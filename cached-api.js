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
        let { ProcessID, Process, Form, Trashed } = result;
        Trashed = !!Trashed;
        const { FormID, Number, AlternateID } = Form;
        let getter = '_demandForm';
        if (clearDemand) {
            this.clear(getter, Form.FormID);
            AlternateID && this.clear(getter, AlternateID);
            this.clear(getter, [ProcessID, Number]);
            this.clear(getter, [Process, Number]);
        } else {
            this.put(getter, [FormID, undefined, Trashed], result);
            AlternateID && this.put(getter, [AlternateID, undefined, Trashed], result);
            this.put(getter, [ProcessID, Number, Trashed], result);
            this.put(getter, [Process, Number, Trashed], result);
        }
        getter = 'getForms';
        this.clear(getter, ProcessID);
        this.clear(getter, Process);
        getter = 'getFormList';
        this.clear(getter, ProcessID);
        this.clear(getter, Process);
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
        '_demandForm',
        'demandCustomer',
        'demandAgency',
        'demandAccount',
        'demandRep',
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
            const { Account, AccountID, Supplier, SupplierID, Customer, CustomerID } = result;
            if (true || clearOnUpdate) {
                cache.clear('demandAccount', [Account, SupplierID]);
                cache.clear('demandAccount', [Account, Supplier]);
                cache.clear('demandAccount', AccountID);
            } else {
                cache.put('demandAccount', [Account, SupplierID], result);
                cache.put('demandAccount', [Account, Supplier], result);
                cache.put('demandAccount', AccountID, result);
            }
            cache.clear('getAccounts');
            cache.clear('searchCustomers');
            cache.clear('getCustomerAccounts', Customer);
            cache.clear('getCustomerAccounts', CustomerID);
            cache.clear('getSupplierAccounts', Supplier);
            cache.clear('getSupplierAccounts', SupplierID);
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
        const { FormID, ProcessID } = result.Action.Form;
        cache.clear('getForms', ProcessID);
        cache.clear('getFormList', ProcessID);
        cleanAfterFormID(FormID);
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
        const { FormID, FileID } = result.FileAttachment;
        cleanAfterFormID(FormID);
        cache.clear('_getFileCached', FileID);
        return result;
    };

    const cleanAfterFormID = id => {
        let getter = '_demandForm';
        const cached = cache.clear(getter, id)[0];
        if (cached) {
            cache.clearFormRelated(cached, true);
        } else {
            cache.clear('getForms');
            cache.clear('getFormList');
        }
        cache.clear('_getProcesses');
    };

    const evaluateForm = api.evaluateForm;
    api.evaluateForm = async function () {
        const result = await evaluateForm.apply(this, arguments);
        cleanAfterFormID(arguments[0]);
        return result;
    };

    ['trashForm', '_archiveForm', '_unarchiveForm', 'restoreForm'].forEach(prop => {
        const original = api[prop];
        api[prop] = async function () {
            const result = await original.apply(this, arguments);
            cache.clear('getForms');
            cache.clear('getFormList');
            cache.clear('_demandForm');
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
            const getter = 'demandAgency';
            const { AgencyID, Agency } = result;
            if (clearOnUpdate) {
                cache.clear(getter, AgencyID);
                cache.clear(getter, Agency);
            } else {
                cache.put(getter, AgencyID, result);
                cache.put(getter, Agency, result);
            }
            cache.clear('getAgencies');
            return result;
        };
    });

    ['createSupplier', 'editSupplier'].forEach(prop => {
        const original = api[prop];
        api[prop] = async function () {
            const result = await original.apply(this, arguments);
            const getter = 'getSupplier';
            const { SupplierID } = result;
            clearOnUpdate ?
                cache.clear(getter, SupplierID) :
                cache.put(getter, SupplierID, result);
            cache.clear('getSuppliers');
            return result;
        };
    });

    ['createRep', 'editRep'].forEach(prop => {
        const original = api[prop];
        api[prop] = async function () {
            const result = await original.apply(this, arguments);
            const getter = 'demandRep';
            const { RepID } = result;
            clearOnUpdate ?
                cache.clear(getter, RepID) :
                cache.put(getter, RepID, result);
            cache.clear('getAgentUsers');
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
            const getter = 'demandCustomer';
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
            const { CustomerID, Name } = result;
            if (clearOnUpdate) {
                cache.clear(getter, CustomerID);
                cache.clear(getter, Name);
            } else {
                cache.put(getter, CustomerID, result);
                cache.put(getter, Name, result);
            }
            cache.clear('getCustomers');
            return result;
        };
    });

    ['createStaff', 'editStaff'].forEach(prop => {
        const original = api[prop];
        api[prop] = async function () {
            const result = await original.apply(this, arguments);
            const getter = 'getStaff';
            const { StaffID } = result;
            clearOnUpdate ?
                cache.clear(getter, StaffID) :
                cache.put(getter, StaffID, result);
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
        cache.clear('demandRep');
        cache.clear('demandCustomer');
        return result;
    };

    return api;
};
