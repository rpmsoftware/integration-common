const rpmUtil = require('./util');
const errors = require('./api-errors');
const { URL } = require('url');
const assert = require('assert');
const util = require('util');

const MAX_PARALLEL_CALLS = 20;

function setParent(obj, parent) {
    return Object.defineProperty(obj, 'parent', { value: parent });
}

function API(url, key, postRequest) {
    if (typeof url === 'object') {
        postRequest = key;
        key = url.key;
        url = url.url;
    }
    url = url.toLowerCase().ensureRight('/');
    this.url = url.ensureRight('api2.svc/').toString();
    this.key = key;
    if (!postRequest) {
        postRequest = 'node-rest';
    }
    if (typeof postRequest === 'string') {
        postRequest = require('./rest-posters/' + postRequest)();
    }
    assert.equal(typeof postRequest, 'function');
    Object.defineProperty(this, 'postRequest', { value: postRequest });
    this.modifiedTTL = 5 * 60;
    this._formNumbers = {};
    this.throwNoForms = false;
    this.logger = rpmUtil.logger;

    let formUrlTemplate = new URL(url).hostname.split('.');
    assert.equal(formUrlTemplate[0], 'api');
    formUrlTemplate[0] = 'secure';
    formUrlTemplate = formUrlTemplate.join('.');
    this.formUrlTemplate = `https://${formUrlTemplate}/rpm/page/form.aspx?item=%d`;
    this.validateParameters = true;
}

rpmUtil.defineStandardProperty(API.prototype, 'parallelRunner', () => {
    if (!this._parallelRunner) {
        this._parallelRunner = rpmUtil.createParallelRunner(MAX_PARALLEL_CALLS);
    }
    return this._parallelRunner;
});

API.prototype.getFormUrl = function (formID) {
    if (typeof formID === 'object') {
        formID = (formID.Form || formID).FormID;
    }
    return util.format(this.formUrlTemplate, rpmUtil.normalizeInteger(formID));
}

API.prototype.getUrl = function (endPoint) {
    return this.url + endPoint;
};

const API_BASED_PROTO = {
    getApi: function () {
        return this.api;
    }
};

const RESPONSE_PROTO = Object.create(API_BASED_PROTO);
RESPONSE_PROTO.getRequestTime = function () {
    return this.requestTime;
};
RESPONSE_PROTO.getResponseTime = function () {
    return this.responseTime;
};

API.prototype.assignTo = function (object) {
    !object.api && Object.defineProperty(object, 'api', { value: this });
    return object;
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
    this.logger.debug(`POST ${url} ${log && data ? '\n' + JSON.stringify(data) : ''}`);
    const requestTime = new Date();
    return this.postRequest(url, data, api.getHeaders()).then(data => {
        const responseTime = new Date();
        if (!data.Result) {
            throw new Error(typeof data === 'object' ? data.toString() : data);
        }
        const isError = data.Result.Error;
        data = isError || data.Result || data;
        if (typeof data === 'object') {
            Object.defineProperty(data, 'requestTime', { value: requestTime });
            Object.defineProperty(data, 'responseTime', { value: responseTime });
            api.assignTo(data);
            Object.setPrototypeOf(data, RESPONSE_PROTO);
        }
        if (isError) {
            throw data;
        }
        return data;
    });

};

API.prototype.getUser = function (userName) {
    return this.request('User', { Username: userName });
};

API.prototype.checkUserPassword = function (userName, password) {
    return this.request('UserPasswordCheck', { Username: userName, Password: password }, false);
};

API.prototype.getStaffList = function (includeGuests) {
    return this.request('StaffList', { IncludeGuest: rpmUtil.toBoolean(includeGuests) });
};

API.prototype.getStaffGroups = function () {
    return this.request('StaffGroups');
};

API.prototype.getStaff = function (staffID) {
    return this.request('Staff', { StaffID: rpmUtil.normalizeInteger(staffID) });
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

API.prototype.getReps = async function () {
    return (await this.getAgentUsers()).AgentUsers.filter(u => u.RepID > 0);
};

API.prototype.getManagers = async function getManagers() {
    return (await this.getAgentUsers()).AgentUsers.filter(u => u.MgrID > 0);
}

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
    return (obj || this).process;
}

exports.getProcess = getProcess;

function getView(obj) {
    return (obj || this).view;
}

exports.getView = getView;

const VIEW_PROTO = {
    getProcess: getProcess,
    getForms: function () {
        var view = this;
        return view.getProcess().getForms(view.ID).then(result => {
            Object.defineProperty(result, 'view', { value: view });
            return result;
        });
    },
    getFormList: function (refType) {
        return this.getProcess().getFormList(this.ID, refType);
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
            Object.defineProperty(response, 'process', { value: proc, configurable: true });
            return response;
        });
    },

    getForms: function (viewId) {
        var proc = this;
        return proc.getApi().getForms(proc.ProcessID, viewId).then(result => {
            Object.defineProperty(result, 'process', { value: proc, configurable: true });
            return result;
        });
    },


    createForm: function (fields, properties, fireWebEvent) {
        return this.getApi().createForm(this.ProcessID, fields, properties, fireWebEvent);
    },

    getFormList: function (viewID, refType) {
        return this.getApi().getFormList(this.ProcessID, viewID, refType);
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
                Object.defineProperty(view, 'process', { value: proc, configurable: true });
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
        return this.getApi().getProcessSecurity(this.ProcessID);
    },

    getActionTypes: function () {
        return this.getApi().getActionTypes(this.ProcessID);
    },

    getActions() {
        return this.getApi().getProcessActions(this.ProcessID);
    }
};

Object.setPrototypeOf(PROCESS_PROTO, API_BASED_PROTO);

API.prototype._extendProcess = function (proc) {
    this.assignTo(proc);
    Object.setPrototypeOf(proc, PROCESS_PROTO);
    return proc;
};

function throwProcessNotFound(nameOrID) {
    throw Error(`Process not found ${nameOrID}`);
}

API.prototype.getInfo = function () {
    return this.request('Info').then(info => Object.setPrototypeOf(info, INFO_PROTO));
};

API.prototype.getRoles = function () {
    return this.request('Roles');
};

API.prototype.editForm = async function (processNameOrID, formNumberOrID, fields, properties, fireWebEvent) {
    if (typeof formNumberOrID === 'object') {
        fireWebEvent = properties;
        properties = fields;
        fields = formNumberOrID;
        formNumberOrID = processNameOrID;
        processNameOrID = undefined;
    }
    const type = typeof properties;
    if (fireWebEvent === undefined && type === 'boolean') {
        fireWebEvent = properties;
        properties = {};
    } else if (type !== 'object') {
        properties = {};
    }
    const body = { Form: properties, OverwriteWithNull: true };
    if (processNameOrID) {
        if (typeof processNameOrID === 'string') {
            body.Process = processNameOrID;
        } else {
            body.ProcessID = rpmUtil.normalizeInteger(processNameOrID);
        }
        properties.Number = formNumberOrID;
    } else {
        properties.FormID = rpmUtil.normalizeInteger(formNumberOrID);
    }
    fields = fields || [];
    properties.Fields = Array.isArray(fields) ? fields :
        Object.keys(fields).map(key => ({ Field: key, Value: fields[key] }));
    if (fireWebEvent) {
        body.WebhookEvaluate = true;
    }

    return this._extendForm(await this.request('ProcFormEdit', body));
};

API.prototype._archiveForm = function (formID) {
    if (this.validateParameters) {
        formID = rpmUtil.normalizeInteger(formID);
    }
    return this.request('ProcFormArchive', { FormID: formID });
};

API.prototype._unarchiveForm = function (formID) {
    if (this.validateParameters) {
        formID = rpmUtil.normalizeInteger(formID);
    }
    return this.request('ProcFormUnarchive', { FormID: formID });
};

API.prototype.setFormArchived = function (formID, archived) {
    return (archived === undefined || rpmUtil.toBoolean(archived)) ?
        this._archiveForm(formID) :
        this._unarchiveForm(formID);
};

API.prototype.trashForm = function (formID) {
    return this.request('ProcFormTrash', { FormID: rpmUtil.normalizeInteger(formID) });
};

function isReferenceField(field) {
    field = field || this;
    return field.FieldType === OBJECT_TYPE.FormReference;
}

exports.isReferenceField = isReferenceField;

function getStatus(nameOrID, demand) {
    var property = typeof nameOrID === 'number' ? 'ID' : 'Text';
    var result = this.StatusLevels.find(st => st[property] === nameOrID);
    if (!result && demand) {
        throw new Error('Unknown status: ' + nameOrID);
    }
    return result;
}

const PROCESS_FIELDS_PROTO = {
    getField,
    getStatus,
    getFieldByUid
};
Object.setPrototypeOf(PROCESS_FIELDS_PROTO, RESPONSE_PROTO);

API.prototype.getFields = async function (processID) {
    processID = rpmUtil.normalizeInteger(processID);
    const response = await this.request('ProcFields', { ProcessID: processID });
    const process = response.Process;
    delete response.Process;
    assert.equal(Object.keys(response).length, 0);
    process.Fields.forEach(field =>
        Object.defineProperty(field, 'processID', { value: processID })
    );
    Object.assign(response, process);
    return Object.setPrototypeOf(response, PROCESS_FIELDS_PROTO);
};

API.prototype.getProcessSecurity = function (processId) {
    return this.request('ProcSecurity', { ProcessID: rpmUtil.normalizeInteger(processId) });
};

API.prototype.getActionTypes = function (processId) {
    return this.request('ActionTypes', { ProcessID: rpmUtil.normalizeInteger(processId) });
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

API.prototype.getFormList = function (processID, viewID, refType) {
    if (this.validateParameters) {
        assert.strictEqual(typeof processID, 'number');
        assert(arguments.length <= 3);
    }
    const request = { ProcessID: processID };
    const type = typeof viewID;
    if (type === 'number') {
        request.ViewID = viewID;
    } else if (viewID !== undefined) {
        this.validateParameters && assert.strictEqual(type, 'boolean');
        request.IncludeArchived = !!viewID;
    }
    if (refType !== undefined) {
        this.validateParameters && assert.strictEqual(type, 'number');
        request.ReferenceType = refType;
    }
    return this.request('ProcFormList', request);
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
    this.assignTo(form);
    form.Form && this.assignTo(form.Form);
    return extendForm(form);
};

API.prototype.getForm = function () {
    return this.demandForm.apply(this, arguments).catch(error => {
        if (error.Message != errors.MSG_FORM_NOT_FOUND) {
            throw error;
        }
    });
};

API.prototype.getFile = function (fileID, returnUrl) {
    if (this.validateParameters) {
        fileID = rpmUtil.normalizeInteger(fileID);
    }
    return this.request('ProcFormFile', { FileID: fileID, ReturnDownloadUrl: rpmUtil.toBoolean(returnUrl) });
};

API.prototype.addFormFile = function (formID, fileName, fileData, folderID, description, shared) {
    if (this.validateParameters) {
        fileData = rpmUtil.toBase64(fileData);
        formID = rpmUtil.normalizeInteger(formID);
        fileName = rpmUtil.validateString(fileName);
    }
    return this.request('ProcFormFileAdd', {
        FormID: formID,
        File: fileData,
        Name: fileName,
        Description: description || undefined,
        FolderID: +folderID || undefined,
        IsStaffOnly: !shared
    });
};

API.prototype.editFormFile = async function (fileID, formID, fileName, folderID, description, shared) {
    if (this.validateParameters) {
        fileID = rpmUtil.normalizeInteger(fileID);
        fileName = fileName === undefined ? undefined : rpmUtil.validateString(fileName);
        folderID = folderID === undefined ? undefined : rpmUtil.normalizeInteger(folderID);
    }
    return this.request('ProcFormFileEdit', {
        FileID: fileID,
        FormID: formID,
        Name: fileName,
        Description: description,
        FolderID: folderID,
        IsStaffOnly: shared === undefined ? undefined : !shared
    });
};

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

API.prototype.createForm = function (processOrId, fields, properties, fireWebEvent) {
    const type = typeof properties;
    if (fireWebEvent === undefined && type === 'boolean') {
        fireWebEvent = properties;
        properties = {};
    } else if (type !== 'object') {
        properties = {};
    }
    fields = fields || [];
    properties = { Form: properties };
    properties[typeof processOrId === 'number' ? 'ProcessID' : 'Process'] = processOrId;
    properties.Form.Fields = Array.isArray(fields) ? fields :
        Object.keys(fields).map(key => ({ Field: key, Value: fields[key] }));
    if (fireWebEvent) {
        properties.WebhookEvaluate = true;
    }
    return this.request('ProcFormAdd', properties).then(this._extendForm.bind(this));
};

const FORM_PROTO = {
    getField,
    getFieldByUid
};
Object.defineProperty(FORM_PROTO, 'url', {
    get: function () {
        return this.api.getFormUrl(this.FormID);
    }
});

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
        'Content-Type': 'application/json'
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

API.prototype.getModifiedAspects = async function () {
    const response = await this.getLastModifications();
    const result = [];
    const lastKnown = this.lastKnownModified;
    if (lastKnown) {
        for (let key in lastKnown) {
            response[key] > lastKnown[key] && result.push(key);
        }
    }
    Object.defineProperty(this, 'lastKnownModified', { value: response, configurable: true });
    return result;
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

API.prototype.demandAccount = async function (account, supplier) {
    const req = {};
    if (typeof account === 'number') {
        req.AccountID = account;
    } else {
        req.Account = account;
        req[typeof supplier === 'number' ? 'SupplierID' : 'Supplier'] = supplier;
    }
    const acc = await this.request('Account', req);
    return this.tweakDates(acc);
};

API.prototype.getAccount = function (account, supplier, demand) {
    try {
        return this.demandAccount(account, supplier);
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
                ID: acc.AccountGroupID,
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
    group = group && (group.ID || group.AccountGroup || group);

    data[typeof customer === 'number' ? 'CustomerID' : 'CustomerName'] = customer;
    data[typeof supplier === 'number' ? 'SupplierID' : 'SupplierName'] = supplier;
    data[typeof location === 'number' ? 'LocationID' : 'LocationName'] = location;
    data[typeof group === 'number' ? 'AccountGroupID' : 'AccountGroupName'] = group;
    return this.request('AccountAdd', { Account: data });
};

function objectToId(nameOrID, property) {
    return typeof nameOrID === 'object' ? nameOrID[property] : nameOrID;
}

API.prototype.demandCustomer = async function (nameOrID) {
    let prop = typeof nameOrID;
    if (prop === 'number') {
        prop = 'CustomerID';
    } else {
        assert.equal(prop, 'string');
        prop = 'Customer';
    }
    const request = {};
    request[prop] = nameOrID;
    const result = await this.request('Customer', request);
    return this._normalizeCustomer(result);
};

API.prototype.getCustomer = async function (nameOrID, demand) {
    try {
        return this.demandCustomer(nameOrID);
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
        customer[prop].forEach(ch => setParent(ch, customer))
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

API.prototype.demandAgency = async function (nameOrID) {
    const request = {};
    request[(typeof nameOrID === 'number') ? 'AgencyID' : 'Agency'] = nameOrID;
    const agency = await this.request('Agency', request);
    agency.Reps.forEach(rep => setParent(rep, agency));
    return extractContact(this.tweakDates(agency));
};

API.prototype.getAgency = async function (nameOrID, demand) {
    try {
        return this.demandAgency(nameOrID);
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
    const type = typeof id;
    if (type === 'number') {
        data.AgencyID = id;
    } else if (type === 'string') {
        data.Agency = id;
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

API.prototype.getProcessActions = function (processID) {
    return this.request('ProcActions', { ProcessID: rpmUtil.normalizeInteger(processID) });
};

API.prototype.addFormParticipant = function (form, process, name) {
    if (name === undefined) {
        name = process;
        process = undefined;
    }
    const request = { Form: {}, Username: name.Username || name };
    if (typeof name === 'object') {
        const { Agency, Username, AgencyID } = name;
        Object.assign(request, { Agency, Username, AgencyID });
    } else {
        request.Username = rpmUtil.validateString(name);
    }
    if (typeof form === 'number') {
        request.Form.FormID = rpmUtil.normalizeInteger(form);
    } else {
        request.Form.Number = rpmUtil.validateString(form);
        if (typeof process === 'number') {
            request.ProcessID = process;
        } else {
            request.Process = rpmUtil.validateString(process);
        }
    }
    return this.request('ProcFormParticipantAdd', request).then(form => this._extendForm(form));
};

API.prototype.getAccountGroups = function () {
    return this.request('AccountGroups');
};

API.prototype.editStaff = function (staff, changes) {
    if (changes === undefined) {
        assert.equal(typeof staff, 'object');
        changes = staff;
    } else {
        staff = staff && staff.StaffID || staff;
        assert.equal(typeof staff, 'number');
        assert.equal(typeof changes, 'object');
        changes.StaffID = staff;
    }
    return this.request('StaffEdit', { Staff: changes.Staff || changes });
};

API.prototype.editUserEnabled = function (user, enabled) {
    user = user.Username || user;
    return this.request('UserEnabledEdit', {
        Username: user,
        Enabled: !!enabled
    });
};

API.prototype.createStaff = function (contact, role, enabled) {
    contact = contact || {};
    return this.request('StaffAdd', {
        Staff: role === undefined && enabled === undefined ? (contact.Staff || contact) : {
            RoleID: role && (role.ID || rpmUtil.normalizeInteger(role)),
            Contact: contact,
            Enabled: !!enabled
        }
    });
};

API.prototype.getSupplier = function (id) {
    if (this.validateParameters) {
        id = rpmUtil.normalizeInteger(id);
    }
    return this.request('Supplier', { SupplierID: id });
};


API.prototype.createAccessValidator = async function (inConfig) {
    const config = {
        users: [],
        roles: []
    };
    if (inConfig.users) {
        config.users = rpmUtil.toArray(inConfig.users).toSet();
    }
    if (inConfig.roles) {
        const roles = rpmUtil.toArray(inConfig.roles).toSet();
        if (roles.length > 0) {
            let rpmRoles = await this.getRoles();
            rpmRoles = rpmRoles.Roles;
            for (let roleName of roles) {
                const role = rpmRoles.find(r => r.Name === roleName);
                role ? config.roles.push(role.ID) : console.warn('Role not found: ' + roleName);
            }
        }
    }
    return async (username, password) => {
        if (typeof username === 'object') {
            password = username.password;
            username = username.username;
        }
        if (config.users.length < 1 && config.roles.length < 1) {
            throw errors.MSG_UNAUTHORIZED_USER;
        }
        let user = await this.checkUserPassword(username, password);
        if (!user.Success) {
            throw 'Invalid password';
        }
        if (config.users.contains(username)) {
            return;
        }
        user = await this.getStaffList(true);
        user = user.StaffList.find(u => u.Username === username);
        if (!config.roles.find(r => r === user.RoleID)) {
            throw errors.MSG_UNAUTHORIZED_USER;
        }
    };
}


exports.RpmApi = API;

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
    SpecialPhone: 20,
    LocationLatLong: 21,
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
    MeasureLengthLarge: 51,
    Duration: 52,
    Email: 53,
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


Object.seal(DATA_TYPE);
Object.seal(OBJECT_TYPE);
Object.seal(REF_DATA_TYPE);

exports.REP_TYPES = Object.seal(['Rep', 'Manager']);

exports.isListField = function (field) {
    var customField = FIELD_TYPE.CustomField;
    return field.FieldType === customField.value && (field.SubType == customField.subTypes.List.value || field.SubType == customField.subTypes.ListMultiSelect.value);
};

function isTableField(field) {
    const customField = FIELD_TYPE.CustomField;
    return field.FieldType === customField.value && (
        field.SubType == customField.subTypes.FieldTable.value ||
        field.SubType == customField.subTypes.FieldTableDefinedRow.value
    );
}

exports.isTableField = isTableField;

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

exports.getDefinitionRow = function (field) {
    assert(isTableField(field));
    const defRow = field.Rows.find(row => row.IsDefinition);
    assert.equal(typeof defRow, 'object', 'No definition row');
    return defRow;
};
