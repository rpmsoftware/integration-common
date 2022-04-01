const NAME = 'genericToForms';

const assert = require('assert');
const { init: initCondition, process: processCondition } = require('../conditions');
const { getFieldEssentials } = require('../api-wrappers');
const { MSG_FORM_NOT_FOUND } = require('../api-errors');
const setters = require('../helpers/setters');
const { init: initView, getForms: getViewForms } = require('../helpers/views');
const { toArray, toBoolean, getEager, normalizeInteger, isEmpty } = require('../util');

const debug = require('debug')('rpm:generic2Forms');

const FORM_FINDERS = {
    view: {
        init: async function (conf) {
            const { match, condition } = conf;
            assert(!match, '"match" is obsolete. Use "condition({sourceObject,destinationForm})" instead');
            conf = await initView.call(this.api, conf);
            conf.condition = initCondition(condition);
            return conf;
        },
        create: async function (conf) {
            const forms = await getViewForms.call(this.api, conf);
            return sourceObject => forms.filter(
                destinationForm => processCondition(conf.condition, { sourceObject, destinationForm })
            );
        },
    },
    number: {
        init: async function ({ formNumber, create }) {
            formNumber = await setters.initValue.call(this,
                (typeof formNumber === 'string' || Array.isArray(formNumber)) ? { srcField: formNumber } : formNumber
            );
            create = toBoolean(create) || undefined;
            return { formNumber, create };
        },
        create: async function ({ formNumber }) {
            return async obj => {
                const result = await setters.set.call(this, formNumber, obj);
                assert.strictEqual(typeof result, 'object');
                if (result.Errors) {
                    throw result.Errors;
                }
                return { Number: result.Value };
            };
        },
    }
};

module.exports = {

    name: NAME,

    init: async function ({
        dstProcess,
        condition,
        fieldMap,
        formNumber,
        dstStatus,
        errorsToActions,
        fireWebEvent,
        getDstForms,
        propertyMap,
        blindPatch,
        updateCondition
    }) {
        const { api } = this;
        errorsToActions = toBoolean(errorsToActions) || undefined;
        fireWebEvent = toBoolean(fireWebEvent) || undefined;
        blindPatch = blindPatch === undefined || toBoolean(blindPatch) || undefined;
        {
            formNumber && !getDstForms && (getDstForms = { getter: 'number', formNumber });
            assert.strictEqual(typeof getDstForms, 'object');
            let { getter, create } = getDstForms;
            getDstForms = await getEager(FORM_FINDERS, getter).init.call(this, getDstForms);
            getDstForms.getter = getter;
            getDstForms.create === undefined && (getDstForms.create = toBoolean(create) || undefined);
        }

        dstProcess = (await api.getProcesses()).getActiveProcess(dstProcess, true);
        const dstFields = await dstProcess.getFields();
        dstProcess = dstProcess.ProcessID;
        condition = condition ? initCondition(condition) : undefined;
        updateCondition = updateCondition ? initCondition.call(dstFields, updateCondition) : undefined;
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
        const resultPropertyMap = {};
        if (propertyMap) {
            for (let dstProperty in propertyMap) {
                let setConf = propertyMap[dstProperty];
                if (typeof setConf === 'string' || Array.isArray(setConf)) {
                    setConf = { srcField: setConf };
                }
                assert.strictEqual(typeof setConf, 'object');
                setConf = await setters.initValue.call(this, setConf);
                setConf.dstProperty = dstProperty;
                resultPropertyMap[dstProperty] = setConf;
            }
        }
        if (dstStatus) {
            delete resultPropertyMap.Status;
            resultPropertyMap.StatusID = {
                setter: 'constant',
                value: dstFields.getStatus(dstStatus, true).ID
            };
        }
        return {
            getDstForms,
            dstProcess,
            condition,
            updateCondition,
            fieldMap: resultFieldMap,
            propertyMap: resultPropertyMap,
            errorsToActions,
            fireWebEvent,
            blindPatch
        };
    },

    process: async function ({
        dstProcess,
        condition,
        fieldMap,
        propertyMap,
        getDstForms,
        fireWebEvent,
        errorsToActions,
        blindPatch,
        updateCondition
    }, data) {
        const { api } = this;
        const duplicates = {};
        const promises = [];
        const later = [];

        const getForms = await getEager(FORM_FINDERS, getDstForms.getter).create.call(this, getDstForms);

        for (const sourceObject of toArray(data)) {

            if (condition && !processCondition(condition, sourceObject)) {
                continue;
            }

            const blindFormPatch = [];
            let blindFormErrors = [];

            for (const conf of fieldMap) {
                const fieldPatch = await setters.set.call(this, conf, sourceObject);
                if (!fieldPatch) {
                    continue;
                }
                const { Errors: fieldErrors } = fieldPatch;
                fieldErrors ? (blindFormErrors = blindFormErrors.concat(fieldErrors)) : blindFormPatch.push(fieldPatch);
            }


            const formProperties = {};
            for (const dstProperty in propertyMap) {
                let v = await setters.set.call(this, propertyMap[dstProperty], sourceObject);
                v && typeof v === 'object' && (v = v.Value);
                formProperties[dstProperty] = v === null ? undefined : v;
            }


            const forms = toArray(await getForms(sourceObject));
            forms.length < 1 && getDstForms.create && later.push(async () => {
                const form = await tweakArchived.call(this,
                    await api.createForm(dstProcess, blindFormPatch, formProperties, fireWebEvent),
                    formProperties
                );
                if (blindFormErrors.length < 1) {
                    return;
                }
                blindFormErrors = blindFormErrors.join('\n');
                if (errorsToActions) {
                    await api.errorToFormAction(blindFormErrors, form);
                } else {
                    throw blindFormErrors;
                }
            });

            for (let destinationForm of forms) {
                let { Number, FormID } = destinationForm;
                FormID = FormID && normalizeInteger(FormID);
                const numberOrID = FormID ? `ID_${FormID}` : `N_${Number}`;
                if (duplicates[numberOrID]) {
                    debug('Form number already processed: ', numberOrID);
                    continue;
                }
                if (updateCondition && !processCondition(updateCondition, { sourceObject, destinationForm })) {
                    continue;
                }
                duplicates[numberOrID] = true;
                promises.push(api.parallelRunner(async () => {
                    let formPatch, formErrors, form;
                    if (blindPatch) {
                        formPatch = blindFormPatch;
                        formErrors = blindFormErrors;
                    } else {
                        form = await (FormID ? api.getForm(FormID) : api.getForm(dstProcess, Number + ''));
                        formPatch = [];
                        formErrors = [];
                        for (const conf of fieldMap) {
                            const fieldPatch = await setters.set.call(this, conf, sourceObject, form);
                            if (!fieldPatch) {
                                continue;
                            }
                            const { Errors: fieldErrors } = fieldPatch;
                            fieldErrors ? (formErrors = formErrors.concat(fieldErrors)) : formPatch.push(fieldPatch);
                        }
                        FormID = form && form.Form.FormID;
                    }
                    if (formPatch.length < 1 && isEmpty(formProperties)) {
                        return;
                    }
                    if (FormID) {
                        form = await api.editForm(FormID, formPatch, formProperties, fireWebEvent);
                    } else {
                        try {
                            form = await api.editForm(dstProcess, Number, formPatch, formProperties, fireWebEvent);
                        } catch (e) {
                            if (e.Message !== MSG_FORM_NOT_FOUND) {
                                throw e;
                            }
                            if (getDstForms.create) {
                                formProperties.Number = Number;
                                form = await api.createForm(dstProcess, formPatch, formProperties, fireWebEvent);
                            }
                        }
                    }
                    form = await tweakArchived.call(api, form, formProperties);
                    if (!form || formErrors.length < 1) {
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
        }
        later.forEach(run => promises.push(api.parallelRunner(run)));
        return Promise.all(promises);
    }

};

async function tweakArchived(form, { Archived }) {
    const api = this;
    if (Archived !== undefined) {
        Archived = toBoolean(Archived);
        const { FormID, Archived: FormArchived } = form.Form || form;
        if (toBoolean(FormArchived) !== Archived) {
            const { Success } = await api.setFormArchived(FormID, Archived);
            assert(Success);
            form = await api.demandForm(FormID);
            assert.strictEqual(toBoolean(form.Form.Archived), Archived);
        }
    }
    return form;
}


