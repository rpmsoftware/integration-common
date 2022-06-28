const { validateString, toArray, getEager, toBoolean, getDeepValue, isEmpty } = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');
const assert = require('assert');
const { ObjectType } = require('../../api-enums');
const { isEmptyValue } = require('../common');

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
        const { init } = OBJECT_CONVERTERS[name] || require('./' + name);
        c = init ? await init.call(this, c) : {};
        c.name = name;
        result.push(c);
    }
    return result;
}

async function convert(conf, obj) {
    for (let c of conf) {
        const { name } = c;
        obj = await (OBJECT_CONVERTERS[name] || require('./' + name)).convert.call(this, c, obj);
    }
    return obj;
}

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
                assert.strictEqual(typeof a, 'object');
                for (let k in a) {
                    const child = a[k];
                    assert.strictEqual(typeof child, 'object');
                    Object.assign(child, parent);
                    delete child[firstProperty];
                    result.push(child);
                }
            }
            return result;
        }
    },

    attachBasic: {
        init: async function ({ dstProperty, type, condition }) {
            validateString(dstProperty);
            condition = initCondition(condition);
            type = getEager(ObjectType, type);
            return { dstProperty, type, condition };
        },
        convert: async function ({ dstProperty, type, condition }, obj) {
            const { api } = this;
            const basicEntities = await api.getEntities(type);
            toArray(obj).forEach(model => model[dstProperty] = basicEntities.find(
                candidate => processCondition(condition, { model, candidate })
            ));
            return obj;
        }
    },

    attachBasicEntity: {
        init: function ({ dstProperty, type, id }) {
            validateString(dstProperty);
            type = getEager(ObjectType, type);
            id = toArray(id);
            assert(id.length > 0);
            id.forEach(assert);
            return { dstProperty, type, id };
        },
        convert: async function ({ dstProperty, type, id }, data) {
            const { api } = this;
            for (const e of toArray(data)) {
                const v = getDeepValue(e, id);
                isEmptyValue(v) || (e[dstProperty] = await api.getEntity(type, v));
            }
            return data;
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


    valueMap: {
        init: function ({ property, dstProperty, valueMap }) {
            validateString(dstProperty);
            validateString(property);
            assert.strictEqual(typeof valueMap, 'object');
            assert(!isEmpty(valueMap));
            return { property, dstProperty, valueMap };
        },
        convert: function ({ property, dstProperty, valueMap }, obj) {
            for (const e of toArray(obj)) {
                e[dstProperty] = valueMap[e[property]];
            }
            return obj;
        }
    },

    extractChildren: {
        init: function ({ properties, dstProperty, array }) {
            validateString(dstProperty);
            properties = toArray(properties).map(validateString);
            assert(properties.length > 0);
            array = toArray(array) || undefined;
            return { properties, dstProperty, array };
        },
        convert: function ({ properties, dstProperty, array }, obj) {
            for (const e of toArray(obj)) {
                const child = {};
                properties.forEach(p => {
                    if (!child[p]) {
                        child[p] = e[p];
                        delete e[p];
                    }
                });
                e[dstProperty] = array ? [child] : child;
            }
            return obj;
        }
    },

    arrayTotals: {
        init: function ({ array, properties: inProperties }) {
            validateString(array);
            const properties = {};
            let initialized = false;
            const ctx = {};
            for (const destination in inProperties) {
                const source = inProperties[destination];
                let { total, condition } = typeof source === 'string' ? { total: source } : source;
                validateString(total);
                condition = condition ? initCondition.call(ctx, condition) : undefined;
                properties[destination] = { total, condition };
                initialized = true;
            }
            assert(initialized);
            return { array, properties };
        },

        convert: function ({ array, properties }, data) {
            toArray(data).forEach(e => {
                const a = e[array];
                assert(Array.isArray(a));
                a.forEach(c => {
                    for (const destination in properties) {
                        const { total, condition } = properties[destination];
                        e[destination] === undefined && (e[destination] = 0);
                        (!condition || processCondition(condition, c)) && (e[destination] = e[destination] + (c[total] || 0));
                    }
                });
            });
            return data;
        }
    },

    group: {
        init: function ({ group, children, condition }) {
            validateString(children);
            group = toArray(group);
            assert(group.length > 0);
            group.forEach(validateString);
            return { group, children, condition };
        },

        convert: function ({ group, children }, data) {
            assert(Array.isArray(data));
            return data.group(children, group);
        }
    },

    stringToObject: {
        init: function ({ source, delimiter, properties, regExp, dstProperty }) {
            delimiter = delimiter ? validateString(delimiter) : undefined;
            validateString(regExp);
            dstProperty ? validateString(dstProperty) : (dstProperty = source);
            validateString(source);
            let fmInit = false;
            for (const p in properties) {
                const v = +properties[p];
                assert(v >= 0);
                fmInit = true;
            }
            assert(fmInit);
            return { source, delimiter, regExp, properties, dstProperty };
        },

        convert: function (conf, data) {
            let { source, delimiter, regExp, dstProperty } = conf;
            regExp instanceof RegExp || (regExp = conf.regExp = new RegExp(regExp));
            toArray(data).forEach(obj => {
                const s = obj[source];
                if (delimiter) {
                    const a = obj[dstProperty] = [];
                    if (s) {
                        for (let n of s.split(delimiter)) {
                            n = string2object.call(conf, n);
                            n && a.push(n);
                        }
                    }
                } else {
                    obj[dstProperty] = (s ? string2object.call(conf, s) : undefined);
                }
            });
            return data;
        }
    },

    totals: {
        init: function ({ group, properties: inProperties }) {
            group = toArray(group);
            assert(group.length > 0);
            group.forEach(validateString);
            const properties = {};
            let initialized = false;
            const ctx = {};
            for (const destination in inProperties) {
                let { total, condition } = inProperties[destination];
                validateString(total);
                condition = condition ? initCondition.call(ctx, condition) : undefined;
                properties[destination] = { total, condition };
                initialized = true;
            }
            assert(initialized);
            return { group, properties };
        },

        convert: function ({ group, properties }, data) {
            assert(Array.isArray(data));
            const result = data.group(PROP_CHILDREN, group);
            result.forEach(e => {
                e[PROP_CHILDREN].forEach(c => {
                    for (const destination in properties) {
                        const { total, condition } = properties[destination];
                        e[destination] === undefined && (e[destination] = 0);
                        (!condition || processCondition(condition, c)) && (e[destination] = e[destination] + (c[total] || 0));
                    }
                })
                delete e[PROP_CHILDREN];
            });
            return result;
        }
    }
};

function string2object(string) {
    let { regExp, properties } = this;
    regExp instanceof RegExp || (regExp = new RegExp(regExp));
    const result = {};
    const a = regExp.exec(string.trim());
    let hasData = false;
    if (a) {
        for (const p in properties) {
            result[p] = a[properties[p]];
            hasData = true;
        }
    }
    return hasData ? result : undefined;
}

const PROP_CHILDREN = Symbol();

module.exports = { init, convert };