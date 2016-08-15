/* global Promise */
require('string').extendPrototype();
var util = require('util');
var RESTClient = require('node-rest-client').Client;
var rpmUtil = require('./util');
var logger = rpmUtil.logger;
var norm = require('./normalizers');

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
    this._restClient = new RESTClient();
    this.parallelRunner = rpmUtil.createParallelRunner();
    this.modifiedTTL = 0;
}

API.prototype.getUrl = function (endPoint) {
    return this.url + endPoint;
};

API.prototype.request = function (endPoint, data) {
    var args = { headers: this.getHeaders(), data: data };
    var url = this.getUrl(endPoint);
    var self = this;
    return new Promise(function (resolve, reject) {
        logger.debug(`POST ${url} ${data ? '\n' + JSON.stringify(data) : ''}`);
        var requestTime = new Date();
        function callback(data) {
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
        self._restClient.post(url, args, callback);
    });
};

API.prototype.getUser = function (userName, password) {
    return this.request('User', {
        Username: userName,
        Password: password
    });
};

API.prototype.getStaffList = function () {
    return this.request('StaffList').then(function (result) {
        return result.StaffList;
    });
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


API.prototype.createFormAction = function (description, formOrID, due, userID) {
    if (typeof formOrID === 'object') {
        formOrID = formOrID.Form || formOrID;
        if (typeof userID === 'undefined') {
            userID = formOrID.Participants.find(function (participant) {
                return participant.Name === formOrID.Owner;
            });
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
    proc.getView = getView;
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
    var p = api.getModifiedAspects();
    p = p.then(function (modifiedAspects) {
        if (!cache._processes || modifiedAspects.contains('ProcList')) {
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
    return this.request('Info').then(function (info) {
        Object.assign(info, INFO_PROTO);
        return info;
    });
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

var ERROR_RESPONSE_FORM_NOT_FOUND = 'Form not found';

API.prototype.createFormInfoCache = function () {
    var api = this;
    var cache = {};
    return function (formID, demand) {
        var result = cache[formID];
        if (result) {
            return Promise.resolve(result);
        }
        var p = api.getForm(formID);
        p = p.then(
            function (form) {
                return form && api.getFormList(form.ProcessID, true);
            },
            function (error) {
                if (error.Message !== ERROR_RESPONSE_FORM_NOT_FOUND) {
                    throw error;
                }
            });
        p = p.then(function (result) {
            if (result) {
                result.Forms.forEach(function (form) {
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
        return p;
    };
};


var PROCESS_FIELD_PROTO = {
    getValue: function (formField) {
        return FIELD_ACCESSORS[this.FieldType][this.SubType].getValue(formField, this);
    }
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

var ERR_VIEW_NOT_FOUND = 'View not found: %s';

function getView(nameOrId, demand) {
    var proc = this;
    var property = typeof nameOrId === 'number' ? 'ID' : 'Name';
    return proc.getViews().then(function (views) {
        var result = views.find(function (view) {
            return view[property] === nameOrId;
        });
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
    var p = proc._api.getLastModifications();
    p = p.then(function (modifications) {
        changed = modifications.ProcFields;
        if (!changed || !cache._fields || changed !== cache._fieldsChanged) {
            return proc.getFields();
        }
    });
    p = p.then(function (fields) {
        if (fields) {
            cache._fields = fields;
            cache._fieldsChanged = changed;
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
}

function getFormList(includeArchived, viewId) {
    var proc = this;
    var request = { ProcessID: proc.ProcessID, IncludeArchived: Boolean(includeArchived) };
    if (typeof viewId === 'number') {
        request.ViewID = viewId;
    }
    return proc._api.request('ProcFormList', request).then(function (response) {
        return response.Forms;
    });

}

API.prototype.getFields = function (processId) {
    return this.request('ProcFields', new BaseProcessData(processId)).then(function (response) {
        response.Process.Fields.forEach(function (field) {
            Object.assign(field, PROCESS_FIELD_PROTO);
        });
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


API.prototype.demandForm = function (processOrFormId, formNumber) {
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

API.prototype.getForm = function () {
    return this.demandForm.apply(this, arguments).then(
        function (form) {
            return form;
        },
        function (error) {
            if (error.Message != 'Form not found') {
                throw error;
            }
        }
    );
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
    }
}

function addForm(fields, status) {
    return this._api.addForm(this.ProcessID, fields, status);
}

API.prototype.addForm = function (processId, fields, status) {
    var api = this;
    var request = new BaseProcessData(processId);
    request.Form = {
        Fields: Array.isArray(fields) ? fields :
            Object.keys(fields).map(function (key) {
                return { Field: key, Value: fields[key] };
            })
    };
    return api.request('ProcFormAdd', request).then(function (form) {
        return status ? api.editForm(form.Form.FormID, [], { Status: status }) : form;
    });
};

API.prototype.getHeaders = function () {
    return { RpmApiKey: this.key };
};

API.prototype.getLastModifications = function () {
    var api = this;
    return api._cachedModified ? Promise.resolve(api._cachedModified) : api.request('Modified').then(function (response) {
        var result = {};
        response.Modified.forEach(function (modified) {
            result[modified.Type] = modified.Age;
        });
        api._cachedModified = result;
        setTimeout(function () {
            api._cachedModified = undefined;
        }, api.modifiedTTL > 0 ? api.modifiedTTL * 1000 : 0);
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


API.prototype.getCustomers = function () {
    var api = this;
    var cache = rpmUtil.getCache(api);
    var p = cache._customers ? api.getModifiedAspects() : Promise.resolve();
    p = p.then(function (modifiedAspects) {
        if (!modifiedAspects || modifiedAspects.contains('CustomerAndAliasList')) {
            return api.request('Customers');
        }
    });
    p = p.then(function (response) {
        if (response) {
            var duplicates = {};
            response.Customers = response.Customers.filter(function (customer) {
                if (duplicates[customer.CustomerID]) {
                    return false;
                }
                duplicates[customer.CustomerID] = true;
                customer.CustomerID = +customer.CustomerID;
                tweakDates(customer);
                return true;
            });
            cache._customers = response;
        }
        return cache._customers;
    });
    return p;
};

function tweakDates(object) {
    object.Added = object.Added && rpmUtil.normalizeDate(object.Added);
    object.Modified = object.Modified ? rpmUtil.normalizeDate(object.Modified) : object.Added;
    return object;
}

API.prototype.getCustomerAccounts = function (nameOrID) {
    var req = {};
    req[typeof nameOrID === 'number' ? 'CustomerID' : 'Customer'] = nameOrID;
    return this.request('Accounts', req).then(function (response) {
        response.Accounts.forEach(tweakDates);
        return response;
    });
};

API.prototype.getSupplierAccounts = function (nameOrID) {
    var req = {};
    req[typeof nameOrID === 'number' ? 'SupplierID' : 'Supplier'] = nameOrID;
    return this.request('Accounts', req).then(function (response) {
        response.Accounts.forEach(tweakDates);
        return response;
    });
};

API.prototype.getAccount = function (nameOrID) {
    var req = {};
    req[typeof nameOrID === 'number' ? 'AccountID' : 'Account'] = nameOrID;
    return this.request('Account', req).then(tweakDates);
};

API.prototype.getAccounts = function () {
    var api = this;
    return Promise.all([api.getCustomers(), api.getSuppliers()]).then(function (responses) {
        var customers = responses[0].Customers;
        var suppliers = responses[1].Suppliers;

        var parentObjects, f, idProperty;
        if (customers.length > suppliers.length) {
            parentObjects = suppliers;
            f = api.getSupplierAccounts;
            idProperty = 'SupplierID';
        } else {
            parentObjects = customers;
            f = api.getCustomerAccounts;
            idProperty = 'CustomerID';
        }
        f = f.bind(api);
        var result = [];
        var promises = [];
        parentObjects.forEach(function (parent) {
            promises.push(api.parallelRunner(function () {
                return f(+parent[idProperty]);
            }).then(function (accounts) {
                accounts.Accounts.forEach(function (account) {
                    tweakDates(account);
                    result.push(account);
                });
            }));
        });
        return Promise.all(promises).then(function () {
            return { Accounts: result };
        });
    });
};

API.prototype.getCustomer = function (nameOrID) {
    var api = this;
    var request = {};
    request[(typeof nameOrID === 'number') ? 'CustomerID' : 'Customer'] = nameOrID;
    return api.request('Customer', request).then(tweakDates);
};

API.prototype.getSuppliers = function () {
    return this.request('Suppliers').then(function (result) {
        var modified = new Date(result.Age * 1000);
        result.Suppliers.forEach(function (supplier) {
            supplier.Modified = modified;
        });
        return result;
    });
};


API.prototype.getAgencies = function () {
    return this.request('Agencies').then(function (response) {
        response.Agencies.forEach(tweakDates);
        return response;
    });
};


function extractContact(object) {
    if (typeof object.Contact !== 'object') {
        var contact = object.Contact = {};
        ["ContactID", "Email", "FirstName", "LastName", "PhoneNumbers", "Salutation", "Title"].forEach(function (property) {
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


var FIELD_TYPE = exports.FIELD_TYPE = (function () {
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

exports.parseTimezoneOffset = parseTimezoneOffset;


var assert = require('assert');

var FIELD_ACCESSORS = exports.FIELD_ACCESSORS = {};

(function () {

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
    ['Date', 'DateTime'].forEach(function (name) {
        st[subTypes[name].value] = { getValue: f };
    });

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
        .forEach(function (name) {
            st[subTypes[name].value] = { getValue: f };
        });


    st[subTypes.List.value] = {
        getValue: function (formField, processField) {
            if (!processField) {
                return formField.Value;
            }
            assert.equal(formField.Uid, processField.Uid);
            return formField.Value ? processField.Options.find(function (option) {
                return option.Text == formField.Value;
            }).ID : null;
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
            result = result.filter(function (value) {
                return value;
            }).map(function (value) {
                return processField.Options.find(function (option) {
                    return option.Text == value;
                }).ID;
            });
            return result;
        }
    };

    var DEPRICATED_TABLE_COL_DELIMITER = '%%';
    var DEPRICATED_TABLE_ROW_DELIMITER = '||';

    st[subTypes.DeprecatedTable.value] = {
        getValue: function (formField, processField) {
            assert.equal(formField.Uid, processField.Uid);
            var result = [];
            formField.Value.split(DEPRICATED_TABLE_ROW_DELIMITER).forEach(function (row) {
                var normalizedRow = {};
                row.split(DEPRICATED_TABLE_COL_DELIMITER).forEach(function (value, idx) {
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
        .forEach(function (name) {
            st[subTypes[name].value] = { getValue: f };
        });
})();


Object.seal(DATA_TYPE);
Object.seal(OBJECT_TYPE);
Object.seal(REF_DATA_TYPE);

exports.isListField = function (field) {
    var customField = FIELD_TYPE.CustomField;
    return field.FieldType === customField.value && (field.SubType == customField.subTypes.List.value || field.SubType == customField.subTypes.ListMultiSelect.value);
};
