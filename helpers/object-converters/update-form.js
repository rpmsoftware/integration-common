const assert = require('assert');
const {
    toArray, toBoolean, validateString, isEmpty, validatePropertyConfig, getDeepValue
} = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');
const { set, initMultiple: initSetters } = require('../setters');

module.exports = {
    init: async function ({
        process,
        formIDProperty,
        formNumberProperty,
        fieldMap,
        propertyMap: propertyMapConf,
        create,
        status,
        statusMap,
        blindPatch,
        dstProperty,
        parallel,
        condition
    }) {
        const { api } = this;
        dstProperty = dstProperty ? validateString(dstProperty) : undefined;
        blindPatch = blindPatch === undefined || toBoolean(blindPatch);
        create = toBoolean(create) || undefined;
        parallel = toBoolean(parallel) || undefined;
        formIDProperty = formIDProperty ? validatePropertyConfig(formIDProperty) : undefined;
        formNumberProperty = formNumberProperty ? validatePropertyConfig(formNumberProperty) : undefined;
        formIDProperty || formNumberProperty || assert(create);
        const processes = await api.getProcesses();
        const fields = await processes.getActiveProcess(process, true).getFields();
        process = fields.ProcessID;
        fieldMap = await initSetters.call(this, fieldMap, fields);
        let propertyMap = {};
        for (const k in propertyMapConf) {
            const c = propertyMapConf[k];
            const { constant } = c;
            propertyMap[k] = constant === undefined ? validatePropertyConfig(c) : { constant };
        }

        if (statusMap || (statusMap = undefined)) {
            const resultStatusMap = [];
            for (let sn in statusMap || {}) {
                const status = fields.getStatus(sn, true).ID;
                const c = initCondition(statusMap[sn]);
                c.status = status;
                resultStatusMap.push(c);
            }
            statusMap = resultStatusMap;
        }

        status && (propertyMap.StatusID = { getter: 'constant', value: fields.getStatus(status, true).ID });
        isEmpty(propertyMap) && (propertyMap = undefined);
        fieldMap.length > 0 || statusMap || assert(propertyMap);
        condition = condition ? initCondition(condition) : undefined;

        return {
            process, formIDProperty, fieldMap, formNumberProperty, parallel,
            propertyMap, statusMap, blindPatch, create, dstProperty, condition
        };

    },
    convert: async function ({
        process,
        formIDProperty,
        formNumberProperty,
        blindPatch,
        create,
        dstProperty,
        fieldMap,
        propertyMap,
        statusMap,
        parallel,
        condition
    }, obj) {
        const { api } = this;
        const createFormUpdatePack = async (source, dstForm) => {
            let formPatch = [];
            for (const conf of fieldMap) {
                const fieldPatch = await set.call(this, conf, source, dstForm);
                fieldPatch && formPatch.push(fieldPatch);
            }
            const formProps = {};
            for (const k in propertyMap) {
                const c = propertyMap[k];
                const { constant } = c;
                const v = constant === undefined ? getDeepValue(source, c) : constant;
                v === undefined || (formProps[k] = v);
            }
            if (statusMap) {
                for (let cond of statusMap) {
                    if (processCondition(cond, source)) {
                        formProps.StatusID = cond.status;
                        break;
                    }
                }
            }
            return { formPatch, formProps };
        };
        const number2id = {};
        formNumberProperty && (await api.getFormList(process, true)).Forms.forEach(({ N, ID }) => number2id[N] = ID);
        const promises = [];
        for (let source of toArray(obj)) {
            if (condition && !processCondition(condition, source)) {
                continue;
            }
            let formID = formIDProperty && +getDeepValue(source, formIDProperty);
            if (!formID) {
                const formNumber = formNumberProperty && getDeepValue(source, formNumberProperty);
                formNumber && (formID = number2id[formNumber]);
            }
            const run = async () => {
                let form;
                if (formID) {
                    if (!blindPatch) {
                        form = await api.demandForm(formID);
                        assert.strictEqual(form.ProcessID, process);
                    }
                    const { formPatch, formProps } = await createFormUpdatePack(source, form);
                    if (formPatch.length > 0 || !isEmpty(formProps)) {
                        form = await api.editForm(formID, formPatch, formProps);
                        assert.strictEqual(form.ProcessID, process);
                    }
                } else if (create) {
                    const { formPatch, formProps } = await createFormUpdatePack(source);
                    (formPatch.length > 0 || !isEmpty(formProps)) &&
                        (form = await api.createForm(process, formPatch, formProps));
                }
                dstProperty && (source[dstProperty] = form);
            };
            parallel ? promises.push(api.parallelRunner(run)) : await run();
        }
        await Promise.all(promises);
        return obj;
    }
};
