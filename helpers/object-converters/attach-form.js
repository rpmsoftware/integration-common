const { initMultiple: initGetters, getMultiple } = require('../getters');
const { validateString, toArray, validatePropertyConfig, getDeepValue } = require('../../util');
const assert = require('assert');

module.exports = {
    init: async function ({ dstProperty, process, formIDProperty, fieldMap }) {
        dstProperty = dstProperty ? validateString(dstProperty) : undefined;
        const { api } = this;
        formIDProperty = validatePropertyConfig(formIDProperty);
        process = (await api.getProcesses()).getActiveProcess(process, true);
        const fields = await process.getFields();
        fieldMap = await initGetters.call(this, fieldMap, fields);
        process = process.ProcessID;
        return { dstProperty, process, formIDProperty, fieldMap };
    },
    convert: async function ({ dstProperty, process, formIDProperty, fieldMap }, obj) {
        const { api } = this;
        for (const e of toArray(obj)) {
            const formID = +getDeepValue(e, formIDProperty);
            let formData;
            if (formID) {
                const { Form, ProcessID } = await api.demandForm(formID);
                assert.strictEqual(ProcessID, process);
                formData = await getMultiple.call(this, fieldMap, Form);
            }
            dstProperty ? (e[dstProperty] = formData) : (formData && Object.assign(e, formData));
        }
        return obj;
    }
};
