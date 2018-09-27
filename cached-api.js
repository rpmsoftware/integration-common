const Cache = require('./cache');
const RpmApi = require('./api-wrappers').RpmApi;
const rpmUtil = require('./util');

module.exports = function (apiConfig) {
    const api = new RpmApi(apiConfig);
    // return api;

    const cache = new Cache();

    Object.defineProperty(api, 'cache', { value: cache });
    [
        'getProcesses',
        'getForms',
        'getFormList',
        'getViews',
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
        'getAccountGroups'
    ].forEach(prop => api[prop] = cache.cachify(api[prop], prop));

    ['createAccount', 'editAccount'].forEach(prop => {
        const original = api[prop];
        api[prop] = async function () {
            const result = await original.apply(this, arguments);
            cache.put('demandAccount', [result.Account, result.Supplier], result);
            cache.put('demandAccount', [result.AccountID], result);
            cache.clear('getAccounts');
            cache.clear('getCustomerAccounts', result.Customer);
            cache.clear('getCustomerAccounts', result.CustomerID);
            cache.clear('getSupplierAccounts', result.Supplier);
            cache.clear('getSupplierAccounts', result.SupplierID);
            return result;
        };
    });

    ['createForm', 'editForm', 'addFormParticipant'].forEach(prop => {
        const original = api[prop];
        api[prop] = async function () {
            const result = await original.apply(this, arguments);
            const form = result.Form;
            let getter = 'demandForm';
            cache.clear(getter, form.FormID);
            cache.clear(getter, [result.ProcessID, form.Number]);
            cache.clear(getter, [result.Process, form.Number]);
            getter = 'getForms';
            cache.clear(getter, result.ProcessID);
            cache.clear(getter, result.Process);
            getter = 'getFormList';
            cache.clear(getter, result.ProcessID);
            cache.clear(getter, result.Process);
            return result;
        };
    });

    const createFormAction = api.createFormAction;
    api.createFormAction = async function () {
        const result = await createFormAction.apply(this, arguments);
        const form = result.Action.Form;
        let getter = 'demandForm';
        cache.clear(getter, form.FormID);
        cache.clear(getter, form.ProcessID);
        getter = 'getForms';
        cache.clear(getter, form.ProcessID);
        getter = 'getFormList';
        cache.clear(getter, form.ProcessID);
        return result;
    };

    const trashForm = api.trashForm;
    api.trashForm = async function (id) {
        id = rpmUtil.normalizeInteger(id);
        const result = await trashForm.apply(this, arguments);
        let getter = 'demandForm';
        const cached = cache.clear(getter, [id])[0];
        if (cached) {
            cache.clear(getter, [cached.ProcessID, cached.Number]);
            cache.clear(getter, [cached.Process, cached.Number]);
            cache.clear('getForms', cached.ProcessID);
            cache.clear('getFormList', cached.ProcessID);
        } else {
            cache.clear('getForms');
            cache.clear('getFormList');
        }
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
}
