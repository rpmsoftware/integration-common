const { initMultiple: initGetters, getMultiple } = require('../getters');
const { validateString, toArray, validatePropertyConfig, getDeepValue, toBoolean } = require('../../util');
const assert = require('assert');

module.exports = {
    init: async function ({ dstProperty, process, formIDProperty, formNumberProperty, fieldMap, demand }) {
        dstProperty = dstProperty ? validateString(dstProperty) : undefined;
        const { api } = this;
        formIDProperty = formIDProperty ? validatePropertyConfig(formIDProperty) : undefined;
        formNumberProperty = formNumberProperty ? validatePropertyConfig(formNumberProperty) : undefined;
        formIDProperty || assert(formNumberProperty);
        process = (await api.getProcesses()).getActiveProcess(process, true);
        const fields = await process.getFields();
        fieldMap = fieldMap ? await initGetters.call(this, fieldMap, fields) : undefined;
        process = process.ProcessID;
        demand = demand === undefined || toBoolean(demand);
        return { dstProperty, process, formIDProperty, formNumberProperty, fieldMap, demand };
    },
    convert: async function ({ dstProperty, process, formIDProperty, formNumberProperty, fieldMap, demand }, obj) {
        const { api } = this;
        const method = demand ? 'demandForm' : 'getForm';
        for (const e of toArray(obj)) {
            const formID = formIDProperty && +getDeepValue(e, formIDProperty);
            const formNumber = formNumberProperty && getDeepValue(e, formNumberProperty);
            let formData;
            if (formID || formNumber) {
                formData = await (formID ? api[method](formID) : api[method](process, formNumber + ''));
                if (formData) {
                    const { Form, ProcessID } = formData;
                    assert.strictEqual(ProcessID, process);
                    formData = fieldMap ? await getMultiple.call(this, fieldMap, Form) : Form;
                }
            }
            dstProperty ? (e[dstProperty] = formData) : (formData && Object.assign(e, formData));
        }
        return obj;
    }
};
