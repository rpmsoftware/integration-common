const NAME = 'genericToForms';

const assert = require('assert');
const conditions = require('../conditions');
const { getFieldEssentials } = require('../api-wrappers');
const setters = require('../helpers/setters');
const { validateString, toArray, toBoolean } = require('../util');
const debug = require('debug')('rpm:generic2Forms');

module.exports = {

    name: NAME,

    init: async function ({
        dstProcess,
        condition,
        fieldMap,
        formNumber,
        dstStatus,
        errorsToActions,
        fireWebEvent
    }) {
        const { api } = this;
        errorsToActions = toBoolean(errorsToActions) || undefined;
        fireWebEvent = toBoolean(fireWebEvent) || undefined;
        formNumber = await setters.initValue.call(this,
            typeof formNumber === 'string' ? { srcField: validateString(formNumber) } : formNumber
        );
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
            dstStatus,
            errorsToActions,
            fireWebEvent
        };
    },

    process: async function ({
        dstProcess,
        condition,
        fieldMap,
        formNumber: formNumberConf,
        dstStatus,
        fireWebEvent,
        errorsToActions
    }, data) {
        const { api } = this;
        const duplicates = {};
        const promises = [];
        for (const obj of toArray(data)) {
            if (condition && !conditions.process(condition, obj)) {
                continue;
            }
            let formNumber = await setters.set.call(this, formNumberConf, obj);
            assert.strictEqual(typeof formNumber, 'object');
            if (formNumber.Errors) {
                throw formNumber.Errors;
            }
            formNumber = formNumberConf.valueIsId ? formNumber.ID : formNumber.Value;
            assert(formNumber);
            if (duplicates[formNumber]) {
                debug('Form number already processed: ', formNumber);
                continue;
            }
            duplicates[formNumber] = true;
            promises.push(api.parallelRunner(async () => {
                let form = await api.getForm(dstProcess, formNumber);
                const formPatch = [];
                let formErrors = [];
                for (const conf of fieldMap) {
                    const fieldPatch = await setters.set.call(this, conf, obj, form);
                    if (!fieldPatch) {
                        continue;
                    }
                    const fieldErrors = fieldPatch.Errors;
                    fieldErrors ? (formErrors = formErrors.concat(fieldErrors)) : formPatch.push(fieldPatch);
                }
                if (formPatch.length < 1 && !dstStatus && formErrors.length < 1) {
                    return;
                }
                form = await (form ?
                    api.editForm(form.Form.FormID, formPatch, { StatusID: dstStatus }, fireWebEvent) :
                    api.createForm(dstProcess, formPatch, { Number: formNumber, StatusID: dstStatus }, fireWebEvent)
                );
                if (formErrors.length < 1) {
                    return;

                }
                formErrors = formErrors.join('\n');
                if (errorsToActions) {
                    await api.errorToFormAction(formErrors, form);
                } else {
                    throw formErrors;
                }
            }));
        }
        return Promise.all(promises);
    }

};