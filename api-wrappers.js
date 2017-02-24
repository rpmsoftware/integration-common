require('string').extendPrototype();
var util = require('util');
var RESTClient = require('node-rest-client').Client;
var rpmUtil = require('./util');
var logger = rpmUtil.logger;
var norm = require('./normalizers');

const MAX_PARALLEL_CALLS = 20;
const PROP_REST_CLIENT = Symbol();

function API(url, key, name) {
    if (typeof url === 'object') {
        key = url.key;
        name = url.name;
        url = url.url;
    }
    url = url.toLowerCase().ensureRight('/');
    this.url = url.ensureRight('Api2.svc/');
    this.key = key;
    this.name = name;
    this.modifiedTTL = 5 * 60;
    this._formNumbers = {};
}

rpmUtil.defineStandardProperty(API.prototype, 'parallelRunner', () => {
    if (!this._parallelRunner) {
        this._parallelRunner = rpmUtil.createParallelRunner(MAX_PARALLEL_CALLS);
    }
    return this._parallelRunner;
});


API.prototype.getUrl = function (endPoint) {
    return this.url + endPoint;
};

API.prototype.request = function (endPoint, data, log) {
    var args = { headers: this.getHeaders(), data: data };
    var url = this.getUrl(endPoint);
    var client = this[PROP_REST_CLIENT];
    if (!client) {
        client = this[PROP_REST_CLIENT] = new RESTClient();
    }
    if (log === undefined) {
        log = true;
    }
    return new Promise((resolve, reject) => {
        logger.debug(`POST ${url} ${log && data ? '\n' + JSON.stringify(data) : ''}`);
        var requestTime = new Date();
        function callback(data) {
            var responseTime = new Date();
            var doneData;
            var isError = false;
            if (data.Result) {
                isError = data.Result.Error;
                doneData = isError || data.Result || data;
            } else {
                isError = true;
                doneData = data;
            }
            doneData.requestTime = requestTime;
            doneData.responseTime = responseTime;
            (isError ? reject : resolve)(doneData);
        }
        client.post(url, args, callback);
    });
};

API.prototype.createFormNumberCache = function () {
    var api = this;
    var formNumberCache = {};
    var queue = Promise.resolve();
    return function (formID) {
        if (!formID) {
            return;
        }
        queue = queue.then(() => {
            var cached = formNumberCache[formID];
            return cached === undefined ? api.getForm(formID).then(form => {
                if (!form) {
                    formNumberCache[formID] = false;
                    return;
                }
                form = form.Form;
                formNumberCache[form.FormID] = form.Number;
                return form.Number;
            }) : Promise.resolve(cached || undefined);
        });
        return queue;
    };
};

API.prototype.getUser = function (userName) {
    return this.request('User', { Username: userName });
};

API.prototype.checkUserPassword = function (userName, password) {
    return this.request('UserPasswordCheck', { Username: userName, Password: password }, false);
};

API.prototype.getStaffList = function () {
    return this.request('StaffList').then(result => result.StaffList);
};

var TIMEZONE_OFFSET_PATTERN = /^\s*([+-]?)(\d\d):(\d\d)\s*$/;

function parseTimezoneOffset(offset) {
    var parts = TIMEZONE_OFFSET_PATTERN.exec(offset);
    offset = (+parts[2]) * 60 + (+parts[3]);
    if (parts[1] == '-') {
        offset = -offset;
    }
    return offset;
}

var INFO_PROTO = {
    getTimezoneOffset: function () {
        return parseTimezoneOffset(this.TimeOffset);
    }
};

API.prototype.getViews = function (viewCategory, templateID) {
    return this.request('ProcViews', {
        'ViewCategory': +viewCategory,
        'ObjectSpecificID': +templateID
    }).then(result => result.Views);
};

var VIEW_CATEGORY = {
    Reps: 1,
    Customers: 5,
    Agencies: 200,
    Accounts: 304,
    CommissionItems: 311,
    FormsPerTemplate: 510, // Process views
    Reconcile: 900,
    Staff: 3,
    Suppliers: 203,
    CustomerLocations: 14,
    FormActions: 525
};


API.prototype.createFormAction = function (description, formOrID, due, userID) {
    if (typeof formOrID === 'object') {
        formOrID = formOrID.Form || formOrID;
        if (typeof userID === 'undefined') {
            userID = formOrID.Participants.find(participant => participant.Name === formOrID.Owner);
            userID = userID && userID.UserID;
        }
        formOrID = formOrID.FormID;
    }
    var data = {
        Action: {
            Description: description,
            Form: {
                FormID: rpmUtil.normalizeInteger(formOrID)
            },
            StaffOnly: true,
            Due: rpmUtil.normalizeDate(due),
            Assignee: {
                UserID: rpmUtil.normalizeInteger(userID)
            }
        }
    };
    return this.request('ActionEdit', data);
};

const PROC_PROMISE_PROPERTY = Symbol();

API.prototype.getProcesses = function (includeDisabled) {
    var api = this;
    if (!api[PROC_PROMISE_PROPERTY]) {
        api[PROC_PROMISE_PROPERTY] = api.request('Procs').then(response => {
            var result = response.Procs.map(api._extendProcess.bind(api));
            delete api[PROC_PROMISE_PROPERTY];
            return result;
        }, error => {
            delete api[PROC_PROMISE_PROPERTY];
            throw error;
        });
    }
    return api[PROC_PROMISE_PROPERTY].then(procs => includeDisabled ? procs : procs.filter(proc => proc.Enabled));
};

const PROCESS_PROTO = {
    getFields,
    getForms,
    addForm,
    createForm,
    getFormList,
    getCachedFields,
    getAllForms,
    getViews,
    getView
};

const API_PROPERTY = Symbol();

API.prototype._extendProcess = function (proc) {
    proc[API_PROPERTY] = this;
    Object.setPrototypeOf(proc, PROCESS_PROTO);
    return proc;
};

var ERR_PROCESS_NOT_FOUND = 'Process not found: %s';

function getProcessSearchKey(nameOrID) {
    return typeof nameOrID === 'number' ? 'ProcessID' : 'Process';
}

API.prototype.getProcess = function (nameOrID, demand) {
    return this.getCachedProcesses().then(procs => {
        var key = getProcessSearchKey(nameOrID);
        var result = procs.find(proc => proc[key] == nameOrID);
        if (demand && !result) {
            throw Error(util.format(ERR_PROCESS_NOT_FOUND, nameOrID));
        }
        return result;
    });
};

API.prototype.getActiveProcess = function (nameOrID, demand) {
    return this.getProcess(nameOrID).then(result => {
        if (result && result.Enabled) {
            return result;
        }
        if (demand) {
            throw Error(util.format(ERR_PROCESS_NOT_FOUND, nameOrID));
        }
    });
};

API.prototype.getCachedProcesses = function () {
    var api = this;
    var cache = rpmUtil.getCache(api);
    return api.getModifiedAspects()
        .then(modifiedAspects => (!cache._processes || modifiedAspects.contains('ProcList')) && api.getProcesses(true))
        .then(processes => {
            if (processes) {
                cache._processes = processes;
            }
            return cache._processes;
        });
};

API.prototype.getInfo = function () {
    return this.request('Info').then(info => Object.setPrototypeOf(info, INFO_PROTO));
};

API.prototype.editForm = function (formId, fields, properties) {
    if (typeof formId === 'object') {
        formId = formId.Form || formId;
        formId = formId.FormID;
    }
    properties = properties || {};
    properties.FormID = formId;
    properties.Fields = Array.isArray(fields) ? fields : Object.keys(fields).map(key => ({ Field: key, Value: fields[key] }));
    return this.request('ProcFormEdit', { Form: properties, OverwriteWithNull: true }).then(this._extendForm.bind(this));
};

API.prototype.setFormArchived = function (archived, formId) {
    return this.request(archived ? 'ProcFormArchive' : 'ProcFormUnarchive', { FormID: formId });
};

API.prototype.trashForm = function (formID) {
    if (typeof formID === 'object') {
        formID = (formID.Form || formID).FormID;
    }
    return this.request('ProcFormTrash', { FormID: formID });
};

var ERROR_RESPONSE_FORM_NOT_FOUND = 'Form not found';

API.prototype.createFormInfoCache = function () {
    var api = this;
    var cache = {};
    return function (formID, demand) {
        var result = cache[formID];
        if (result) {
            return Promise.resolve(result);
        }
        return api.getForm(formID).then(form => form && api.getFormList(form.ProcessID, true), error => {
            if (error.Message !== ERROR_RESPONSE_FORM_NOT_FOUND) {
                throw error;
            }
        }).then(result => {
            if (result) {
                result.Forms.forEach(form => {
                    cache[form.ID] = form;
                    form.ProcessID = result.ProcessID;
                });
                result = cache[formID];
            }
            if (!result && demand) {
                throw new Error(ERROR_RESPONSE_FORM_NOT_FOUND);
            }
            return result;
        });
    };
};


var PROCESS_FIELD_PROTO = {
    getValue: function (formField) {
        return FIELD_ACCESSORS[this.FieldType][this.SubType].getValue(formField, this);
    }
};

function getFields(asObject) {
    var proc = this;
    return proc[API_PROPERTY].getFields(proc.ProcessID).then(response => {
        if (asObject) {
            response.Fields = response.Fields.toObject('Name');
        }
        response.process = proc;
        return response;
    });
}

function getViews() {
    var proc = this;
    return proc[API_PROPERTY].getViews(VIEW_CATEGORY.FormsPerTemplate, proc.ProcessID);
}

var ERR_VIEW_NOT_FOUND = 'View not found: %s';

function getView(nameOrId, demand) {
    var proc = this;
    var property = typeof nameOrId === 'number' ? 'ID' : 'Name';
    return proc.getViews().then(views => {
        var result = views.find(view => view[property] === nameOrId);
        if (demand && !result) {
            throw Error(util.format(ERR_VIEW_NOT_FOUND, nameOrId));
        }
        return result;
    });
}

function getCachedFields() {
    var proc = this;
    var cache = rpmUtil.getCache(proc);
    var changed;
    return proc[API_PROPERTY].getLastModifications().then(modifications => {
        changed = modifications.ProcFields;
        if (!changed || !cache._fields || changed !== cache._fieldsChanged) {
            return proc.getFields();
        }
    }).then(fields => {
        if (fields) {
            cache._fields = fields;
            cache._fieldsChanged = changed;
        }
        return cache._fields;
    });

}

function getAllForms(includeArchived) {
    var process = this;
    return process.getFormList(includeArchived).then(forms => {
        var data = [];
        var p = Promise.resolve();
        forms.forEach(form => p = p.then(() => process[API_PROPERTY].getForm(form.ID)).then(form => data.push(form)));
        return p.then(() => data);
    });
}


function getForms(viewId) {
    return this[API_PROPERTY].getForms(this.ProcessID, viewId);
}

function getFormList(includeArchived, viewId) {
    var proc = this;
    var request = { ProcessID: proc.ProcessID, IncludeArchived: Boolean(includeArchived) };
    if (typeof viewId === 'number') {
        request.ViewID = viewId;
    }
    return proc[API_PROPERTY].request('ProcFormList', request).then(response => response.Forms);

}

function getStatus(nameOrID, demand) {
    var property = typeof nameOrID === 'number' ? 'ID' : 'Text';
    var result = this.StatusLevels.find(st => st[property] === nameOrID);
    if (!result && demand) {
        throw new Error('Unknown status: ' + nameOrID);
    }
    return result;
}

API.prototype.getCachedFields = function (processNameOrId) {
    return this.getActiveProcess(processNameOrId, true).then(proc => proc.getCachedFields());
};

API.prototype.getFields = function (processId) {
    return this.request('ProcFields', new BaseProcessData(processId)).then(response => {
        response = response.Process;
        response.Fields.forEach(field => Object.assign(field, PROCESS_FIELD_PROTO));
        response.getField = getField;
        response.getStatus = getStatus;
        response.getFieldByUid = getFieldByUid;
        return response;
    });
};

API.prototype.getForms = function (processOrId, viewId) {
    var baseRequest = new BaseProcessData(processOrId);
    if (viewId) {
        baseRequest.ViewID = viewId;
    }
    var self = this;
    return new Promise((resolve, reject) => {
        self.request('ProcForms', baseRequest).then(
            response => resolve(response),
            error => {
                if (error.Message === 'No forms') {
                    error = new BaseProcessData(processOrId);
                    error.Columns = [];
                    error.Forms = [];
                    resolve(error);
                } else {
                    reject(error);
                }
            });
    });
};


API.prototype.getFormList = function (processId, viewId, includeArchived) {
    if (includeArchived === undefined && typeof viewId === 'boolean') {
        includeArchived = viewId;
        viewId = undefined;
    }
    var baseRequest = { ProcessID: processId };
    if (viewId) {
        baseRequest.ViewID = viewId;
    }
    if (includeArchived) {
        baseRequest.IncludeArchived = true;
    }
    return this.request('ProcFormList', baseRequest);
};

var FORM_NUMBER_TTL = 15 * 60 * 1000; // 15 minutes

API.prototype._saveFormNumber = function (formID, formNumber) {
    this._formNumbers[formID] = { FormID: formID, Number: formNumber, Updated: Date.now() };
};

API.prototype.getFormNumber = function (formID) {
    var api = this;
    var result = api._formNumbers[formID];
    if (result && Date.now() - result.Updated < FORM_NUMBER_TTL) {
        return Promise.resolve(result.Number);
    }
    return api.demandForm(+formID).then(() => {
        result = api._formNumbers[formID];
        assert(result && Date.now() - result.Updated < FORM_NUMBER_TTL);
        return result.Number;
    });
};

API.prototype.demandForm = function (processOrFormId, formNumber) {
    var api = this;
    var request;
    if (arguments.length > 1) {
        request = new BaseProcessData(processOrFormId);
        request.FormNumber = formNumber;
    } else {
        request = { FormID: processOrFormId };
    }
    return api.request('ProcForm', request).then(api._extendForm.bind(api));
};

API.prototype._extendForm = function (form) {
    form = extendForm(form);
    var frm = form.Form || form;
    this._saveFormNumber(frm.FormID, frm.Number);
    return form;
};

API.prototype.getForm = function () {
    return this.demandForm.apply(this, arguments).then(form => form, function (error) {
        if (error.Message != 'Form not found') {
            throw error;
        }
    });
};

function getFormFieldsAsObject() {
    var form = this;
    var obj = {};
    form.Fields.forEach(pair => obj[pair.Field] = pair.Value);
    return obj;
}

function getFormFieldValue(fieldName, eager) {
    var field = this.getField(fieldName, eager);
    return field && field.Value;
}

function getField(fieldName, eager) {
    var result = this.Fields.find(field => (field.Field || field.Name) === fieldName);
    if (!result && eager) {
        throw new Error('Unknown field: ' + fieldName);
    }
    return result;
}

exports.getField = getField;

function getFieldByUid(uid, eager) {
    var result = this.Fields.find(field => field.Uid === uid);
    if (!result && eager) {
        throw new Error('Unknown field. Uid: ' + uid);
    }
    return result;
}
exports.getFieldByUid = getFieldByUid;

function BaseProcessData(processOrId) {
    if (typeof processOrId === 'number') {
        this.ProcessID = processOrId;
    } else {
        this.Process = processOrId + '';
    }
}

function addForm(fields, status) {
    return this[API_PROPERTY].addForm(this.ProcessID, fields, status);
}

API.prototype.addForm = function (processId, fields, status) {
    console.warn('ACHTUNG! API.addForm is deprecated. Use API.createForm() instead');
    return this.createForm(processId, fields, { Status: status });
};

function createForm(fields, properties) {
    return this[API_PROPERTY].createForm(this.ProcessID, fields, properties);
}


API.prototype.createForm = function (processOrId, fields, properties) {
    var api = this;
    properties = properties || {};
    var status = properties.Status || properties.StatusID || undefined;
    properties = { Form: properties };
    properties[typeof processOrId === 'number' ? 'ProcessID' : 'Process'] = processOrId;
    properties.Form.Fields = Array.isArray(fields) ? fields :
        Object.keys(fields).map(key => ({ Field: key, Value: fields[key] }));
    var p = this.request('ProcFormAdd', properties);
    if (status) {
        p = p.then(form => api.setFormStatus(form, status));
    }
    return p.then(api._extendForm.bind(api));
};


function extendForm(form) {
    var frm = form.Form || form;
    frm.getFieldsAsObject = getFormFieldsAsObject;
    frm.getFieldValue = getFormFieldValue;
    frm.getField = getField;
    frm.getFieldByUid = getFieldByUid;
    return form;
}


API.prototype.createFormSet = function (parentFormID, fields) {
    if (typeof parentFormID === 'object') {
        parentFormID = (parentFormID.Form || parentFormID).FormID;
    }
    return this.request('ProcFormSetAdd', {
        Form: {
            FormID: parentFormID,
            Fields: Array.isArray(fields) ? fields : Object.keys(fields).map(key => ({ Field: key, Value: fields[key] }))
        }
    }).then(extendForm);
};

API.prototype.setFormStatus = function (form, status) {
    var properties = {};
    properties[typeof status === 'number' ? 'StatusID' : 'Status'] = status;
    return this.editForm(form, [], properties);
};

API.prototype.getHeaders = function () {
    return { RpmApiKey: this.key };
};

const PROP_CACHED_MODIFIED = Symbol();
const PROP_MODIFIED_PROMISE = Symbol();
const PROP_MODIFIED_TIMESTAMP = Symbol();

API.prototype.getLastModifications = function () {
    var api = this;
    if (api[PROP_CACHED_MODIFIED] && api[PROP_MODIFIED_TIMESTAMP] && Date.now() - api[PROP_MODIFIED_TIMESTAMP] < api.modifiedTTL * 1000) {
        return Promise.resolve(api[PROP_CACHED_MODIFIED]);
    }
    if (!api[PROP_MODIFIED_PROMISE]) {
        api[PROP_MODIFIED_PROMISE] = api.request('Modified').then(response => {
            api[PROP_MODIFIED_TIMESTAMP] = response.responseTime.getTime();
            var result = {};
            response.Modified.forEach(modified => result[modified.Type] = modified.Age);
            api[PROP_CACHED_MODIFIED] = result;
            delete api[PROP_MODIFIED_PROMISE];
            return result;
        }, error => {
            delete api[PROP_MODIFIED_PROMISE];
            throw error;
        });
    }
    return api[PROP_MODIFIED_PROMISE];
};

const PROP_LAST_KNOWN_MODIFIED = Symbol();

API.prototype.getModifiedAspects = function () {
    var self = this;
    return self.getLastModifications().then(response => {
        var result = [];
        if (self[PROP_LAST_KNOWN_MODIFIED]) {
            for (var key in self[PROP_LAST_KNOWN_MODIFIED]) {
                var value = self[PROP_LAST_KNOWN_MODIFIED][key];
                if (response[key] > value) {
                    result.push(key);
                }
            }
        }
        self[PROP_LAST_KNOWN_MODIFIED] = response;
        return result;
    });
};

API.prototype.getCachedCustomers = function () {
    var api = this;
    var cache = rpmUtil.getCache(api);
    return (cache._customers ? api.getModifiedAspects() : Promise.resolve())
        .then(modifiedAspects => (!modifiedAspects || modifiedAspects.contains('CustomerAndAliasList')) && api.getCustomers())
        .then(response => {
            if (response) {
                cache._customers = response;
            }
            return cache._customers;
        });
};

API.prototype.getCustomers = function () {
    return this.request('Customers').then(response => {
        var duplicates = {};
        response.Customers = response.Customers.filter(customer => {
            if (duplicates[customer.CustomerID]) {
                return false;
            }
            duplicates[customer.CustomerID] = true;
            customer.CustomerID = +customer.CustomerID;
            tweakDates(customer);
            return true;
        });
        return response;
    });
};

function tweakDates(object) {
    object.Added = object.Added && rpmUtil.normalizeDate(object.Added);
    object.Modified = object.Modified ? rpmUtil.normalizeDate(object.Modified) : object.Added;
    return object;
}

API.prototype.getCustomerAccounts = function (nameOrID) {
    var req = {};
    req[typeof nameOrID === 'number' ? 'CustomerID' : 'Customer'] = nameOrID;
    return this.request('Accounts', req).then(response => {
        response.Accounts.forEach(tweakDates);
        return response;
    });
};


API.prototype.getSupplierAccounts = function (nameOrID) {
    var req = {};
    req[typeof nameOrID === 'number' ? 'SupplierID' : 'Supplier'] = nameOrID;
    return this.request('Accounts', req).then(response => {
        response.Accounts.forEach(tweakDates);
        return response;
    });
};

API.prototype.getAccount = function (nameOrID) {
    var req = {};
    req[typeof nameOrID === 'number' ? 'AccountID' : 'Account'] = nameOrID;
    return this.request('Account', req).then(tweakDates);
};

API.prototype.getAccounts = function (modifiedAfter) {
    modifiedAfter = modifiedAfter ? rpmUtil.normalizeDate(modifiedAfter) : new Date(0);
    return this.request('Accounts', { ModifiedAfter: modifiedAfter.toISOString() }).then(response => {
        response.Accounts.forEach(tweakDates);
        return response;
    });
};

API.prototype.getCustomer = function (nameOrID) {
    var api = this;
    var request = {};
    request[(typeof nameOrID === 'number') ? 'CustomerID' : 'Customer'] = nameOrID;
    return api.request('Customer', request).then(tweakDates);
};

API.prototype.getSuppliers = function () {
    return this.request('Suppliers').then(result => {
        var modified = new Date(result.Age * 1000);
        result.Suppliers.forEach(supplier => supplier.Modified = modified);
        return result;
    });
};


API.prototype.getAgencies = function () {
    return this.request('Agencies').then(response => {
        response.Agencies.forEach(tweakDates);
        return response;
    });
};


function extractContact(object) {
    if (typeof object.Contact !== 'object') {
        var contact = object.Contact = {};
        ["ContactID", "Email", "FirstName", "LastName", "PhoneNumbers", "Salutation", "Title"].forEach(property => {
            contact[property] = object[property];
            delete object[property];
        });
    }
    return object;
}

API.prototype.getAgency = function (nameOrID) {
    var api = this;
    var request = {};
    request[(typeof nameOrID === 'number') ? 'AgencyID' : 'Agency'] = nameOrID;
    return api.request('Agency', request).then(tweakDates).then(extractContact);
};

API.prototype.getRep = function (nameOrID) {
    var api = this;
    var request = {};
    request[(typeof nameOrID === 'number') ? 'RepID' : 'Rep'] = nameOrID;
    return api.request('Rep', request).then(tweakDates).then(extractContact);
};


exports.RpmApi = API;

function DataCache(api) {
    this.api = api;
    this.checkModified();
}

DataCache.prototype.refreshers = {
    ProcList: function () {
        var self = this;
        self.api.getProcesses().then(response => self.processCache = response);
    }
};

DataCache.prototype.checkModified = function () {
    var self = this;
    this.api.getLastModifications().then(response => {
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
    return this.processCache.reduce((a, b) => a || (b[key] === processId ? b : undefined));
};

exports.DataCache = DataCache;

var DATA_TYPE = exports.DATA_TYPE = {
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

exports.PROCESS_PERMISSIONS = Object.seal({
    HideAll: 1,
    Edit: 3,
    EditOwnHideOthers: 8,
    ReadOwnHideOthers: 10,
    ReadAll: 11,
    Start: 12,
    StartOwnHideOthers: 13,
    EditOwnReadOthers: 14,
    StartOwnReadOthers: 15,
    StartHideAll: 17
});

exports.PHONE_TYPES = Object.seal({
    Business: 1,
    Home: 2,
    Fax: 3,
    Other: 6
});

var OBJECT_TYPE = exports.OBJECT_TYPE = {
    NA: 0,
    AgentRep: 1,
    SubscriberSupport: 2,
    Staff: 3,
    Administrator: 4,
    Customer: 5,
    SubAgent: 6,
    AgentMgr: 7,
    CustomerContact: 8,
    Subscriber: 9,
    CommissionRun: 10,
    SystemName: 11,
    CustomerLocation: 14,
    CustomerAlias: 15,
    Deployment: 17,
    Carrier: 20,
    Lead: 100,
    Quote: 101,
    Order: 102,
    State: 110,
    Country: 111,
    AgentCompany: 200,
    CommissionGroup: 201,
    CustomerAccountGroup: 202,
    Supplier: 203,
    RefPartner: 204,
    SupplierExclusion: 205,
    Product: 303,
    CustomerAccount: 304,
    CommTier: 305,
    AgentSplitAdden: 306,
    AgentCommAdden: 307,
    AgentProductAdden: 308,
    AgentBaseAdden: 309,
    AgentAccountAdden: 310,
    CommissionItem: 311,
    CommissionItemSplit: 312,
    CommissionItemOrigin: 313,
    AgentCommSched: 314,
    AgentCommValue: 315,
    CommBaseSchedMod: 316,
    MasterDes: 318,
    AgentDes: 319,
    CommDeposit: 320,
    Notes: 323, // These notes are used for search by fields, but are unused
    Quota: 324, // this is for old quota that was removed from system CR 10435
    IssueText: 325,
    CommissionAdjustment: 326,
    CommissionRefRule: 327,
    DataExportTemplate: 330,
    CommSupplierTotal: 350,
    SupplierExtranet: 400,
    SupplierExtranetLogin: 401,
    CommImportTemp: 411,
    CommItemTransfer: 421,
    FileAttachment: 450,
    ECItem: 470,
    ECTemplate: 471,
    CustomField: 500,
    CustomFieldValue: 501,
    CustomFieldListSelectedItem: 502,
    FormField: 503,
    TableFieldRow: 504,
    PMTemplate: 510,
    PMStatus: 511,
    PMTemplateReference: 512,  // To be phased out.  This type is redundant with 522 for our purposes.
    SharedField: 513,
    PMActionTrigger: 515,
    PMFieldGroup: 516,
    ActionType: 517,
    RestrictedReference: 519,
    Form: 520,
    FormStatus: 521,
    FormReference: 522,
    FormOwner: 523,
    FormParticipant: 524,
    FormAction: 525,
    FormEmail: 526,
    FormSummary: 530,
    FormHistory: 531,
    ArchivedAccountGroup: 538,
    ArchivedCommissionItemSplit: 539,
    ArchivedFormParticipant: 540,
    ArchivedFormOwner: 541,
    ArchivedFormStaffReferenced: 542,
    ArchivedCustomer: 543,
    ArchivedAccount: 544,
    ArchivedCommisionItem: 545,
    ArchivedRep: 546,
    ArchivedAgency: 547,
    ArchivedSupplier: 548,
    ArchivedProduct: 549,
    StatusTrigger: 550,
    Approval: 560,
    ApprovalStage: 561,
    ProcessFlow: 565,
    FormVerifiedList: 574,
    Holder: 580,
    Role: 600,
    AgencyAssignment: 620,
    AgencyAssignmentCategory: 621,
    CalendarAction: 650,
    CalendarDate: 651,
    Cview: 700,
    Cview_ColumnOption: 710,
    Cview_FilterOption: 711,
    AgencyReferral: 715,
    Referral: 716,
    CustomFormReport: 741,
    PhoneType: 800,
    TemporaryLogo: 851,
    Reconciles: 900,
    Reconcile: 901,
    StaticField: 9999,  // Refers to fields like Customer.Website or Contact.FirstName.  Some static fields are shared fields.
    NetBilledForRun: 10000,
    PayoutForRun: 10001,
    GrossCommForRun: 10002,
    GrossProfitForRun: 10003,
    Wholesale: 10004,
    Margin: 10005,
    AgentComm: 10006,
    ContractValue: 10007,
    CommReferralTo: 10008,
    AgencyPayout: 10017,
    CommReferral: 10022,
    Origin: 10040,
    Access: 10041,
    Enabled: 10042,
    Email: 10050,
    FormNumber: 10060,
    BusinessPhone: 10070,
    HomePhone: 10071,
    FaxPhone: 10072,
    OtherPhone: 10073,
    Website: 10074,
    CountryAddress: 10075,
    Modified: 10076,
    Company: 10077,
    PrimaryContact: 10100,
    ContactInfo: 10101,
    StreetAddress: 10102,
    City: 10103,
    StateAddress: 10104,
    ZipCode: 10105,
    Added: 10106,
    Title: 10107,
    RepType: 10108,
    Phone: 10109,
    Latitude: 10110,
    FirstName: 10112,
    LastName: 10113,
    Rename_Reps: 10121,
    Rename_Rep: 10120,
    Rename_Managers: 10122,
    Rename_Manager: 10123,
    Rename_Agency: 10124,
    Rename_Agencies: 10125,
    BardCode: 10200,
    FormStarted: 10201,
    Owner: 10202,
    SelectForm: 10300,
    ShellViewProcess: 10400,
    ShellProcessSingle: 10401,
    ShellAgencyView: 10402,
    ShellAgencySingle: 10403,
    ShellRepView: 10404,
    ShellRepSingle: 10405,
    ShellCustomerView: 10406,
    ShellCustomerSingle: 10407,
    ShellAccountView: 10408,
    ShellAccountSingle: 10409,
    ShellCommItemView: 10410,
    ShellCommItemSingle: 10411,
    ShellStaffView: 10412,
    ShellStaffSingle: 10413,
    NotesForStaff: 10500,
    NotesForAgents: 10501,
    HomePage: 10550,
    ProcessHolder: 10551,
    HolderFlow: 10607,
    HolderFileAttachment: 10608,
    HolderProcess: 10600
};

var REF_DATA_TYPE = exports.REF_DATA_TYPE = {
    NA: 0,
    AgentRep: 1,
    SubscriberSupport: 2,
    Staff: 3,
    Administrator: 4,
    Customer: 5,
    SubAgent: 6,
    AgentMgr: 7,
    CustomerContact: 8,
    Subscriber: 9,
    CommissionRun: 10,
    SystemName: 11,
    CustomerLocation: 14,
    CustomerAlias: 15,
    Deployment: 17,
    Carrier: 20,
    Lead: 100,
    Quote: 101,
    Order: 102,
    State: 110,
    Country: 111,
    AgentCompany: 200,
    CommissionGroup: 201,
    CustomerAccountGroup: 202,
    Supplier: 203,
    RefPartner: 204,
    SupplierExclusion: 205,
    Product: 303,
    CustomerAccount: 304,
    CommTier: 305,
    AgentSplitAdden: 306,
    AgentCommAdden: 307,
    AgentProductAdden: 308,
    AgentBaseAdden: 309,
    AgentAccountAdden: 310,
    CommissionItem: 311,
    CommissionItemSplit: 312,
    CommissionItemOrigin: 313,
    AgentCommSched: 314,
    AgentCommValue: 315,
    CommBaseSchedMod: 316,
    MasterDes: 318,
    AgentDes: 319,
    CommDeposit: 320,
    Notes: 323, // These notes are used for search by fields, but are unused
    Quota: 324, // this is for old quota that was removed from system CR 10435
    IssueText: 325,
    CommissionAdjustment: 326,
    CommissionRefRule: 327,
    DataExportTemplate: 330,
    CommSupplierTotal: 350,
    SupplierExtranet: 400,
    SupplierExtranetLogin: 401,
    CommImportTemp: 411,
    CommItemTransfer: 421,
    FileAttachment: 450,
    ECItem: 470,
    ECTemplate: 471,
    CustomField: 500,
    CustomFieldValue: 501,
    CustomFieldListSelectedItem: 502,
    FormField: 503,
    TableFieldRow: 504,
    PMTemplate: 510,
    PMStatus: 511,
    PMTemplateReference: 512,  // To be phased out.  This type is redundant with 522 for our purposes.
    SharedField: 513,
    PMActionTrigger: 515,
    PMFieldGroup: 516,
    ActionType: 517,
    RestrictedReference: 519,
    Form: 520,
    FormStatus: 521,
    FormReference: 522,
    FormOwner: 523,
    FormParticipant: 524,
    FormAction: 525,
    FormEmail: 526,
    FormSummary: 530,
    FormHistory: 531,
    ArchivedAccountGroup: 538,
    ArchivedCommissionItemSplit: 539,
    ArchivedFormParticipant: 540,
    ArchivedFormOwner: 541,
    ArchivedFormStaffReferenced: 542,
    ArchivedCustomer: 543,
    ArchivedAccount: 544,
    ArchivedCommisionItem: 545,
    ArchivedRep: 546,
    ArchivedAgency: 547,
    ArchivedSupplier: 548,
    ArchivedProduct: 549,
    StatusTrigger: 550,
    Approval: 560,
    ApprovalStage: 561,
    ProcessFlow: 565,
    FormVerifiedList: 574,
    Holder: 580,
    HolderModifiedDate: 581, // for view
    HolderFiles: 582, // for view
    NoHolderFiles: 583, // for view
    Role: 600,
    AgencyAssignment: 620,
    AgencyAssignmentCategory: 621,
    CalendarAction: 650,
    CalendarDate: 651,
    Cview: 700,
    Cview_ColumnOption: 710,
    Cview_FilterOption: 711,
    AgencyReferral: 715,
    Referral: 716,
    CustomFormReport: 741,
    PhoneType: 800,
    TemporaryLogo: 851,
    Reconciles: 900,
    Reconcile: 901,
    StaticField: 9999,  // Refers to fields like Customer.Website or Contact.FirstName.  Some static fields are shared fields.
    NetBilledForRun: 10000,
    PayoutForRun: 10001,
    GrossCommForRun: 10002,
    GrossProfitForRun: 10003,
    Wholesale: 10004,
    Margin: 10005,
    AgentComm: 10006,
    ContractValue: 10007,
    CommReferralTo: 10008,
    AgencyPayout: 10017,
    CommReferral: 10022,
    Origin: 10040,
    Access: 10041,
    Enabled: 10042,
    Email: 10050,
    FormNumber: 10060,
    BusinessPhone: 10070,
    HomePhone: 10071,
    FaxPhone: 10072,
    OtherPhone: 10073,
    Website: 10074,
    CountryAddress: 10075,
    Modified: 10076,
    Company: 10077,
    PrimaryContact: 10100,
    ContactInfo: 10101,
    StreetAddress: 10102,
    City: 10103,
    StateAddress: 10104,
    ZipCode: 10105,
    Added: 10106,
    Title: 10107,
    RepType: 10108,
    Phone: 10109,
    Latitude: 10110,
    FirstName: 10112,
    LastName: 10113,
    Rename_Reps: 10121,
    Rename_Rep: 10120,
    Rename_Managers: 10122,
    Rename_Manager: 10123,
    Rename_Agency: 10124,
    Rename_Agencies: 10125,
    BardCode: 10200,
    FormStarted: 10201,
    Owner: 10202,
    SelectForm: 10300,
    ShellViewProcess: 10400,
    ShellProcessSingle: 10401,
    ShellAgencyView: 10402,
    ShellAgencySingle: 10403,
    ShellRepView: 10404,
    ShellRepSingle: 10405,
    ShellCustomerView: 10406,
    ShellCustomerSingle: 10407,
    ShellAccountView: 10408,
    ShellAccountSingle: 10409,
    ShellCommItemView: 10410,
    ShellCommItemSingle: 10411,
    ShellStaffView: 10412,
    ShellStaffSingle: 10413,
    NotesForStaff: 10500,
    NotesForAgents: 10501,
    HomePage: 10550,
    ProcessHolder: 10551,
    HolderFlow: 10607,
    HolderFileAttachment: 10608,
    HolderProcess: 10600

};


var FIELD_TYPE = exports.FIELD_TYPE = (() => {
    var fieldTypes = {};
    var name;
    for (name in OBJECT_TYPE) {
        fieldTypes[name] = { value: OBJECT_TYPE[name], subTypes: {} };
    }

    var subTypes = fieldTypes.CustomField.subTypes;
    for (name in DATA_TYPE) {
        subTypes[name] = { value: DATA_TYPE[name] };
    }
    subTypes = fieldTypes.FormReference.subTypes;
    for (name in REF_DATA_TYPE) {
        subTypes[name] = { value: REF_DATA_TYPE[name] };
    }

    Object.seal(fieldTypes);
    return fieldTypes;
})();

exports.getTableRowValues = function (row, valueExtractor) {
    var values = {};
    row.Fields.forEach(field => {
        var value = field.Values[0];
        if (value) {
            values[field.Uid] = valueExtractor && valueExtractor(value) || value.Value;
        }
    });
    return values;
};


exports.parseTimezoneOffset = parseTimezoneOffset;

function validateFieldType(field, fieldTypeName, subTypeName) {
    var t = FIELD_TYPE[fieldTypeName];
    if (!t) {
        throw new Error('Unknown FieldType: ' + fieldTypeName);
    }
    if (field.FieldType !== t.value) {
        throw new Error(`Incorrect FieldType ${field.FieldType}. ${t.value} (${fieldTypeName}) expected`);
    }
    t = t.subTypes[subTypeName];
    if (!t) {
        throw new Error(`Unknown SubType '${subTypeName}' for FieldType '${fieldTypeName}' subType`);
    }
    if (field.SubType !== t.value) {
        throw new Error(`Incorrect SubType ${field.SubType}. ${t.value} (${subTypeName}) expected`);
    }
    return field;
}

function validateProcessReference(field, processID) {
    field = validateFieldType(field, 'FormReference', 'RestrictedReference');
    if (processID !== undefined && field.ProcessID !== processID) {
        throw new Error(`Field "${field.Name}" is referring to process ProcessID=${field.ProcessID}. ProcessID=${processID} is expected`);
    }
    return field;
}

function isProcessReference(field, processID) {
    try {
        validateProcessReference(field, processID);
        return true;
    } catch (error) {
        return false;
    }
}


exports.validateFieldType = validateFieldType;
exports.validateProcessReference = validateProcessReference;
exports.isProcessReference = isProcessReference;

var assert = require('assert');

var FIELD_ACCESSORS = exports.FIELD_ACCESSORS = {};

(() => {

    var f, subTypes, st;

    f = function (formField) {
        return formField.ID || null;
    };

    st = FIELD_ACCESSORS[FIELD_TYPE.FormReference.value] = {};
    subTypes = FIELD_TYPE.FormReference.subTypes;
    for (var name in subTypes) {
        st[subTypes[name].value] = { getValue: f };
    }

    st = FIELD_ACCESSORS[FIELD_TYPE.CustomField.value] = {};
    subTypes = FIELD_TYPE.CustomField.subTypes;

    f = function (formField) {
        return norm.normalizeDate(formField.Value);
    };
    ['Date', 'DateTime'].forEach(name => st[subTypes[name].value] = { getValue: f });

    st[subTypes.YesNo.value] = {
        getValue: function (formField) {
            return norm.normalizeBoolean(formField.Value);
        }
    };

    f = function (formField) {
        return norm.normalizeNumber(formField.Value);
    };

    ['Money', 'Number', 'Money4', 'Percent', 'FixedNumber', 'Decimal',
        'MeasureLengthSmall', 'MeasureLengthMedium', 'MeasurePressure', 'MeasureArea',
        'MeasureWeight', 'Force', 'MeasureDensity', 'MeasureFlow', 'MeasureTemperature']
        .forEach(name => st[subTypes[name].value] = { getValue: f });


    st[subTypes.List.value] = {
        getValue: function (formField, processField) {
            if (!processField) {
                return formField.Value;
            }
            assert.equal(formField.Uid, processField.Uid);
            return formField.Value ? processField.Options.find(option => option.Text == formField.Value).ID : null;
        }
    };

    var MULTI_LIST_DELIMITER = ', ';
    st[subTypes.ListMultiSelect.value] = {
        getValue: function (formField, processField) {
            var result = formField.Value.split(MULTI_LIST_DELIMITER);
            if (!processField) {
                return result;
            }
            assert.equal(formField.Uid, processField.Uid);
            return result.filter(value => value).map(value => processField.Options.find(option => option.Text == value).ID);
        }
    };

    var DEPRICATED_TABLE_COL_DELIMITER = '%%';
    var DEPRICATED_TABLE_ROW_DELIMITER = '||';

    st[subTypes.DeprecatedTable.value] = {
        getValue: function (formField, processField) {
            assert.equal(formField.Uid, processField.Uid);
            var result = [];
            formField.Value.split(DEPRICATED_TABLE_ROW_DELIMITER).forEach(row => {
                var normalizedRow = {};
                row.split(DEPRICATED_TABLE_COL_DELIMITER).forEach((value, idx) => {
                    value = value.trim();
                    if (value) {
                        normalizedRow[processField.Options[idx].Text] = value;
                    }
                });
                if (!rpmUtil.isEmpty(normalizedRow)) result.push(normalizedRow);
            });
            return result;
        }
    };

    f = function (formField) {
        return formField.Value;
    };

    ['Text', 'Http', 'Description', 'TextArea', 'Link', 'SpecialPhone', 'LocationLatLong', 'LocationUTM', 'LocationDLS', 'LocationNTS', 'WellUWI', 'WellAPI', 'Html']
        .forEach(name => st[subTypes[name].value] = { getValue: f });
})();


Object.seal(DATA_TYPE);
Object.seal(OBJECT_TYPE);
Object.seal(REF_DATA_TYPE);

exports.isListField = function (field) {
    var customField = FIELD_TYPE.CustomField;
    return field.FieldType === customField.value && (field.SubType == customField.subTypes.List.value || field.SubType == customField.subTypes.ListMultiSelect.value);
};
