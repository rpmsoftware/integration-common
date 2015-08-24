'use strict';
var util = require('util');
var fs = require('fs');

var Deferred = require('promised-io/promise').Deferred;

exports.readConfig = function (envName, fileName) {
    var config = process.env[envName] || fs.readFileSync(fileName || 'config.json');
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
}

exports.isInteger = function (value) {
    return typeof value === 'number' && !(value % 1);
}

exports.getRejectedPromise = function (error) {
    var deferred = new Deferred();
    deferred.reject(error);
    return deferred.promise;
}

exports.Range = Range;

exports.runOnce = function (callable, parameters) {
    var run = true;
    return function () {
        if (!run) {
            run = false;
            callable.apply(null, parameters);
        }
    }
}

exports.clearArray = function (array) {
    while (array.length) {
        array.pop();
    }
}

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
            throw new Error('Cannot convert to boolean: ' + value);
    }
}

exports.indexOf = function (array, value) {
    var result = array.indexOf(value);
    if (result < 0) {
        throw new Error(util.format('Value %s is not in %s', value, array));
    }
    return result;
}

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
    for (var key in object) {
        return false;
    }
    return true;
}

exports.getDeepValue = function (object, keys) {
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
}

exports.getOrCreate = function (object, key, defaultValue) {
    var result = object[key];
    if (result === undefined && defaultValue !== undefined) {
        result = object[key] = defaultValue;
    }
    return result;
}

exports.getCache = function () {
    if (!this._cache) {
        this._cache = {};
    }
    return this._cache;
}

exports.deleteCache = function () {
    delete this._cache;
}

exports.pushIfNotIn = function (array, value) {
    var result = array.indexOf(value) < 0;
    if (result) {
        array.push(value);
    }
    return result;
}

exports.getEager =function (object, id, error) {
    var result = object[id];
    if (!result) {
        throw new Error((error || 'Unknown element: ') + id);
    }
    return result;
}