const assert = require('assert');
const { toArray, toBoolean, validatePropertyConfig, getDeepValue } = require('../../../util');
const { init: initCondition, process: processCondition } = require('../../../conditions');

module.exports = {

    init: async function ({ process, formIDProperty, formNumberProperty, parallel, condition }) {
        const { api } = this;
        parallel = toBoolean(parallel) || undefined;
        formIDProperty = formIDProperty ? validatePropertyConfig(formIDProperty) : undefined;
        formNumberProperty = formNumberProperty ? validatePropertyConfig(formNumberProperty) : undefined;
        formIDProperty || assert(formNumberProperty);
        process = (await api.getProcesses()).getActiveProcess(process, true).ProcessID;
        condition = condition ? initCondition(condition) : undefined;
        return { process, formIDProperty, formNumberProperty, parallel, condition };
    },

    convert: async function ({
        process,
        formIDProperty,
        formNumberProperty,
        parallel,
        condition
    }, obj) {
        const { api } = this;

        let getFormID;
        if (formIDProperty) {
            getFormID = source => getDeepValue(source, formIDProperty)
        } else {
            assert(formNumberProperty);
            const number2id = {};
            (await api.getFormList(process, true)).Forms.forEach(({ N, ID }) => number2id[N] = ID);
            getFormID = source => number2id[getDeepValue(source, formNumberProperty)];
        }

        const promises = [];
        for (let source of toArray(obj)) {
            if (condition && !processCondition(condition, source)) {
                continue;
            }
            const formID = getFormID(obj);
            if (!(formID > 0)) {
                continue;
            }
            const run = () => api.trashForm(formID);
            parallel ? promises.push(api.parallelRunner(run)) : await run();
        }

        await Promise.all(promises);
        return obj;
    }
};
