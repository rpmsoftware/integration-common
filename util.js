/* global Buffer, process */

const debug = require('debug')('rpm:util');
const { readFileSync, writeFile } = require('fs');
const moment = require('dayjs');
const assert = require('assert');
const { unzipSync } = require('zlib');

String.prototype.ensureRight = function (right) {
    return this.endsWith(right) ? this : this + right;
};

exports.readConfig = function (envName, fileName, tryUnzip) {
    const config = process.env[envName] || readFileSync(fileName || 'config.json', 'utf8');
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

function Range(min, max) {
    if (max < min) {
        throw new Error('Invalid range');
    }
    this.min = min;
    this.max = max;
}

Range.prototype.within = function (value) {
    return this.min <= value && this.max >= value;
};

exports.isInteger = function (value) {
    return typeof value === 'number' && value % 1 === 0;
};

exports.Range = Range;

exports.runOnce = function (callable, parameters) {
    var run = true;
    return function () {
        if (!run) {
            run = false;
            callable.apply(null, parameters);
        }
    };
};

function clearArray(array) {
    while (array.length) {
        array.pop();
    }
}

exports.clearArray = clearArray;

const BOOLEANS = {
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

const toBoolean = exports.toBoolean = (value, demand) => {
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

exports.createDateNormalizer = function (timeZone) {
    if (!timeZone) {
        return normalizeDate;
    }
    var moment = require('moment-timezone');
    if (!moment.tz.zone(timeZone)) {
        throw new Error('Unknown time zone: ' + timeZone);
    }
    return function (date) {
        date = normalizeDate(date);
        date.setMinutes(date.getMinutes() + moment(date).utcOffset() - moment().tz(timeZone).utcOffset());
        return date;
    };
};

exports.indexOf = function (array, value) {
    var result = array.indexOf(value);
    if (result < 0) {
        throw new Error(`Value ${value} is not in [${array.join(',')}]`);
    }
    return result;
};

function NotImplementedError() {
    Error.call(this, 'Implement me');
}

NotImplementedError.prototype = new Error();

exports.NotImplementedError = NotImplementedError;

function Statistics(name) {
    this.name = name;
    this.added = 0;
    this.updated = 0;
    this.deleted = 0;
}

Statistics.prototype.incUpdated = function () {
    ++this.updated;
};

Statistics.prototype.incDeleted = function () {
    ++this.deleted;
};
Statistics.prototype.incAdded = function () {
    ++this.added;
};

Statistics.prototype.hasChanges = function () {
    return Boolean(this.added || this.updated || this.deleted);
};

exports.ChangeStatistics = Statistics;

const isEmpty = object => {
    assert.strictEqual(typeof object, 'object');
    if (Array.isArray(object)) {
        return object.length < 1;
    }
    for (const key in object) {
        return false;
    }
    return true;
};

exports.isEmpty = isEmpty;

exports.getValues = Object.values;

function demandDeepValue(object, keys) {
    function goDeeper(key) {
        if (typeof object !== 'object') {
            throw new TypeError('No property: ' + JSON.stringify(key));
        }
        if (typeof key === 'object') {
            assert(Array.isArray(object));
            assert(!isEmpty(key));
            object = object.demand(e => {
                for (let k in key) {
                    if (e[k] !== key[k]) {
                        return false;
                    }
                }
                return true;
            });
        } else {
            object = object[key];
        }

    }
    if (Array.isArray(keys)) {
        keys.forEach(goDeeper);
    } else {
        delete arguments['0'];
        for (const key in arguments) {
            goDeeper(arguments[key]);
        }
    }
    return object;
}

exports.demandDeepValue = demandDeepValue;

exports.getDeepValue = function () {
    try {
        return demandDeepValue.apply(undefined, arguments);
    } catch (error) {
        if (!(error instanceof TypeError)) {
            throw error;
        }
    }
};

exports.getOrCreate = function (object, key, defaultValue) {
    var result = object[key];
    if (result === undefined && defaultValue !== undefined) {
        result = object[key] = defaultValue;
    }
    return result;
};

const CACHE_PROPERTY = Symbol();

exports.getCache = function (object) {
    object = object || this;
    if (!object[CACHE_PROPERTY]) {
        object[CACHE_PROPERTY] = {};
    }
    return object[CACHE_PROPERTY];
};

exports.deleteCache = function (object) {
    delete (object || this)._cache;
};

function getEager(object, id, error) {
    var result = object[id];
    if (result === undefined) {
        throwError(error || `Property "${id}" not found in object: ${JSON.stringify(object)}`, 'PropertyNotFoundError', { property: id, object: object });
    }
    return result;
}
exports.getEager = getEager;

function dummy() {
}

function matchObjects(obj1, obj2, matcher) {
    var names = {};

    matcher = matcher || dummy;

    var key;
    for (key in obj1) {
        matcher(obj1[key], getEager(obj2, key));
        names[key] = true;
    }

    for (key in obj2) {
        if (!names[key]) {
            matcher(getEager(obj1, key), obj2[key]);
        }
    }
}
exports.matchObjects = matchObjects;

function throwError(message, name, data) {
    const error = new Error('' + message);
    if (typeof name !== 'string') {
        data = name;
        name = undefined;
    }
    if (name) {
        error.name = name;
    }
    if (typeof data === 'object') {
        for (const key in data) {
            if (key === 'name' || key === 'message') {
                continue;
            }
            error[key] = data[key];
        }
    }
    throw error;
}

exports.throwError = throwError;

const DEFAULT_CHILDREN_PROPERTY = '_children';

const arrayPrototypeExtensions = {
    demandIndexOf: function (element) {
        var result = this.indexOf(element);
        if (result < 0) {
            throw new Error('Array element not found: ' + element);
        }
        return result;
    },

    equals: function (another) {
        if (this.length != another.length) {
            return false;
        }
        for (var idx in this) {
            if (this[idx] !== another[idx]) {
                return false;
            }
        }
        return true;

    },

    contains: function (value) {
        return this.indexOf(value) >= 0;
    },

    clear: function () {
        clearArray(this);

    },

    pushUnique: function (value) {
        var result = this.indexOf(value) < 0;
        if (result) {
            this.push(value);
        }
        return result;

    },

    demand: function () {
        const result = this.find.apply(this, arguments);
        if (result === undefined) {
            throw new TypeError('Array element not found');
        }
        return result;
    },

    toObject: function (keyProperty) {
        var result = {};
        this.forEach(element => {
            var key = keyProperty === undefined ? element : element[keyProperty];
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

    getRandomElement: function () {
        return this[Math.trunc(Math.random() * this.length)];
    },

    removeRandomElement: function () {
        if (this.length > 0) {
            return this.splice(Math.trunc(Math.random() * this.length), 1)[0];
        }
    },

    shuffle: function () {
        const copy = this.concat();
        const result = [];
        while (copy.length > 0) {
            result.push(copy.splice(Math.trunc(Math.random() * copy.length), 1)[0]);
        }
        return result;
    },

    aggregate: function (aggrProp, reducer, groupProps) {
        if (!Array.isArray(groupProps)) {
            groupProps = Object.values(arguments);
            groupProps.shift();
            groupProps.shift();
        }
        groupProps.forEach(p => {
            assert.strictEqual(typeof p, 'string')
            assert.notStrictEqual(p, aggrProp);
        });
        let result = {};
        this.forEach(e => {
            let groupValues = {};
            groupProps.forEach(p => groupValues[p] = getEager(e, p));
            let key = `[${Object.values(groupValues).join('][')}]`
            let grp = result[key];
            if (!grp) {
                grp = result[key] = groupValues;
                grp[aggrProp] = [];
            }
            grp[aggrProp].push(getEager(e, aggrProp));
        });
        result = Object.values(result);
        result.forEach(e => e[aggrProp] = e[aggrProp].reduce(reducer));
        return result;
    },

    group: function (aggrProp, groupProps) {
        typeof aggrProp === 'symbol' || validateString(aggrProp);
        if (!Array.isArray(groupProps)) {
            groupProps = Object.values(arguments);
            groupProps.shift();
        }
        groupProps.forEach(p => {
            assert.strictEqual(typeof p, 'string')
            assert.notStrictEqual(p, aggrProp);
        });
        let result = {};
        this.forEach(e => {
            let groupValues = {};
            let key = groupProps.map(p => {
                const v = e[p];
                groupValues[p] = v;
                delete e[p];
                return v;
            });
            key = `[${key.join('][')}]`
            let grp = result[key];
            if (!grp) {
                grp = result[key] = groupValues;
                grp[aggrProp] = [];
            }
            grp[aggrProp].push(e);
        });
        return Object.keys(result).sort().map(k => result[k]);
    },

    buildHierarchy: function ({ groupProperties, childrenProperty }) {
        childrenProperty = childrenProperty ? validateString(childrenProperty) : DEFAULT_CHILDREN_PROPERTY;
        assert(groupProperties);
        groupProperties = toArray(groupProperties);
        const groupLevel = (array, level) => {
            level = level || 0;
            if (level < groupProperties.length) {
                array = array.group(childrenProperty, groupProperties[level]);
                array.forEach(e => e[childrenProperty] = groupLevel(e[childrenProperty], level + 1));
            }
            return array;
        };
        return groupLevel(this);
    },

    toSet: function () {
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

};

function extendArrayPrototype() {
    var existing = Object.getOwnPropertyNames(Array.prototype);
    for (var property in arrayPrototypeExtensions) {
        if (existing.indexOf(property) < 0) {
            Object.defineProperty(Array.prototype, property, { value: arrayPrototypeExtensions[property] });
        }
    }
}

exports.tryJsonParse = function (value) {
    if (typeof value !== 'string') {
        return value;
    }
    try {
        return JSON.parse(value);
    } catch (err) {
        return value;
    }
};

extendArrayPrototype();

exports.forcePrototype = function (base, data) {
    var result = Object.create(base.prototype);
    for (var key in data) {
        result[key] = data[key];
    }
    return result;
};

exports.isHeroku = function () {
    for (var key in HEROKU_ENVIRONMENT) {
        var value = HEROKU_ENVIRONMENT[key];
        var env = process.env[key];
        if (!env || typeof value === 'string' && value !== env || value.test && !value.test(env)) {
            return false;
        }
    }
    return true;
};

var HEROKU_ENVIRONMENT = {
    DYNO: /^web\.\d+$/,
    PORT: /^\d+$/,
    NODE_HOME: '/app/.heroku/node',
};

exports.defineStandardProperty = function (obj, name, getter, setter) {
    return Object.defineProperty(obj, name, {
        get: getter,
        set: setter || undefined,
        enumerable: true,
        configurable: true
    });
};

exports.createObjectSerializer = function (object, fileName) {
    var running = false;
    var triggered = false;

    function doSave() {
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

    }

    return function () {
        triggered = true;
        if (!running) {
            running = true;
            doSave();
        }
    };
};

exports.singleRun = function (callback) {
    var running = false;

    function stop() {
        running = false;
    }

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

function normalizeDate(date) {
    let result;
    if (date instanceof Date) {
        result = date;
    } else if (typeof result === 'string' && result.toUpperCase().indexOf('T') >= 0) {
        result = moment(result).toDate();
    } else if (date !== undefined && date !== null) {
        result = new Date(date);
    }
    if (!result || isNaN(result.getTime())) {
        throw new Error('Invalid date: ' + date);
    }
    return result;
}

exports.normalizeDate = normalizeDate;


function normalizeInteger(value) {
    let intValue = value;
    if (typeof intValue === 'string') {
        intValue = intValue.trim();
        intValue = intValue && +intValue;
    }
    if (isNaN(intValue) || intValue % 1) {
        throw new TypeError('Invalid integer: ' + value);
    }
    return intValue;
}

exports.normalizeInteger = normalizeInteger;

exports.logErrorStack = function (error) {
    if (!(error instanceof Error)) {
        if (typeof error === 'object') {
            error = JSON.stringify(error);
        }
        error = new Error(error);
    }
    console.error(error.stack);
};

var PARALLEL_REQUESTS = 20;

exports.createParallelRunner = function (parallelRequests) {
    if (typeof parallelRequests !== 'number' || parallelRequests < 1) {
        parallelRequests = PARALLEL_REQUESTS;
        debug('Using default number of parallel requests: ', PARALLEL_REQUESTS);
    }
    var queue = [];
    var running = 0;

    function shift() {
        if (queue.length > 0 && running < parallelRequests) {
            ++running;
            var cb = queue.shift();
            cb();
        }
    }

    return function (callback) {
        if (typeof callback !== 'function') {
            throw new Error('Function expected');
        }


        var promise = new Promise((resolve, reject) => {
            function res(result) {
                resolve(result);
                --running;
                shift();
            }
            function rej(error) {
                queue = [];
                reject(error);
                --running;
            }
            queue.push(() => {
                try {
                    var result = callback();
                    (result instanceof Promise) ? result.then(res, rej) : res(result);
                } catch (error) {
                    rej(error);
                }
            });
        });
        setTimeout(shift, 0);
        return promise;

    };


};

exports.logger = require('./logger')();

var MONTHS = {};
['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
    .forEach((month, idx) => MONTHS[month] = idx);

var DAYS = {};
['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    .forEach((day, idx) => DAYS[day] = idx);

exports.createDateMatcher = function (config) {
    var conf = {};
    if (config.day) {
        conf._day = {};
        toArray(config.day).forEach(d =>
            conf._day[normalizeInteger(typeof d === 'string' ? DAYS[d.trim().toLowerCase()] : d) % 7] = true);
    }
    if (config.month) {
        conf._month = {};
        toArray(config.month).forEach(d =>
            conf._month[normalizeInteger(typeof d === 'string' ? MONTHS[d.trim().toLowerCase()] : d) % 12] = true);
    }

    if (config.date) {
        conf._date = {};
        toArray(config.date).forEach(
            d => conf._date[normalizeInteger(d) % 32] = true);
    }

    if (config.hour) {
        conf._hour = {};
        toArray(config.hour).forEach(
            d => conf._hour[normalizeInteger(d) % 24] = true);
    }
    return function (date) {
        date = normalizeDate(date);
        return !(
            conf._day && !conf._day[date.getDay()] ||
            conf._date && !conf._date[date.getDate()] ||
            conf._month && !conf._month[date.getMonth()] ||
            conf._hour && !conf._hour[date.getHours()]
        );
    };
};

exports.promiseFinally = function (callback) {
    return function (promise) {
        return promise.then(result => {
            var cbResult = callback();
            return cbResult instanceof Promise ? cbResult.then(() => result) : result;
        }, error => {
            var cbResult = callback();
            if (cbResult instanceof Promise) {
                return cbResult.then(() => {
                    throw error;
                });
            }
            throw error;
        });
    };
};

exports.pause = function (timeout, value) {
    return new Promise(resolve => setTimeout(() => resolve(value), normalizeInteger(timeout)));
};

exports.cachify = function (callback, secTimeout) {
    var cache;
    secTimeout = +secTimeout;
    secTimeout = secTimeout > 0 ? secTimeout * 1000 : 0;
    var last = 0;
    return function (reset) {
        if (reset || secTimeout && Date.now() - last > secTimeout) {
            cache = undefined;
        }
        return cache ? Promise.resolve(cache.value) : Promise.resolve().then(callback).then(value => {
            cache = { value };
            last = secTimeout && Date.now();
            return value;
        });
    };
};

exports.promisify = function (callable) {
    return function (...params) {
        return new Promise((resolve, reject) => {
            params.push((error, result) => error ? reject(error) : resolve(result));
            callable.apply(this, params);
        });

    };
};

const validateString = exports.validateString = value => {
    if (typeof value !== 'string' || value.length < 1) {
        throw new Error(`Non-empty string is expected ("${value}")`);
    }
    return value;
};

exports.toMoment = (value, validate) => {
    value = moment.isDayjs(value) ? value : moment(value);
    validate && assert(value.isValid());
    return value;
};

const toArray = exports.toArray = value => value === undefined ? [] : (Array.isArray(value) ? value : [value]);

const toBuffer = exports.toBuffer = data => Buffer.isBuffer(data) ? data : Buffer.from(data);
exports.toBase64 = data => toBuffer(data).toString('base64');

exports.createPropertySorter = property => (a, b) => {
    const nameA = a[property];
    const nameB = b[property];
    return nameA === nameB ? 0 : (nameA < nameB ? -1 : 1);
};

exports.getDataURLPrefix = type => `data:${type.toLowerCase()};base64,`;

exports.defineLazyProperty = (obj, name, init) => {
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

const validateFetchResponse = exports.validateFetchResponse = async response => {
    response = await response;
    let { ok, status, statusText } = response;
    if (ok) {
        return response;
    }
    response = await response.text();
    statusText || (statusText = undefined);
    try {
        response = response && JSON.parse(response);
    } catch (e) {
        // ;
    }
    throwError(statusText || status, FETCH_ERROR, { status, statusText, response });
};

exports.fetch = function () {
    return validateFetchResponse(fetch.apply(this, arguments));
};

exports.fetch2json = async response => {
    response = await validateFetchResponse(response).then(r => r.text());
    try {
        return response ? JSON.parse(response) : undefined;
    } catch (e) {
        console.error(response);
        throw e;
    }
};

exports.validatePropertyConfig = p => {
    const result = toArray(p);
    const { length } = result;
    assert(length > 0);
    result.forEach(p => typeof p === 'object' && !Array.isArray(p) || validateString(p));
    return length > 1 ? result : result[0];
};

exports.setParent = (obj, parent) => Object.defineProperty(obj, 'parent', { value: parent });

exports.createTimeBasedIDGenerator = start => {
    if (start || (start = 0)) {
        start = new Date(start).getTime();
        assert(!isNaN(start));
        assert(start < Date.now());
    }
    let nextID;
    return () => {
        nextID || (nextID = Date.now() - start);
        return nextID++;
    };
};

const EMPTY_STRING = '';

const isEmptyValue = exports.isEmptyValue = v => v === undefined || v === null || v === EMPTY_STRING;

const PROP_GLOBAL = Symbol();

exports.getGlobal = () => {
    let result = global[PROP_GLOBAL];
    if (!result) {
        result = {};
        Object.defineProperty(global, PROP_GLOBAL, { value: result });
    }
    return result;
};

exports.round = (value, factor) => factor ? Math.round(value * factor) / factor : Math.round(value);

exports.coalesce = function (array) {
    for (const v of Array.isArray(array) ? array : arguments) {
        if (!isEmptyValue(v)) {
            return v;
        }
    }
};
