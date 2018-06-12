const rpmUtil = require('../util');
const throwError = rpmUtil.throwError;
const validateString = rpmUtil.validateString;
const moment = require('moment');
const rpm = require('../api-wrappers');
const assert = require('assert');
const createHash = require('string-hash');
const format = require('util').format;
const common = require('./common');


function normalizeIndex(value) {
    if (typeof value === 'string') {
        return value;
    }
    const result = rpmUtil.normalizeInteger(value);
    if (result < 0) {
        throw new TypeError('Index cannot be negative: ' + value);
    }
    return result;
}

function validateIndex(array, indexOrValue) {
    assert(Array.isArray(array), 'Array is expected');
    if (typeof indexOrValue === 'string') {
        return array.demandIndexOf(indexOrValue);
    }
    if (indexOrValue < 0 || indexOrValue >= array.length) {
        throw new Error(`Index ${indexOrValue} is out of bounds [$0,${array.length})`);
    }
    return indexOrValue;
}

const COMMON_SETTERS = {
    constant: {
        convert: function (config) {
            return config.value;
        },
        init: function (config) {
            assert.notStrictEqual(config.value, undefined);
        }
    },

    pattern: {
        convert: function (config, data) {
            data = data[config.srcField];
            data = data && data.trim();
            return data ? format(config.pattern, data) : null;
        },
        init: function (config) {
            validateString(config.srcField);
            config.pattern = config.pattern && config.pattern.trim();
            validateString(config.pattern);
            return config;
        }
    },

    strHash: function (config, data) {
        data = data[config.srcField];
        data = data && data.trim();
        return data ? '' + createHash(data) : null;
    },
    trim: function (config, data) {
        data = data[config.srcField];
        return data && data.trim() || null;
    },
    dictionary: {
        convert: async function (config, data) {
            const srcValue = data[config.srcField];
            if (!srcValue) {
                return null;
            }
            let keys;
            if (config.pattern) {
                keys = new RegExp(config.pattern).exec(srcValue);
                if (!keys) {
                    throwFieldError(config, `Could  not parse "${srcValue}"`);
                }
                keys.shift();
            } else {
                keys = [srcValue];
            }
            const l = config.keyColumns.length;
            if (keys.length < l) {
                throwFieldError(config, `${l} key(s) expected. [${keys.join(',')}]`);
            }
            let forms = await this.api.getForms(config.process, config.view);
            const columns = forms.Columns;
            const keyIdx = [];
            config.keyColumns.forEach(c => {
                const idx = validateIndex(columns, c);
                if (keyIdx.indexOf(idx) >= 0) {
                    throw new Error('Duplicate key index: ' + c);
                }
                keyIdx.push(idx);
            });
            const valueIdx = validateIndex(columns, config.valueColumn);
            let result = forms.Forms.find(form => {
                const values = form.Values;
                for (let ii = 0; ii < l; ii++) {
                    if (values[keyIdx[ii]] !== keys[ii]) {
                        return;
                    }
                }
                return form;
            });
            if (result) {
                result = result.Values[valueIdx];
            }
            if (!result && config.demand) {
                throwFieldError(config, `Unknown value: [${keys.join(',')}]`);
            }
            return result || null;
        },

        init: async function (config) {
            const api = this.api;
            validateString(config.srcField);
            let proc = await api.getProcesses();
            proc = proc.getActiveProcess(config.process, true);
            config.process = proc.ProcessID;
            if (config.view) {
                const view = await proc.getView(config.view, true);
                config.view = view.ID;
            }
            const keyColumns = rpmUtil.toArray(config.keyColumns).map(normalizeIndex);
            assert(keyColumns.length > 0, 'Must have at least one dictionary key column');
            config.keyColumns = keyColumns;
            config.valueColumn = normalizeIndex(config.valueColumn);
            return config;
        }
    }
};

for (let name in COMMON_SETTERS) {
    const convert = COMMON_SETTERS[name];
    if (typeof convert === 'function') {
        COMMON_SETTERS[name] = { convert }
    }
}

const SPECIFIC_SETTERS = {};

const VALUE_ERROR = exports.VALUE_ERROR = 'ValueError';

function throwFieldError(config, error) {
    // throw new Error(error);
    throwError(`${config.dstField}. ${error}`, VALUE_ERROR);
}

function getErrorMessage(config, error) {
    return `"${config.dstField}". ${error}`;
}

let fieldType = rpm.OBJECT_TYPE.CustomField;
let subTypes = rpm.DATA_TYPE;

function add(subtype, name, convert, init) {
    if (typeof name === 'function') {
        init = convert;
        convert = name;
        name = common.DEFAULT_ACCESSOR_NAME;
    }
    const fullType = common.getFullType(fieldType, rpmUtil.getEager(subTypes, subtype));
    let gens = SPECIFIC_SETTERS[fullType];
    if (!gens) {
        gens = SPECIFIC_SETTERS[fullType] = {};
    }
    if (init) {
        assert.equal(typeof init, 'function');
    }
    assert.equal(typeof convert, 'function');
    init = init || undefined;
    return gens[name] = { convert, init };
}

add('FieldTableDefinedRow',
    async function (config, data, form) {
        data = data[config.srcField] || data;
        const existingRows = form && rpm.getField.call(form.Form || form, config.dstField, true).Rows.filter(r => !r.IsDefinition);

        function getRowID(templateID) {
            const result = existingRows && existingRows.find(r => r.TemplateDefinedRowID === templateID);
            return result ? result.RowID : 0;
        }

        const rows = [];
        const errors = [];
        let rownum = 0;
        for (let rowDef of config.tableRows) {
            const srcRow = data[rowDef.name];
            const fieldValues = [];
            rows.push({ RowID: getRowID(rowDef.id), TemplateDefinedRowID: rowDef.id, Fields: fieldValues });
            ++rownum;
            for (let tabFieldConf of config.tableFields) {
                const fieldPatch = await setField.call(this, tabFieldConf, srcRow);
                if (!fieldPatch) {
                    continue;
                }
                let err = fieldPatch.Errors;
                delete fieldPatch.Errors;
                if (err) {
                    rpmUtil.toArray(err).forEach(err => errors.push(`"${config.dstField}".${rownum}.` + err));
                }
                fieldValues.push({ Values: [fieldPatch], Uid: tabFieldConf.dstUid });
            }
        }
        return { Rows: rows, Errors: errors.length > 0 ? errors : undefined };
    },
    async function (config, rpmField) {
        config = await initTableFields.call(this, config, rpmField);
        config.tableRows = rpmField.Rows.filter(r => !r.IsDefinition && !r.IsLabelRow).map(r => ({ id: r.ID, name: r.Name }));
        return config;
    }
);

add('FieldTable', 'delimetered',
    async function (config, data, form) {
        data = data[config.srcField];
        const existingRows = form && rpm.getField.call(form.Form || form, config.dstField, true).Rows.filter(r => !r.IsDefinition);
        function getRowID() {
            return (existingRows && existingRows.length) ? existingRows.shift().RowID : 0;
        }

        const rows = [];

        const colDelimiter = config.colDelimiter;
        let errors = [];
        let rownum = 0;
        for (let r of data ? data.split(config.rowDelimiter) : []) {
            const srcRow = colDelimiter ? r.split(config.colDelimiter).map(v => v.trim() || null) : [r];
            let fieldValues = [];
            rows.push({ RowID: getRowID(), Fields: fieldValues });
            ++rownum;
            for (let tabFieldConf of config.tableFields) {
                const fieldPatch = await setField.call(this, tabFieldConf, srcRow);
                if (!fieldPatch) {
                    continue;
                }
                let err = fieldPatch.Errors;
                delete fieldPatch.Errors;
                if (err) {
                    rpmUtil.toArray(err).forEach(err => errors.push(`"${config.dstField}".${rownum}.` + err));
                }
                fieldValues.push({ Values: [fieldPatch], Uid: tabFieldConf.dstUid });
            }
        }
        const emptyFields = config.tableFields.map(tabFieldConf => ({ Values: [], Uid: tabFieldConf.dstUid }));
        let id;
        while ((id = getRowID())) {
            rows.push({ RowID: id, Fields: emptyFields });
        }
        if (rows.length < 1) {
            return;
        }
        return { Rows: rows, Errors: errors.length > 0 ? errors : undefined };
    },
    async function (config, rpmField) {
        const result = {
            tableFields: [],
            colDelimiter: config.colDelimiter ? validateString(config.colDelimiter) : undefined
        };
        ['srcField', 'rowDelimiter'].forEach(prop => result[prop] = validateString(config[prop]));
        const defRow = rpmField.Rows.find(row => row.IsDefinition);
        assert(defRow, 'No definition row');
        for (let tableFieldName in config.tableFields) {
            let tabFieldConf = config.tableFields[tableFieldName];
            if (typeof tabFieldConf !== 'object') {
                tabFieldConf = { srcField: tabFieldConf + '' }
            }
            tabFieldConf = await initField.call(this, tabFieldConf, rpm.getField.call(defRow, tableFieldName, true));
            tabFieldConf.isTableField = true;
            result.tableFields.push(tabFieldConf);
        }
        return result;
    }
);

add('FieldTable',
    async function (config, data, form) {
        data = data[config.srcField] || data;
        assert(Array.isArray(data), 'Array is expected');
        const existingRows = form && rpm.getField.call(form.Form || form, config.dstField, true).Rows.filter(r => !r.IsDefinition);
        function getRowID() {
            return (existingRows && existingRows.length) ? existingRows.shift().RowID : 0;
        }
        const rows = [];
        let errors = [];
        let rownum = 0;
        for (let srcRow of data) {
            let fieldValues = [];
            rows.push({ RowID: getRowID(), Fields: fieldValues });
            ++rownum;
            for (let tabFieldConf of config.tableFields) {
                const fieldPatch = await setField.call(this, tabFieldConf, srcRow);
                if (!fieldPatch) {
                    continue;
                }
                let err = fieldPatch.Errors;
                delete fieldPatch.Errors;
                if (err) {
                    rpmUtil.toArray(err).forEach(err => errors.push(`"${config.dstField}".${rownum}.` + err));
                }
                fieldValues.push({ Values: [fieldPatch], Uid: tabFieldConf.dstUid });
            }
        }
        const emptyFields = config.tableFields.map(tabFieldConf => ({ Values: [], Uid: tabFieldConf.dstUid }));
        let id;
        while ((id = getRowID())) {
            rows.push({ RowID: id, Fields: emptyFields });
        }
        if (rows.length < 1) {
            return;
        }
        return { Rows: rows, Errors: errors.length > 0 ? errors : undefined };
    }, initTableFields
);

async function initTableFields(config, rpmField) {
    const defRow = rpmField.Rows.find(row => row.IsDefinition);
    assert(defRow, 'No definition row');
    const tableFields = config.tableFields;
    config.tableFields = [];

    function push(c) {
        c.isTableField = true;
        config.tableFields.push(c);
    }

    if (tableFields) {
        for (let tableFieldName in tableFields) {
            let tabFieldConf = tableFields[tableFieldName]
            if (typeof tabFieldConf !== 'object') {
                tabFieldConf = { srcField: tabFieldConf + '' }
            }
            push(await initField.call(this, tabFieldConf, rpm.getField.call(defRow, tableFieldName, true)));
        }
    } else {
        for (let tabField of defRow.Fields) {
            push(await initField.call(this, { srcField: tabField.Name }, tabField));
        }
    }
    return config;
}


function getDate(config, data) {
    const date = data[config.srcField];
    if (!date) {
        return null;
    }
    const m = moment(date, config.pattern || undefined);
    if (!m.isValid()) {
        throwFieldError(config, 'Invalid date: ' + date);
    }
    return m;
}

add('Date', function (config, data) {
    data = getDate(config, data);
    return { Value: data ? data.format('YYYY-MM-DD') : null };
});

add('DateTime', function (config, data) {
    data = getDate(config, data);
    return { Value: data ? data.format('YYYY-MM-DD HH:mm:ss') : null };
});

add('YesNo', function (config, data) {
    return { Value: rpmUtil.toBoolean(data[config.srcField]) ? 'Yes' : 'No' };
});

const EMPTY = { Value: null, ID: 0 };

add('List', async function (config, data) {
    const value = data[config.srcField];
    if (!value) {
        return EMPTY;
    }
    let option = await this.api.getFields(config.processID);
    option = option.getFieldByUid(config.dstUid, true);
    option = option.Options.find(o => o.Text === value);
    return option ? { Value: option.Text, ID: option.ID } : (config.demand ?
        Object.assign({ Errors: getErrorMessage(config, 'Unknown value: ' + value) }, EMPTY) :
        { Value: value }
    );
});

fieldType = rpm.OBJECT_TYPE.FormReference;
subTypes = rpm.REF_DATA_TYPE;

add('Customer', 'demand', async function (config, data) {
    const api = this.api || this;
    let name = data[config.srcField];
    if (!name) return null;
    const cust = await api.getCustomer(name);
    if (!cust) throwFieldError(config, `Customer "${name}" does not exist`);
    return { ID: cust.CustomerID, Value: cust.Name };
});
add('Customer', 'get', async function (config, data) {
    const api = this.api || this;
    let cust = data[config.srcField];
    if (!cust) return null;
    cust = await api.getCustomer(cust);
    return cust ? { ID: cust.CustomerID, Value: cust.Name } : { ID: 0, Value: null };
});
add('Customer', 'getOrCreate', async function (config, data) {
    const api = this.api || this;
    const cust = data[config.srcField];
    if (!cust) return null;
    let result = await api.getCustomer(cust);
    if (!result) {
        result = await api.createCustomer(cust);
    }
    return { ID: cust.CustomerID, Value: cust.Name };
});

add('AgentCompany', 'demand', async function (config, data) {
    const api = this.api || this;
    let name = data[config.srcField];
    // if (agency === undefined) return;
    if (!name) return null;
    const agency = await api.getAgency(name);
    if (!agency) throwFieldError(config, `Agency "${name}" does not exist`)
    return { ID: agency.AgencyID, Value: agency.Agency };
});
add('AgentCompany', 'get', async function (config, data) {
    const api = this.api || this;
    let agency = data[config.srcField];
    // if (agency === undefined) return;
    if (!agency) return null;
    agency = await api.getAgency(agency);
    return agency ? { ID: agency.AgencyID, Value: agency.Agency } : { ID: 0, Value: null };
});
add('AgentCompany', 'getOrCreate', async function (config, data) {
    const api = this.api || this;
    const agency = data[config.srcField];
    // if (agency === undefined) return;
    if (!agency) return null;
    let result = await api.getAgency(agency);
    if (!result) {
        result = await api.createAgency(agency);
    }
    return { ID: agency.AgencyID, Value: agency.Agency };
});

add('AgentRep', 'demand', async function (config, data) {
    const api = this.api || this;
    let name = data[config.srcField];
    // if (agency === undefined) return;
    if (!name) return null;
    const agency = await api.getAgency(name);
    if (!agency) throwFieldError(config, `Agency "${name}" does not exist`)
    const rep = agency.Reps.find(r => r.Type === 'Manager');
    if (!rep) {
        throwFieldError(config, `No manager for "${agency.Agency}" agency`)
    }
    return { ID: rep.RepID, Value: rep.Rep };
});

add('CustomerAccount', 'getOrCreate',
    async function (config, data) {
        const api = this.api || this;
        let accountName = data[config.account];
        // if (accountName === undefined) return;
        if (!accountName) return null;

        const extract = prop => {
            const property = config[prop];
            const value = data[property];
            if (!value) {
                throwFieldError(config, `"${property}" is required for Account`);
            }
            return value;
        }

        const customer = extract('customer');
        const supplier = extract('supplier');

        let account = await api.getAccount(accountName, supplier);
        if (!account) {
            account = await api.createAccount(accountName, customer, supplier);
        } else if (account.Customer !== customer) {
            throwFieldError(config, `Expected account "${accountName}"`);
        }
        return { ID: account.AccountID, Value: account.Account };
    }, function (config) {
        ['account', 'customer', 'supplier'].forEach(prop => validateString(config[prop]));
        return config;
    }
);


add('RestrictedReference', async function (config, data) {
    data = data[config.srcField];
    if (!data) return null;
    if (typeof data === 'number') {
        if (config.isTableField) {
            return { ID: data };
        }
        data = await this.api.demandForm(data);
        return data.Form.Number;
    }
    return data;
});


const defaultConverter = {
    convert: function (config, data) {
        return data[config.srcField] || null;
    }
};

async function initField(conf, rpmField) {
    if (!rpmField.UserCanEdit) {
        throw new Error('Field is readonly: ' + rpmField.Name);
    }
    const key = common.getFullType(rpmField);
    let gen = SPECIFIC_SETTERS[key] || COMMON_SETTERS;
    const setter = conf.setter;
    if (setter) {
        gen = gen[setter] || COMMON_SETTERS[setter];
        if (!gen) {
            throw new Error('Unknown RPM value generator: ' + JSON.stringify(conf));
        }
    } else {
        gen = gen[common.DEFAULT_ACCESSOR_NAME] || defaultConverter;
    }
    if (gen.init) {
        const newConf = await gen.init.call(this, conf, rpmField);
        conf = newConf || conf;
    } else {
        validateString(conf.srcField);
    }
    if (setter) {
        conf.setter = setter;
    } else {
        delete conf.setter;
    }
    conf.type = key;
    conf.dstUid = validateString(rpmField.Uid);
    conf.dstField = validateString(rpmField.Name);
    conf.processID = rpmField.ProcessID;
    return conf;
}

function getSetter(fieldConfig) {
    let converter = SPECIFIC_SETTERS[fieldConfig.type] || COMMON_SETTERS;
    const name = fieldConfig.setter || common.DEFAULT_ACCESSOR_NAME;
    const result = converter && converter[name] || COMMON_SETTERS[name] || defaultConverter;
    return result.convert;
}

async function setField(conf, data, form) {
    const setter = getSetter(conf);
    let result;
    try {
        result = await setter.call(this, conf, data, form);
        if (result === undefined) { // Workaround for tables
            return;
        }
    } catch (error) {
        if (error.name !== VALUE_ERROR) {
            throw error;
        }
        result = { ID: 0, Value: null, Errors: error.message || error };
    }
    return (result && typeof result === 'object') ? result : (conf.valueIsId ?
        { ID: result ? rpmUtil.normalizeInteger(result) : 0 } :
        { Value: result }
    );
}

async function set(conf, data, form) {
    const result = await setField.call(this, conf, data, form);
    result.Uid = conf.dstUid;
    result.Field = conf.dstField;
    return result;
}

Object.assign(exports, { initField, set });