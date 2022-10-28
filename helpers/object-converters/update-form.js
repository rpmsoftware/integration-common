const assert = require('assert');
const {
    toArray, toBoolean, validateString, isEmpty, validatePropertyConfig, getDeepValue
} = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');
const { initMultiple: initGetters, getMultiple } = require('../getters');
const { set, initMultiple: initSetters } = require('../setters');

module.exports = {
    init: async function ({ process, formIDProperty, fieldMap, propertyMap, create, status, statusMap, blindPatch, dstProperty }) {
        const { api } = this;
        dstProperty = dstProperty ? validateString(dstProperty) : undefined;
        blindPatch = blindPatch === undefined || toBoolean(blindPatch);
        create = toBoolean(create) || undefined;
        formIDProperty = formIDProperty ? validatePropertyConfig(formIDProperty) : undefined;
        formIDProperty || assert(create);
        const processes = await api.getProcesses();
        const fields = await processes.getActiveProcess(process, true).getFields();
        process = fields.ProcessID;
        fieldMap = await initSetters.call(this, fieldMap, fields);
        propertyMap = propertyMap ? await initGetters.call(this, propertyMap) : {};

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

        return {
            process, formIDProperty, fieldMap,
            propertyMap, statusMap, blindPatch, create, dstProperty
        };

    },
    convert: async function ({ process, formIDProperty, blindPatch, create, dstProperty, fieldMap, propertyMap, statusMap }, obj) {
        const { api } = this;
        const createFormUpdatePack = async (source, dstForm) => {
            let formPatch = [];
            for (const conf of fieldMap) {
                const fieldPatch = await set.call(this, conf, source, dstForm);
                fieldPatch && formPatch.push(fieldPatch);
            }
            let formProps = propertyMap ? await getMultiple.call(this, propertyMap, source) : {};
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

        for (let source of toArray(obj)) {
            const formID = formIDProperty && +getDeepValue(source, formIDProperty);
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
                const { formPatch, dstFormProps } = await createFormUpdatePack(source);
                (formPatch.length > 0 || !isEmpty(dstFormProps)) &&
                    (form = await api.createForm(process, formPatch, dstFormProps));
            }
            dstProperty && (source[dstProperty] = form);

        }
    }
};
