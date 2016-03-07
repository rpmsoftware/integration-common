/* global Promise */
'use strict';
require('string').extendPrototype();
var util = require('util');
var RESTClient = require('node-rest-client').Client;
var urlLib = require('url');
var rpmUtil = require('./util');

function API(url, key, name) {
    if (!arguments) {
        return;
    }
    if (typeof url === 'object') {
        key = url.key;
        name = url.name;
        url = url.url;
    }
    url = url.toLowerCase().ensureRight('/');
    this.url = url.ensureRight('Api2.svc/');
    this.key = key;
    this.name = name;
    this._requestClient = new RESTClient();
}

API.prototype.getUrl = function (endPoint) {
    return this.url + endPoint;
};

API.prototype.request = function (endPoint, data) {
    var args = { headers: this.getHeaders(), data: data };
    var url = this.getUrl(endPoint);
    var self = this;
    return new Promise(function (resolve, reject) {
        console.log('\nPOST ' + url);
        if (data) {
            console.log(JSON.stringify(data));
        }
        var requestTime = new Date();
        function callback(data, response) {
            var responseTime = new Date();
            var doneData;
            var isError = false;
            if (data.Result) {
                isError = data.Result.Error;
                doneData = isError ? data.Result.Error : (data.Result || data);
            } else {
                isError = true;
                doneData = data;
            }
            doneData.requestTime = requestTime;
            doneData.responseTime = responseTime;
            (isError ? reject : resolve)(doneData);
        }
        self._requestClient.post(url, args, callback);
    });
};

API.prototype.getStaffList = function () {
    return this.request('StaffList').then(function (result) {
        return result.StaffList;
    });
};

var TIMEZONE_OFFSET_PATTERN = /^\s*([+-]?\d\d):(\d\d)\s*$/;

API.prototype.getTimeZoneOffset = function () {
    return this.getInfo().then(function (info) {
        var parts = TIMEZONE_OFFSET_PATTERN.exec(info.TimeOffset);
        return (+parts[1]) * 60 + (+parts[2]);
    });
};

API.prototype.getViews = function (viewCategory, templateID) {
    var p = this.request('ProcViews', {
        'ViewCategory': +viewCategory,
        'ObjectSpecificID': +templateID
    });
    p = p.then(function (result) {
        return result.Views;
    });
    return p;
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


API.prototype.createFormAction = function (description, form, due, userID) {
    if (typeof form === 'object') {
        form = form.Form || form;
        if (typeof userID === 'undefined') {
            userID = form.Participants.find(function (participant) {
                return participant.Name === form.Owner;
            });
            userID = userID && userID.UserID;
        }
        form = form.FormID;
    }
    var data = {
        Action: {
            Description: description,
            Form: {
                FormID: rpmUtil.normalizeInteger(form)
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


API.prototype.getProcesses = function (includeDisabled) {
    var self = this;
    return self.request('Procs').then(function (response) {
        return response.Procs.filter(function (proc) {
            self._extendProcess(proc);
            return (includeDisabled || proc.Enabled);
        });
    });
};

API.prototype._extendProcess = function (proc) {
    proc._api = this;
    proc.getFields = getFields;
    proc.getForms = getForms;
    proc.addForm = addForm;
    proc.getFormList = getFormList;
    proc.getCachedFields = getCachedFields;
    proc.getAllForms = getAllForms;
    proc.getViews = getViews;
};

var ERR_PROCESS_NOT_FOUND = 'Process not found: %s';

function getProcessSearchKey(nameOrID) {
    return typeof nameOrID === 'number' ? 'ProcessID' : 'Process';
}

API.prototype.getProcess = function (nameOrID, demand) {
    return this.getCachedProcesses().then(function (procs) {
        var key = getProcessSearchKey(nameOrID);
        var result = procs.find(function (proc) {
            return proc[key] == nameOrID;
        });
        if (demand && !result) {
            throw Error(util.format(ERR_PROCESS_NOT_FOUND, nameOrID));
        }
        return result;
    });
};

API.prototype.getActiveProcess = function (nameOrID, demand) {
    return this.getProcess(nameOrID).then(function (result) {
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
    var p = cache._processes ? api.getModifiedAspects() : Promise.resolve();
    p = p.then(function (modifiedAspects) {
        if (!modifiedAspects || modifiedAspects.contains('ProcList')) {
            return api.getProcesses(true);
        }
    });
    p = p.then(function (processes) {
        if (processes) {
            cache._processes = processes;
        }
        return cache._processes;
    });
    return p;
};


API.prototype.getInfo = function () {
    return this.request('Info');
};

API.prototype.editForm = function (formId, fields, properties) {
    properties = properties || {};
    properties.FormID = formId;
    properties.Fields = Array.isArray(fields) ? fields :
        Object.keys(fields).map(function (key) {
            return { Field: key, Value: fields[key] };
        });
    return this.request('ProcFormEdit', { Form: properties });
};

API.prototype.setFormArchived = function (archived, formId) {
    return this.request(archived ? 'ProcFormArchive' : 'ProcFormUnarchive', { FormID: formId });
};

API.prototype.trashForm = function (formId) {
    return this.request('ProcFormTrash', { FormID: formId });
};

function getFields(asObject) {
    var proc = this;
    return proc._api.getFields(proc.ProcessID).then(function (response) {
        if (asObject) {
            response.Fields = response.Fields.toObject('Name');
        }
        response.process = proc;
        return response;
    });
}

function getViews() {
    var proc = this;
    return proc._api.getViews(VIEW_CATEGORY.FormsPerTemplate, proc.ProcessID);
}

function getCachedFields() {
    var proc = this;
    var cache = rpmUtil.getCache(proc);
    var p = cache._fields ? proc._api.getModifiedAspects() : Promise.resolve();
    p = p.then(function (modifiedAspects) {
        if (!modifiedAspects || modifiedAspects.contains('ProcFields')) {
            return proc.getFields();
        }
    });
    p = p.then(function (fields) {
        if (fields) {
            cache._fields = fields;
        }
        return cache._fields;
    });
    return p;
}

function getAllForms(includeArchived) {
    var process = this;
    return process.getFormList(includeArchived).then(function (forms) {
        var p = Promise.resolve();
        var data = [];
        function addForm(form) {
            data.push(form);
        }
        forms.forEach(function (form) {
            p = p.then(function () {
                return process._api.getForm(form.ID);
            });
            p = p.then(addForm);
        });
        p = p.then(function () {
            return data;
        });
        return p;
    });
}


function getForms(viewId) {
    return this._api.getForms(this.ProcessID, viewId);
};

function getFormList(includeArchived, viewId) {
    var proc = this;
    var request = { ProcessID: proc.ProcessID, IncludeArchived: Boolean(includeArchived) };
    if (typeof viewId === 'number') {
        request.ViewID = viewId;
    }
    return proc._api.request('ProcFormList', request).then(function (response) {
        return response.Forms;
    });

};

API.prototype.getFields = function (processId) {
    return this.request('ProcFields', new BaseProcessData(processId)).then(function (response) {
        return response.Process;
    });
};

API.prototype.getForms = function (processOrId, viewId) {
    var baseRequest = new BaseProcessData(processOrId);
    if (viewId) {
        baseRequest.ViewID = viewId;
    }
    var self = this;
    return new Promise(function (resolve, reject) {
        self.request('ProcForms', baseRequest).then(
            function (response) {
                resolve(response);
            }, function (response) {
                if (response.Message === 'No forms') {
                    response = new BaseProcessData(processOrId);
                    response.Columns = [];
                    response.Forms = [];
                    resolve(response);
                } else {
                    reject(response);
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


API.prototype.getForm = function (processOrFormId, formNumber) {
    var api = this;
    var request;
    if (arguments.length > 1) {
        request = new BaseProcessData(processOrFormId);
        request.FormNumber = formNumber;
    } else {
        request = { FormID: processOrFormId };
    }
    return api.request('ProcForm', request).then(function (response) {
        response.Form.getFieldsAsObject = getFormFieldsAsObject;
        response.Form.getFieldValue = getFormFieldValue;
        response.Form.getField = getFormField;
        response.Form.getFieldByUid = getFormFieldByUid;
        return response;
    });
};

function getFormFieldsAsObject() {
    var form = this;
    var obj = {};
    form.Fields.forEach(function (pair) {
        obj[pair.Field] = pair.Value;
    });
    return obj;
}

function getFormFieldValue(fieldName, eager) {
    var field = this.getField(fieldName, eager);
    return field && field.Value;
}

function getFormField(fieldName, eager) {
    var result = this.Fields.find(function (field) {
        return field.Field === fieldName;
    });
    if (!result && eager) {
        throw new Error('Unknown form field:' + fieldName);
    }
    return result;
}

function getFormFieldByUid(uid, eager) {
    var result = this.Fields.find(function (field) {
        return field.Uid === uid;
    });
    if (!result && eager) {
        throw new Error('Unknown form field. Uid:' + uid);
    }
    return result;
}

function BaseProcessData(processOrId) {
    if (typeof processOrId === 'number') {
        this.ProcessID = processOrId;
    } else {
        this.Process = processOrId + '';
    };
}

function addForm(data) {
    return this._api.addForm(this.ProcessID, data);
};

API.prototype.addForm = function (processId, data) {
    var request = new BaseProcessData(processId);
    request.Form = {
        Fields: Array.isArray(data) ? data :
            Object.keys(data).map(function (key) {
                return { Field: key, Value: data[key] };
            })
    };
    return this.request('ProcFormAdd', request);
};

API.prototype.getHeaders = function () {
    return { RpmApiKey: this.key };
};

API.prototype.getLastModifications = function () {
    return this.request('Modified').then(function (response) {
        var result = {};
        response.Modified.forEach(function (modified) {
            result[modified.Type] = modified.Age;
        });
        return result;
    });
};

API.prototype.getModifiedAspects = function () {
    var self = this;
    return self.getLastModifications().then(function (response) {
        var result = [];
        if (self._lastKnownModified) {
            for (var key in self._lastKnownModified) {
                var value = self._lastKnownModified[key];
                if (response[key] > value) {
                    result.push(key);
                }
            }
        }
        self._lastKnownModified = response;
        return result;
    });
};

API.prototype.getCustomers = function (asObject) {
    return this.request('Customers').then(function (response) {
        if (asObject) {
            response.Customers = response.Customers.toAbject('CustomerID');
        }
        return response;
    });
};

API.prototype.getCustomer = function (nameOrID) {
    var api = this;
    var request = {};
    request[(typeof nameOrID === 'number') ? 'CustomerID' : 'Customer'] = nameOrID;
    return api.request('Customer', request);
};

API.prototype.getSuppliers = function (asObject) {
    return this.request('Suppliers').then(function (response) {
        if (asObject) {
            response.Suppliers = response.Suppliers.toObject('SupplierID');
        }
        return response;
    });
};

API.prototype.getAgencies = function (asObject) {
    return this.request('Agencies').then(function (response) {
        if (asObject) {
            response.Agencies = response.Agencies.toObject('AgencyID');
        }
        return response;
    });
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

exports.DataCache = DataCache;

exports.DATA_TYPE = {
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

exports.OBJECT_TYPE = {
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

exports.REF_DATA_TYPE = {
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

exports.getTableRowValues = function (row) {
    var values = {};
    row.Fields.forEach(function (field) {
        var value = field.Values[0];
        if (value) {
            values[field.Uid] = value.Value;
        }
    });
    return values;
};
