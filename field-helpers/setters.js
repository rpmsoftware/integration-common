const { throwError, normalizeInteger, validateString, toBoolean, toArray, getEager } = require('../util');
const moment = require('moment');
const rpm = require('../api-wrappers');
const assert = require('assert');
const createHash = require('string-hash');
const { format } = require('util');
const common = require('./common');

const {
    FieldSubType,
    ObjectType,
    RefSubType
} = require('../enums');


function normalizeIndex(value) {
    if (typeof value === 'string') {
        return value;
    }
    const result = normalizeInteger(value);
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

    formNumberToID: async function (config, data) {
        assert(config.processID > 0);
        const srcValue = data[config.srcField];
        if (!srcValue) {
            return 0;
        }
        const form = await this.api.demandForm(config.processID, srcValue);
        return form.Form.FormID;
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
            const keyColumns = toArray(config.keyColumns).map(normalizeIndex);
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

let fieldType = ObjectType.CustomField;
let subTypes = FieldSubType;

function add(subtype, name, convert, init) {
    if (typeof name === 'function') {
        init = convert;
        convert = name;
        name = common.DEFAULT_ACCESSOR_NAME;
    }
    const fullType = common.getFullType(fieldType, getEager(subTypes, subtype));
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
            if (!srcRow) {
                continue;
            }
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
                    toArray(err).forEach(err => errors.push(`"${config.dstField}".${rownum}.` + err));
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
                    toArray(err).forEach(err => errors.push(`"${config.dstField}".${rownum}.` + err));
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
        assert.equal(typeof data, 'object', 'Object is expected');
        const existingRows = form ? rpm.getField.call(form.Form || form, config.dstField, true)
            .Rows.filter(r => !r.IsDefinition && !r.IsLabelRow) : [];

        const isArray = Array.isArray(data);
        let getExistingRow;
        if (isArray) {
            getExistingRow = () => existingRows && existingRows.shift();
        } else if (config.key) {
            const getKey = row => {
                let key = rpm.getFieldByUid.call(row, config.key, true).Values[0];
                return key && key.Value;
            };
            getExistingRow = key => {
                assert(key !== undefined, 'Row key is required');
                const idx = existingRows.findIndex(r => key === getKey(r));
                return idx < 0 ? undefined : existingRows.splice(idx, 1)[0];
            }
        } else {
            getExistingRow = rowID => {
                const key = +rowID;
                assert(typeof key === 'number', 'Numeric key is required: ' + rowID);
                const idx = existingRows.findIndex(r => key === r.RowID);
                return idx < 0 ? undefined : existingRows.splice(idx, 1)[0];
            }
        }

        let rows = [];
        let errors = [];
        let rownum = 0;
        for (let key in data) {
            const srcRow = data[key];
            const existingRow = getExistingRow(key);
            if (!(existingRow || isArray || config.createKeys)) {
                continue;
            }
            let fieldValues = [];
            rows.push({ RowID: existingRow && existingRow.RowID || 0, Fields: fieldValues });
            ++rownum;
            for (let tabFieldConf of config.tableFields) {
                if (!srcRow.hasOwnProperty(tabFieldConf.srcField)) {
                    continue;
                }
                const fieldPatch = await setField.call(this, tabFieldConf, srcRow);
                if (!fieldPatch) {
                    continue;
                }
                let err = fieldPatch.Errors;
                delete fieldPatch.Errors;
                if (err) {
                    toArray(err).forEach(err => errors.push(`"${config.dstField}".${rownum}.` + err));
                }
                fieldValues.push({ Values: [fieldPatch], Uid: tabFieldConf.dstUid });
            }
            existingRow && config.key && !fieldValues.find(f => f.Uid === config.key) &&
                fieldValues.push(rpm.getFieldByUid.call(existingRow, config.key, true));
        }
        if (!isArray) {
            rows = rows.concat(existingRows);
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
            tabFieldConf = await initField.call(this, tabFieldConf, rpm.getField.call(defRow, tableFieldName, true));
            if (!tabFieldConf.srcField) {
                tabFieldConf.srcField = tabFieldConf.dstField;
            }
            push(tabFieldConf);
        }
    } else {
        for (let tabField of defRow.Fields) {
            tabField.UserCanEdit && push(await initField.call(this, { srcField: tabField.Name }, tabField));
        }
    }
    config.key = config.key ? rpm.getField.call(defRow, validateString(config.key), true).Uid : undefined;
    config.createKeys = config.key && !!config.tableFields.find(tf => tf.dstUid === config.key);
    return config;
}


function toMoment(config, date) {
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
    data = data[config.srcField];
    if (config.normalize) {
        data = toMoment(config, data);
        data = data ? data.format('YYYY-MM-DD') : null;
    }
    return { Value: data };
});

add('DateTime', function (config, data) {
    data = data[config.srcField];
    if (config.normalize) {
        data = toMoment(config, data);
        data = data ? data.format('YYYY-MM-DD HH:mm:ss') : null;
    }
    return { Value: data };
});

add('YesNo', function (config, data) {
    data = data[config.srcField];
    if (config.normalize) {
        data = (data === undefined || data === null) ? null : (toBoolean(data) ? 'Yes' : 'No');
    }
    return { Value: data };
});

const EMPTY = { Value: null, ID: 0 };

add('List', function (config, data) {
    const value = data[config.srcField];
    if (!value) {
        return EMPTY;
    }
    let option = config.options.find(o => o.Text === value);
    return option ? { Value: option.Text, ID: option.ID } : (config.demand ?
        Object.assign({ Errors: getErrorMessage(config, 'Unknown value: ' + value) }, EMPTY) :
        { Value: value }
    );
}, async function (config, rpmField) {
    config.options = getEager(rpmField, 'Options');
    return config;
});

fieldType = ObjectType.FormReference;
subTypes = RefSubType;

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
        conf.normalize = conf.hasOwnProperty('normalize') ? toBoolean(conf.normalize) : true;
    }
    if (conf.hasOwnProperty('srcField')) {
        validateString(conf.srcField);
    } else {
        conf.srcField = rpmField.Name;
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
        { ID: result ? normalizeInteger(result) : 0 } :
        { Value: result }
    );
}

async function set(conf, data, form) {
    const result = await setField.call(this, conf, data, form);
    if (result) {
        result.Uid = conf.dstUid;
        result.Field = conf.dstField;
    }
    return result;
}

Object.assign(exports, { initField, set });