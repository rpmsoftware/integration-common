const rpmUtil = require('./util');
const logger = rpmUtil.logger;
const norm = require('./normalizers');
const errors = require('./api-errors');

const MAX_PARALLEL_CALLS = 20;
const PROP_POST_REQUEST = Symbol();
const PROP_PARENT = Symbol();
const CHILD_PROTO = {
    getParent: function () {
        return this[PROP_PARENT];
    }
}

function setParent(obj, parent) {
    Object.defineProperty(obj, PROP_PARENT, { value: parent });
    return obj;
}

function API(url, key, postRequest) {
    if (typeof url === 'object') {
        postRequest = arguments[arguments.length - 1];
        key = url.key;
        url = url.url;
    }
    url = url.toLowerCase().ensureRight('/');
    this.url = url.ensureRight('Api2.svc/').toString();
    this.key = key;
    assert.equal(typeof postRequest, 'function');
    this[PROP_POST_REQUEST] = postRequest;
    this.modifiedTTL = 5 * 60;
    this._formNumbers = {};
    this.throwNoForms = false;
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

const PROP_REQUEST_TIME = Symbol();
const PROP_RESPONSE_TIME = Symbol();
const PROP_API = Symbol();

const API_BASED_PROTO = {
    getApi: function () {
        return this[PROP_API];
    }
};

const RESPONSE_PROTO = Object.create(API_BASED_PROTO);
RESPONSE_PROTO.getRequestTime = function () {
    return this[PROP_REQUEST_TIME];
};
RESPONSE_PROTO.getResponseTime = function () {
    return this[PROP_RESPONSE_TIME];
};

API.prototype.request = function (endPoint, data, log) {
    const api = this;
    const url = api.getUrl(endPoint);
    if (log === undefined) {
        log = api.logRequests;
        if (log === undefined) {
            log = true;
        }
    }
    logger.debug(`POST ${url} ${log && data ? '\n' + JSON.stringify(data) : ''}`);
    const requestTime = new Date();
    return this[PROP_POST_REQUEST](url, data, api.getHeaders()).then(data => {
        const responseTime = new Date();
        if (!data.Result) {
            throw new Error(typeof data === 'object' ? data.toString() : data);
        }
        const isError = data.Result.Error;
        data = isError || data.Result || data;
        if (typeof data === 'object') {
            Object.defineProperty(data, PROP_REQUEST_TIME, { value: requestTime });
            Object.defineProperty(data, PROP_RESPONSE_TIME, { value: responseTime });
            Object.defineProperty(data, PROP_API, { value: api });
            Object.setPrototypeOf(data, RESPONSE_PROTO);
        }
        if (isError) {
            throw data;
        }
        return data;
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
    return this.request('StaffList');
};

API.prototype.getStaffGroups = function () {
    return this.request('StaffGroups');
};

API.prototype.getStaff = function (staffID) {
    return this.request('Staff', { StaffID: +staffID });
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
        'ViewCategory': rpmUtil.normalizeInteger(viewCategory),
        'ObjectSpecificID': rpmUtil.normalizeInteger(templateID)
    });
};

API.prototype.getProcessViews = function (processID) {
    return this.getViews(VIEW_CATEGORY.FormsPerTemplate, processID);
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

API.prototype.getAgentUsers = function () {
    return this.request('AgentUsers');
};

API.prototype.getCustomerUsers = function () {
    return this.request('CustomerUsers');
};

API.prototype.createFormAction = function (description, formOrID, due, userID) {
    var api = this;
    if (!userID && typeof formOrID !== 'object') {
        return api.demandForm(formOrID).then(form => api.createFormAction(description, form, due, userID));
    }
    if (!userID) {
        assert.equal(typeof formOrID, 'object');
        formOrID = formOrID.Form || formOrID;
        userID = formOrID.Participants.find(participant => participant.Name === formOrID.Owner);
        userID = userID && userID.UserID;
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
    return api.request('ActionEdit', data);
};

const PROC_PROMISE_PROPERTY = Symbol();

API.prototype.getProcesses = function () {
    const api = this;
    if (!api[PROC_PROMISE_PROPERTY]) {
        api[PROC_PROMISE_PROPERTY] = api.request('Procs').then(response => {
            Object.setPrototypeOf(response, PROCESSES_PROTO);
            response.Procs.forEach(api._extendProcess.bind(api));
            delete api[PROC_PROMISE_PROPERTY];
            return response;
        }, error => {
            delete api[PROC_PROMISE_PROPERTY];
            throw error;
        });
    }
    return api[PROC_PROMISE_PROPERTY];
};

function getProcess(obj) {
    return (obj || this)[PROCESS_PROP];
}

exports.getProcess = getProcess;

function getView(obj) {
    return (obj || this)[VIEW_PROP];
}

exports.getView = getView;

const VIEW_PROTO = {
    getProcess: getProcess,
    getForms: function () {
        var view = this;
        return view.getProcess().getForms(view.ID).then(result => {
            Object.defineProperty(result, VIEW_PROP, { value: view });
            return result;
        });
    },
    getFormList: function (includeArchived) {
        return this.getProcess().getFormList(includeArchived, this.ID);
    }
};

const PROCESSES_PROTO = {
    getProcess: function (nameOrID, demand) {
        const prop = typeof nameOrID === 'number' ? 'ProcessID' : 'Process';
        const result = this.Procs.find(p => p[prop] === nameOrID);
        if (!result && demand) {
            throwProcessNotFound(nameOrID);
        }
        return result;
    },
    getActiveProcess: function (nameOrID, demand) {
        let result = this.getProcess(nameOrID, demand);
        if (result && !result.Enabled) {
            throw new Error('Process is disabled: ' + nameOrID);
        }
        return result;
    }
};

const PROCESS_PROTO = exports.PROCESS_PROTO = {

    getFields: function () {
        var proc = this;
        return proc.getApi().getFields(proc.ProcessID).then(response => {
            Object.defineProperty(response, PROCESS_PROP, { value: proc });
            return response;
        });
    },

    getForms: function (viewId) {
        var proc = this;
        return proc.getApi().getForms(proc.ProcessID, viewId).then(result => {
            Object.defineProperty(result, PROCESS_PROP, { value: proc });
            return result;
        });
    },

    addForm: function (fields, status) {
        return this.getApi().addForm(this.ProcessID, fields, status);
    },

    createForm: function (fields, properties) {
        return this.getApi().createForm(this.ProcessID, fields, properties);
    },

    getFormList: function (includeArchived, viewId) {
        return this.getApi().getFormList(this, viewId, includeArchived);
    },

    getCachedFields: function () {
        var proc = this;
        var cache = rpmUtil.getCache(proc);
        var changed;
        return proc.getApi().getLastModifications().then(modifications => {
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

    },

    getAllForms: function (includeArchived) {
        var process = this;
        return process.getFormList(includeArchived).then(forms => {
            var data = [];
            var p = Promise.resolve();
            forms.forEach(form => p = p.then(() => process.getApi().getForm(form.ID)).then(form => data.push(form)));
            return p.then(() => data);
        });
    },

    getViews: function () {
        var proc = this;
        return proc.getApi().getProcessViews(proc.ProcessID).then(views => {
            views.Views.forEach(view => {
                Object.defineProperty(view, PROCESS_PROP, { value: proc });
                Object.setPrototypeOf(view, VIEW_PROTO);
            });
            return views;
        });
    },

    getView: async function (nameOrId, demand) {
        const property = typeof nameOrId === 'number' ? 'ID' : 'Name';
        let result = await this.getViews();
        result = result.Views.filter(view => view[property] === nameOrId);
        const length = result.length;
        if (demand && length < 1) {
            throw new Error(`View not found: ${nameOrId}`);
        }
        if (length > 0) {
            return result.find(v => v.IsShared) || result[0];
        }
    },

    getSecurity: function () {
        return this.getApi().getProcessSecurity(this);
    },

    getActionTypes: function () {
        return this.getApi().getActionTypes(this);
    },

    getActions() {
        return this.getApi().request('ProcActions', { ProcessID: this.ProcessID });
    }
};

Object.setPrototypeOf(PROCESS_PROTO, API_BASED_PROTO);

API.prototype._extendProcess = function (proc) {
    Object.defineProperty(proc, PROP_API, { value: this });
    Object.setPrototypeOf(proc, PROCESS_PROTO);
    return proc;
};

function throwProcessNotFound(nameOrID) {
    throw Error(`Process not found ${nameOrID}`);
}

function getProcessSearchKey(nameOrID) {
    return typeof nameOrID === 'number' ? 'ProcessID' : 'Process';
}

API.prototype.getProcess = function (nameOrID, demand) {
    return this.getCachedProcesses().then(procs => {
        var key = getProcessSearchKey(nameOrID);
        var result = procs.find(proc => proc[key] == nameOrID);
        if (demand && !result) {
            throwProcessNotFound(nameOrID);
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
            throwProcessNotFound(nameOrID);
        }
    });
};

API.prototype.getCachedProcesses = function () {
    var api = this;
    var cache = rpmUtil.getCache(api);
    return api.getModifiedAspects()
        .then(modifiedAspects => (!cache._processes || modifiedAspects.contains('ProcList')) && api.getProcesses())
        .then(processes => {
            if (processes) {
                cache._processes = processes.Procs;
            }
            return cache._processes;
        });
};

API.prototype.getInfo = function () {
    return this.request('Info').then(info => Object.setPrototypeOf(info, INFO_PROTO));
};

API.prototype.getRoles = function () {
    return this.request('Roles');
};

API.prototype.editForm = function (formId, fields, properties) {
    properties = properties || {};
    properties.FormID = rpmUtil.normalizeInteger(formId);
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

API.prototype.createFormInfoCache = function () {
    var api = this;
    var cache = {};
    return function (formID, demand) {
        var result = cache[formID];
        if (result) {
            return Promise.resolve(result);
        }
        return api.getForm(formID).then(form => form && api.getFormList(form.ProcessID, true), error => {
            if (error.Message !== errors.MSG_FORM_NOT_FOUND) {
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
                throw new Error(errors.MSG_FORM_NOT_FOUND);
            }
            return result;
        });
    };
};

function isReferenceField(field) {
    field = field || this;
    return field.FieldType === OBJECT_TYPE.FormReference;
}

exports.isReferenceField = isReferenceField;

const PROCESS_FIELD_PROTO = {
    getValue: function (formField) {
        return FIELD_ACCESSORS[this.FieldType][this.SubType].getValue(formField, this);
    },
    isReference: isReferenceField
};

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

const PROCESS_FIELDS_PROTO = {
    getField,
    getStatus,
    getFieldByUid,
    getValue: function (formField) {
        var procField = this.Fields.find(f => f.Uid === formField.Uid);
        return FIELD_ACCESSORS[procField.FieldType][procField.SubType].getValue(formField, procField);
    }
};
Object.setPrototypeOf(PROCESS_FIELDS_PROTO, RESPONSE_PROTO);


const PROCESS_PROP = Symbol();
const VIEW_PROP = Symbol();

rpmUtil.defineStandardProperty(PROCESS_FIELDS_PROTO, 'process', function () {
    return this[PROCESS_PROP];
});

API.prototype.getFields = function (processId) {
    processId = rpmUtil.normalizeInteger(processId);
    return this.request('ProcFields', { ProcessID: processId }).then(response => {
        response = response.Process;
        response.Fields.forEach(field => {
            Object.setPrototypeOf(field, PROCESS_FIELD_PROTO);
            Object.defineProperty(field, 'processID', { value: processId });
        });
        return Object.setPrototypeOf(response, PROCESS_FIELDS_PROTO);
    });
};

API.prototype.getProcessSecurity = function (processId) {
    return this.request('ProcSecurity', { ProcessID: processId.ProcessID || processId });
};

API.prototype.getActionTypes = function (processId) {
    return this.request('ActionTypes', { ProcessID: processId.ProcessID || processId });
};

API.prototype.getForms = function (processOrId, viewID) {
    const baseRequest = {};
    if (typeof processOrId === 'number') {
        baseRequest.ProcessID = rpmUtil.normalizeInteger(processOrId);
    } else {
        baseRequest.Process = rpmUtil.validateString(processOrId);
    }
    if (viewID) {
        baseRequest.ViewID = rpmUtil.normalizeInteger(viewID);
    }
    const api = this;
    return api.request('ProcForms', baseRequest).catch(error => {
        if (api.throwNoForms || error.Message !== 'No forms') {
            throw error;
        }
        error = {
            ColumnUids: [],
            Columns: [],
            Forms: [],
            View: viewID
        };
        if (typeof processOrId === 'number') {
            error.ProcessID = processOrId;
            error.Process = '';
        } else {
            error.ProcessID = 0;
            error.Process = processOrId;
        }
        return error;
    });
};


API.prototype.getFormList = function (processId, viewId, includeArchived) {
    if (includeArchived === undefined && typeof viewId === 'boolean') {
        includeArchived = viewId;
        viewId = undefined;
    }
    var request = { ProcessID: processId.ProcessID || processId };
    if (viewId) {
        request.ViewID = viewId.ID || viewId;
    }
    if (includeArchived) {
        request.IncludeArchived = true;
    }
    return this.request('ProcFormList', request);
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
    return this.demandForm.apply(this, arguments).catch(error => {
        if (error.Message != errors.MSG_FORM_NOT_FOUND) {
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

API.prototype.addForm = function (processId, fields, status) {
    logger.warn('ACHTUNG! API.addForm is deprecated. Use API.createForm() instead');
    return this.createForm(processId, fields, { Status: status });
};

API.prototype.createForm = function (processOrId, fields, properties) {
    properties = properties || {};
    fields = fields || [];
    properties = { Form: properties };
    properties[typeof processOrId === 'number' ? 'ProcessID' : 'Process'] = processOrId;
    properties.Form.Fields = Array.isArray(fields) ? fields :
        Object.keys(fields).map(key => ({ Field: key, Value: fields[key] }));
    return this.request('ProcFormAdd', properties).then(this._extendForm.bind(this));
};

const FORM_PROTO = {
    getFieldsAsObject: getFormFieldsAsObject,
    getFieldValue: getFormFieldValue,
    getField,
    getFieldByUid
};

function extendForm(form) {
    Object.setPrototypeOf(form.Form || form, FORM_PROTO);
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
    return {
        RpmApiKey: this.key,
        "Content-Type": "application/json"
    };
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
            api[PROP_MODIFIED_TIMESTAMP] = response.getResponseTime().getTime();
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
    var api = this;
    return api.request('Customers').then(response => {
        var duplicates = {};
        response.Customers = response.Customers.filter(customer => {
            if (duplicates[customer.CustomerID]) {
                return false;
            }
            duplicates[customer.CustomerID] = true;
            customer.CustomerID = +customer.CustomerID;
            api.tweakDates(customer);
            return true;
        });
        return response;
    });
};

API.prototype.tweakDates = function (object) {
    object.Added = object.Added && rpmUtil.normalizeDate(object.Added);
    object.Modified = object.Modified ? rpmUtil.normalizeDate(object.Modified) : object.Added;
    return object;
};

API.prototype.getCustomerAccounts = function (nameOrID) {
    var req = {};
    req[typeof nameOrID === 'number' ? 'CustomerID' : 'Customer'] = nameOrID;
    var api = this;
    return api.request('Accounts', req).then(response => {
        response.Accounts.forEach(a => api.tweakDates(a));
        return response;
    });
};


API.prototype.getSupplierAccounts = function (nameOrID) {
    var req = {};
    req[typeof nameOrID === 'number' ? 'SupplierID' : 'Supplier'] = nameOrID;
    var api = this;
    return api.request('Accounts', req).then(response => {
        response.Accounts.forEach(a => api.tweakDates(a));
        return response;
    });
};

API.prototype.getAccount = async function (account, supplier, demand) {
    const req = {};
    if (typeof account === 'number') {
        req.AccountID = account;
    } else {
        req.Account = account;
        req[typeof supplier === 'number' ? 'SupplierID' : 'Supplier'] = supplier;
    }
    try {
        const acc = await this.request('Account', req);
        return this.tweakDates(acc);
    } catch (e) {
        if (demand || e.Message !== errors.MSG_ACCOUNT_NOT_FOUND) {
            throw e;
        }
    }
};

API.prototype.getAccounts = function (modifiedAfter) {
    modifiedAfter = modifiedAfter ? rpmUtil.normalizeDate(modifiedAfter) : new Date(0);
    var api = this;
    return api.request('Accounts', { ModifiedAfter: modifiedAfter.toISOString() }).then(response => {
        response.Accounts.forEach(a => api.tweakDates(a));
        return response;
    });
};

API.prototype.getAllAccounts = function () {
    return this.getAccounts(new Date(0));
};

API.prototype.getAccountGroupsInUse = function () {
    return this.getAllAccounts().then(accounts => {
        var result = {};
        accounts.Accounts.forEach(acc => {
            if (!acc.AccountGroupID || result[acc.AccountGroupID]) {
                return;
            }
            result[acc.AccountGroupID] = {
                AccountGroupID: acc.AccountGroupID,
                AccountGroup: acc.AccountGroup,
                SupplierID: acc.SupplierID
            };
        });
        return rpmUtil.getValues(result);
    });
};

API.prototype.createAccount = function (name, customer, supplier, location, group, fields) {
    var data = { Name: name };
    if (fields) {
        data.Fields = fields;
    }
    customer = customer && (customer.CustomerID || customer.Customer || customer);
    supplier = supplier && (supplier.SupplierID || supplier.Supplier || supplier);
    location = location && (location.LocationID || location.Name || location);
    group = group && (group.AccountGroupID || group.AccountGroup || group);

    data[typeof customer === 'number' ? 'CustomerID' : 'CustomerName'] = customer;
    data[typeof supplier === 'number' ? 'SupplierID' : 'SupplierName'] = supplier;
    data[typeof location === 'number' ? 'LocationID' : 'LocationName'] = location;
    data[typeof group === 'number' ? 'AccountGroupID' : 'AccountGroupName'] = group;
    return this.request('AccountAdd', { Account: data });
};

function objectToId(nameOrID, property) {
    return typeof nameOrID === 'object' ? nameOrID[property] : nameOrID;
}

API.prototype.getCustomer = async function (nameOrID, demand) {
    nameOrID = objectToId(nameOrID, 'CustomerID');
    const request = {};
    request[(typeof nameOrID === 'number') ? 'CustomerID' : 'Customer'] = nameOrID;
    try {
        const result = await this.request('Customer', request);
        return this._normalizeCustomer(result);
    } catch (e) {
        if (demand || e.Message !== errors.MSG_CUSTOMER_NOT_FOUND) {
            throw e;
        }
    }
};

API.prototype.searchCustomers = function (field, value) {
    if (value === undefined) {
        value = field;
        field = undefined;
    }
    return this.request('CustomerSearch', { Field: field, Search: value });
};

API.prototype._normalizeCustomer = function (customer) {
    customer.Age = customer.Age || 0;
    ['Locations', 'Accounts'].forEach(prop =>
        customer[prop].forEach(ch => Object.setPrototypeOf(setParent(ch, customer), CHILD_PROTO))
    );
    return this.tweakDates(customer);
};

API.prototype.createCustomer = function (data) {
    if (typeof data !== 'object') {
        data = {
            Name: data
        };
    }
    data = data.Customer || data;
    return this.request('CustomerAdd', { Customer: data }).then(result => this._normalizeCustomer(result));
};

API.prototype.editCustomer = function (nameOrID, data) {
    nameOrID = objectToId(nameOrID, 'CustomerID');
    if (typeof data !== 'object') {
        data = {
            Name: data
        };
    }
    data = data.Customer || data;
    if (typeof nameOrID === 'number') {
        data.CustomerID = nameOrID;
    } else if (data.Name) {
        throw new Error('CustomerID has to be integer');
    } else {
        data.Name = nameOrID;
    }
    return this.request('CustomerEdit', { Customer: data }).then(result => this._normalizeCustomer(result));
};

API.prototype.addCustomerContact = function (customerID, contact, primary) {
    customerID = objectToId(customerID, 'CustomerID');
    return this.request('CustomerContactAdd', {
        CustomerID: customerID,
        IsPrimary: !!primary,
        Contact: contact.Contact || contact
    }).then(result => result.Contact);
};

API.prototype.editCustomerContact = function (customerID, contactID, data, primary) {
    customerID = objectToId(customerID, 'CustomerID');
    if (typeof contactID === 'object') {
        primary = data;
        data = contactID;
    } else {
        data = data || {};
        data.ContactID = contactID;
    }
    return this.request('CustomerContactEdit', {
        CustomerID: customerID,
        IsPrimary: !!primary,
        Contact: data
    }).then(result => result.Contact);
};

API.prototype.addCustomerLocation = function (customerID, location) {
    if (typeof location !== 'object') {
        location = {
            Name: location
        };
    }
    return this.request('CustomerLocationAdd', {
        CustomerID: objectToId(customerID, 'CustomerID'),
        Location: location.Location || location
    });
};

API.prototype.editCustomerLocation = function (customerID, locationID, location) {
    if (typeof locationID === 'object') {
        location = locationID.Location || locationID;
    } else {
        location = typeof location === 'object' ? location.Location || location : { Name: location };
        location.LocationID = locationID;
    }
    return this.request('CustomerLocationEdit', {
        CustomerID: objectToId(customerID, 'CustomerID'),
        Location: location
    });
};

API.prototype.getSuppliers = async function () {
    const result = await this.request('Suppliers');
    result.Suppliers.forEach(s => this.tweakDates(s));
    return result;
};

API.prototype.getAgencies = function () {
    var api = this;
    return api.request('Agencies').then(response => {
        response.Agencies.forEach(a => api.tweakDates(a));
        return response;
    });
};

function extractContact(object) {
    assert.equal(typeof object.Contact, 'object');
    if (typeof object.Contact !== 'object') {
        var contact = object.Contact = {};
        ["ContactID", "Email", "FirstName", "LastName", "PhoneNumbers", "Salutation", "Title"].forEach(property => {
            contact[property] = object[property];
            delete object[property];
        });
    }
    return object;
}

API.prototype.getAgency = async function (nameOrID, demand) {
    const request = {};
    request[(typeof nameOrID === 'number') ? 'AgencyID' : 'Agency'] = nameOrID;
    try {
        const agency = await this.request('Agency', request);
        agency.Reps.forEach(rep => Object.setPrototypeOf(setParent(rep, agency), CHILD_PROTO));
        return extractContact(this.tweakDates(agency));
    } catch (e) {
        if (demand || e.Message !== errors.MSG_AGENCY_NOT_FOUND) {
            throw e;
        }
    }
};

API.prototype.createAgency = function (data) {
    if (typeof data !== 'object') {
        data = { Agency: data };
    }
    return this.request('AgencyAdd', { Agency: data }).then(a => extractContact(this.tweakDates(a)));
};

API.prototype.editAgency = function (id, data) {
    data = data || id;
    assert.equal(typeof data, 'object');
    if (typeof id === 'number') {
        data.AgencyID = id;
    }
    return this.request('AgencyEdit', { Agency: data }).then(a => extractContact(this.tweakDates(a)));
};

API.prototype.getRep = function (repNameOrID, agencyNameOrID) {
    var api = this;
    var request = {};
    if (typeof repNameOrID === 'number') {
        request.RepID = repNameOrID;
    } else {
        request.Rep = repNameOrID;
        request[typeof agencyNameOrID === 'number' ? 'AgencyID' : 'Agency'] = agencyNameOrID;
    }
    return api.request('Rep', request).then(r => extractContact(api.tweakDates(r)));
};

API.prototype.getRepByAssignment = function (supplierNameOrID, assignCode) {
    var api = this;
    var request = {
        AssignmentCode: assignCode
    };
    request[typeof supplierNameOrID === 'number' ? 'SupplierID' : 'Supplier'] = supplierNameOrID;
    return api.request('Rep', request).then(r => extractContact(api.tweakDates(r)));
};

API.prototype.errorToFormAction = function (error, form, user) {
    if (error instanceof Error) {
        error = error.name + '. ' + error.message;
    } else {
        error = error.Message || error;
    }
    return this.createFormAction(error, form, new Date(), user);
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

exports.FIELD_FORMAT = Object.seal({
    String: 1,    // Account, Role, Supplier, [list field]
    Money: 2,    // Net billed, Payout, [money 2], [money 4], [formula 2], [formula 4]
    Date: 3,    // Action due, Last logon, [date field]
    Boolean: 4,    // Yes/no, [yesno field]
    Integer: 5,    // Number of accounts, Files, Qty
    Percent: 6,    // Decimal percent, like 0.5 for 50%
    Text: 7,    // [text field], [description field], [list multi-select]
    Email: 8,    // Email (from contacts)
    Phone: 9,    // Phone (from contacts)
    View: 10,   // View link column - or other "controls" that are links
    SmallText: 11,   // Special text
    Http: 12,   // Website from company, [link field], [link (fixed)]. Value is a URL like http://google.com
    Divider: 13,   // [divider field]
    Misc: 14,   // ? phone + email?
    BigInt: 15,   // NOT USED
    TextArea: 16,   // Paragraph, [text area field]
    IntegerLink: 17,   // Items link
    Table: 18,   // [table field]
    Number: 20,   // [number field], [number (fixed)]
    PercentCustom: 21,   // "whole number", like 50 for 50% [percent field] 
    SpecialPhone: 22,   // [npa-nxxx]
    LocationLatLong: 23,   // [lat/long]
    GoogleMapLink: 24,   // Map column
    DateTime: 25,   // A formatted Date and time string
    Money4: 26,   // 4 decimal money type
    TimeDate: 27,   // A Time and date in the format (3:39 PM Aug 30, 2010)
    YMAsDate: 28,   // The underlying data is a YM string that needs to be formatted as a date.
    NumberDouble: 29,   // A decimal number type.
    IntegerRaw: 30,   // A format that corresponds to the integer digits and nothing else (no commas).
    General: 31,   // For Excel, this equates with "No formatting".  This is needed for situations where we would use Text, but there are many return feeds which causes the cell not to display properly (Case 5069)
    Label: 32,   // Label Custom field.  Used (so far) for multi-form printing.
    Description: 33,   // Description Custom field.  Used (so far) for multi-form printing.
    DateTimeFormatted: 34,   // A DateTime that is ready for display. compared to 25 which is really like a "DateTimeRaw"
    LinkEl: 35,   // Contains a link element in html
    RpmObjLink: 36,   // Not used yet, but will have a way to have type id, obj id, and name given and JS will make the link 
    RpmObjLinkSubtle: 37,   // Above but only show link on hover (give the anchor element css class="gridLink")
    DateTimeISOShort: 38,   // An ISO date format:  [YYYY]-[MM]-[DD]T[hh]:[mm]
    LocationDLS: 39,   // A DLS location
    LocationNTS: 40,   // A NTS
    LocationUTM: 41,   // A UTM
    WellUWI: 42,   // A Well UWI
    WellAPI: 43,   // A Well API
    DescriptionTable: 44,   // A description table decoration field.
    WellColumn: 45,   // A Well Data
    MeasurementField: 46,   // One of the measurement fields: 1:11 is "11 mm"
    YesNoList: 47    // A YesNo field list
});

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
    MeasureForce: 36,
    MeasureDensity: 37,
    MeasureFlow: 38,
    MeasureTemperature: 39,
    DeprecatedFormulaQuantity: 40,
    YesNoList: 41,
    ListScore: 42,
    Html: 43, // Fixed
    LocationList: 44,
    FieldTable: 45,
    FieldTableDefinedRow: 46,
    FormulaField: 47,
    MeasureVolumeSmall: 48,
    MeasureVolumeMedium: 49,
    MeasureVolumeLarge: 50,
    MeasureLengthLarge: 51
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

const OBJECT_TYPE = exports.OBJECT_TYPE = {
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
    ProductVariables: 12,
    ItemVariables: 13,
    CustomerLocation: 14,
    CustomerAlias: 15,
    Instance: 17,
    Brand: 19,
    Agreement: 20,
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
    AgencyGroup: 206,
    CommAdjType: 300,
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
    CommMatrix: 321, // we have multiple import matrixes 
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
    CommName: 420,
    CommItemTransfer: 421,
    FileAttachment: 450,
    ECItem: 470,
    ECTemplate: 471,
    CustomField: 500,
    CustomFieldValue: 501,
    CustomFieldListSelectedItem: 502,
    FormField: 503,
    TableFieldRow: 504,
    PMFieldField: 505,
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
    FormSignature: 532,
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
    Holder: 580,
    HolderModifiedDate: 581, // for view
    FolderFiles: 582, // for view
    NoFolderFiles: 583, // for view
    Role: 600,
    StaffGroup: 601,
    RolePrivilege: 602,
    RolePermsission: 603,
    AgencyAssignment: 620,
    AgencyAssignmentCategory: 621,
    CalendarAction: 650,
    CalendarDate: 651,
    Cview: 700,
    Cview_ColumnOption: 710,
    Cview_FilterOption: 711,
    AgencyReferral: 715,
    Referral: 716,
    FormLayout: 741,
    PhoneType: 800,
    TemporaryLogo: 851,
    Reconciles: 900,
    Reconcile: 901,
    SuperUserBillingLevel: 950,
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
    User: 10078,
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
    FieldFieldStaticOption: 10140,
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
    HolderProcess: 10600,
    ViewDownload: 10609,
    ImportFile: 10610
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
    FieldReference: 505,
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

const SHARED_FIELD_SUBTYPES = exports.SHARED_FIELD_SUBTYPES = OBJECT_TYPE;

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

    subTypes = fieldTypes.SharedField.subTypes;
    for (name in SHARED_FIELD_SUBTYPES) {
        subTypes[name] = { value: SHARED_FIELD_SUBTYPES[name] };
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
    if (subTypeName === undefined) {
        return field;
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
        'MeasureWeight', 'MeasureForce', 'MeasureDensity', 'MeasureFlow', 'MeasureTemperature']
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

    var DEPRICATED_TABLE_COL_DELIMITER = ' %%';
    var DEPRICATED_TABLE_ROW_DELIMITER = ' ||';

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

    ['Text', 'Http', 'Description', 'TextArea', 'Link', 'SpecialPhone', 'LocationLatLong',
        'LocationUTM', 'LocationDLS', 'LocationNTS', 'WellUWI', 'WellAPI', 'Html']
        .forEach(name => st[subTypes[name].value] = { getValue: f });

})();


Object.seal(DATA_TYPE);
Object.seal(OBJECT_TYPE);
Object.seal(REF_DATA_TYPE);

exports.REP_TYPES = Object.seal(['Rep', 'Manager']);

exports.isListField = function (field) {
    var customField = FIELD_TYPE.CustomField;
    return field.FieldType === customField.value && (field.SubType == customField.subTypes.List.value || field.SubType == customField.subTypes.ListMultiSelect.value);
};

exports.isTableField = function (field) {
    var customField = FIELD_TYPE.CustomField;
    return field.FieldType === customField.value && (
        field.SubType == customField.subTypes.FieldTable.value ||
        field.SubType == customField.subTypes.FieldTableDefinedRow.value
    );
};

const STAFF_FILTERS = {};
['Role', 'StaffGroup', 'Enabled'].forEach(prop => STAFF_FILTERS[prop] = rpmUtil.getEager(OBJECT_TYPE, prop));
exports.STAFF_FILTERS = Object.seal(STAFF_FILTERS);

exports.getStaffFilters = function (field) {
    validateFieldType(field, 'FormReference', 'Staff');
    const result = {};
    for (let prop in STAFF_FILTERS) {
        let v = STAFF_FILTERS[prop];
        v = field.Filters.find(f => f.Type === v).Specific;
        if (v) {
            result[prop] = v;
        }
    }
    return result;
}


