const Cache = require('./cache');
const { RpmApi } = require('./api-wrappers');
const { ObjectType } = require('./api-enums');
const rpmUtil = require('./util');

async function getProcess(nameOrID, demand) {
    return (await this._getProcesses()).getProcess(nameOrID, demand);
}

async function getActiveProcess(nameOrID, demand) {
    return (await this._getProcesses()).getActiveProcess(nameOrID, demand);
}

module.exports = function (apiConfig) {
    const api = new RpmApi(apiConfig);

    const cache = new Cache();

    cache.clearFormRelated = function (result) {
        const form = result.Form;
        let getter = 'demandForm';
        this.clear(getter, form.FormID);
        this.clear(getter, [result.ProcessID, form.Number]);
        this.clear(getter, [result.Process, form.Number]);
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
        return api._getFileCached(fileID, rpmUtil.toBoolean(returnUrl));
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
        'getInfo',
        'getProcessActions',
        'getAgentUsers',
        'getCustomerUsers',
        'getStaffList',
        'getAgencies',
        'getSuppliers',
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
        'getTableFillsList'
    ].forEach(prop => api[prop] = cache.cachify(api[prop], prop));

    ['createAccount', 'editAccount'].forEach(prop => {
        const original = api[prop];
        api[prop] = async function () {
            const result = await original.apply(this, arguments);
            cache.put('demandAccount', [result.Account, result.Supplier], result);
            cache.put('demandAccount', [result.AccountID], result);
            cache.clear('getAccounts');
            cache.clear('searchCustomers');
            cache.clear('getCustomerAccounts', result.Customer);
            cache.clear('getCustomerAccounts', result.CustomerID);
            cache.clear('getSupplierAccounts', result.Supplier);
            cache.clear('getSupplierAccounts', result.SupplierID);
            return result;
        };
    });

    ['createForm', 'editForm', 'addFormParticipant', 'addNoteByFormID', 'addNoteByFormNumber'].forEach(prop => {
        const original = api[prop];
        api[prop] = async function () {
            const result = await original.apply(this, arguments);
            cache.clearFormRelated(result);
            return result;
        };
    });

    const createForm = api.createForm;
    api.createForm = async function () {
        const result = await createForm.apply(this, arguments);
        cache.clearFormRelated(result);
        cache.clear('_getProcesses');
        return result;
    };

    const editFormAction = api.editFormAction;
    api.editFormAction = async function () {
        const result = await editFormAction.apply(this, arguments);
        const form = result.Action.Form;
        let getter = 'demandForm';
        cache.clear(getter, form.FormID);
        cache.clear(getter, form.ProcessID);
        cache.clear('getForms', form.ProcessID);
        cache.clear('getFormList', form.ProcessID);
        return result;
    };

    async function clearAfterFile(formID) {
        let getter = 'demandForm';
        cache.clear(getter, formID);
        const form = await this.demandForm(formID);
        cache.put(getter, [formID], form);
        cache.put(getter, [form.ProcessID, form.Form.Number], form);
        cache.put(getter, [form.Process, form.Form.Number], form);
        getter = 'getForms';
        cache.clear(getter, form.ProcessID);
        cache.clear(getter, form.Process);
        getter = 'getFormList';
        cache.clear(getter, form.ProcessID);
        cache.clear(getter, form.Process);
    }

    const addFormFile = api.addFormFile;
    api.addFormFile = async function () {
        const result = await addFormFile.apply(this, arguments);
        await clearAfterFile.call(this, result.FileAttachment.FormID);
        return result;
    };

    const editFormFile = api.editFormFile;
    api.editFormFile = async function () {
        const result = await editFormFile.apply(this, arguments);
        await clearAfterFile.call(this, result.FileAttachment.FormID);
        cache.clear('_getFileCached', result.FileAttachment.FileID);
        return result;
    };

    const cleanAfterFormID = id => {
        id = +id;
        let getter = 'demandForm';
        const cached = !isNaN(id) && cache.clear(getter, [id])[0];
        if (cached) {
            cache.clear(getter, [cached.ProcessID, cached.Form.Number]);
            cache.clear(getter, [cached.Process, cached.Form.Number]);
            cache.clear('getForms', cached.ProcessID);
            cache.clear('getFormList', cached.ProcessID);
            cache.clear('getForms', cached.Process);
            cache.clear('getFormList', cached.Process);
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
            cache.put(getter, result.AgencyID, result);
            cache.put(getter, result.Agency, result);
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
            customerID = rpmUtil.normalizeInteger(customerID.CustomerID || customerID);
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
            cache.put(getter, result.CustomerID, result);
            cache.put(getter, result.Name, result);
            cache.clear('getCustomers');
            return result;
        };
    });

    ['createStaff', 'editStaff'].forEach(prop => {
        const original = api[prop];
        api[prop] = async function () {
            const result = await original.apply(this, arguments);
            cache.clear('getStaff', result.StaffID);
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
        return result;
    };

    return api;
};
