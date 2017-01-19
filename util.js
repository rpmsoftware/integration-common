/* global process */
'use strict';
var util = require('util');
var fs = require('fs');

exports.readConfig = function (envName, fileName) {
    var config = process.env[envName] || fs.readFileSync(fileName || 'config.json', 'ascii');
    return JSON.parse(config);
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

exports.toBoolean = function (value) {
    if (typeof value !== 'string') {
        return Boolean(value);
    }
    switch (value.trim().toLowerCase()) {
        case 'true':
        case 'yes':
        case 'y':
        case '1':
            return true;
        case 'false':
        case 'no':
        case 'n':
        case '0':
        case '':
            return false;
        default:
            throw new SyntaxError('Cannot convert to boolean: ' + value);
    }
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
        throw new Error(util.format('Value %s is not in %s', value, array));
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

exports.isEmpty = function (object) {
    if (Array.isArray(object)) {
        return object.length < 1;
    }
    for (var key in object) {
        return false;
    }
    return true;
};

exports.getValues = function (object) {
    if (Array.isArray(object)) {
        return object;
    }
    if (typeof object !== 'object') {
        throw new Error('Object is expected');
    }
    return Object.keys(object).map(key => object[key]);
};

function demandDeepValue(object, keys) {
    function goDeeper(key) {
        if (!object || !object.hasOwnProperty(key)) {
            throw new TypeError('No property: ' + key);
        }
        object = object[key];

    }
    if (Array.isArray(keys)) {
        keys.forEach(goDeeper);
    } else {
        delete arguments['0'];
        for (var key in arguments) {
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

exports.getCache = function (object) {
    object = object || this;
    if (!object._cache) {
        object._cache = {};
    }
    return object._cache;
};

exports.deleteCache = function (object) {
    delete (object || this)._cache;
};

function getEager(object, id, error) {
    var result = object[id];
    if (result === undefined) {
        throwError(error || util.format('Property "%s" not found in object: %s', id, JSON.stringify(object)), 'PropertyNotFoundError', { property: id, object: object });
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
    var error = new Error('' + message);
    if (typeof name !== 'string') {
        data = name;
        name = undefined;
    }
    if (name) {
        error.name = name;
    }
    if (typeof data === 'object') {
        for (var key in data) {
            if (key === 'name' || key === 'message') {
                continue;
            }
            error[key] = data[key];
        }
    }
    throw error;
}

exports.throwError = throwError;

var arrayPrototypeExtensions = {
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

    find: function (callback, includeIndex) {
        for (var ii = 0; ii < this.length; ii++) {
            var element = this[ii];
            if (callback(element, ii)) {
                return includeIndex ? { value: element, index: ii } : element;
            }
        }
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
        value = JSON.parse(value);
    } catch (err) {
    }
    return value;
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

exports.defineStandardProperty = function (replicator, name, getter, setter) {
    var property = {
        get: getter,
        set: setter || undefined,
        enumerable: true,
        configurable: true
    };
    Object.defineProperty(replicator, name, property);
};

exports.createObjectSerializer = function (object, fileName) {
    var running = false;
    var triggered = false;

    function doSave() {
        triggered = false;
        console.log('Saving state');
        fs.writeFile(fileName, JSON.stringify(object), err => {
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
    var result = date instanceof Date ? date : new Date(date);
    if (isNaN(result.getTime())) {
        throw new Error('Invalid date: ' + date);
    }
    return result;
}

exports.normalizeDate = normalizeDate;


function normalizeInteger(value) {
    value = +value;
    if (typeof value !== 'number' || value % 1) {
        throw new TypeError('Invalid integer: ' + value);
    }
    return value;
}

exports.normalizeInteger = normalizeInteger;

exports.logErrorStack = function (error) {
    if (!(error instanceof Error)) {
        if (typeof error === 'object') {
            error = util.format('%j', error);
        }
        error = new Error(error);
    }
    console.error(error.stack);
};

var PARALLEL_REQUESTS = 20;

exports.createParallelRunner = function (parallelRequests) {
    if (typeof parallelRequests !== 'number' || parallelRequests < 1) {
        parallelRequests = PARALLEL_REQUESTS;
        console.log('Using default number of parallel requests: ', PARALLEL_REQUESTS);
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
            queue.push(function () {
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

( /*init logger */() => {
    try {
        var winston = require('winston');
        exports.logger = {
            error: winston.error,
            warn: winston.warn,
            info: winston.info,
            debug: winston.debug,
            trace: winston.trace
        };
    } catch (e) {
        exports.logger = {
            error: console.error,
            warn: console.warn,
            info: console.info,
            debug: console.log,
            trace: console.trace
        };
    }
})();

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
        (Array.isArray(config.day) ? config.day : [config.day]).forEach(d =>
            conf._day[normalizeInteger(typeof d === 'string' ? DAYS[d.trim().toLowerCase()] : d) % 7] = true);
    }
    if (config.month) {
        conf._month = {};
        (Array.isArray(config.month) ? config.month : [config.month]).forEach(d =>
            conf._month[normalizeInteger(typeof d === 'string' ? MONTHS[d.trim().toLowerCase()] : d) % 12] = true);
    }

    if (config.date) {
        conf._date = {};
        (Array.isArray(config.date) ? config.date : [config.date]).forEach(
            d => conf._date[normalizeInteger(d) % 32] = true);
    }

    if (config.hour) {
        conf._hour = {};
        (Array.isArray(config.hour) ? config.hour : [config.hour]).forEach(
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