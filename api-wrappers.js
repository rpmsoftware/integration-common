'use strict';
require('string').extendPrototype();

var Promised = require('promised-io/promise');
var Deferred = Promised.Deferred;
var RESTClient = require('node-rest-client').Client;

function EndPoint(apiServer, name) {
    this.name = name;
    this.apiServer = apiServer;
}

EndPoint.prototype.getUrl = function () {
    return this.apiServer.getUrl(this.name);
};

EndPoint.prototype.request = function (data) {
    return this.apiServer.request(this.name);
};

function API(url, key, name) {
    if (!arguments) {
        return;
    }
    if (typeof url === 'object') {
        key = url.key
        name = url.name
        url = url.url
    }
    this.url = url;
    this.key = key;
    this.name = name;
}

API.prototype.getUrl = function (endPoint) {
    var url = this.url.toLowerCase().ensureRight('/');
    url = url.ensureRight('rpm/');
    url = url.ensureRight('Api2.svc/');
    return url + endPoint;
};


API.prototype.request = function (endPoint, data) {
    var args = { headers: this.getHeaders(), data: data };
    var url = this.getUrl(endPoint);
    var deferred = new Deferred();
    console.log('\nPOST ' + url + '\n\n' + JSON.stringify(data) + '\n\n');
    var requestTime = new Date();
    new RESTClient().post(url, args, function (data, response) {
        var responseTime = new Date();
        var doneData;
        var isError = false;
        if (data.Result) {
            isError = data.Result.Error;
            doneData = isError ? data.Result.Error : data.Result;
        } else {
            isError = true;
            doneData = data;
        }
        doneData.requestTime = requestTime;
        doneData.responseTime = responseTime;
        (isError ? deferred.reject : deferred.resolve)(doneData);
    });
    return deferred.promise;
};

API.prototype.getProcesses = function (includeArcived) {
    var deferred = new Deferred();
    this.request('Procs').then(
        function (response) {
            deferred.resolve(response.Procs.filter(function (proc) {
                return proc.Enabled && (includeArcived || !proc.Archived);
            }));
        },
        function (error) {
            deferred.reject(error);
        });
    return deferred.promise;
};

API.prototype.getFields = function (processId) {
    var deferred = new Deferred();
    this.request('ProcFields', new BaseProcessData(processId)).then(
        function (response) {
            deferred.resolve(response.Process);
        },
        function (error) {
            deferred.reject(error);
        });
    return deferred.promise;
};

Object.defineProperty(API.prototype, 'cache',
    {
        enumerable: true,
        get: function () {
            if (!this.__cache) {
                this.__cache = new DataCache(this);
            }
            return this.__cache;
        }
    });


API.prototype.getForms = function (processOrId, viewId) {
    var deferred = new Deferred();
    var baseRequest = new BaseProcessData(processOrId);
    if (viewId) {
        baseRequest.ViewID = viewId;
    }
    this.request('ProcForms', baseRequest).then(
        function (response) {
            deferred.resolve(response);
        }, function (response) {
            if (response.Message === 'No forms') {
                response = new BaseProcessData(processOrId);
                response.Columns = [];
                response.Forms = [];
                deferred.resolve(response);
            } else {
                deferred.reject(response);
            }
        });
    return deferred.promise;
};

API.prototype.getForm = function (processOrFormId, formNumber) {
    var request;
    if (arguments.length > 1) {
        request = new BaseProcessData(processOrFormId);
        request.FormNumber = formNumber;
    } else {
        request = { FormID: processOrFormId };
    }
    return this.request('ProcForm', request);
};

function BaseProcessData(processOrId) {
    if (typeof processOrId === 'number') {
        this.ProcessID = processOrId;
    } else {
        this.Process = processOrId + '';
    };
}

API.prototype.addForm = function (processId, data) {
    var request = new BaseProcessData(processId);
    request.Form = {};
    request.Form.Fields = Object.keys(data).map(function (key) {
        return { Field: key, Value: data[key] };
    });
    return this.request('ProcFormAdd', request);
};

API.prototype.getHeaders = function () {
    return { RpmApiKey: this.key };
};

API.prototype.getLastModifications = function (includeArcived) {
    var deferred = new Deferred();
    this.request('Modified').then(
        function (response) {
            var result = {};
            response.Modified.forEach(function (modified) {
                result[modified.Type] = modified.Age;
            });
            deferred.resolve(result);
        },
        function (error) {
            deferred.reject(error);
        });
    return deferred.promise;
};

exports.RpmApi = API;

function DataCache(api) {
    this.api = api;
    this.checkModified();
}

DataCache.prototype.refreshers = {
    ProcList: function () {
        this.api.getProcesses().then(function (response) {
            this.processCache = response;
        }.bind(this));
    }
};

DataCache.prototype.checkModified = function () {
    var self = this;
    this.api.getLastModifications().then(function (response) {
        var update, changed = false;
        if (self.lastModifications) {
            update = function (key) {
                var last = self.lastModifications[key];
                var current = response[key];
                if (!last || last < current) {
                    self.refreshers[key].bind(self)();
                    changed = true;
                }
            };
        } else {
            update = function (key) {
                self.refreshers[key].bind(self)();
            };
            changed = true;
        }
        Object.keys(self.refreshers).forEach(update);
        if (changed) {
            self.lastModifications = response;
        }
    });
};


DataCache.prototype.getProcessInfo = function (processId) {
    this.checkModified();
    var key = (typeof processId === 'number') ? 'ProcessID' : 'Process';
    return this.processCache.reduce(function (a, b) {
        return a || (b[key] === processId ? b : undefined);
    });
};

exports.DATA_TYPES = {
    NA: 0,
    Text: 1,
    Http: 2,   // This is a fixed link
    Date: 3,
    YesNo: 4,
    List: 5,
    Divider: 6,
    Money: 7,
    Label: 8,
    Description: 9,
    ListMultiSelect: 10,
    TextArea: 11,
    Link: 12,
    DeprecatedTable: 13,
    Number: 14,
    DeprecatedFormula2: 15,    // Refers to a formula money field
    Money4: 16,
    Percent: 17,
    DeprecatedFormula4: 18,    // Refers to a formula money field
    FixedNumber: 19, // Fixed
    SpecialPhone: 20, // WTF?
    LocationLatLong: 21, // WTF?
    Decimal: 22,
    LocationUTM: 23,
    LocationDLS: 24,
    LocationNTS: 25,
    WellUWI: 26,
    WellAPI: 27,
    DateTime: 28,
    DescriptionTable: 29,
    DeprecatedFormulaDecimal: 30,
    MeasureLengthSmall: 31,
    MeasureLengthMedium: 32,
    MeasurePressure: 33,
    MeasureArea: 34,
    MeasureWeight: 35,
    Force: 36,
    MeasureDensity: 37,
    MeasureFlow: 38,
    MeasureTemperature: 39,
    DeprecatedFormulaQuantity: 40,
    YesNoList: 41,
    ListScore: 42, // WTF?
    Html: 43, // Fixed
    LocationList: 44,
    FieldTable: 45,
    FieldTableDefinedRow: 46,
    FormulaField: 47
};