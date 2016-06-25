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
    return typeof value === 'number' && !(value % 1);
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
        case '1':
            return true;
        case 'false':
        case 'no':
        case '0':
        case '':
            return false;
        default:
            throw new SyntaxError('Cannot convert to boolean: ' + value);
    }
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
    if (typeof object !== 'object') {
        throw new Error('Object is expected');
    }
    return Object.keys(object).map(function (key) {
        return object[key];
    });
};

exports.getDeepValue = function (object, keys) {
    if (!Array.isArray(keys)) {
        keys = arguments;
        keys.shift();
    }
    try {
        keys.forEach(function (key) {
            object = object[key];
        });
    } catch (error) {
        if (!(error instanceof TypeError)) {
            throw error;
        }
    }
    return object;
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

    for (var key in obj1) {
        matcher(obj1[key], getEager(obj2, key));
        names[key] = true;
    }

    for (var key in obj2) {
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

    find: function (callback) {
        for (var ii = 0; ii < this.length; ii++) {
            var element = this[ii];
            if (callback(element, ii)) {
                return element;
            }
        };
    },

    toObject: function (keyProperty) {
        var result = {};
        this.forEach(function (element) {
            var key = element[keyProperty];
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
        fs.writeFile(fileName, JSON.stringify(object), function (err) {
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

exports.normalizeDate = function (date) {
    var result = date instanceof Date ? date : new Date(date);
    if (isNaN(result.getTime())) {
        throw new Error('Invalid date: ' + date);
    }
    return result;
};

exports.normalizeInteger = function (value) {
    value = +value;
    if (typeof value !== 'number' || value % 1) {
        throw new TypeError('Invalid integer: ' + value);
    }
    return value;
};

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


        var promise = new Promise(function (resolve, reject) {
            function res(result) {
                resolve(result);
                --running;
                shift();
            };
            function rej(error) {
                queue = [];
                reject(error);
                --running;
            };
            queue.push(function () {
                try {
                    var result = callback();
                    result instanceof Promise ? result.then(res, rej) : res(result);
                } catch (error) {
                    rej(error);
                }
            });
        });
        setTimeout(shift, 0);
        return promise;

    }


};
