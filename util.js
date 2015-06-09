'use strict';

var Deferred = require('promised-io/promise').Deferred;

exports.readConfig = function (envName, fileName) {
	var config = process.env[envName] || require('fs').readFileSync(fileName || 'config.json');
	return JSON.parse(config);
};

function Range(min, max) {
    if(max<min) {
        throw 'Invalid range' 
    }
    this.min = min;
    this.max = max;
}

Range.prototype.within=function (value) {
    return this.min<=value && this.max>=value;
}

exports.isInteger = function(value) {
    return typeof value==='number' && !(value % 1);
}

exports.getRejectedPromise = function (error) {
    var deferred = new Deferred();
    deferred.reject(error);
    return deferred.promise;
}

exports.Range = Range;