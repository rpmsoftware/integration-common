const assert = require('assert');
const { validateString, toArray, getEager, isEmpty } = require('../util');
const { DEFAULT_ACCESSOR_NAME, getFullType } = require('./common');
const {
    getField,
    getFieldByUid,
    validateProcessReference
} = require('../api-wrappers');

const {
    FieldSubType,
    ObjectType,
    RefSubType
} = require('../api-enums');

const dummy = () => { };

const COMMON_GETTERS = {
    none: {
        get: dummy,
        init: dummy
    },

    getID: function (config, form) {
        form = form.Form || form;
        return getFieldByUid.call(form, config.srcUid, true).ID;
    },

    getFormNumber: {
        get: function (config, form) {
            return (form.Form || form).Number;
        },
        init: function (conf) {
            return conf;
        }
    },

    getFormOwner: {
        get: async function (config, form) {
            form = form.Form || form;
            const staff = (await this.api.getStaffList()).StaffList.demand(s => s.Name === form.Owner);
            return await this.api.getStaff(staff.ID);
        },
        init: function (conf) {
            return conf;
        }
    },

    getIfField: {
        get: function (config, form) {
            form = form.Form || form;
            const ifValue = form.getFieldByUid(config.ifUid, true).Value;
            return config.ifValues.find(v => v === ifValue) ? form.getFieldByUid(config.srcUid, true).Value : undefined;
        },
        init: function (conf, rpmField, rpmFields) {
            conf.srcUid = rpmField.Uid;
            conf.ifUid = rpmFields.getField(validateString(conf.ifField), true).Uid;
            validateString(conf.ifField);
            const values = toArray(conf.ifValues);
            assert(values.length > 0, 'No values');
            conf.ifValues = values;
            return conf;
        }
    },

    getDeep: {
        get: async function (config, form) {
            form = form.Form || form;
            for (let f of config.fieldPath) {
                form = form.getFieldByUid(f.uid, true).ID;
                if (!form) {
                    return null;
                }
                form = await this.api.demandForm(form);
                form = form.Form;
            }
            return get.call(this, config.targetField, form);
        },
        init: async function (conf, rpmField, rpmFields) {
            const targetField = conf.fieldPath.pop();
            const fieldPath = [];
            for (let f of conf.fieldPath) {
                f = getField.call(rpmFields, validateString(f), true);
                validateProcessReference(f);
                fieldPath.push({ name: f.Name, uid: f.Uid });
                rpmFields = await this.api.getFields(f.ProcessID);
            }
            conf.targetField = await init.call(this, targetField, rpmFields);
            conf.fieldPath = fieldPath;
            if (!conf.srcField) {
                conf.srcField = fieldPath[0].name;
            }
            return conf;
        }
    }
};


for (let name in COMMON_GETTERS) {
    const get = COMMON_GETTERS[name];
    const type = typeof get;
    if (type === 'object') {
        assert.equal(typeof get.get, 'function');
    } else {
        assert.equal(type, 'function');
        COMMON_GETTERS[name] = { get };
    }
}

function addCommon(name, get, init) {
    validateString(name);
    assert(!COMMON_GETTERS[name], `Getter already exists: "${name}"`);
    COMMON_GETTERS[name] = { get, init };
}

const SPECIFIC_GETTERS = {};

let fieldType;
let subTypes;

function add(subtype, name, get, init) {
    if (typeof name === 'function') {
        init = get;
        get = name;
        name = DEFAULT_ACCESSOR_NAME;
    }
    const fullType = getFullType(fieldType, getEager(subTypes, subtype));
    let accs = SPECIFIC_GETTERS[fullType];
    if (!accs) {
        accs = SPECIFIC_GETTERS[fullType] = {};
    }
    if (init) {
        assert.equal(typeof init, 'function');
    }
    assert.equal(typeof get, 'function');
    init = init || undefined;
    return accs[name] = { get, init };
}

fieldType = ObjectType.CustomField;
subTypes = FieldSubType;

const REGEX_PERCENTS = /^(\d+(\.\d+)?)%$/;

add('Percent', function (conf, form) {
    const srcField = getFieldByUid.call(form.Form || form, conf.srcUid, true);
    const value = srcField.Value;
    if (!value) {
        return null;
    }
    let result = +value;
    if (isNaN(result)) {
        assert(!conf.isTableField, `Non-table field expected: ${JSON.stringify(srcField)}`);
        result = REGEX_PERCENTS.exec(value);
        assert(result, `Unknown percentage format: ${JSON.stringify(srcField)}`);
        result = +result[1] / 100;
    }
    assert(!isNaN(result), 'Number expected: ' + result);
    return conf.isTableField ? result / 100 : result;
});

add('FieldTableDefinedRow', async function (conf, form) {
    const srcRows = (form.Form || form).getFieldByUid(conf.srcUid, true).Rows.filter(r => !r.IsDefinition && !r.IsLabelRow);
    const result = {};
    for (let rowConf of conf.tableRows) {
        const srcRow = srcRows.find(r => r.TemplateDefinedRowID === rowConf.id);
        assert(srcRow, 'Cannot find form row with TemplateDefinedRowID=' + rowConf.id);
        const resultRow = {};
        for (let fieldConf of conf.tableFields) {
            resultRow[fieldConf.srcField] = await get.call(this, fieldConf, {
                Fields: srcRow.Fields.map(fld => {
                    fld = Object.assign({}, fld);
                    const val = fld.Values[0];
                    delete fld.Values;
                    if (val) {
                        assert.equal(typeof val, 'object');
                        Object.assign(fld, val);
                    } else {
                        fld.Value = null;
                    }
                    return fld;
                })
            });
        }
        result[rowConf.name] = resultRow;
    }
    return result;

}, async function (conf, rpmField) {
    conf = await initTableFields.call(this, conf, rpmField);
    conf.tableRows = rpmField.Rows.filter(r => !r.IsDefinition && !r.IsLabelRow).map(r => ({ id: r.ID, name: r.Name }));
    return conf;
});



async function initTableFields(config, rpmField) {
    const defRow = rpmField.Rows.find(row => row.IsDefinition);
    assert(defRow, 'No definition row');

    let tableFields = config.tableFields;
    tableFields = Array.isArray(tableFields) ? tableFields.map(c => typeof c === 'object' ? c : { srcField: c + '' }) : [];

    config.tableFields = [];
    const rpmTableFields = defRow.Fields;
    for (let tabField of rpmTableFields) {
        let tabFieldConf = tableFields.find(fc => fc.srcField === tabField.Name);
        if (!tabFieldConf) {
            if (config.selectedFieldsOnly) {
                continue;
            }
            tabFieldConf = {};
        }
        tabFieldConf = await initField.call(this, tabFieldConf, tabField, rpmTableFields);
        validateString(tabFieldConf.srcField);
        tabFieldConf.isTableField = true;
        config.tableFields.push(tabFieldConf);
    }
    config.keyRowID = !!config.keyRowID;
    if (config.key) {
        validateString(config.key);
        assert(config.tableFields.find(c => c.srcField === config.key), `No key field "${config.key}"`);
    } else {
        config.key = undefined;
    }
    return config;
}

add('FieldTable', async function (conf, form) {
    const srcField = (form.Form || form).getFieldByUid(conf.srcUid, true);
    let srcRows = srcField.Rows.filter(r => !r.IsDefinition && !r.IsLabelRow);
    const filter = srcField.filter;
    if (typeof filter === 'function') {
        srcRows = srcRows.filter(filter);
    }

    const result = conf.key || conf.keyRowID ? {} : [];
    for (let srcRow of srcRows) {
        const resultRow = {};
        const tableForm = {
            Fields: srcRow.Fields.map(fld => {
                fld = Object.assign({}, fld);
                const val = fld.Values[0];
                delete fld.Values;
                if (val) {
                    assert.equal(typeof val, 'object');
                    Object.assign(fld, val);
                } else {
                    fld.Value = null;
                }
                return fld;
            })
        };
        for (let fieldConf of conf.tableFields) {
            resultRow[fieldConf.srcField] = await get.call(this, fieldConf, tableForm);
        }
        if (conf.key) {
            result[getEager(resultRow, conf.key)] = resultRow;
        } else if (conf.keyRowID) {
            result[srcRow.RowID] = resultRow;
        } else {
            result.push(resultRow);
        }
    }
    return result;
}, initTableFields);


fieldType = ObjectType.FormReference;
subTypes = RefSubType;

add('RestrictedReference', 'getNumber', async function (config, form) {
    form = form.Form || form;
    let dst = getFieldByUid.call(form, config.srcUid, true).ID;
    if (!dst) {
        return null;
    }
    dst = await this.api.demandForm(dst);
    return dst.Form.Number;
});

add('RestrictedReference', 'getID', function (config, form) {
    form = form.Form || form;
    return getFieldByUid.call(form, config.srcUid, true).ID;
});

const FORM_PROPERTY_GETTERS = {
    _number: 'Number',
};
for (let prop in FORM_PROPERTY_GETTERS) {
    const propertyGetter = FORM_PROPERTY_GETTERS[prop];
    if (typeof propertyGetter === 'string') {
        FORM_PROPERTY_GETTERS[prop] = form => (form.Form || form)[propertyGetter];
    }
}

add('RestrictedReference', 'getReferencedObject', async function (getterConfig, form) {
    form = form.Form || form;
    let targetForm = getFieldByUid.call(form, getterConfig.srcUid, true).ID;
    if (!targetForm) {
        return;
    }
    targetForm = await this.api.demandForm(targetForm);
    const result = {};
    for (let dstProp in getterConfig.fieldMap) {
        const getterConf = getterConfig.fieldMap[dstProp];
        result[dstProp] = await (typeof getterConf === 'string' ?
            getEager(FORM_PROPERTY_GETTERS, getterConf)(targetForm) :
            get.call(this, getterConf, targetForm)
        );
    }
    return result;
}, async function (config, rpmField) {
    const refFormFields = await this.api.getFields(rpmField.ProcessID);
    const fieldMap = {};
    const array = Array.isArray(config.fields);
    for (let dstProp in config.fields) {
        let resultFieldConf = config.fields[dstProp];
        if (typeof resultFieldConf === 'string' && FORM_PROPERTY_GETTERS[resultFieldConf]) {
            if (array) {
                dstProp = resultFieldConf;
            }
        } else {
            resultFieldConf = await init.call(this, resultFieldConf, refFormFields);
            if (array) {
                dstProp = resultFieldConf.srcField;
            }
        }
        assert(!fieldMap[dstProp], `Duplicate destination "${dstProp}"`);
        fieldMap[dstProp] = resultFieldConf;
    }
    assert(!isEmpty(fieldMap));
    return { fieldMap };
});

add('CustomerLocation', 'getReferencedObject', async function (config, form) {
    form = form.Form || form;
    const locationID = getFieldByUid.call(form, config.srcUid, true).ID;
    if (!locationID) {
        return;
    }
    const customerID = getFieldByUid.call(form, config.parentField.uid, true).ID;
    const customer = await this.api.demandCustomer(customerID);
    const location = customer.Locations.demand(l => l.LocationID === locationID);
    let result;
    if (config.fieldMap) {
        result = {};
        for (let dst in config.fieldMap) {
            result[dst] = location[config.fieldMap[dst]];
        }
    } else {
        result = location;
    }
    return result;

}, async function (config, rpmField, rpmFields) {
    const parentField = rpmFields.demand(f => f.Uid === rpmField.ParentUid);
    let fieldMap;
    if (config && config.fields) {
        assert.equal(typeof config.fields, 'object');
        if (Array.isArray(config.fields)) {
            fieldMap = {};
            for (let src of config.fields) {
                fieldMap[src] = validateString(src);
            }
        } else {
            fieldMap = config.fields;
        }
    }
    return {
        parentField: {
            name: parentField.Name,
            uid: parentField.Uid
        },
        fieldMap
    }
});

const DEFAULT_GETTER = {
    get: function (config, form) {
        form = form.Form || form;
        return getFieldByUid.call(form, config.srcUid, true).Value;
    }
};

async function init(conf, rpmFields) {
    if (typeof conf === 'string') {
        conf = { srcField: conf };
    }
    let rpmField;
    if (conf.srcField) {
        rpmField = getField.call(rpmFields, validateString(conf.srcField), true);
    }
    return initField.call(this, conf, rpmField, rpmFields);
}


async function initField(conf, rpmField, rpmFields) {
    let type;
    if (rpmField) {
        type = getFullType(rpmField);
    }
    const getters = rpmField && SPECIFIC_GETTERS[type] || COMMON_GETTERS;
    const getterName = conf.getter;
    let getter;
    if (getterName) {
        getter = getters[getterName];
        if (!getter) {
            throw new Error('Unknown getter: ' + JSON.stringify(conf));
        }
    } else {
        getter = getters[DEFAULT_ACCESSOR_NAME] || DEFAULT_GETTER;
    }
    if (getter.init) {
        const newConf = await getter.init.call(this, conf, rpmField, rpmFields);
        conf = newConf || conf;
    } else {
        assert(rpmField, 'Source field required');
    }
    if (rpmField) {
        conf.srcType = type;
        conf.srcField = rpmField.Name;
        conf.srcUid = rpmField.Uid;
    }
    if (getterName) {
        conf.getter = getterName;
    } else {
        delete conf.getter;
    }
    return conf;
}

function findGetter(fieldConfig) {
    const getters = fieldConfig.srcType && SPECIFIC_GETTERS[fieldConfig.srcType] || COMMON_GETTERS;
    const name = fieldConfig.getter || DEFAULT_ACCESSOR_NAME;
    const result = getters[name] || COMMON_GETTERS[name] || DEFAULT_GETTER;
    return result.get;
}

function get(conf, form) {
    return findGetter(conf).call(this, conf, form);
}

Object.assign(exports, { get, init, addCommon });
