const assert = require('assert');
const { toArray, validateString, validatePropertyConfig, getDeepValue } = require('integration-common/util');
const { initMultiple: initGetters, getMultiple } = require('integration-common/helpers/getters');

exports.convert = async function ({ process, fieldMap, srcProperty, dstProperty }, obj) {
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
        form = form.Form || form;
        assert.strictEqual(process, form.ProcessID);
        e[dstProperty] = await getMultiple.call(this, fieldMap, form);
    }
    return obj;
};

exports.init = async function ({ process, fieldMap, srcProperty, dstProperty }) {
    dstProperty = validateString(dstProperty || srcProperty);
    srcProperty = validatePropertyConfig(srcProperty);
    const processes = await this.api.getProcesses();
    const fields = await processes.getActiveProcess(process, true).getFields();
    process = fields.ProcessID;
    fieldMap = await initGetters.call(this, fieldMap, fields);
    return { process, fieldMap, srcProperty, dstProperty };
};
