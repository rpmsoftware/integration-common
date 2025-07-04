const {
    throwError,
    normalizeInteger,
    validateString,
    toBoolean,
    toArray,
    getEager,
    getDeepValue,
    validatePropertyConfig,
    demandDeepValue,
    isEmpty,
    isEmptyValue
} = require('../util');
const moment = require('dayjs');
const {
    getField,
    getFieldByUid,
    ISO_DATE_FORMAT,
    ISO_DATE_TIME_FORMAT,
    isTableField,
    isReferenceField
} = require('../api-wrappers');
const assert = require('assert');
const { format } = require('util');
const { getFullType, DEFAULT_ACCESSOR_NAME } = require('./common');
const { FieldSubType, ObjectType, RepTypes } = require('../api-enums');
const tweakDate = require('./tweak-date');
const { init: initCondition, process: processCondition } = require('../conditions');

const validateIndex = (array, indexOrValue) => {
    assert(Array.isArray(array), 'Array is expected');
    if (typeof indexOrValue === 'string') {
        return array.demandIndexOf(indexOrValue);
    }
    if (indexOrValue < 0 || indexOrValue >= array.length) {
        throw new Error(`Index ${indexOrValue} is out of bounds [$0,${array.length})`);
    }
    return indexOrValue;
};

const getObjectValue = ({ srcField, regexp }, data) => {
    data = getDeepValue(data, srcField);
    if (data && regexp) {
        assert.strictEqual(typeof data, 'string');
        data = new RegExp(regexp).exec(data);
        data = data && data[1];
    }
    return data || undefined;
};

const normalizeIndex = value => {
    if (typeof value === 'string') {
        return value;
    }
    const result = normalizeInteger(value);
    if (result < 0) {
        throw new TypeError('Index cannot be negative: ' + value);
    }
    return result;
};


const COMMON_SETTERS = {
    now: {

        convert: function (conf) {
            return tweakDate.process(conf, moment().millisecond(0)).format(ISO_DATE_TIME_FORMAT);
        },

        init: function (conf) {
            return tweakDate.init.call(this, conf);
        }
    },

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
            data = getDeepValue(data, srcField);
            return data ? format(pattern, data) : null;
        },
        init: function ({ pattern }) {
            validateString(pattern);
            return { pattern };
        }
    },

    trim: function ({ srcField }, data) {
        data = getDeepValue(data, srcField);
        return data && data.trim() || null;
    },

    formNumberToID: async function ({ srcField, processID }, data) {
        assert(processID > 0);
        const srcValue = getDeepValue(data, srcField);
        return srcValue ? { ID: (await this.api.demandForm(processID, srcValue)).Form.FormID } : getEmpty();
    },

    arrayFind: {
        convert: async function ({ srcField, keyProperty, keyValue, resultProperty }, data) {
            const srcArray = getDeepValue(data, srcField);
            assert(Array.isArray(srcArray));
            let result = srcArray.find(e => e[keyProperty] === keyValue);
            if (result && resultProperty) {
                result = result[resultProperty];
            }
            return result || null;
        },
        init: async function ({ resultProperty, keyProperty, keyValue }) {
            console.warn('"arrayFind" setter is deprecated. Use converters instead');
            validateString(keyProperty);
            resultProperty = resultProperty ? validateString(resultProperty) : undefined;
            return { resultProperty, keyProperty, keyValue };
        }
    },

    dictionary: {
        convert: async function (config, data) {
            const { srcField, pattern, keyColumns, view, process, valueColumn, demand } = config;
            const srcValue = getDeepValue(data, srcField);
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
                keys = [srcValue + ''];
            }
            const l = keyColumns.length;
            if (keys.length < l) {
                throwFieldError(config, `${l} key(s) expected. [${keys.join(',')}]`);
            }
            let forms = await this.api.getForms(process, view);
            const columns = forms.Columns;
            const keyIdx = [];
            keyColumns.forEach(c => {
                const idx = validateIndex(columns, c);
                if (keyIdx.indexOf(idx) >= 0) {
                    throw new Error('Duplicate key index: ' + c);
                }
                keyIdx.push(idx);
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
            console.warn('"dictionary" setter is deprecated. Use converters instead');
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
    },

    staff: {
        convert: async function (conf, data) {
            const api = this.api || this;
            const { srcField, demand } = conf;
            const name = getDeepValue(data, srcField);
            if (!name) {
                return null;
            }
            let result = (await api.getStaffList()).StaffList.find(({ Name }) => Name === name)
                || demand && throwFieldError(conf, `Staff member "${name}" does not exist`);
            return result ? { ID: result.ID, Value: result.Name } : null;
        },
        init: async function ({ demand }) {
            console.warn('"staff" setter is deprecated. Use converters instead');
            demand = toBoolean(demand) || undefined;
            return { demand };
        }
    }

};

COMMON_SETTERS[DEFAULT_ACCESSOR_NAME] = {
    init: function ({ defaultValue, skipEmpty }) {
        skipEmpty = toBoolean(skipEmpty) || undefined;
        return { defaultValue, skipEmpty };
    },
    convert: function ({ srcField, defaultValue, skipEmpty }, data) {
        const result = getDeepValue(data, srcField);
        return isEmptyValue(result) ? (skipEmpty ? undefined : (defaultValue === undefined ? null : defaultValue)) : result;
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

add('Duration',
    function ({ srcField, unit }, data) {
        let v = getDeepValue(data, srcField);
        isEmptyValue(v) && (v = null);
        return (v !== null && unit) ? `${v} ${unit}` : v;
    },
    function ({ unit }) {
        unit = unit ? validateString(unit) : undefined;
        return { unit };
    }
);

add('FieldTableDefinedRow',
    async function ({ srcField, dstField, tableRows, tableFields }, data, form) {
        data = getDeepValue(data, srcField) || {};
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
        data = getDeepValue(data, config.srcField);
        if (!data) {
            return;
        }

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
    async function ({
        srcField, dstField, dstKeyField, tableFields, createRows, srcKeyProperty
    }, data, form) {
        srcField === null || (data = getDeepValue(data, srcField));
        if (!data || srcKeyProperty && isEmpty(data)) {
            return;
        }
        assert.strictEqual(typeof data, 'object', 'Object is expected');
        let existingRows = form ? getField.call(form.Form || form, dstField, true)
            .Rows.filter(r => !r.IsDefinition && !r.IsLabelRow) : [];
        let getExistingRow;
        if (!srcKeyProperty) {
            getExistingRow = () => existingRows.shift();
        } else if (dstKeyField) {
            const prop = dstKeyField.IsReference ? 'ID' : 'Value';
            const existingKeyed = {};
            getExistingRow = srcKeyValue => {
                if (isEmptyValue(srcKeyValue)) {
                    return;
                }
                let a = existingKeyed[srcKeyValue];
                if (!a) {
                    a = existingKeyed[srcKeyValue] = [];
                    existingRows = existingRows.filter(r => {
                        const key = getFieldByUid.call(r, dstKeyField.Uid, true).Values[0];
                        if (key && srcKeyValue === key[prop]) {
                            a.push(r);
                            return false;
                        }
                        return true;
                    });
                }
                return a.shift();
            }
        } else {
            getExistingRow = rowID => {
                const key = +rowID;
                if (isNaN(key)) {
                    throw 'Numeric key is required: ' + rowID;
                }
                const idx = existingRows.findIndex(r => key === r.RowID);
                return idx < 0 ? undefined : existingRows.splice(idx, 1)[0];
            }
        }

        let Rows = [];
        let errors = [];
        let rownum = 0;


        const createDstRow = async (srcRow, existingRow) => {
            const Fields = [];
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
                Fields.push({ Values: [fieldPatch], Uid: tabFieldConf.dstUid });
            }
            return { RowID: existingRow && existingRow.RowID || 0, Fields };
        }

        const later = {};
        for (let k in data) {
            const srcRow = data[k];
            srcKeyProperty && (k = demandDeepValue(srcRow, srcKeyProperty));
            const existingRow = getExistingRow(k);
            if (existingRow) {
                Rows.push(await createDstRow(srcRow, existingRow))
            } else if (createRows) {
                const a = later[k] || (later[k] = []);
                a.push(srcRow);
            }
        }

        for (const k in later) {
            let keyFieldPatch;
            if (dstKeyField) {
                keyFieldPatch = {};
                if (dstKeyField.IsReference) {
                    keyFieldPatch.ID = normalizeInteger(k);
                } else {
                    keyFieldPatch.Value = k;
                }
                keyFieldPatch = { Values: [keyFieldPatch], Uid: dstKeyField.Uid };
            }
            for (let srcRow of later[k]) {
                const row = await createDstRow(srcRow, existingRows.shift());
                Rows.push(row);
                const { Fields } = row;
                dstKeyField && !Fields.find(({ Uid }) => Uid === dstKeyField.Uid) && Fields.push(keyFieldPatch);
            }
        }

        if (srcKeyProperty) {
            Rows = Rows.concat(existingRows.map(({ RowID }) => ({ RowID, Fields: [] })));
        }

        return { Rows, Errors: errors.length > 0 ? errors : undefined };
    }, initTableFields
);

async function initTableFields({
    tableFields: srcTableFields, key, createRows, srcKeyProperty, dstKeyField
}, rpmField) {
    assert(!key, '"key" property is obsolete. Use "dstKeyField" instead')
    const defRow = rpmField.Rows.find(row => row.IsDefinition);
    assert(defRow, 'No definition row');
    const tableFields = [];

    srcKeyProperty = srcKeyProperty ? validatePropertyConfig(srcKeyProperty) : undefined;

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
    if (dstKeyField || (dstKeyField = undefined)) {
        dstKeyField = getField.call(defRow, validateString(dstKeyField));
        dstKeyField = { Uid: dstKeyField.Uid, IsReference: isReferenceField(dstKeyField) };
    }
    createRows = createRows === undefined ? !srcKeyProperty : toBoolean(createRows);
    return { tableFields, dstKeyField, createRows, srcKeyProperty };
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
    data = getDeepValue(data, config.srcField);
    data && config.normalize && (data = toMoment(config, data).format(ISO_DATE_FORMAT));
    return { Value: data || null };
});

add('DateTime', function (config, data) {
    data = getDeepValue(data, config.srcField);
    data && config.normalize && (data = toMoment(config, data).format(ISO_DATE_TIME_FORMAT));
    return { Value: data || null };
});

add('YesNo', function ({ srcField, normalize }, data) {
    data = getDeepValue(data, srcField);
    if (normalize) {
        data = (data === undefined || data === null) ? null : (toBoolean(data) ? 'Yes' : 'No');
    }
    return { Value: data };
});

const getEmpty = () => ({ Value: null, ID: 0 });

add('List', function (config, data) {
    const { srcField, demand, options, defaultValue } = config;
    let value = getDeepValue(data, srcField);
    isEmptyValue(value) && (value = defaultValue);
    if (isEmptyValue(value)) {
        return getEmpty();
    }
    let option = options.find(o => o.Text === value);
    return option ? { Value: option.Text, ID: option.ID } : (demand ?
        Object.assign({ Errors: getErrorMessage(config, 'Unknown value: ' + value) }, getEmpty()) :
        { Value: value }
    );
}, async function ({ demand, defaultValue }, rpmField) {
    demand = toBoolean(demand) || undefined;
    let { Options: options } = rpmField;
    assert(options);
    options = options
        .filter(({ IsHidden, IsLabel }) => !IsHidden && !IsLabel)
        .map(({ Text, ID }) => ({ Text, ID }));
    return { options, demand, defaultValue };
});

add('ListMultiSelect', function (config, data) {
    const { srcField, defaultValue, isTableField } = config;
    assert(!isTableField);
    let value = getDeepValue(data, srcField);
    isEmptyValue(value) && (value = defaultValue);
    Array.isArray(value) && (value = value.join(','));
    return isEmptyValue(value) ? getEmpty() : value;
}, async function ({ demand, defaultValue }, rpmField) {
    demand = toBoolean(demand) || undefined;
    let { Options: options } = rpmField;
    assert(options);
    options = options
        .filter(({ IsHidden, IsLabel }) => !IsHidden && !IsLabel)
        .map(({ Text, ID }) => ({ Text, ID }));
    return { defaultValue, options, demand };
});

fieldType = ObjectType.FormReference;
subTypes = ObjectType;

add('Customer',
    async function (config, data) {
        const api = this.api || this;
        const { srcField, demand, create } = config;
        const name = getDeepValue(data, srcField);
        if (!name) {
            return null;
        }
        const result = await api.getCustomer(name) ||
            create && await api.createCustomer(name) ||
            demand && throwFieldError(config, `Customer "${name}" does not exist`);
        return result ? { ID: result.CustomerID, Value: result.Name } : null;
    },
    async function ({ demand, create }) {
        demand = toBoolean(demand) || undefined;
        create = toBoolean(create) || undefined;
        return { demand, create };
    }
);

add('AgentCompany',
    async function (config, data) {
        const api = this.api || this;
        const { srcField, demand, create } = config;
        const name = getDeepValue(data, srcField);
        if (!name) {
            return null;
        }
        const result = await api.getAgency(name) ||
            create && await api.createAgency(name) ||
            demand && throwFieldError(config, `Agency "${name}" does not exist`);
        return result ? { ID: result.AgencyID, Value: result.Agency } : null;
    },
    async function ({ demand, create }) {
        demand = toBoolean(demand) || undefined;
        create = toBoolean(create) || undefined;
        return { demand, create };
    }
);

add('AgentCompany', 'fromRep',
    async function (config, data) {
        const api = this.api || this;
        const { srcField, demand } = config;
        const name = getDeepValue(data, srcField);
        if (!name) {
            return null;
        }
        const result = (await api.getAgentUsers()).AgentUsers.find(({ Name }) => Name === name) ||
            demand && throwFieldError(config, `Rep "${name}" does not exist`)
        return result ? { ID: result.AgencyID, Value: result.Agency } : null;
    },
    async function ({ demand }) {
        demand = toBoolean(demand) || undefined;
        return { demand };
    }
);

add('AgentCompany', 'demand', async function (config, data) {
    const api = this.api || this;
    let name = data[config.srcField];
    // if (agency === undefined) return;
    if (!name) return null;
    const agency = await api.getAgency(name);
    if (!agency) throwFieldError(config, `Agency "${name}" does not exist`)
    return { ID: agency.AgencyID, Value: agency.Agency };
}, function () {
    console.warn('"AgentCompany.demand" setter is deprecated. Use converters instead');
    return {};
});


add('AgentRep',
    async function (config, data) {
        const api = this.api || this;
        const { srcField, demand } = config;
        const name = getDeepValue(data, srcField);
        if (!name) {
            return null;
        }
        const result = (await api.getAgentUsers()).AgentUsers.find(({ Name }) => Name === name) ||
            demand && throwFieldError(config, `Rep "${name}" does not exist`);
        return result ? { ID: result.RepID, Value: result.Name } : null;
    },
    async function ({ demand }) {
        demand = toBoolean(demand) || undefined;
        return { demand };
    }
);

add('AgentRep', 'agencyManager',
    async function (config, data) {
        const api = this.api || this;
        const { srcField } = config;
        const name = getDeepValue(data, srcField);
        if (!name) {
            return null;
        }
        const { AgentUsers } = await api.getAgentUsers();
        const result = AgentUsers.find(({ Agency, Type }) => Type === RepTypes.Both && Agency === name);
        return result ? { ID: result.RepID, Value: result.Name } : null;
    }
);

add('CustomerAccount',
    async function (config, data) {
        const api = this.api || this;
        let { demand, create, srcField } = config;
        const name = getDeepValue(data, srcField);
        if (!name) {
            return null;
        }
        const extract = prop => {
            const property = config[prop];
            const value = getDeepValue(data, property);
            if (!value) {
                throwFieldError(config, `"${property}" is required for Account`);
            }
            return value;
        }
        const customer = extract('customer');
        const supplier = extract('supplier');
        const result = await api.getAccount(name, supplier) ||
            create && await api.createAccount(name, customer, supplier) ||
            demand && throwFieldError(config, `Account "${name}" does not exist`);
        result && (result.Customer === customer || throwFieldError(config, `Expected account customer "${customer}"`));
        return result ? { ID: result.AccountID, Value: result.Account } : null;
    },
    function ({ customer, supplier, create, demand }) {
        validateString(customer);
        validateString(supplier);
        demand = toBoolean(demand) || undefined;
        create = toBoolean(create) || undefined;
        return { demand, create, customer, supplier };
    }
);

add('RestrictedReference',
    async function (conf, data) {
        const { isTableField, forceNumber } = conf;
        data = getObjectValue(conf, data);
        if (!data) {
            return getEmpty();
        }
        if (typeof data === 'number') {
            if (isTableField) {
                return { ID: data };
            }
            if (forceNumber) {
                return data + '';
            }
            data = await this.api.demandForm(data);
            data = data.Form.Number;
        }
        return data;
    },
    function ({ forceNumber }) {
        forceNumber = toBoolean(forceNumber) || undefined;
        return { forceNumber };
    }
);

add('RestrictedReference', 'title2reference', async function (conf, data) {
    data = getObjectValue(conf, data);
    if (data) {
        assert.strictEqual(typeof data, 'string');
        data = (await this.api.getFormList(conf.processID, true)).Forms.find(({ T }) => T === data);
    }
    return data ? { ID: data.ID, Value: data.N } : getEmpty();
});

async function defaultBasicReference({ srcField, isTableField }, data) {
    data = getDeepValue(data, srcField) || (isTableField ? 0 : null);
    return isTableField ? { ID: data } : data;
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

async function initField(conf, rpmField) {
    const key = getFullType(rpmField);
    let gen = SPECIFIC_SETTERS[key] || COMMON_SETTERS;
    (typeof conf === 'string' || Array.isArray(conf)) && (conf = { srcField: conf });
    let { setter, condition, srcField, normalize, regexp } = conf;
    setter || (setter = DEFAULT_ACCESSOR_NAME);
    const { init } = gen[setter] || getEager(COMMON_SETTERS, setter);
    conf = init ? await init.call(this, conf, rpmField) : {};
    assert.strictEqual(typeof conf, 'object');
    conf.normalize = normalize === undefined || toBoolean(normalize);
    conf.setter = setter || undefined;
    if (srcField === undefined) {
        srcField = rpmField.Name;
    } else if (Array.isArray(srcField)) {
        assert(srcField.length > 0);
    }
    toArray(srcField).forEach(p => typeof p === 'object' || validateString(p));
    conf.srcField = srcField;
    conf.regexp = regexp ? validateString(regexp) : undefined;
    conf.type = key;
    conf.dstUid = validateString(rpmField.Uid);
    conf.dstField = validateString(rpmField.Name);
    conf.processID = rpmField.ProcessID;
    if (condition && !isTableField(rpmField)) {
        conf.condition = initCondition(condition);
    }
    return conf;
}

async function initValue(conf) {
    let { setter, srcField, normalize, regexp } = conf;
    setter || (setter = DEFAULT_ACCESSOR_NAME);
    const { init: initGen } = getEager(COMMON_SETTERS, setter);
    const result = initGen ? await initGen.call(this, conf) : {};
    assert.strictEqual(typeof result, 'object');
    if (srcField !== undefined) {
        Array.isArray(srcField) && assert(srcField.length > 0);
        toArray(srcField).forEach(p => typeof p === 'object' || validateString(p));
        result.srcField = srcField;
    }
    result.normalize = normalize === undefined || toBoolean(normalize);
    result.setter = setter;
    conf.regexp = regexp ? validateString(regexp) : undefined;
    return result;
}

function getSetter({ type, setter }) {
    return ((SPECIFIC_SETTERS[type] || COMMON_SETTERS)[setter] || COMMON_SETTERS[setter]).convert;
}

async function setField(conf, data, form) {
    const setter = getSetter(conf);
    let result;
    let { condition, valueIsId } = conf;
    if (condition && !processCondition(condition, data)) {
        return;
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
    result instanceof Date && (result = result.toISOString());
    return (result !== null && typeof result === 'object') ? result : (valueIsId ?
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

async function initMultiple(inFieldMap, fields) {
    const result = [];
    const init = fields === undefined ? initValue : initField;
    for (const dstField in inFieldMap) {
        result.push(await init.call(this, inFieldMap[dstField], fields && fields.getField(dstField, true)));
    }
    return result;
}

module.exports = { initField, set, initValue, initMultiple };