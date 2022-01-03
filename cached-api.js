const Cache = require('./cache');
const { RpmApi } = require('./api-wrappers');
const { ObjectType } = require('./api-enums');
const { toBoolean, normalizeInteger } = require('./util');

async function getProcess(nameOrID, demand) {
    return (await this._getProcesses()).getProcess(nameOrID, demand);
}

async function getActiveProcess(nameOrID, demand) {
    return (await this._getProcesses()).getActiveProcess(nameOrID, demand);
}

module.exports = function (api) {

    let { clearOnUpdate } = api;
    clearOnUpdate = toBoolean(clearOnUpdate);

    if (!(api instanceof RpmApi)) {
        api = new RpmApi(api);
    }

    const cache = new Cache();

    cache.clearFormRelated = function (result, clearDemand) {
        const form = result.Form;
        let getter = 'demandForm';
        if (clearDemand) {
            this.clear(getter, form.FormID);
            form.AlternateID && this.clear(getter, form.AlternateID);
            this.clear(getter, [result.ProcessID, form.Number]);
            this.clear(getter, [result.Process, form.Number]);
        } else {
            this.put(getter, form.FormID, result);
            form.AlternateID && this.put(getter, form.AlternateID, result);
            this.put(getter, [result.ProcessID, form.Number], result);
            this.put(getter, [result.Process, form.Number], result);
        }
        getter = 'getForms';
        this.clear(getter, result.ProcessID);
        this.clear(getter, result.Process);
        getter = 'getFormList';
        this.clear(getter, result.ProcessID);
        this.clear(getter, result.Process);
        return result;
    };


    api._getFileCached = api.getFile;

    api.getFile = async function (fileID, returnUrl) {
        return api._getFileCached(fileID, toBoolean(returnUrl));
    }


    api.getProcess = getProcess;
    api.getActiveProcess = getActiveProcess;


    Object.defineProperty(api, 'cache', { value: cache });
    [
        '_getProcesses',
        'getForms',
        'getFormList',
        'getViews',
        'getProcessViews',
        'getFields',
        'getBasicFields',
        'getInfo',
        'getProcessActions',
        'getAgentUsers',
        'getCustomerUsers',
        'getStaffList',
        'getAgencies',
        'getSuppliers',
        'getSupplier',
        'getCustomers',
        'getAccounts',
        'getCustomerAccounts',
        'getSupplierAccounts',
        'getRoles',
        'getStaffGroups',
        'getStaff',
        'getUser',
        'getProcessSecurity',
        'getActionTypes',
        'demandForm',
        'demandCustomer',
        'demandAgency',
        'demandAccount',
        'getRep',
        'getRepByAssignment',
        'getAccountGroups',
        '_getFileCached',
        'getTableFillsList',
        'getCommAgencies'
    ].forEach(prop => api[prop] = cache.cachify(api[prop], prop));

    ['createAccount', 'editAccount'].forEach(prop => {
        const original = api[prop];
        api[prop] = async function () {
            const result = await original.apply(this, arguments);
            if (clearOnUpdate) {
                cache.clear('demandAccount', [result.Account, result.SupplierID]);
                cache.clear('demandAccount', [result.Account, result.Supplier]);
                cache.clear('demandAccount', [result.AccountID]);
            } else {
                cache.put('demandAccount', [result.Account, result.SupplierID], result);
                cache.put('demandAccount', [result.Account, result.Supplier], result);
                cache.put('demandAccount', [result.AccountID], result);
            }
            cache.clear('getAccounts');
            cache.clear('searchCustomers');
            cache.clear('getCustomerAccounts', result.Customer);
            cache.clear('getCustomerAccounts', result.CustomerID);
            cache.clear('getSupplierAccounts', result.Supplier);
            cache.clear('getSupplierAccounts', result.SupplierID);
            return result;
        };
    });

    ['editForm', 'addFormParticipant', 'addNoteByFormID', 'addNoteByFormNumber'].forEach(prop => {
        const original = api[prop];
        api[prop] = async function () {
            const result = await original.apply(this, arguments);
            cache.clearFormRelated(result, clearOnUpdate);
            return result;
        };
    });

    const createForm = api.createForm;
    api.createForm = async function () {
        const result = await createForm.apply(this, arguments);
        cache.clearFormRelated(result, clearOnUpdate);
        cache.clear('_getProcesses');
        return result;
    };

    const editFormAction = api.editFormAction;
    api.editFormAction = async function () {
        const result = await editFormAction.apply(this, arguments);
        const form = result.Action.Form;
        cache.clear('getForms', form.ProcessID);
        cache.clear('getFormList', form.ProcessID);
        cleanAfterFormID(form.FormID);
        return result;
    };

    const addFormFile = api.addFormFile;
    api.addFormFile = async function () {
        const result = await addFormFile.apply(this, arguments);
        cleanAfterFormID(result.FileAttachment.FormID);
        return result;
    };

    const editFormFile = api.editFormFile;
    api.editFormFile = async function () {
        const result = await editFormFile.apply(this, arguments);
        cleanAfterFormID(result.FileAttachment.FormID);
        cache.clear('_getFileCached', result.FileAttachment.FileID);
        return result;
    };

    const cleanAfterFormID = id => {
        let getter = 'demandForm';
        const cached = cache.clear(getter, id)[0];
        if (cached) {
            cache.clearFormRelated(cached, true);
        } else {
            cache.clear('getForms');
            cache.clear('getFormList');
        }
        cache.clear('_getProcesses');
    };

    ['trashForm', '_archiveForm', '_unarchiveForm', 'evaluateForm'].forEach(prop => {
        const original = api[prop];
        api[prop] = async function () {
            const result = await original.apply(this, arguments);
            cleanAfterFormID(arguments[0]);
            return result;
        };
    });

    const original = api.addSignature;
    api.addSignature = async function () {
        const result = await original.apply(this, arguments);
        +arguments[0] === ObjectType.Form && cleanAfterFormID(arguments[1]);
        return result;
    };

    ['createAgency', 'editAgency'].forEach(prop => {
        const original = api[prop];
        api[prop] = async function () {
            const result = await original.apply(this, arguments);
            let getter = 'demandAgency';
            if (clearOnUpdate) {
                cache.clear(getter, result.AgencyID);
                cache.clear(getter, result.Agency);
            } else {
                cache.put(getter, result.AgencyID, result);
                cache.put(getter, result.Agency, result);
            }
            cache.clear('getAgencies');
            return result;
        };
    });

    [
        'addCustomerLocation',
        'editCustomerLocation',
        'addCustomerContact',
        'editCustomerContact'
    ].forEach(prop => {
        const original = api[prop];
        api[prop] = async function (customerID) {
            const result = await original.apply(this, arguments);
            let getter = 'demandCustomer';
            customerID = normalizeInteger(customerID.CustomerID || customerID);
            const deleted = cache.clear(getter, customerID)[0];
            deleted && cache.clear(getter, deleted.Name);
            return result;
        };
    });

    ['createCustomer', 'editCustomer'].forEach(prop => {
        const original = api[prop];
        api[prop] = async function () {
            const result = await original.apply(this, arguments);
            const getter = 'demandCustomer';
            if (clearOnUpdate) {
                cache.clear(getter, result.CustomerID);
                cache.clear(getter, result.Name);
            } else {
                cache.put(getter, result.CustomerID, result);
                cache.put(getter, result.Name, result);
            }
            cache.clear('getCustomers');
            return result;
        };
    });

    ['createStaff', 'editStaff'].forEach(prop => {
        const original = api[prop];
        api[prop] = async function () {
            const result = await original.apply(this, arguments);
            if (clearOnUpdate) {
                cache.clear('getStaff', result.StaffID);
            } else {
                cache.put('getStaff', result.StaffID, result);
            }
            cache.clear('getStaffList');
            return result;
        };
    });

    const _editUserEnabled = api.editUserEnabled;
    api.editUserEnabled = async function () {
        const result = await _editUserEnabled.apply(this, arguments);
        cache.clear('getStaff');
        cache.clear('getStaffList');
        cache.clear('getCustomerUsers');
        cache.clear('getAgentUsers');
        cache.clear('getUser');
        cache.clear('getRep');
        cache.clear('getCustomer');
        return result;
    };

    return api;
};
