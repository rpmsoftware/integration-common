const { throwError, normalizeInteger, validateString, toBoolean, toArray, getEager } = require('../util');
const moment = require('dayjs');
const {
    getField,
    getFieldByUid,
    ISO_DATE_FORMAT,
    ISO_DATE_TIME_FORMAT,
    isTableField,
    toSimpleField
} = require('../api-wrappers');
const assert = require('assert');
const createHash = require('string-hash');
const { format } = require('util');
const { getFullType, DEFAULT_ACCESSOR_NAME, isEmptyValue } = require('./common');
const { FieldSubType, ObjectType } = require('../api-enums');


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
        convert: function ({ value }) {
            return value;
        },
        init: function ({ value }) {
            assert.notStrictEqual(value, undefined);
            return { value };
        }
    },

    pattern: {
        convert: function ({ srcField, pattern }, data) {
            data = data[srcField];
            data = data && data.trim();
            return data ? format(pattern, data) : null;
        },
        init: function ({ pattern }) {
            pattern = pattern ? validateString(pattern) : undefined;
            return { pattern };
        }
    },

    strHash: function ({ srcField }, data) {
        data = data[srcField];
        data = data && data.trim();
        return data ? '' + createHash(data) : null;
    },

    trim: function ({ srcField }, data) {
        data = data[srcField];
        return data && data.trim() || null;
    },

    formNumberToID: async function ({ srcField, processID }, data) {
        assert(processID > 0);
        const srcValue = data[srcField];
        return srcValue ? (await this.api.demandForm(processID, srcValue)).Form.FormID : 0;
    },

    dictionary: {
        convert: async function (config, data) {
            const { srcField, pattern, keyColumns, view, process, valueColumn, demand } = config;
            const srcValue = data[srcField];
            if (!srcValue) {
                return null;
            }
            let keys;
            if (pattern) {
                keys = new RegExp(pattern).exec(srcValue);
                if (!keys) {
                    throwFieldError(config, `Could  not parse "${srcValue}"`);
                }
                keys.shift();
            } else {
                keys = [srcValue];
            }
            const l = keyColumns.length;
            if (keys.length < l) {
                throwFieldError(config, `${l} key(s) expected. [${keys.join(',')}]`);
            }
            let forms = await this.api.getForms(process, view);
            const columns = forms.Columns;
            const keyIdx = keyColumns.map(c => {
                const idx = validateIndex(columns, c);
                if (keyIdx.indexOf(idx) >= 0) {
                    throw new Error('Duplicate key index: ' + c);
                }
                return idx;
            });
            const valueIdx = validateIndex(columns, valueColumn);
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
            if (!result && demand) {
                throwFieldError(config, `Unknown value: [${keys.join(',')}]`);
            }
            return result || null;
        },

        init: async function ({ process, view, keyColumns, valueColumn }) {
            const { api } = this;
            let proc = await api.getProcesses();
            proc = proc.getActiveProcess(process, true);
            process = proc.ProcessID;
            view = view ? (await proc.getView(view, true)).ID : undefined;
            keyColumns = toArray(keyColumns).map(normalizeIndex);
            assert(keyColumns.length > 0, 'Must have at least one dictionary key column');
            valueColumn = normalizeIndex(valueColumn);
            return { process, view, keyColumns, valueColumn };
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

function throwFieldError({ dstField }, error) {
    throwError(`${dstField}. ${error}`, VALUE_ERROR);
}

function getErrorMessage({ dstField }, error) {
    return `"${dstField}". ${error}`;
}

let fieldType = ObjectType.CustomField;
let subTypes = FieldSubType;

function add(subtype, name, convert, init) {
    if (typeof name === 'function') {
        init = convert;
        convert = name;
        name = DEFAULT_ACCESSOR_NAME;
    }
    const fullType = getFullType(fieldType, getEager(subTypes, subtype));
    let gens = SPECIFIC_SETTERS[fullType];
    if (!gens) {
        gens = SPECIFIC_SETTERS[fullType] = {};
    }
    if (init) {
        assert.strictEqual(typeof init, 'function');
    }
    assert.strictEqual(typeof convert, 'function');
    init = init || undefined;
    return gens[name] = { convert, init };
}

add('FieldTableDefinedRow',
    async function ({ srcField, dstField, tableRows, tableFields }, data, form) {
        data = data[srcField] || data;
        const existingRows = form && getField.call(form.Form || form, dstField, true).Rows.filter(r => !r.IsDefinition);

        function getRowID(templateID) {
            const result = existingRows && existingRows.find(r => r.TemplateDefinedRowID === templateID);
            return result ? result.RowID : 0;
        }

        const rows = [];
        const errors = [];
        let rownum = 0;
        for (let rowDef of tableRows) {
            const srcRow = data[rowDef.name];
            if (!srcRow) {
                continue;
            }
            const fieldValues = [];
            rows.push({ RowID: getRowID(rowDef.id), TemplateDefinedRowID: rowDef.id, Fields: fieldValues });
            ++rownum;
            for (let tabFieldConf of tableFields) {
                const fieldPatch = await setField.call(this, tabFieldConf, srcRow);
                if (!fieldPatch) {
                    continue;
                }
                let err = fieldPatch.Errors;
                delete fieldPatch.Errors;
                if (err) {
                    toArray(err).forEach(err => errors.push(`"${dstField}".${rownum}.` + err));
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
        const existingRows = form && getField.call(form.Form || form, config.dstField, true).Rows.filter(r => !r.IsDefinition);
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
    async function ({ colDelimiter, rowDelimiter, tableFields }, rpmField) {
        const result = {
            tableFields: [],
            colDelimiter: colDelimiter ? validateString(colDelimiter) : undefined,
            rowDelimiter: validateString(rowDelimiter)
        };
        const defRow = rpmField.Rows.find(row => row.IsDefinition);
        assert(defRow, 'No definition row');
        for (let tableFieldName in tableFields) {
            let tabFieldConf = tableFields[tableFieldName];
            if (typeof tabFieldConf !== 'object') {
                tabFieldConf = { srcField: tabFieldConf + '' }
            }
            tabFieldConf = await initField.call(this, tabFieldConf, getField.call(defRow, tableFieldName, true));
            tabFieldConf.isTableField = true;
            result.tableFields.push(tabFieldConf);
        }
        return result;
    }
);

add('FieldTable',
    async function (config, data, form) {
        data = data[config.srcField] || data;
        assert.strictEqual(typeof data, 'object', 'Object is expected');
        const existingRows = form ? getField.call(form.Form || form, config.dstField, true)
            .Rows.filter(r => !r.IsDefinition && !r.IsLabelRow) : [];

        const isArray = Array.isArray(data);
        let getExistingRow;
        if (isArray) {
            getExistingRow = () => existingRows && existingRows.shift();
        } else if (config.key) {
            const getKey = row => {
                let key = getFieldByUid.call(row, config.key, true).Values[0];
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
                fieldValues.push(getFieldByUid.call(existingRow, config.key, true));
        }
        if (!isArray) {
            rows = rows.concat(existingRows);
        }
        return { Rows: rows, Errors: errors.length > 0 ? errors : undefined };
    }, initTableFields
);

async function initTableFields({ tableFields: srcTableFields, key, createKeys }, rpmField) {
    const defRow = rpmField.Rows.find(row => row.IsDefinition);
    assert(defRow, 'No definition row');
    const tableFields = [];

    const push = c => {
        c.isTableField = true;
        tableFields.push(c);
    };

    if (srcTableFields) {
        for (let tableFieldName in srcTableFields) {
            let tabFieldConf = srcTableFields[tableFieldName]
            if (typeof tabFieldConf !== 'object') {
                tabFieldConf = { srcField: tabFieldConf + '' }
            }
            tabFieldConf = await initField.call(this, tabFieldConf, getField.call(defRow, tableFieldName, true));
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
    key = key ? getField.call(defRow, validateString(key), true).Uid : undefined;
    createKeys = key && !!tableFields.find(tf => tf.dstUid === key);
    return { tableFields, key, createKeys };
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
        data = data ? data.format(ISO_DATE_FORMAT) : null;
    }
    return { Value: data };
});

add('DateTime', function (config, data) {
    data = data[config.srcField];
    if (config.normalize) {
        data = toMoment(config, data);
        data = data ? data.format(ISO_DATE_TIME_FORMAT) : null;
    }
    return { Value: data };
});

add('YesNo', function ({ srcField, normalize }, data) {
    data = data[srcField];
    if (normalize) {
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
    return { options: getEager(rpmField, 'Options') };
});

fieldType = ObjectType.FormReference;
subTypes = ObjectType;

add('Customer', 'demand', async function (config, data) {
    const api = this.api || this;
    let name = data[config.srcField];
    if (!name) return null;
    const cust = await api.getCustomer(name);
    if (!cust) throwFieldError(config, `Customer "${name}" does not exist`);
    return { ID: cust.CustomerID, Value: cust.Name };
});
add('Customer', 'get', async function ({ srcField }, data) {
    const api = this.api || this;
    let cust = data[srcField];
    if (!cust) return null;
    cust = await api.getCustomer(cust);
    return cust ? { ID: cust.CustomerID, Value: cust.Name } : { ID: 0, Value: null };
});
add('Customer', 'getOrCreate', async function ({ srcField }, data) {
    const api = this.api || this;
    let cust = data[srcField];
    if (!cust) return null;
    cust = await api.getCustomer(cust) || await api.createCustomer(cust);
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
add('AgentCompany', 'get', async function ({ srcField }, data) {
    const api = this.api || this;
    let agency = data[srcField];
    // if (agency === undefined) return;
    if (!agency) return null;
    agency = await api.getAgency(agency);
    return agency ? { ID: agency.AgencyID, Value: agency.Agency } : { ID: 0, Value: null };
});
add('AgentCompany', 'getOrCreate', async function ({ srcField }, data) {
    const api = this.api || this;
    const agency = data[srcField];
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
    }, function ({ account, customer, supplier }) {
        validateString(account);
        validateString(customer);
        validateString(supplier);
        return { account, customer, supplier };
    }
);


add('RestrictedReference', async function ({ srcField, isTableField }, data) {
    data = data[srcField] || (isTableField ? 0 : null);
    if (typeof data === 'number') {
        if (isTableField) {
            return { ID: data };
        }
        data = await this.api.demandForm(data);
        data = data.Form.Number;
    }
    return data;
});

async function defaultBasicReference({ srcField, isTableField }, data) {
    data = data[srcField] || (isTableField ? 0 : null);
    return (typeof data === 'number' && isTableField) ? { ID: data } : data;
}

[
    'Customer',
    'CustomerContact',
    'CustomerLocation',
    'AgentCompany',
    'AgentRep',
    'CustomerAccount',
    'Staff',
    'Supplier'
].forEach(subType => add(subType, defaultBasicReference));

const defaultConverter = {
    convert: function ({ srcField }, data) {
        return data[srcField] || null;
    }
};

const CONDITIONS = {
    gt: function (src, dstField) {
        src = +src;
        const dstValue = +(dstField && dstField.Value);
        return !isNaN(src) && (isNaN(dstValue) || src - dstValue > 0);
    },
    ne: function (src, dstField) {
        return !dstField || src !== dstField.Value;
    },
    emptySource: function (src) {
        return isEmptyValue(src);
    },
    emptyDestination: function (src, dstField) {
        return !dstField || dstField.ID === 0 || isEmptyValue(dstField.Value);
    },
};

async function initField(conf, rpmField) {
    const key = getFullType(rpmField);
    let gen = SPECIFIC_SETTERS[key] || COMMON_SETTERS;
    let { setter, condition, srcField, normalize } = conf;
    if (setter) {
        gen = gen[setter] || COMMON_SETTERS[setter];
        if (!gen) {
            throw new Error('Unknown RPM value generator: ' + JSON.stringify(conf));
        }
    } else {
        gen = gen[DEFAULT_ACCESSOR_NAME] || defaultConverter;
    }
    conf = gen.init ? await gen.init.call(this, conf, rpmField) : {};
    assert.strictEqual(typeof conf, 'object');
    conf.normalize = normalize === undefined || toBoolean(normalize);
    conf.setter = setter || undefined;
    conf.srcField = srcField === undefined ? rpmField.Name : validateString(srcField);
    conf.type = key;
    conf.dstUid = validateString(rpmField.Uid);
    conf.dstField = validateString(rpmField.Name);
    conf.processID = rpmField.ProcessID;
    if (condition && !isTableField(rpmField)) {
        getEager(CONDITIONS, validateString(condition));
        conf.condition = condition;
    }
    return conf;
}

function getSetter({ type, setter }) {
    let converter = SPECIFIC_SETTERS[type] || COMMON_SETTERS;
    const name = setter || DEFAULT_ACCESSOR_NAME;
    return (converter && converter[name] || COMMON_SETTERS[name] || defaultConverter).convert;
}

async function setField(conf, data, form) {
    const setter = getSetter(conf);
    let result;
    let { condition, valueIsId, srcField, dstUid } = conf;
    if (condition) {
        condition = getEager(CONDITIONS, condition);
        const srcValue = data[srcField];
        const dstField = form ? toSimpleField(getFieldByUid.call(form.Form || form, dstUid, true)) : undefined;
        if (!condition(srcValue, dstField)) {
            return;
        }
    }
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
    return (result && typeof result === 'object') ? result : (valueIsId ?
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