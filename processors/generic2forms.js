const NAME = 'genericToForms';

const assert = require('assert');
const conditions = require('../conditions');
const { getFieldEssentials } = require('../api-wrappers');
const setters = require('../helpers/setters');
const { init: initView, getForms: getViewForms } = require('../helpers/views');
const { validateString, toArray, toBoolean, getEager, normalizeInteger, isEmpty, getDeepValue } = require('../util');

const debug = require('debug')('rpm:generic2Forms');

const FORM_FINDERS = {
    view: {
        init: async function (conf) {
            const { match } = conf;
            assert(typeof match === 'object');
            assert(!isEmpty(match));
            conf = await initView.call(this.api, conf);
            conf.match = match;
            return conf;
        },
        getForms: async function (conf, obj) {
            const result = await getViewForms.call(this.api, conf);
            const { match } = conf;
            assert(!isEmpty(match));
            return result.filter(form => {
                for (const formProp in match) {
                    const objProp = match[formProp];
                    if (getDeepValue(obj, objProp) !== getEager(form, formProp)) {
                        return false;
                    }
                }
                return true;
            });
        },
    },
    number: {
        init: async function ({ formNumber }) {
            formNumber = await setters.initValue.call(this,
                typeof formNumber === 'string' ? { srcField: validateString(formNumber) } : formNumber
            );
            return { formNumber, create: true };
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
            if (formNumber && !getDstForms) {
                getDstForms = { getter: 'number', formNumber };
            }
            assert.strictEqual(typeof getDstForms, 'object');
            const { getter } = getDstForms;
            getDstForms = await getEager(FORM_FINDERS, getter).init.call(this, getDstForms);
            getDstForms.getter = getter;
        }

        dstProcess = (await api.getProcesses()).getActiveProcess(dstProcess, true);
        const dstFields = await dstProcess.getFields();
        dstProcess = dstProcess.ProcessID;
        condition = condition ? conditions.init(condition) : undefined;
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
        for (const obj of toArray(data)) {
            if (condition && !conditions.process(condition, obj)) {
                continue;
            }
            for (const { Number, FormID } of toArray(await getEager(FORM_FINDERS, getDstForms.getter).getForms.call(this, getDstForms, obj))) {
                const numberOrID = Number || FormID;
                if (duplicates[numberOrID]) {
                    debug('Form number already processed: ', numberOrID);
                    continue;
                }
                duplicates[numberOrID] = true;
                promises.push(api.parallelRunner(async () => {
                    let form = await (
                        Number ? api.getForm(dstProcess, Number) : api.getForm(normalizeInteger(FormID))
                    );
                    if (!form && !getDstForms.create) {
                        return;
                    }
                    const formPatch = [];
                    let formErrors = [];
                    for (const conf of fieldMap) {
                        const fieldPatch = await setters.set.call(this, conf, obj, form);
                        if (!fieldPatch) {
                            continue;
                        }
                        const { Errors: fieldErrors } = fieldPatch;
                        fieldErrors ? (formErrors = formErrors.concat(fieldErrors)) : formPatch.push(fieldPatch);
                    }
                    const formProperties = {};
                    for (const dstProperty in propertyMap) {
                        const v = await setters.set.call(this, propertyMap[dstProperty], obj, form);
                        formProperties[dstProperty] = (v && typeof v === 'object') ? v.Value : v;
                    }
                    if (formPatch.length < 1 && isEmpty(formProperties)) {
                        return;
                    }
                    if (form) {
                        form = await api.editForm(form.Form.FormID, formPatch, formProperties, fireWebEvent);
                    } else {
                        formProperties.Number = Number;
                        form = await api.createForm(dstProcess, formPatch, formProperties, fireWebEvent)
                    }
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
        }
        return Promise.all(promises);
    }

};