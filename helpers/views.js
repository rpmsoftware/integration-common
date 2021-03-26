const assert = require('assert');
const { validateString, getEager, normalizeInteger, toBoolean } = require('../util');
const { StaticViewColumnUids } = require('../api-enums');

const CONVERTERS = {
    number: value => {
        const result = +value;
        assert(!isNaN(result), value);
        return result;
    },
    boolean: value => toBoolean(value)
}

exports.init = async function ({ process, view, fieldMap }) {
    const api = this;
    typeof process === 'number' || (process = (await api.getProcesses()).getActiveProcess(process, true).ProcessID);
    let [fields, views] = await Promise.all([api.getFields(process), view ? api.getProcessViews(process) : undefined]);
    view = view ? views.Views.demand(({ Name }) => Name === view).ID : undefined;
    fieldMap = Object.assign({}, fieldMap);
    for (const dstProperty in fieldMap) {
        let cfg = fieldMap[dstProperty];
        const cfgType = typeof cfg;
        if (cfgType === 'number') {
            cfg = { index: cfg };
        } else if (cfgType === 'string') {
            cfg = { field: cfg };
        }
        let { index, name, uid, field, pattern, type } = cfg;
        const columnConf =
            field !== undefined && { uid: fields.getField(field, true).Uid } ||
            uid !== undefined && { uid: getEager(StaticViewColumnUids, uid) } ||
            index !== undefined && { index: normalizeInteger(index) } ||
            { name: validateString(name) };
        columnConf.pattern = pattern ? validateString(pattern) : undefined;
        type && getEager(CONVERTERS, validateString(type));
        columnConf.type = type || undefined;
        fieldMap[dstProperty] = columnConf;
    }
    return { process, view, fieldMap };
};

exports.getForms = async function ({ process, view, fieldMap }) {
    const api = this;
    const { Columns, ColumnUids, Forms } = await api.getForms(process, view);
    const indices = {};
    if (Forms.length > 0) {
        const { length } = Columns;
        assert.strictEqual(ColumnUids.length, length);
        const duplicates = {};
        for (let dstProperty in fieldMap) {
            const cfg = fieldMap[dstProperty];
            let { uid, index, name, pattern, type: convert } = cfg;
            convert = convert ? getEager(CONVERTERS, convert) : undefined;
            !pattern || pattern instanceof RegExp || (pattern = cfg.pattern = new RegExp(pattern));
            let idx;
            if (uid) {
                idx = ColumnUids.demandIndexOf(uid);
            } else if (index !== undefined) {
                assert(index >= 0 && index < length);
                idx = index;
            } else {
                idx = Columns.demandIndexOf(name);
            }
            assert(!duplicates[idx]);
            indices[dstProperty] = { index: idx, pattern, convert };
            duplicates[idx] = true;
        }
    }
    return Forms.map(({ FormID, Values }) => {
        const result = {};
        for (let dstProperty in indices) {
            const { index, pattern, convert } = indices[dstProperty];
            let value = Values[index];
            if (value && pattern) {
                value = pattern.exec(value);
                value = value && value[1];
            } else if (value && convert) {
                value = convert(value);
            }
            result[dstProperty] = value || undefined;
        }
        result.FormID = FormID;
        return result;
    });
};
