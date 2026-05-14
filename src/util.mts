import assert from 'assert';
import { readFileSync, writeFile } from 'fs';
import moment from 'dayjs';
import { unzipSync } from 'zlib';
import Debug from 'debug';
const debug = Debug('rpm:util');

export const toArray = <T,>(x?: T[] | T): T[] => Array.isArray(x) ? x : (x ? [x] : []);

type Cache<T> = {
    value?: T
};

Object.assign(String.prototype, {
    ensureRight: function (this: string, right: string) {
        return this.endsWith(right) ? this : this + right;
    }
});

export const cachify = <T,>(callback: () => T | undefined, secTimeout?: number) => {
    let cache: Cache<T> | undefined;
    secTimeout = secTimeout && secTimeout > 0 ? secTimeout * 1000 : 0;
    let timestamp: number = 0;
    return (reset: boolean): Promise<T | undefined> => {
        if (reset || secTimeout && Date.now() - timestamp > secTimeout) {
            cache = undefined;
        }
        return cache ? Promise.resolve(cache.value) : Promise.resolve().then(callback).then(value => {
            cache = { value };
            timestamp = secTimeout && Date.now();
            return value;
        });
    };
};

export const assertInteger = (value: number, positive?: boolean) => {
    assert.strictEqual(typeof value, 'number');
    assert.strictEqual(value % 1, 0);
    positive && assert(value > 0);
    return value;
};

export const isInteger = (value: number) => {
    return typeof value === 'number' && value % 1 === 0;
};


const BOOLEANS: Record<string, boolean> = {
    'true': true,
    'yes': true,
    'y': true,
    '1': true,
    'on': true,
    'false': false,
    'no': false,
    'n': false,
    '0': false,
    '': false,
    'off': false
};

export const toBoolean = (value?: any, demand?: boolean): boolean | undefined => {
    if (typeof value !== 'string') {
        return Boolean(value);
    }
    const result = BOOLEANS[value.trim().toLowerCase()];
    if (result !== undefined) {
        return result;
    }
    const msg = 'Cannot convert to boolean: ' + value;
    if (demand) {
        throw new SyntaxError(msg);
    }
    console.warn(msg);
};

export const readConfig = (envName?: string, fileName?: string, tryUnzip?: boolean) => {
    const config = envName && process.env[envName] || readFileSync(fileName || 'config.json', 'utf8');
    let result;
    try {
        result = JSON.parse(config);
    } catch (e) {
        if (!toBoolean(tryUnzip)) {
            throw e;
        }
        debug('Failed to parse JSON. Trying to unzip base64 stream');
        result = JSON.parse(unzipSync(Buffer.from(config, 'base64')).toString());
    }
    return result;
};

export class NotImplementedError extends Error {
    constructor() {
        super('Implement me')
    }
}

export const isEmpty = (obj: object | any[]) => {
    assert.strictEqual(typeof obj, 'object');
    if (Array.isArray(obj)) {
        return obj.length < 1;
    }
    for (const key in obj) {
        return false;
    }
    return true;
};

export const getValues = (obj: object) => Object.values(obj);

export const throwError = (message: any, name?: string, data?: any): never => {
    const error = new Error('' + message);
    if (typeof name !== 'string') {
        data = name;
        name = undefined;
    }
    if (name) {
        error.name = name;
    }
    if (typeof data === 'object') {
        delete data.name;
        delete data.message;
        Object.assign(error, data);
    }
    throw error;
};

export const pause = (timeout: number, value?: any) =>
    new Promise(resolve => setTimeout(() => resolve(value), normalizeInteger(timeout)));

export const validateString = (value: any) => {
    if (typeof value !== 'string' || value.length < 1) {
        throw new Error(`Non-empty string is expected ("${value}")`);
    }
    return value;
};

export const toMoment = (value: any, validate: boolean): moment.Dayjs => {
    value = moment.isDayjs(value) ? value : moment(value);
    validate && assert(value.isValid());
    return value;
};

export const toBuffer = (data: any) => Buffer.isBuffer(data) ? data : Buffer.from(data);
export const toBase64 = (data: any) => toBuffer(data).toString('base64');

export const createPropertySorter = (property: string) => (a: any, b: any) => {
    const nameA = a[property];
    const nameB = b[property];
    return nameA === nameB ? 0 : (nameA < nameB ? -1 : 1);
};

export const getDataURLPrefix = (type: string) => `data:${type.toLowerCase()};base64,`;

export const normalizeInteger = (value: any): number => {
    let intValue = value;
    if (typeof intValue === 'string') {
        intValue = intValue.trim();
        intValue = intValue && +intValue;
    }
    if (isNaN(intValue) || intValue % 1) {
        throw new TypeError('Invalid integer: ' + value);
    }
    return intValue;
};

export const isResponseJSON = (response: Response) => {
    const type = response.headers.get('content-type');
    return type ? type.toLowerCase().indexOf('application/json') >= 0 : false;
};


export const isEmptyValue = (v: any) => v === undefined || v === null || v === '';

export const round = (value: number, factor?: number) =>
    factor ? Math.round(value * factor) / factor : Math.round(value);

export const isDisabled = (obj: any) => obj.enabled !== undefined && !toBoolean(obj.enabled);

export const createCaselessGetter = (object: any) => {
    const obj: any = {};
    for (const key in object) {
        obj[key.toLocaleLowerCase()] = object[key];
    }
    return (name: string) => obj[name.toLocaleLowerCase()];
};

export const setParent = (obj: object, parent: any) =>
    Object.defineProperty(obj, 'parent', { value: parent });

export const createTimeBasedIDGenerator = (start: any) => {
    if (start || (start = 0)) {
        start = new Date(start).getTime();
        assert(!isNaN(start));
        assert(start < Date.now());
    }
    let nextID: number;
    return () => {
        nextID > 0 || (nextID = Date.now() - start);
        return nextID++;
    };
};

export const validatePropertyConfig = (p: any) => {
    const result = toArray(p);
    const { length } = result;
    assert(length > 0);
    result.forEach(p => typeof p === 'object' && !Array.isArray(p) || validateString(p));
    return length > 1 ? result : result[0];
};

export const defineStandardProperty = (
    obj: object, name: string, getter?: () => any, setter?: () => any
) =>
    Object.defineProperty(obj, name, {
        get: getter,
        set: setter || undefined,
        enumerable: true,
        configurable: true
    });


export const createObjectSerializer = (object: any, fileName: string) => {
    let running = false;
    let triggered = false;

    const doSave = () => {
        triggered = false;
        debug('Saving state');
        writeFile(fileName, JSON.stringify(object), err => {
            running = false;
            if (err) {
                console.error(err);
            }
            if (triggered) {
                doSave();
            }
        });
    };

    return () => {
        triggered = true;
        if (!running) {
            running = true;
            doSave();
        }
    };
}

export const singleRun = (callback: (stop?: () => void) => any) => {
    let running = false;

    const stop = () => { running = false };

    return function () {
        if (running) {
            console.warn('Already running', callback);
            return;
        }
        running = true;
        try {
            callback(stop);
        } catch (err) {
            stop();
            throw err;
        }
    };
};

export function normalizeDate(date: any) {
    let result;
    if (date instanceof Date) {
        result = date;
    } else if (typeof date === 'string' && date.toUpperCase().indexOf('T') >= 0) {
        result = moment(result).toDate();
    } else if (date !== undefined && date !== null) {
        result = new Date(date);
    }
    if (!result || isNaN(result.getTime())) {
        throw new Error('Invalid date: ' + date);
    }
    return result;
}

export function logErrorStack(error: any) {
    if (!(error instanceof Error)) {
        if (typeof error === 'object') {
            error = JSON.stringify(error);
        }
        error = new Error(error);
    }
    console.error(error.stack);
};

export const defineLazyProperty = (obj: object, name: string, init: () => any) => {
    const hiddenProperty = Symbol();
    Object.defineProperty(obj, name, {
        get() {
            let result = this[hiddenProperty];
            if (result === undefined) {
                result = init.call(this);
                Object.defineProperty(this, hiddenProperty, { value: result });
            }
            return result;
        }
    });
};

const FETCH_ERROR = 'FetchError';

export const validateFetchResponse = async (response: Response | Promise<Response>) => {
    response = await response;
    const { ok, status, statusText, headers } = response;
    if (ok) {
        return response;
    }
    let error = await response.text();
    error && console.error(error);
    // statusText || (statusText = undefined);
    try {
        error = error && JSON.parse(error);
    } catch {
        // ;
    }
    throwError(statusText || status, FETCH_ERROR, { status, statusText, error, headers });
    return response;
};

export const fetch2json = async (response: Response | Promise<Response>) => {
    const result = await validateFetchResponse(response).then(r => r.text());
    try {
        return result ? JSON.parse(result) : undefined;
    } catch (e) {
        console.error(result);
        throw e;
    }
};

function fetchAndValidate(...args: Parameters<typeof fetch>) {
    return validateFetchResponse(fetch(...args));
}
export { fetchAndValidate as fetch };

const GLOBAL: HashMap = {};
export const getGlobal = () => GLOBAL;


const MONTHS: Record<string, number> = {};
['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
    .forEach((month, idx) => MONTHS[month] = idx);

const DAYS: Record<string, number> = {};
['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    .forEach((day, idx) => DAYS[day] = idx);

type StringOrNumber = string | number;
type Num2Bool = Record<number, boolean>;

export const createDateMatcher = (config: {
    day?: StringOrNumber,
    month?: StringOrNumber,
    date?: StringOrNumber,
    hour?: StringOrNumber
}) => {
    const conf = {
        day: {} as Num2Bool,
        month: {} as Num2Bool,
        date: {} as Num2Bool,
        hour: {} as Num2Bool
    };

    if (config.day) {
        conf.day = {};
        toArray(config.day).forEach(d =>
            conf.day[normalizeInteger(typeof d === 'string' ? DAYS[d.trim().toLowerCase()] : d) % 7] = true);
    }
    if (config.month) {
        conf.month = {};
        toArray(config.month).forEach(d =>
            conf.month[normalizeInteger(typeof d === 'string' ? MONTHS[d.trim().toLowerCase()] : d) % 12] = true);
    }

    if (config.date) {
        conf.date = {};
        toArray(config.date).forEach(
            d => conf.date[normalizeInteger(d) % 32] = true);
    }

    if (config.hour) {
        conf.hour = {};
        toArray(config.hour).forEach(
            d => conf.hour[normalizeInteger(d) % 24] = true);
    }
    return (...args: Parameters<typeof normalizeDate>) => {
        const date = normalizeDate(args);
        return !(
            conf.day && !conf.day[date.getDay()] ||
            conf.date && !conf.date[date.getDate()] ||
            conf.month && !conf.month[date.getMonth()] ||
            conf.hour && !conf.hour[date.getHours()]
        );
    };
};


const PARALLEL_REQUESTS = 20;
const MS_WAIT = 10;

export const createParallelRunner = (parallelRequests: number = PARALLEL_REQUESTS, perMilliseconds: number = 0) => {
    parallelRequests = +parallelRequests;
    perMilliseconds = +perMilliseconds;

    assert(perMilliseconds >= 0);
    assert(parallelRequests > 0);

    let queue = [] as (() => any)[];
    const slots = [] as { available: boolean, lastUsed?: number }[];

    let running = false;

    const push = async (cb: () => Promise<void>) => {
        queue.push(cb);
        if (running) {
            return;
        }
        running = true;
        while (queue.length > 0) {
            let slot;
            if (slots.length < parallelRequests) {
                slot = { available: true };
                slots.push(slot);
            } else {
                const now = Date.now();
                slot = slots.find(({ available, lastUsed }) => available && now - (lastUsed || 0) > perMilliseconds);
            }
            if (!slot) {
                await pause(MS_WAIT);
                continue;
            }
            slot.available = false;
            const cb = queue.shift();
            assert(cb);
            cb().finally(() => {
                slot.available = true;
                slot.lastUsed = Date.now();
            });
        }
        running = false;
    };

    return (callback: () => any) => {
        assert.strictEqual(typeof callback, 'function');
        return new Promise((resolve, reject) => push(async () => {
            try {
                resolve(await callback());
            } catch (error) {
                queue = [];
                reject(error);
            }
        }));
    };
};

const HEROKU_ENVIRONMENT: Record<string, RegExp | string> = {
    DYNO: /^web\.\d+$/,
    PORT: /^\d+$/,
    NODE_HOME: '/app/.heroku/node',
};


export const isHeroku = () => {
    for (const key in HEROKU_ENVIRONMENT) {
        const value = HEROKU_ENVIRONMENT[key];
        const env = process.env[key];
        if (!env || typeof value === 'string' && value !== env || value instanceof RegExp && !value.test(env)) {
            return false;
        }
    }
    return true;
};


export const tryJsonParse = (value: any) => {
    if (typeof value !== 'string') {
        return value;
    }
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
};


export const demandDeepValue = (obj: any, keys: string | string[]) => {
    const goDeeper = (key: string | HashMap) => {
        if (typeof obj !== 'object') {
            throw new TypeError('No property: ' + JSON.stringify(key));
        }
        if (typeof key === 'object') {
            assert(Array.isArray(obj));
            assert(!isEmpty(key));
            obj = demandArrayValue.call(obj, e => {
                for (const k in key) {
                    if (e[k] !== key[k]) {
                        return false;
                    }
                }
                return true;
            });
        } else {
            obj = obj[key];
        }

    }
    keys = toArray(keys);
    assert(keys.length > 0);
    keys.forEach(s => goDeeper(s));
    return obj;
}

export const getDeepValue = (...args: Parameters<typeof demandDeepValue>) => {
    try {
        return demandDeepValue(...args);
    } catch (error) {
        if (!(error instanceof TypeError)) {
            throw error;
        }
    }
}

export const getOrCreate = (object: HashMap, key: string, defaultValue?: any) => {
    let result = object[key];
    if (result === undefined && defaultValue !== undefined) {
        result = object[key] = defaultValue;
    }
    return result;
};

export const getEager = (object: HashMap, id: string, error?: string) => {
    const result = object[id];
    result === undefined && throwError(
        error || `Property "${id}" not found in object: ${JSON.stringify(object)}`,
        'PropertyNotFoundError',
        { property: id, object: object }
    );
    return result;
}

function demandArrayValue(this: any[], ...args: Parameters<typeof Array.prototype.find>) {
    const result = this.find(...args);
    if (result === undefined) {
        throw new TypeError('Array element not found');
    }
    return result;
};

type HashMap = Record<string, any>;

function arrayAggregate(this: any[], aggrProp: string, reducer: () => any, groupProps: string | string[]) {
    const result = arrayGroup.call(this, aggrProp, groupProps);
    result.forEach(e => e[aggrProp] = e[aggrProp].reduce(reducer, undefined));
    return result;
}

function arrayAggregateMerge(this: any[], reducer: () => any, groupProps: string | string[]) {
    const result = arrayGroup.call(this, PROP_AGGREGATE, groupProps);
    result.forEach(e => {
        const a = e[PROP_AGGREGATE];
        delete e[PROP_AGGREGATE];
        Object.assign(e, a.reduce(reducer, {}));
    });
    return result;
}

function arrayGroup(this: any[], aggrProp: string | symbol, groupProps: string | string[]) {
    groupProps = toArray(groupProps);
    assert(groupProps.length > 0);
    groupProps.forEach(p => {
        assert.strictEqual(typeof p, 'string')
        assert.notStrictEqual(p, aggrProp);
    });
    const result: HashMap = {};
    this.forEach(e => {
        const groupValues: HashMap = {};
        const key1 = groupProps.map(p => {
            const v = groupValues[p] = e[p];
            return isEmptyValue(v) ? '' : v;
        });
        const key = `[${key1.join('][')}]`
        let grp = result[key];
        if (!grp) {
            grp = result[key] = groupValues;
            grp[aggrProp] = [];
        }
        grp[aggrProp].push(e);
    });
    return Object.values(result);
}

Object.assign(Array.prototype, {
    demandIndexOf: function (this: any[], element: any) {
        const result = this.indexOf(element);
        if (result < 0) {
            throw new Error('Array element not found: ' + element);
        }
        return result;
    },

    equals: function (this: any[], another: any[]) {
        if (this.length != another.length) {
            return false;
        }
        for (const idx of this) {
            if (this[idx] !== another[idx]) {
                return false;
            }
        }
        return true;
    },

    clear: function (this: any[]) {
        while (this.length > 0) {
            this.pop();
        }
    },

    pushUnique: function (this: any[], value: any) {
        const result = this.indexOf(value) < 0;
        if (result) {
            this.push(value);
        }
        return result;

    },

    demand: demandArrayValue,

    toObject: function (this: any[], keyProperty: string) {
        const result: HashMap = {};
        this.forEach(element => {
            const key = keyProperty === undefined ? element : getDeepValue(element, keyProperty);
            if (key === undefined) {
                throw Error('Property cannot be empty: ' + keyProperty);
            }
            if (result[key]) {
                throw Error('Duplicate key property value: ' + key);
            }
            result[key] = element;
        });
        return result;
    },

    getRandomElement: function (this: any[]) {
        return this[Math.trunc(Math.random() * this.length)];
    },

    removeRandomElement: function (this: any[]) {
        if (this.length > 0) {
            return this.splice(Math.trunc(Math.random() * this.length), 1)[0];
        }
    },

    shuffle: function (this: any[]) {
        const copy = [...this];
        const result = [];
        while (copy.length > 0) {
            result.push(copy.splice(Math.trunc(Math.random() * copy.length), 1)[0]);
        }
        return result;
    },

    aggregate: arrayAggregate,

    aggregateMerge: arrayAggregateMerge,

    group: arrayGroup,

    toSet: function (this: any[]) {
        const result = [];
        for (let ii = 0; ii < this.length; ii++) {
            const element = this[ii];
            let duplicate;
            for (let jj = ii + 1; jj < this.length; jj++) {
                duplicate = element === this[jj];
                if (duplicate) {
                    break;
                }
            }
            !duplicate && result.push(element);
        }
        return result;
    }

});

const PROP_AGGREGATE = Symbol();

