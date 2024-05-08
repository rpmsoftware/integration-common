const assert = require('assert');
const { toArray, validateString, validatePropertyConfig, getDeepValue, toBoolean } = require('../../../util');
const { initMultiple: initGetters, getMultiple } = require('../../getters');

exports.convert = async function ({ process, fieldMap, srcProperty, dstProperty, merge }, obj) {
    const { api } = this;
    for (const e of toArray(obj)) {
        let form = getDeepValue(e, srcProperty);
        if (!form) {
            continue;
        }
        switch (typeof form) {
            case 'number':
                form = await api.getForm(form);
                break;
            case 'string':
                form = await api.getForm(process, form);
                break;
            case 'object':
                break;
            default:
                assert.fail();
        }
        if (!form) {
            dstProperty && (delete obj[dstProperty]);
            continue;
        }
        form = form.Form || form;
        assert.strictEqual(process, form.ProcessID);
        const r = await getMultiple.call(this, fieldMap, form);
        merge ? Object.assign(e, r) : (e[dstProperty] = r);
    }
    return obj;
};

exports.init = async function ({ process, fieldMap, srcProperty, dstProperty, merge }) {
    merge = toBoolean(merge) || undefined;
    dstProperty = merge ? undefined : validateString(dstProperty || srcProperty);
    srcProperty = validatePropertyConfig(srcProperty);
    const processes = await this.api.getProcesses();
    const fields = await processes.getActiveProcess(process, true).getFields();
    process = fields.ProcessID;
    fieldMap = await initGetters.call(this, fieldMap, fields);
    return { process, fieldMap, srcProperty, dstProperty, merge };
};
