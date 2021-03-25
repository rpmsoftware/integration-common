const NAME = 'genericToForms';

const assert = require('assert');
const conditions = require('../conditions');
const { getFieldEssentials } = require('../api-wrappers');
const setters = require('../helpers/setters');
const { validateString, toArray } = require('../util');
const { render } = require('mustache');

module.exports = {

    name: NAME,

    init: async function ({
        dstProcess,
        condition,
        fieldMap,
        formNumber,
        dstStatus
    }) {
        formNumber = validateString(formNumber);
        const { api } = this;
        dstProcess = (await api.getProcesses()).getActiveProcess(dstProcess, true);
        const dstFields = await dstProcess.getFields();
        dstStatus = dstStatus ? dstFields.getStatus(dstStatus, true).ID : undefined;
        dstProcess = dstProcess.ProcessID;
        condition = condition ? conditions.init.call(dstFields, condition) : undefined;
        const resultFieldMap = [];
        if (fieldMap) {
            for (let dstField in fieldMap) {
                let setConf = fieldMap[dstField];
                if (typeof setConf === 'string' || Array.isArray(setConf)) {
                    setConf = { srcField: setConf };
                }
                assert.strictEqual(typeof setConf, 'object');
                dstField = getFieldEssentials(dstFields.getField(dstField, true));
                resultFieldMap.push(await setters.initField.call(this, setConf, dstField));
            }
        }
        return {
            formNumber,
            dstProcess,
            condition,
            fieldMap: resultFieldMap,
            dstStatus
        };
    },

    process: async function ({
        dstProcess,
        condition,
        fieldMap,
        formNumber: formNumberTemplate,
        dstStatus,
        fireWebEvent
    }, data) {
        const { api } = this;
        const duplicates = {};
        const promises = [];
        for (const obj of toArray(data)) {
            if (condition && !conditions.process(condition, obj)) {
                continue;
            }
            const formNumber = validateString(render(formNumberTemplate, obj));
            assert(!duplicates[formNumber]);
            duplicates[formNumber] = true;
            promises.push(api.parallelRunner(async () => {
                const form = await api.getForm(dstProcess, formNumber);
                const formPatch = [];
                for (const conf of fieldMap) {
                    const fieldPatch = await setters.set.call(this, conf, obj, form);
                    fieldPatch && formPatch.push(fieldPatch);
                }
                return (formPatch.length > 0 || dstStatus) && (form ?
                    api.editForm(form.Form.FormID, formPatch, { StatusID: dstStatus }, fireWebEvent) :
                    api.createForm(dstProcess, formPatch, { Number: formNumber, StatusID: dstStatus }, fireWebEvent)
                );
            }));
        }
        return Promise.all(promises);
    }

};