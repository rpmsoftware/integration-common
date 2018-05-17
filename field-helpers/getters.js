const assert = require('assert');
const rpmUtil = require('../util');
const rpm = require('../api-wrappers');
const common = require('./common');

const COMMON_GETTERS = {
    getID: function (config, form) {
        form = form.Form || form;
        return rpm.getFieldByUid.call(form, config.srcUid, true).ID;
    },

    getFormNumber: {
        get: function (config, form) {
            return (form.Form || form).Number;
        },
        init: function (conf) {
            return conf;
        }
    },
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

const SPECIFIC_GETTERS = {};

let fieldType;
let subTypes;

function add(subtype, name, get, init) {
    if (typeof name === 'function') {
        init = get;
        get = name;
        name = common.DEFAULT_ACCESSOR_NAME;
    }
    const fullType = common.getFullType(fieldType, rpmUtil.getEager(subTypes, subtype));
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

fieldType = rpm.OBJECT_TYPE.CustomField;
subTypes = rpm.DATA_TYPE;

add('FieldTableDefinedRow', function (conf, form) {
    const srcRows = (form.Form || form).getFieldByUid(conf.srcUid, true).Rows.filter(r => !r.IsDefinition && !r.IsLabelRow);
    console.log('ROWS: %j', srcRows)
    // TemplateDefinedRowID
    const result = {};
    for (let dr of conf.tableRows) {
        const r = srcRows.find(r => r.TemplateDefinedRowID = dr.id);
        assert(r, 'Cannot find form row with TemplateDefinedRowID=' + dr.id);
        const frm = {
            Fields:r.Fields.map(ff=>{
                ff=
            });
        };
        for (let df of conf.tableFields) {
            let ff = Object.assign({}, rpm.getFieldByUid.call(r, df.srcUid, true));
            Object.assign(ff, ff.Values[0]);
            delete ff.Values;

        }

    }
    return result;

}, async function (conf, rpmField) {
    conf.srcUid = rpmField.Uid;
    const defRow = rpmField.Rows.find(row => row.IsDefinition);
    assert(defRow, 'No definition row');
    conf.tableFields = [];
    for (let tabField of defRow.Fields) {
        conf.tableFields.push(await initField.call(this, {}, tabField));
    }
    conf.tableRows = rpmField.Rows.filter(r => !r.IsDefinition && !r.IsLabelRow).map(r => ({ id: r.ID, name: r.Name }));
    return conf;
});

const DEFAULT_GETTER = {
    get: function (config, form) {
        form = form.Form || form;
        return rpm.getFieldByUid.call(form, config.srcUid, true).Value;
    }
};

async function init(conf, rpmFields) {
    let rpmField;
    if (conf.srcField) {
        rpmField = rpmFields.getField(rpmUtil.validateString(conf.srcField), true);
    }
    return initField.call(this, conf, rpmField);
}


async function initField(conf, rpmField) {
    let type;
    if (rpmField) {
        type = common.getFullType(rpmField);
    }
    const getters = rpmField && SPECIFIC_GETTERS[type] || COMMON_GETTERS;
    const getterName = conf.getter;
    let getter;
    if (getterName) {
        getter = getters[getterName];
        if (!getter) {
            throw new Error('Unknown RPM value generator: ' + JSON.stringify(conf));
        }
    } else {
        getter = getters[common.DEFAULT_ACCESSOR_NAME] || DEFAULT_GETTER;
    }
    if (getter.init) {
        const newConf = await getter.init.call(this, conf, rpmField);
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
    const name = fieldConfig.getter || common.DEFAULT_ACCESSOR_NAME;
    const result = getters[name] || COMMON_GETTERS[name] || DEFAULT_GETTER;
    return result.get;
}

function get(conf, form) {
    return findGetter(conf).call(this, conf, form);
}

Object.assign(exports, { get, init });
