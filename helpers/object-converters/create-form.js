const { validateString, toArray, getDeepValue, validatePropertyConfig, toBoolean } = require('../../util');
const { initMultiple: initSetters, set } = require('../setters');
const { init: initCondition, process: processCondition } = require('../../conditions');

module.exports = {

    init: async function ({ dstProperty, process, fieldMap, propertyMap: propertyMapConf, fireWebEvents, condition }) {
        validateString(dstProperty);
        const { api } = this;
        condition = condition ? initCondition(condition) : undefined;
        process = (await api.getProcesses()).getActiveProcess(process, true);
        const fields = await process.getFields();
        fieldMap = fieldMap ? await initSetters.call(this, fieldMap, fields) : [];
        const propertyMap = {};
        for (const k in propertyMapConf) {
            const c = propertyMapConf[k];
            const { constant } = c;
            propertyMap[k] = constant === undefined ? validatePropertyConfig(c) : { constant };
        }
        process = process.ProcessID;
        fireWebEvents = toBoolean(fireWebEvents) || undefined;
        return { dstProperty, process, propertyMap, fieldMap, fireWebEvents ,condition};
    },

    convert: async function ({ dstProperty, process, fieldMap, propertyMap, fireWebEvents, condition }, obj) {
        const { api } = this;
        for (const e of toArray(obj)) {
            if (condition && !processCondition(condition, e)) {
                continue;
            }
            const formPatch = [];
            for (const conf of fieldMap) {
                const fieldPatch = await set.call(this, conf, e);
                fieldPatch && formPatch.push(fieldPatch);
            }
            const formProps = {};
            for (const k in propertyMap) {
                const c = propertyMap[k];
                const { constant } = c;
                const v = constant === undefined ? getDeepValue(e, c) : constant;
                v === undefined || (formProps[k] = v);
            }
            e[dstProperty] = (await api.createForm(process, formPatch, formProps, fireWebEvents)).Form;
        }
        return obj;
    }
};
