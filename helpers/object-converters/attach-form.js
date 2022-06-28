const { initMultiple: initGetters, getMultiple } = require('../getters');
const { validateString, toArray } = require('../../util');
const assert = require('assert');

module.exports = {
    init: async function ({ dstProperty, process, formIDProperty, fieldMap }) {
        validateString(dstProperty);
        const { api } = this;
        validateString(formIDProperty);
        process = (await api.getProcesses()).getActiveProcess(process, true);
        const fields = await process.getFields();
        fieldMap = await initGetters.call(this, fieldMap, fields);
        process = process.ProcessID;
        return { dstProperty, process, formIDProperty, fieldMap };
    },
    convert: async function ({ dstProperty, process, formIDProperty, fieldMap }, obj) {
        const { api } = this;
        for (const e of toArray(obj)) {
            const formID = +e[formIDProperty];
            let formData;
            if (formID) {
                const { Form, ProcessID } = await api.demandForm(formID);
                assert.strictEqual(ProcessID, process);
                formData = await getMultiple.call(this, fieldMap, Form);
            }
            e[dstProperty] = formData;
        }
        return obj;
    }
};
