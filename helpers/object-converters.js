const { init: initGetter, get, initMultiple: initGetters, getMultiple } = require('./getters');
const { validateString, toArray, getEager, toBoolean, getDeepValue } = require('../util');
const { init: initCondition, process: processCondition } = require('../conditions');
const assert = require('assert');
const hash = require('object-hash');

const DEFAULT_CONVERTER = 'getter';
const PROP_PARENT = '_parent';

async function init(conf) {
    const result = [];
    for (let c of conf ? toArray(conf) : []) {
        let { name, enabled } = c;
        if (enabled !== undefined && !toBoolean(enabled)) {
            continue;
        }
        name || (name = DEFAULT_CONVERTER);
        const { init } = getEager(OBJECT_CONVERTERS, name);
        c = init ? await init.call(this, c) : {};
        c.name = name;
        result.push(c);
    }
    return result;
}
exports.init = init;

async function convert(conf, obj) {
    for (let c of conf) {
        obj = await getEager(OBJECT_CONVERTERS, c.name).convert.call(this, c, obj);
    }
    return obj;
}
exports.convert = convert;

const OBJECT_CONVERTERS = {

    flatten: {
        init: ({ array }) => {
            array = toArray(array).map(validateString);
            assert(array.length > 0);
            return { array };
        },
        convert: ({ array }, obj) => {
            let result = [];
            const firstProperty = array[0];
            for (let parent of toArray(obj)) {
                const a = getDeepValue(parent, array);
                if (a === undefined) {
                    result.push(parent);
                    continue;
                }
                assert(Array.isArray(a));
                for (let child of a) {
                    assert.strictEqual(typeof child, 'object');
                    Object.assign(child, parent);
                    delete child[firstProperty];
                    result.push(child);
                }
            }
            return result;
        }
    },

    getter: {
        init: async function (conf) {
            const { dstProperty } = conf;
            validateString(dstProperty);
            conf = await initGetter.call(this, conf);
            conf.dstProperty = dstProperty;
            return conf;
        },
        convert: async function (conf, obj) {
            const { dstProperty } = conf;
            for (const e of toArray(obj)) {
                e[dstProperty] = await get.call(this, conf, e);
            }
            return obj;
        }
    },

    attachForm: {
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
    },

    filter: {
        init: async function ({ condition }) {
            condition = initCondition(condition);
            return { condition };
        },
        convert: async function ({ condition }, obj) {
            return toArray(obj).filter(e => processCondition(condition, e));
        }
    },

    filterArray: {
        init: async function ({ condition, dstProperty, array }) {
            assert(array);
            validateString(dstProperty);
            condition = initCondition(condition);
            return { condition, dstProperty, array };
        },
        convert: async function ({ array: arrayProperty, condition, dstProperty }, obj) {
            for (const parent of toArray(obj)) {
                const array = getDeepValue(obj, arrayProperty);
                array && (parent[dstProperty] = toArray(array).filter(e => processCondition(condition, e)));
            }
            return obj;
        }
    },

    forEach: {
        init: async function ({ array, convert }) {
            assert(array);
            convert = await init.call(this, convert);
            return { array, convert };
        },
        convert: async function ({ array: arrayProperty, convert: convertConf }, obj) {
            for (const parent of toArray(obj)) {
                const array = getDeepValue(obj, arrayProperty);
                if (typeof array !== 'object') {
                    continue;
                }
                for (const key in array) {
                    const element = array[key];
                    if (typeof element !== 'object') {
                        continue;
                    }
                    element[PROP_PARENT] || Object.defineProperty(element, PROP_PARENT, { value: parent });
                    await convert.call(this, convertConf, element);
                }
            }
            return obj;
        }
    },

    hash: {
        init: function ({ dstProperty, properties }) {
            validateString(dstProperty);
            properties = toArray(properties);
            assert(properties.length > 0);
            properties.forEach(validateString);
            return { dstProperty, properties };
        },
        convert: function ({ dstProperty, properties }, obj) {
            for (const e of toArray(obj)) {
                e[dstProperty] = hash(properties.map(p => e[p]));
            }
            return obj;
        }
    },



};
