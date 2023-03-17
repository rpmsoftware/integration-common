const { initMultiple: initGetters, getMultiple } = require('../getters');
const { validateString, toArray, validatePropertyConfig, getDeepValue } = require('../../util');
const assert = require('assert');

module.exports = {
    init: async function ({ dstProperty, process, formIDProperty, formNumberProperty, fieldMap }) {
        dstProperty = dstProperty ? validateString(dstProperty) : undefined;
        const { api } = this;
        formIDProperty = formIDProperty ? validatePropertyConfig(formIDProperty) : undefined;
        formNumberProperty = formNumberProperty ? validatePropertyConfig(formNumberProperty) : undefined;
        formIDProperty || assert(formNumberProperty);
        process = (await api.getProcesses()).getActiveProcess(process, true);
        const fields = await process.getFields();
        fieldMap = fieldMap ? await initGetters.call(this, fieldMap, fields) : undefined;
        process = process.ProcessID;
        return { dstProperty, process, formIDProperty, formNumberProperty, fieldMap };
    },
    convert: async function ({ dstProperty, process, formIDProperty, formNumberProperty, fieldMap }, obj) {
        const { api } = this;
        for (const e of toArray(obj)) {
            const formID = formIDProperty && +getDeepValue(e, formIDProperty);
            const formNumber = formNumberProperty && getDeepValue(e, formNumberProperty);
            let formData;
            if (formID || formNumber) {
                const { Form, ProcessID } = await (
                    formID ? api.demandForm(formID) : api.demandForm(process, formNumber)
                );
                assert.strictEqual(ProcessID, process);
                formData = fieldMap ? await getMultiple.call(this, fieldMap, Form) : Form;
            }
            dstProperty ? (e[dstProperty] = formData) : (formData && Object.assign(e, formData));
        }
        return obj;
    }
};
