/* global Buffer */
const debug = require('debug')('rpm:api');

const {
    FieldFormat,
    ObjectType,
    RefSubType,
    FieldSubType,
    ProcessPermission,
    ProcessPermissionsHidden
} = require('./api-enums');

const {
    normalizeDate,
    getEager,
    demandDeepValue,
    normalizeInteger,
    validateString,
    toBoolean,
    toMoment,
    createParallelRunner,
    defineStandardProperty,
    toArray,
    getDataURLPrefix,
    setParent,
    throwError
} = require('./util');
const errors = require('./api-errors');
const { URL } = require('url');
const assert = require('assert');
const util = require('util');
const { EventEmitter } = require('events');

const MAX_PARALLEL_CALLS = 20;

const ISO_DATE_FORMAT = exports.ISO_DATE_FORMAT = 'YYYY-MM-DD';
const ISO_DATE_TIME_FORMAT = exports.ISO_DATE_TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

const RPM_API_ERROR = 'RpmApiError';

function API(url, key, postRequest) {
    let maxParallelCalls;
    if (typeof url === 'object') {
        postRequest = url.postRequest;
        key = url.key;
        maxParallelCalls = url.maxParallelCalls;
        url = url.url;
    }
    this.maxParallelCalls = maxParallelCalls > 0 ? maxParallelCalls : MAX_PARALLEL_CALLS;
    url = url.toLowerCase().ensureRight('/');
    this.url = url.ensureRight('api2.svc/').toString();
    this.key = key;
    if (!postRequest) {
        postRequest = 'node-fetch';
    }
    if (typeof postRequest === 'string') {
        postRequest = require('./rest-posters/' + postRequest)();
    }
    assert.strictEqual(typeof postRequest, 'function');
    Object.defineProperty(this, 'postRequest', { value: postRequest });
    this.modifiedTTL = 5 * 60;
    this._formNumbers = {};
    this.throwNoForms = false;
    let formUrlTemplate = new URL(url).hostname.split('.');
    assert.strictEqual(formUrlTemplate[0], 'api');
    formUrlTemplate[0] = 'secure';
    formUrlTemplate = formUrlTemplate.join('.');
    this.formUrlTemplate = `https://${formUrlTemplate}/rpm/page/form.aspx?item=%d`;
    this.validateParameters = true;
}

API.prototype = new EventEmitter();
API.prototype.constructor = API;

defineStandardProperty(API.prototype, 'parallelRunner', function () {
    if (!this._parallelRunner) {
        const { maxParallelCalls } = this;
        assert(+maxParallelCalls > 0);
        Object.defineProperty(this, '_parallelRunner', { value: createParallelRunner(maxParallelCalls) });
    }
    return this._parallelRunner;
});

API.prototype.getFormUrl = function (formID) {
    if (typeof formID === 'object') {
        formID = (formID.Form || formID).FormID;
    }
    return util.format(this.formUrlTemplate, normalizeInteger(formID));
}

API.prototype.getUrl = function (endPoint) {
    return this.url + endPoint;
};

API.prototype.assignTo = function (object) {
    !object.api && Object.defineProperty(object, 'api', { value: this });
    return object;
};

API.prototype.request = async function (endPoint, data, log) {
    const api = this;
    const url = api.getUrl(endPoint);
    if (log === undefined) {
        log = api.logRequests;
    }
    if (log === undefined) {
        log = true;
    }
    debug(`POST ${url} ${log && data ? '\n' + JSON.stringify(data) : ''}`);
    const requestTime = new Date();
    data = await this.postRequest(url, data, api.getHeaders())
    const responseTime = new Date();
    const { Result } = data || null;
    if (!Result) {
        throw typeof data === 'object' ? data : new Error(data + '');
    }
    const { Error: error } = Result;
    if (error) {
        const { Message } = error;
        if (Message) {
            throwError(Message, RPM_API_ERROR, error);
        } else {
            throw Result;
        }
    }
    if (typeof Result === 'object') {
        Object.defineProperty(Result, 'requestTime', { value: requestTime });
        Object.defineProperty(Result, 'responseTime', { value: responseTime });
        api.assignTo(Result);
    }
    return Result;
};

API.prototype.getUser = function (userName) {
    return this.request('User', { Username: userName });
};

API.prototype.checkUserPassword = function (userName, password) {
    return this.request('UserPasswordCheck', { Username: userName, Password: password }, false);
};

API.prototype.getStaffList = function (includeGuests, includeApiUser) {
    if (includeGuests !== undefined) {
        includeGuests = toBoolean(includeGuests);
    }
    if (includeApiUser !== undefined) {
        includeApiUser = toBoolean(includeApiUser);
    }
    return this.request('StaffList', { IncludeGuest: includeGuests, IncludeApiUser: includeApiUser });
};

API.prototype.getStaffGroups = function () {
    return this.request('StaffGroups');
};

API.prototype.getStaff = async function (staffID) {
    if (this.validateParameters) {
        staffID = normalizeInteger(staffID);
    }
    const result = await this.request('Staff', { StaffID: staffID });
    return Object.setPrototypeOf(result, STAFF_PROTO);
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
        ViewCategory: normalizeInteger(viewCategory),
        ObjectSpecificID: normalizeInteger(templateID)
    });
};

API.prototype.getProcessViews = function (processID) {
    return this.request('ProcViews', { ProcessID: normalizeInteger(processID) });
};

exports.VIEW_CATEGORY = {
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
    if (!userID && typeof formOrID !== 'object') {
        return this.demandForm(formOrID).then(form => this.createFormAction(description, form, due, userID));
    }
    if (!userID) {
        assert.strictEqual(typeof formOrID, 'object');
        formOrID = formOrID.Form || formOrID;
        userID = formOrID.Participants.find(participant => participant.Name === formOrID.Owner);
        userID = userID && userID.UserID;
    }
    if (typeof formOrID === 'object') {
        formOrID = (formOrID.Form || formOrID).FormID;
    }
    assert(+formOrID);
    assert(+userID);
    return this.editFormAction(+formOrID, {
        Description: description,
        StaffOnly: true,
        Due: toMoment(due).format(ISO_DATE_FORMAT),
        Assignee: {
            UserID: +userID
        }
    });
};

API.prototype.editFormAction = function (formID, data) {
    if (data === undefined) {
        data = formID;
        formID = undefined;
    }
    if (this.validateParameters) {
        data = data.Action || data;
        formID = normalizeInteger(formID || demandDeepValue(data, 'Form', 'FormID'));
        assert.strictEqual(typeof data, 'object');
        validateString(data.Description);
        assert(data.Due);
        assert(+data.Assignee.UserID || +data.Assignee.ParticipantID, 'Assignee UserID or ParticipantID required');
    }
    formID && (data = Object.assign({ Form: { FormID: formID } }, data));
    return this.request('ActionEdit', this.validateParameters ? { Action: data } : data);
};

const PROC_PROMISE_PROPERTY = Symbol();

API.prototype._getProcesses = function () {
    const api = this;
    if (!api[PROC_PROMISE_PROPERTY]) {
        api[PROC_PROMISE_PROPERTY] = api.request('Procs').then(response => {
            Object.setPrototypeOf(response, PROCESSES_PROTO);
            response.Procs.forEach(api._extendProcess.bind(api));
            delete api[PROC_PROMISE_PROPERTY];
            return response;
        }).finally(() => delete api[PROC_PROMISE_PROPERTY]);
    }
    return api[PROC_PROMISE_PROPERTY];
};

API.prototype.getProcesses = async function () {
    const permissions = Object.values(arguments).map(p => getEager(ProcessPermission, p));
    let result = await this._getProcesses();
    if (permissions.length > 0) {
        result = Object.assign(Object.create(PROCESSES_PROTO), result,
            { Procs: result.Procs.filter(p => permissions.indexOf(p.Permission) >= 0) }
        );
    }
    return result;
};

API.prototype.getUserProcesses = async function () {
    const result = await this._getProcesses();
    return Object.assign(Object.create(PROCESSES_PROTO), result,
        { Procs: result.Procs.filter(p => ProcessPermissionsHidden.indexOf(p.Permission) < 0) }
    );
};

const ENTITY_GETTERS = {};
ENTITY_GETTERS[ObjectType.Form] = {
    demand: function (id) {
        return this.demandForm(id);
    }
};
ENTITY_GETTERS[ObjectType.AgentCompany] = {
    demand: function (id) {
        return this.demandAgency(id.AgencyID || id);
    },
    getEntities: async function (normalize) {
        const { Agencies } = await this.getAgencies();
        normalize && Agencies.forEach(a => Object.defineProperties(a, { ID: { value: a.AgencyID }, Name: { value: a.Agency } }));
        return Agencies;
    }
};
ENTITY_GETTERS[ObjectType.Staff] = {
    demand: async function (id) {
        if (typeof id === 'string') {
            id = (await this.getStaffList()).StaffList.demand(({ Name }) => Name === id).ID;
        } else {
            id = id.ID || id;
        }
        return this.getStaff(id);
    },
    getEntities: async function () {
        return (await this.getStaffList()).StaffList;
    }
};
ENTITY_GETTERS[ObjectType.Customer] = {
    demand: function (id) {
        return this.demandCustomer(id.CustomerID || id);
    },
    getEntities: async function (normalize) {
        const { Customers } = await this.getCustomers();
        normalize && Customers.forEach(a => Object.defineProperties(a, { ID: { value: a.CustomerID }, Name: { value: a.Customer } }));
        return Customers;
    }
};
ENTITY_GETTERS[ObjectType.Supplier] = {
    demand: function (id) {
        return this.getSupplier(id.SupplierID || id);
    },
    getEntities: async function (normalize) {
        const { Suppliers } = await this.getSuppliers();
        normalize && Suppliers.forEach(a => Object.defineProperties(a, { ID: { value: a.SupplierID }, Name: { value: a.Supplier } }));
        return Suppliers;
    }
};
ENTITY_GETTERS[ObjectType.AgentRep] = {
    demand: function (id) {
        return this.demandRep(id.RepID || id);
    },
    getEntities: async function (normalize) {
        const result = await this.getReps();
        normalize && result.forEach(a => Object.defineProperties(a, { ID: { value: a.RepID } }));
        return result;
    }
};
ENTITY_GETTERS[ObjectType.StaffGroup] = {
    demand: async function (nameOrID) {
        const t = typeof nameOrID;
        let prop;
        if (t === 'number') {
            prop = 'ID';
        } else {
            assert.strictEqual(t, 'string');
            prop = 'Group';
        }
        return (await this.getStaffGroups()).Groups.demand(e => e[prop] === nameOrID);
    },
    getEntities: async function (normalize) {
        const { Groups } = await this.getStaffGroups();
        normalize && Groups.forEach(a => Object.defineProperties(a, { Name: { value: a.Group } }));
        return Groups;
    }
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
        return proc.api.getFields(proc.ProcessID).then(response => {
            Object.defineProperty(response, 'process', { value: proc, configurable: true });
            return response;
        });
    },

    getForms: function (viewId) {
        var proc = this;
        return proc.api.getForms(proc.ProcessID, viewId).then(result => {
            Object.defineProperty(result, 'process', { value: proc, configurable: true });
            return result;
        });
    },


    createForm: function (fields, properties, fireWebEvent) {
        return this.api.createForm(this.ProcessID, fields, properties, fireWebEvent);
    },

    editForm: function (formNumber, fields, properties, fireWebEvent) {
        return this.api.editForm(this.ProcessID, formNumber, fields, properties, fireWebEvent);
    },

    getFormList: function (viewID, refType) {
        return this.api.getFormList(this.ProcessID, viewID, refType);
    },

    getAllForms: function (includeArchived) {
        var process = this;
        return process.getFormList(includeArchived).then(forms => {
            var data = [];
            var p = Promise.resolve();
            forms.forEach(form => p = p.then(() => process.api.getForm(form.ID)).then(form => data.push(form)));
            return p.then(() => data);
        });
    },

    getViews: function () {
        var proc = this;
        return proc.api.getProcessViews(proc.ProcessID).then(views => {
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
        return this.api.getProcessSecurity(this.ProcessID);
    },

    getActionTypes: function () {
        return this.api.getActionTypes(this.ProcessID);
    },

    getActions() {
        return this.api.getProcessActions(this.ProcessID);
    }
};

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

API.prototype.editForm = async function (processNameOrID, formNumberOrID, fields, properties, control) {
    if (typeof formNumberOrID === 'object') {
        control = properties;
        properties = fields;
        fields = formNumberOrID;
        formNumberOrID = processNameOrID;
        processNameOrID = undefined;
    }
    let { OverwriteWithNull, WebhookEvaluate } = control || {};
    OverwriteWithNull = OverwriteWithNull === undefined ? true : toBoolean(OverwriteWithNull);
    WebhookEvaluate !== undefined && (WebhookEvaluate = toBoolean(WebhookEvaluate));
    properties = typeof properties === 'object' ? Object.assign({}, properties) : {};
    const body = { Form: properties, OverwriteWithNull, WebhookEvaluate };
    if (processNameOrID) {
        if (typeof processNameOrID === 'string') {
            body.Process = processNameOrID;
        } else {
            body.ProcessID = normalizeInteger(processNameOrID);
        }
        properties.Number = formNumberOrID;
    } else if (typeof formNumberOrID === 'number') {
        properties.FormID = formNumberOrID;
    } else {
        properties.AlternateID = formNumberOrID;
    }
    if (fields) {
        properties.Fields = Array.isArray(fields) ? fields :
            Object.keys(fields).map(key => ({ Field: key, Value: fields[key] }));
    } else {
        delete properties.Fields;
    }
    const result = this._extendForm(await this.request('ProcFormEdit', body));
    this.emit('FormEdit', result);
    return result;
};

API.prototype._archiveForm = function (formID) {
    if (this.validateParameters) {
        formID = normalizeInteger(formID);
    }
    return this.request('ProcFormArchive', { FormID: formID });
};

API.prototype._unarchiveForm = function (formID) {
    if (this.validateParameters) {
        formID = normalizeInteger(formID);
    }
    return this.request('ProcFormActivate', { FormID: formID });
};

API.prototype.setFormArchived = function (formID, archived) {
    return (archived === undefined || toBoolean(archived)) ?
        this._archiveForm(formID) :
        this._unarchiveForm(formID);
};

API.prototype.trashForm = function (id) {
    const body = {};
    body[typeof id === 'number' ? 'FormID' : 'AlternateID'] = id;
    return this.request('ProcFormTrash', body);
};

API.prototype.restoreForm = function (id) {
    const body = {};
    body[typeof id === 'number' ? 'FormID' : 'AlternateID'] = id;
    return this.request('ProcFormRestore', body);
};

function isReferenceField(field) {
    field = field || this;
    return field.FieldType === ObjectType.FormReference;
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

API.prototype.getBasicFields = async function (type) {
    const entities = await this.getEntities(type);
    assert(entities.length > 0, 'There are no entities');
    const { Fields } = await this.demandEntity(type, entities[0]);
    return { Fields: Fields.map(({ Field: Name, Uid }) => ({ Name, Uid })) };
};

API.prototype.getFields = async function (processID) {
    processID = normalizeInteger(processID);
    const response = await this.request('ProcFields', { ProcessID: processID });
    const process = response.Process;
    delete response.Process;
    assert.strictEqual(Object.keys(response).length, 0);
    process.Fields.forEach(field =>
        Object.defineProperty(field, 'processID', { value: processID })
    );
    Object.assign(response, process);
    return Object.setPrototypeOf(response, PROCESS_FIELDS_PROTO);
};

API.prototype.getProcessSecurity = function (processId) {
    return this.request('ProcSecurity', { ProcessID: normalizeInteger(processId) });
};

API.prototype.getActionTypes = function (processId) {
    return this.request('ActionTypes', { ProcessID: normalizeInteger(processId) });
};

API.prototype.getForms = function (processOrId, viewID) {
    const baseRequest = {};
    if (typeof processOrId === 'number') {
        baseRequest.ProcessID = normalizeInteger(processOrId);
    } else {
        baseRequest.Process = validateString(processOrId);
    }
    if (viewID) {
        baseRequest.ViewID = normalizeInteger(viewID);
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
        this.validateParameters && assert.strictEqual(typeof refType, 'number');
        request.ReferenceType = refType;
    }
    return this.request('ProcFormList', request);
};

const PROP_TRASHED = 'Trashed';

API.prototype.demandForm = function (processOrFormId, formNumber, AllowTrashed) {
    if (typeof formNumber === 'boolean') {
        AllowTrashed = formNumber;
        formNumber = undefined;
    }
    formNumber || (formNumber = undefined);
    return this._demandForm(processOrFormId, formNumber, toBoolean(AllowTrashed));
}

API.prototype._demandForm = async function (processOrFormId, formNumber, AllowTrashed) {
    assert.strictEqual(typeof AllowTrashed, 'boolean');
    formNumber === undefined || assert.strictEqual(typeof formNumber, 'string');
    let Process, ProcessID, FormNumber, AlternateID, FormID;
    const type = typeof processOrFormId;
    if (formNumber === undefined) {
        Process = undefined;
        ProcessID = undefined;
        FormNumber = undefined;
        if (type === 'number') {
            AlternateID = undefined;
            FormID = processOrFormId;
        } else {
            assert.strictEqual(type, 'string');
            AlternateID = processOrFormId;
            FormID = undefined;
        }
    } else {
        AlternateID = undefined;
        FormID = undefined;
        FormNumber = formNumber + '';
        if (type === 'number') {
            Process = undefined;
            ProcessID = processOrFormId;
        } else {
            assert.strictEqual(type, 'string');
            ProcessID = undefined;
            Process = processOrFormId;
        }
    }
    const result = await this.request('ProcForm', { FormID, ProcessID, Process, FormNumber, AlternateID, AllowTrashed })
        .then(form => this._extendForm(form));
    AllowTrashed && Object.defineProperty(result, PROP_TRASHED, { value: true });
    return result;
};

API.prototype._extendForm = function (form) {
    this.assignTo(form);
    assert(form.Form);
    this.assignTo(form.Form);
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
        fileID = normalizeInteger(fileID);
    }
    return this.request('ProcFormFile', { FileID: fileID, ReturnDownloadUrl: toBoolean(returnUrl) });
};

API.prototype.addFormFile = function (formID, fileName, fileData, folderID, description, shared) {
    if (typeof formID === 'object') {
        fileName = formID.Name;
        fileData = formID.File;
        folderID = formID.FolderID;
        description = formID.Description;
        shared = !formID.IsStaffOnly;
        formID = formID.FormID;
    }
    if (this.validateParameters) {
        Buffer(fileData) ? (fileData = fileData.toString('base64')) : validateString(fileData);
        formID = normalizeInteger(formID);
        validateString(fileName);
    }
    return this.request('ProcFormFileAdd', {
        FormID: formID,
        File: fileData,
        Name: fileName,
        Description: description || undefined,
        FolderID: +folderID || undefined,
        IsStaffOnly: !shared
    }, false);
};

API.prototype.editFormFile = async function (fileID, fileName, folderID, description, shared) {
    if (typeof fileID === 'object') {
        fileName = fileID.Name;
        folderID = fileID.FolderID;
        description = fileID.Description;
        shared = !fileID.IsStaffOnly;
        fileID = fileID.FileID;
    }
    if (this.validateParameters) {
        fileID = normalizeInteger(fileID);
        fileName = fileName ? validateString(fileName) : undefined;
        folderID = folderID ? normalizeInteger(folderID) : undefined;
    }
    return this.request('ProcFormFileEdit', {
        FileID: fileID,
        Name: fileName,
        Description: description,
        FolderID: folderID,
        IsStaffOnly: shared === undefined ? undefined : !shared
    });
};

const ERR_FIElD_NOT_FOUND = exports.ERR_FIElD_NOT_FOUND = 'RpmFieldNotFoundError';

const throwFieldNotFound = fieldName => {
    const error = new Error(`Unknown field: "${fieldName}"`);
    error.name = ERR_FIElD_NOT_FOUND;
    throw error;
};

function getField(fieldName, eager) {
    const result = this.Fields.find(({ Field, Name }) => (Field || Name) === fieldName);
    result || eager && throwFieldNotFound(fieldName);
    return result;
}

exports.getField = getField;

function getFieldByUid(uid, eager) {
    const result = this.Fields.find(({ Uid }) => Uid === uid);
    result || eager && throwFieldNotFound(uid);
    return result;
}
exports.getFieldByUid = getFieldByUid;

API.prototype.createForm = function (processOrId, fields, properties, fireWebEvent) {
    const type = typeof properties;
    if (fireWebEvent === undefined && type === 'boolean') {
        fireWebEvent = properties;
        properties = {};
    } else if (type !== 'object') {
        properties = {};
    }
    properties = { Form: Object.assign({}, properties) };
    properties[typeof processOrId === 'number' ? 'ProcessID' : 'Process'] = processOrId;
    if (fields) {
        properties.Form.Fields = Array.isArray(fields) ? fields :
            Object.keys(fields).map(key => ({ Field: key, Value: fields[key] }));
    } else {
        delete properties.Form.Fields;
    }
    if (fireWebEvent) {
        assert.strictEqual(typeof fireWebEvent, 'boolean');
        properties.WebhookEvaluate = true;
    }
    return this.request('ProcFormAdd', properties).then(form => this._extendForm(form));
};

const FORM_PROTO = exports.FORM_PROTO = Object.defineProperties({
    EntityType: ObjectType.Form,
    RefType: ObjectType.RestrictedReference,
    IDProperty: 'FormID'
}, {
    EntityID: { get() { return this.Form.FormID; } },
    RefName: { get() { return this.Form.Number; } },
    Archived: { get() { return this.Form.Archived; } },
});

const FORM_CORE_PROTO = {
    getField,
    getFieldByUid
};
Object.defineProperty(FORM_CORE_PROTO, 'url', {
    get: function () { return this.api.getFormUrl(this.FormID); }
});

function extendForm(form) {
    const { Form } = form;
    Object.defineProperty(Form, 'ProcessID', { value: form.ProcessID });
    Object.defineProperty(Form, 'Process', { value: form.Process });
    Object.setPrototypeOf(form, FORM_PROTO);
    Object.setPrototypeOf(Form, FORM_CORE_PROTO);
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
    }).then(form => this._extendForm(form));
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
            return true;
        });
        return response;
    });
};

API.prototype.getCustomerAccounts = function (nameOrID) {
    const req = {};
    req[typeof nameOrID === 'number' ? 'CustomerID' : 'Customer'] = nameOrID;
    return this.request('Accounts', req);
};


API.prototype.getSupplierAccounts = function (nameOrID) {
    const req = {};
    req[typeof nameOrID === 'number' ? 'SupplierID' : 'Supplier'] = nameOrID;
    return this.request('Accounts', req);
};

API.prototype.demandAccount = async function (account, supplier) {
    const req = {};
    if (typeof account === 'number') {
        req.AccountID = account;
    } else {
        req.Account = account;
        req[typeof supplier === 'number' ? 'SupplierID' : 'Supplier'] = supplier;
    }
    return this.request('Account', req);
};

API.prototype.getAccount = async function (account, supplier, demand) {
    try {
        return await this.demandAccount(account, supplier);
    } catch (e) {
        if (demand || e.Message !== errors.MSG_ACCOUNT_NOT_FOUND) {
            throw e;
        }
    }
};

API.prototype.getAccounts = function (modifiedAfter) {
    modifiedAfter = modifiedAfter ? normalizeDate(modifiedAfter) : new Date(0);
    return this.request('Accounts', { ModifiedAfter: modifiedAfter.toISOString() });
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
        return Object.values(result);
    });
};

API.prototype.createAccount = function (name, customer, supplier, data) {
    if (typeof name === 'object') {
        data = name;
        name = data.Name;
        customer = data.CustomerID || data.CustomerName;
        supplier = data.SupplierID || data.SupplierName;
    }
    data = Object.assign({}, data);
    data.Name = name;
    data[typeof customer === 'number' ? 'CustomerID' : 'CustomerName'] = customer;
    data[typeof supplier === 'number' ? 'SupplierID' : 'SupplierName'] = supplier;
    return this.request('AccountAdd', { Account: data });
};

API.prototype.editAccount = function (accountID, data) {
    if (typeof accountID === 'object') {
        data = accountID;
        accountID = data.AccountID;
    }
    data = Object.assign({}, data);
    if (this.validateParameters) {
        accountID = normalizeInteger(accountID);
        data.AccountID = accountID;
        data = { Account: data };
    }
    return this.request('AccountEdit', data);
};

function objectToId(nameOrID, property) {
    return typeof nameOrID === 'object' ? nameOrID[property] : nameOrID;
}

API.prototype.demandCustomer = async function (nameOrID, IncludeLocations) {
    let prop = typeof nameOrID;
    if (prop === 'number') {
        prop = 'CustomerID';
    } else {
        assert.strictEqual(prop, 'string');
        prop = 'Customer';
    }
    IncludeLocations === undefined || assert(typeof IncludeLocations, 'boolean');
    const request = { IncludeLocations };
    request[prop] = nameOrID;
    const result = await this.request('Customer', request);
    return this._normalizeCustomer(result);
};

API.prototype.getCustomer = async function (nameOrID, demand) {
    try {
        return await this.demandCustomer(nameOrID);
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
    const { Locations, Accounts } = customer;
    Accounts.forEach(ch => setParent(ch, customer))
    Locations && Locations.forEach(ch => setParent(ch, customer))
    return Object.setPrototypeOf(CUSTOMER_PROTO);
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
    const customer = Object.assign({}, data);
    if (typeof nameOrID === 'number') {
        customer.CustomerID = nameOrID;
    } else if (data.Name) {
        throw new Error('CustomerID has to be integer');
    } else {
        customer.Name = nameOrID;
    }
    return this.request('CustomerEdit', { Customer: customer }).then(result => this._normalizeCustomer(result));
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
    if (typeof contactID === 'object') {
        primary = data;
        data = contactID;
    } else {
        data = data || {};
        data.ContactID = contactID;
    }
    return this.request('CustomerContactEdit', {
        CustomerID: objectToId(customerID, 'CustomerID'),
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

API.prototype.getSuppliers =  function (includeArchived) {
    if (this.validateParameters) {
        includeArchived = !!includeArchived || undefined;
    }
    return this.request('Suppliers', { IncludeArchived: includeArchived });
};

API.prototype.getAgencies = function () {
    return this.request('Agencies');
};

const CUSTOMER_PROTO = Object.defineProperties({
    EntityType: ObjectType.Customer,
    RefType: ObjectType.Customer,
    IDProperty: 'CustomerID'
}, {
    EntityID: { get() { return this.CustomerID } },
    RefName: { get() { return this.Customer || this.Name } },
});

const AGENCY_PROTO = Object.defineProperties({
    EntityType: ObjectType.AgentCompany,
    RefType: ObjectType.AgentCompany,
    IDProperty: 'AgencyID'
}, {
    EntityID: { get() { return this.AgencyID } },
    RefName: { get() { return this.Agency } },
});

const STAFF_PROTO = Object.defineProperties({
    EntityType: ObjectType.Staff,
    RefType: ObjectType.Staff,
    IDProperty: 'StaffID'
}, {
    EntityID: { get() { return this.StaffID } },
    RefName: { get() { return this.Name } },
});

API.prototype.demandAgency = async function (nameOrID) {
    const request = {};
    request[(typeof nameOrID === 'number') ? 'AgencyID' : 'Agency'] = nameOrID;
    return this.request('Agency', request).then(a => this._normalizeAgency(a));
};

API.prototype.getAgency = async function (nameOrID, demand) {
    try {
        return await this.demandAgency(nameOrID);
    } catch (e) {
        if (demand || e.Message !== errors.MSG_AGENCY_NOT_FOUND) {
            throw e;
        }
    }
};

API.prototype._normalizeAgency = function (agency) {
    const { StaffAssignment, Reps } = agency;
    StaffAssignment && StaffAssignment.forEach(sa => sa.StaffID || (sa.Name = ''));
    Reps && Reps.forEach(rep => setParent(rep, agency));
    return Object.setPrototypeOf(agency, AGENCY_PROTO);
};

API.prototype.createAgency = function (data, fireWebEvent) {
    if (typeof data !== 'object') {
        data = { Agency: data };
    }
    return this.request('AgencyAdd', { Agency: data, WebhookEvaluate: !!fireWebEvent })
        .then(a => this._normalizeAgency(a));
};

API.prototype.editAgency = function (id, data, fireWebEvent) {
    const type = typeof id;
    if (type === 'object') {
        fireWebEvent = data;
        data = id;
    } else {
        data = Object.assign({}, data);
        assert.strictEqual(typeof data, 'object');
        if (type === 'number') {
            data.AgencyID = id;
        } else {
            assert.strictEqual(type, 'string');
            data.Agency = id;
        }
    }
    return this.request('AgencyEdit', { Agency: data, WebhookEvaluate: !!fireWebEvent })
        .then(a => this._normalizeAgency(a));
};

const REP_PROTO = Object.defineProperties({
    EntityType: ObjectType.AgentRep,
    RefType: ObjectType.AgentRep,
    IDProperty: 'RepID'
}, {
    EntityID: { get() { return this.RepID } },
    RefName: { get() { return this.Rep } },
});

API.prototype._normalizeRep = function (rep) {
    return Object.setPrototypeOf(rep, REP_PROTO);
};

API.prototype.demandRep = function (repNameOrID, agencyNameOrID) {
    const request = {};
    if (typeof repNameOrID === 'number') {
        request.RepID = repNameOrID;
    } else {
        request.Rep = repNameOrID;
        request[typeof agencyNameOrID === 'number' ? 'AgencyID' : 'Agency'] = agencyNameOrID;
    }
    return this.request('Rep', request).then(r => this._normalizeRep(r));
};

API.prototype.getRep = async function () {
    try {
        return await this.demandRep.apply(this, arguments);
    } catch (e) {
        if (e.Message !== errors.MSG_REP_NOT_FOUND) {
            throw e;
        }
    }
};

API.prototype.createRep = function (agencyID, data) {
    if (typeof agencyID === 'object') {
        data = agencyID;
        agencyID = data.AgencyID;
    }
    assert.strictEqual(typeof data, 'object');
    data = Object.assign({}, data);
    data.AgencyID = agencyID;
    return this.request('RepAdd', { Rep: data }).then(r => this._normalizeRep(r));
};

API.prototype.editRep = function (repID, data) {
    if (typeof repID === 'object') {
        data = repID;
        repID = data.RepID;
    }
    assert.strictEqual(typeof data, 'object');
    data = Object.assign({}, data);
    data.RepID = repID;
    return this.request('RepEdit', { Rep: data }).then(r => this._normalizeRep(r));
};

API.prototype.getRepByAssignment = function (supplierNameOrID, assignCode) {
    const request = {
        AssignmentCode: assignCode
    };
    request[typeof supplierNameOrID === 'number' ? 'SupplierID' : 'Supplier'] = supplierNameOrID;
    return this.request('Rep', request).then(r => this._normalizeRep(r));
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
    return this.request('ProcActions', { ProcessID: normalizeInteger(processID) });
};

API.prototype.getFormActions = function (formID) {
    return this.request('ProcActions', { FormID: normalizeInteger(formID) });
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
        request.Username = validateString(name);
    }
    if (typeof form === 'number') {
        request.Form.FormID = normalizeInteger(form);
    } else {
        request.Form.Number = validateString(form);
        if (typeof process === 'number') {
            request.ProcessID = process;
        } else {
            request.Process = validateString(process);
        }
    }
    return this.request('ProcFormParticipantAdd', request).then(form => this._extendForm(form));
};

API.prototype.getAccountGroups = function () {
    return this.request('AccountGroups');
};

API.prototype.editStaff = async function (staff, changes) {
    if (changes === undefined) {
        assert.strictEqual(typeof staff, 'object');
        changes = staff;
    } else {
        staff = staff && staff.StaffID || staff;
        assert.strictEqual(typeof staff, 'number');
        assert.strictEqual(typeof changes, 'object');
        changes.StaffID = staff;
    }
    return Object.setPrototypeOf(await this.request('StaffEdit', { Staff: changes.Staff || changes }), STAFF_PROTO);
};

API.prototype.editUserEnabled = function (user, enabled) {
    user = user.Username || user;
    return this.request('UserEnabledEdit', {
        Username: user,
        Enabled: !!enabled
    });
};

API.prototype.createStaff = async function (contact, role, enabled) {
    contact = contact || {};
    return Object.setPrototypeOf(await this.request('StaffAdd', {
        Staff: role === undefined && enabled === undefined ? (contact.Staff || contact) : {
            RoleID: role && (role.ID || normalizeInteger(role)),
            Contact: contact,
            Enabled: !!enabled
        }
    }), STAFF_PROTO);
};

const SUPPLIER_PROTO = Object.defineProperties({
    EntityType: ObjectType.Supplier,
    RefType: ObjectType.Supplier,
    IDProperty: 'SupplierID'
}, {
    EntityID: { get() { return this.SupplierID } },
    RefName: { get() { return this.Name || this.Supplier } },
});

API.prototype._normalizeSupplier = function (supplier) {
    return Object.setPrototypeOf(supplier, SUPPLIER_PROTO);
};

API.prototype.getSupplier = function (id) {
    if (this.validateParameters) {
        id = normalizeInteger(id);
    }
    return this.request('Supplier', { SupplierID: id }).then(s => this._normalizeSupplier(s));
};

API.prototype.createSupplier = function (data) {
    if (typeof data !== 'object') {
        data = { Supplier: data };
    }
    return this.request('SupplierAdd', { Supplier: data }).then(s => this._normalizeSupplier(s));
};

API.prototype.editSupplier = function (id, data) {
    if (typeof id === 'object') {
        data = id;
        id = data.SupplierID;
    }
    typeof data === 'object' ? Object.assign({}, data) : (data = { Supplier: data });
    data.SupplierID = id;
    return this.request('SupplierEdit', { Supplier: data }).then(s => this._normalizeSupplier(s));
};

API.prototype.createAccessValidator = async function (inConfig) {
    const config = {
        users: [],
        roles: []
    };
    if (inConfig.users) {
        config.users = toArray(inConfig.users).toSet();
    }
    if (inConfig.roles) {
        const roles = toArray(inConfig.roles).toSet();
        if (roles.length > 0) {
            let rpmRoles = await this.getRoles();
            rpmRoles = rpmRoles.Roles;
            for (let roleName of roles) {
                const role = rpmRoles.find(r => r.Name === roleName);
                role ? config.roles.push(role.ID) : debug('Role not found: ' + roleName);
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

API.prototype.addNoteByFormID = function (formID, note, noteForStaff, user) {
    if (this.validateParameters) {
        formID = normalizeInteger(formID);
    }
    return this.request('ProcFormNoteAdd', {
        Form: {
            FormID: formID,
            NoteBy: user || undefined,
            NoteForStaff: noteForStaff,
            Note: note
        }
    }).then(form => this._extendForm(form));
};

API.prototype.addNoteByFormNumber = function (processNameOrID, formNumber, note, noteForStaff, user) {
    const body = {
        Form: {
            Number: validateString(formNumber),
            NoteBy: user || undefined,
            NoteForStaff: noteForStaff,
            Note: note
        }
    };
    if (typeof processNameOrID === 'number') {
        body.ProcessID = normalizeInteger(processNameOrID);
    } else {
        body.Process = validateString(processNameOrID);
    }
    return this.request('ProcFormNoteAdd', body).then(form => this._extendForm(form));
};

API.prototype.getTableFillsList = function () {
    return this.request('ProcTableFillsList');
};

API.prototype.getProcessFlows = function () {
    return this.request('ProcFlows');
};

API.prototype.evaluateForm = function (formID) {
    if (this.validateParameters) {
        formID = normalizeInteger(formID);
    }
    return this.request('ProcFormEvaluate', { FormID: formID });
};

const URI_PREFIX_PNG = getDataURLPrefix('image/png');

API.prototype.addSignature = function (objectTypeID, objectID, signature, name, company, date, alternateID) {
    let body = typeof objectTypeID === 'object' ? objectTypeID : {
        ObjectTypeID: objectTypeID,
        ObjectID: objectID,
        AlternateID: alternateID,
        File: signature,
        Name: name,
        Company: company,
        Date: date
    };
    if (this.validateParameters) {
        body.ObjectTypeID = normalizeInteger(body.ObjectTypeID);
        body.ObjectID = normalizeInteger(body.ObjectID);
        validateString(body.Name);
        body.AlternateID === undefined || validateString(body.AlternateID);
        body.Company === undefined || validateString(body.Company);
        if (Buffer.isBuffer(body.File)) {
            body.File = body.File.toString('base64');
        }
        validateString(body.File);
        if (!body.File.toLowerCase().startsWith(URI_PREFIX_PNG)) {
            body.File = URI_PREFIX_PNG + body.File;
        }
        if (body.Date !== undefined) {
            const d = toMoment(body.Date);
            assert(d.isValid());
            body.Date = d.format(ISO_DATE_TIME_FORMAT);
        }
    }
    return this.request('SignatureAdd', body);
};


API.prototype.addFormSignature = function (formID, signature, name, company, date, alternateID) {
    return this.addSignature(ObjectType.Form, formID, signature, name, company, date, alternateID);
};

API.prototype.getFormSignatures = function (formID) {
    return this.request('ProcFormSignatures', { FormID: this.validateParameters ? normalizeInteger(formID) : formID });
};

API.prototype.getCommAgencies = function (run) {
    if (this.validateParameters) {
        run = run ? validateString(run) : 'all';
    }
    return this.request('CommAgencies', { Run: run });
};

API.prototype.getEntities = function (type, normalize) {
    return getEager(ENTITY_GETTERS, type).getEntities.call(this, toBoolean(normalize));
};

API.prototype.demandEntity = function (type, id) {
    return getEager(ENTITY_GETTERS, type).demand.call(this, id);
};

API.prototype.getEntity = async function () {
    try {
        return await this.demandEntity.apply(this, arguments);
    } catch {
        //
    }
};

API.prototype.getActionsDue = function () {
    return this.request('ProcActionsDue');
};

API.prototype.shareFormLayout = function (FormID, LayoutID) {
    if (this.validateParameters) {
        FormID = normalizeInteger(FormID);
        LayoutID = LayoutID ? normalizeInteger(LayoutID) : undefined;
    }
    return this.request('ProcFormLayoutShare', { FormID, LayoutID });
};

exports.RpmApi = API;

exports.FIELD_FORMAT = FieldFormat;
exports.DATA_TYPE = FieldSubType;
exports.OBJECT_TYPE = ObjectType;
exports.REF_DATA_TYPE = RefSubType;
exports.SHARED_FIELD_SUBTYPES = ObjectType;

var FIELD_TYPE = exports.FIELD_TYPE = (() => {
    var fieldTypes = {};
    var name;
    for (name in ObjectType) {
        fieldTypes[name] = { value: ObjectType[name], subTypes: {} };
    }

    var subTypes = fieldTypes.CustomField.subTypes;
    for (name in FieldSubType) {
        subTypes[name] = { value: FieldSubType[name] };
    }
    subTypes = fieldTypes.FormReference.subTypes;
    for (name in RefSubType) {
        subTypes[name] = { value: RefSubType[name] };
    }

    subTypes = fieldTypes.SharedField.subTypes;
    for (name in ObjectType) {
        subTypes[name] = { value: ObjectType[name] };
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

function isFieldType() {
    try {
        validateFieldType.apply(undefined, arguments);
        return true;
    } catch (error) {
        return false;
    }
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

function isCustomerReference(field) {
    return isFieldType(field, 'FormReference', 'Customer');
}


exports.validateFieldType = validateFieldType;
exports.validateProcessReference = validateProcessReference;
exports.isProcessReference = isProcessReference;
exports.isFieldType = isFieldType;
exports.isCustomerReference = isCustomerReference;

exports.isListField = function (field) {
    var customField = FIELD_TYPE.CustomField;
    return field.FieldType === customField.value && (field.SubType == customField.subTypes.List.value || field.SubType == customField.subTypes.ListMultiSelect.value);
};

function isTableField(field, definedRows) {
    if (field.FieldType !== ObjectType.CustomField) {
        return false;
    }
    const st = field.SubType;
    return definedRows === undefined ?
        (st === FieldSubType.FieldTable || st === FieldSubType.FieldTableDefinedRow) :
        (st === (definedRows ? FieldSubType.FieldTableDefinedRow : FieldSubType.FieldTable));
}

exports.isTableField = isTableField;

const STAFF_FILTERS = {};
['Role', 'StaffGroup', 'Enabled'].forEach(prop => STAFF_FILTERS[prop] = getEager(ObjectType, prop));
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
    return field.Rows.demand(row => row.IsDefinition);
};

exports.toSimpleField = function (field) {
    let v = field.Values;
    if (!Array.isArray(v)) {
        return field;
    }
    assert(v.length < 2);
    v = v[0];
    if (v) {
        field = Object.assign({}, field, v);
        delete field.Values;
    }
    return field;
};

exports.getFieldEssentials = ({ Name, Uid, ProcessID, Rows, UserCanEdit, FieldType, SubType, Options }) =>
    ({ Name, Uid, ProcessID, Rows, UserCanEdit, FieldType, SubType, Options });
