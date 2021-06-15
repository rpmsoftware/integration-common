const NAME = 'genericToForms';

const assert = require('assert');
const { init: initCondition, process: processCondition } = require('../conditions');
const { getFieldEssentials } = require('../api-wrappers');
const { MSG_FORM_NOT_FOUND } = require('../api-errors');
const setters = require('../helpers/setters');
const { init: initView, getForms: getViewForms } = require('../helpers/views');
const { validateString, toArray, toBoolean, getEager, normalizeInteger, isEmpty } = require('../util');

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
        getForms: async function (conf, sourceObject) {
            return (await getViewForms.call(this.api, conf)).filter(
                destinationForm => processCondition(conf.condition, { sourceObject, destinationForm })
            );
        },
    },
    number: {
        init: async function ({ formNumber, create }) {
            formNumber = await setters.initValue.call(this,
                typeof formNumber === 'string' ? { srcField: validateString(formNumber) } : formNumber
            );
            create = create === undefined || toBoolean(create) || undefined;
            return { formNumber, create };
        },
        getForms: async function ({ formNumber }, obj) {
            const result = await setters.set.call(this, formNumber, obj);
            assert.strictEqual(typeof result, 'object');
            if (result.Errors) {
                throw result.Errors;
            }
            return { Number: result.Value };
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
        propertyMap
    }) {
        const { api } = this;
        errorsToActions = toBoolean(errorsToActions) || undefined;
        fireWebEvent = toBoolean(fireWebEvent) || undefined;

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
            fieldMap: resultFieldMap,
            propertyMap: resultPropertyMap,
            errorsToActions,
            fireWebEvent
        };
    },

    process: async function ({
        dstProcess,
        condition,
        fieldMap,
        propertyMap,
        getDstForms,
        fireWebEvent,
        errorsToActions
    }, data) {
        const { api } = this;
        const duplicates = {};
        const promises = [];
        const later = [];


        const tweakArchived = async (form, { Archived }) => {
            if (Archived !== undefined) {
                Archived = toBoolean(Archived);
                const { FormID, Archived: FormArchived } = form.Form;
                if (toBoolean(FormArchived) !== Archived) {
                    const { Success } = await api.setFormArchived(FormID, Archived);
                    assert(Success);
                    form = await api.demandForm(FormID);
                    assert.strictEqual(toBoolean(form.Form.Archived), Archived);
                }
            }
            return form;
        };



        for (const obj of toArray(data)) {

            if (condition && !processCondition(condition, obj)) {
                continue;
            }

            const formPatch = [];
            let formErrors = [];
            for (const conf of fieldMap) {
                const fieldPatch = await setters.set.call(this, conf, obj);
                if (!fieldPatch) {
                    continue;
                }
                const { Errors: fieldErrors } = fieldPatch;
                fieldErrors ? (formErrors = formErrors.concat(fieldErrors)) : formPatch.push(fieldPatch);
            }
            const formProperties = {};
            for (const dstProperty in propertyMap) {
                let v = await setters.set.call(this, propertyMap[dstProperty], obj);
                v && typeof v === 'object' && (v = v.Value);
                formProperties[dstProperty] = v === null ? undefined : v;
            }


            const forms = toArray(await getEager(FORM_FINDERS, getDstForms.getter).getForms.call(this, getDstForms, obj));
            forms.length < 1 && getDstForms.create && later.push(async () => {
                const form = await tweakArchived(
                    await api.createForm(dstProcess, formPatch, formProperties, fireWebEvent),
                    formProperties
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
            });

            for (let { Number, FormID } of forms) {
                FormID = normalizeInteger(FormID);
                const numberOrID = FormID ? `ID_${FormID}` : `N_${Number}`;
                if (duplicates[numberOrID]) {
                    debug('Form number already processed: ', numberOrID);
                    continue;
                }
                duplicates[numberOrID] = true;
                if (formPatch.length < 1 && isEmpty(formProperties)) {
                    continue;
                }
                promises.push(api.parallelRunner(async () => {
                    let form;
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
                    form = await tweakArchived(form, formProperties);
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