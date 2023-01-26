const {
    validateString, toArray, getEager, toBoolean, getDeepValue,
    isEmpty, validatePropertyConfig, normalizeInteger, createParallelRunner
} = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');
const assert = require('assert');
const { ObjectType } = require('../../api-enums');
const { isEmptyValue } = require('../common');

const DEFAULT_CONVERTER = 'getter';

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
        c.name || (c.name = name);
        result.push(c);
    }
    return result;
}

async function convert(conf, obj) {
    for (let c of conf) {
        const { name } = c;
        obj = await (OBJECT_CONVERTERS[name] || require('./' + name)).convert.call(this, c, obj);
        if (toArray(obj).length < 1) {
            break;
        }
    }
    return obj;
}

const PARENT_PROPERTY = '_parent';

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
                    let child = a[k];
                    assert.strictEqual(typeof child, 'object');
                    child = Object.assign({}, child, parent);
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
            const result = toArray(obj).filter(e => processCondition(condition, e));
            // console.log('Filtered down to',result.length);
            return result;
        }
    },

    filterArray: {
        init: async function ({ condition, dstProperty, array }) {
            validatePropertyConfig(array);
            validateString(dstProperty);
            condition = initCondition(condition);
            return { condition, dstProperty, array };
        },
        convert: async function ({ array: arrayProperty, condition, dstProperty }, obj) {
            for (const parent of toArray(obj)) {
                const array = getDeepValue(parent, arrayProperty);
                if (!array) {
                    continue;
                }
                const r = [];
                for (let e in array) {
                    e = array[e];
                    processCondition(condition, e) && r.push(e);
                }
                parent[dstProperty] = r;
            }
            return obj;
        }
    },

    mapArray: {
        init: async function ({ property, dstProperty, array }) {
            array = validatePropertyConfig(array);
            dstProperty = validateString(dstProperty);
            // Single property for now. Add fieldMap when needed
            property = validatePropertyConfig(property);
            return { property, dstProperty, array };
        },
        convert: async function ({ array: arrayProperty, property, dstProperty }, obj) {
            for (const parent of toArray(obj)) {
                const array = getDeepValue(parent, arrayProperty);
                if (!array) {
                    continue;
                }
                const result = [];
                for (let e in array) {
                    e = array[e];
                    result.push(getDeepValue(e, property));
                }
                parent[dstProperty] = result;
            }
            return obj;
        }
    },

    concat: {
        init: async function ({ dstProperty, arrays }) {
            arrays = toArray(arrays).map(a => validatePropertyConfig(a));
            assert(arrays.length > 0);
            validateString(dstProperty);
            return { dstProperty, arrays };
        },
        convert: async function ({ arrays, dstProperty }, obj) {
            for (const parent of toArray(obj)) {
                let r = [];
                for (const a in arrays) {
                    r = r.concat(toArray(getDeepValue(parent, arrays[a])));
                }
                parent[dstProperty] = r;
            }
            return obj;
        }
    },

    forEach: {
        init: async function ({ array, condition, convert, parallel }) {
            array = array ? validatePropertyConfig(array) : undefined;
            condition = condition ? initCondition(condition) : undefined;
            parallel = parallel && normalizeInteger(parallel);
            parallel > 0 || (parallel = undefined);
            convert = await init.call(this, convert);
            return { array, convert, condition, parallel };
        },
        convert: async function ({ array: arrayProperty, condition, convert: convertConf, parallel }, obj) {
            if (arrayProperty) {
                for (const parent of toArray(obj)) {
                    const array = getDeepValue(parent, arrayProperty);
                    if (typeof array !== 'object') {
                        continue;
                    }
                    for (const key in array) {
                        const e = array[key];
                        if (condition && !processCondition(condition, e)) {
                            continue;
                        }
                        Object.defineProperty(e, PARENT_PROPERTY, { value: parent, configurable: true });
                        array[key] = await convert.call(this, convertConf, e);
                    }
                }
            } else {
                const runner = createParallelRunner(parallel || 1);
                obj = await Promise.all(toArray(obj).map(e =>
                    condition && !processCondition(condition, e) ? e :
                        runner(() => convert.call(this, convertConf, e))
                ));
            }
            return obj;
        }
    },


    valueMap: {
        init: function (conf) {

            const initSingle = (dstProperty, { property, keyProperty, valueMap, propertyMap }) => {
                validateString(dstProperty);
                keyProperty = validatePropertyConfig(keyProperty || property);
                valueMap && !isEmpty(valueMap) || (valueMap = undefined);
                if (propertyMap || (propertyMap = undefined)) {
                    assert.strictEqual(typeof propertyMap, 'object');
                    const resultMap = {};
                    for (const k in propertyMap) {
                        resultMap[k] = validatePropertyConfig(propertyMap[k]);
                    }
                    propertyMap = resultMap;
                }
                valueMap || assert(propertyMap);
                return { keyProperty, dstProperty, valueMap, propertyMap };
            }

            const { dstProperties, dstProperty } = conf;
            const result = [];
            if (dstProperties) {
                for (const dstProperty in dstProperties) {
                    result.push(initSingle(dstProperty, dstProperties[dstProperty]));
                }
            } else {
                result.push(initSingle(dstProperty, conf));
            }
            return { dstProperties: result };

        },

        convert: function ({ dstProperties }, obj) {
            for (const e of toArray(obj)) {
                for (const { keyProperty, dstProperty, valueMap, propertyMap } of dstProperties) {
                    const k = e[keyProperty];
                    let value;
                    if (valueMap) {
                        value = valueMap[k];
                    } else {
                        const p = propertyMap[k];
                        p === undefined || (value = getDeepValue(e, p));
                    }
                    e[dstProperty] = value;
                }
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
        init: function ({ group, children, array }) {
            validateString(children);
            group = toArray(group);
            assert(group.length > 0);
            group.forEach(validateString);
            array = array ? validateString(array) : undefined;
            return { group, children, array };
        },

        convert: function ({ group, children, array }, data) {
            if (array) {
                toArray(data).forEach(e => {
                    const a = e[array];
                    if (!array) {
                        return;
                    }
                    assert(Array.isArray(a));
                    e[array] = a.group(children, group)
                });
                return data;
            }
            assert(Array.isArray(data));
            return data.group(children, group);
        }
    },

    concatenate: {
        init: function ({ arrays, dstProperty, deleteSources }) {
            validateString(dstProperty);
            deleteSources = toBoolean(deleteSources);
            arrays = toArray(arrays);
            assert(arrays.length > 0);
            arrays.forEach(validateString);
            return { arrays, dstProperty, deleteSources };
        },

        convert: function ({ arrays, dstProperty, deleteSources }, data) {
            toArray(data).forEach(e => {
                let result = [];
                arrays.forEach(prop => {
                    let a = e[prop];
                    if (a === undefined) {
                        return;
                    }
                    result = result.concat(a);
                    if (deleteSources) {
                        delete e[prop];
                    }
                })
                e[dstProperty] = result;
            });
            return data;
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
    },

    wrap: {
        init: function ({ dstProperty, srcProperties }) {
            validateString(dstProperty);
            srcProperties = toArray(srcProperties).map(validateString);
            srcProperties.length > 0 || (srcProperties = undefined);
            return { srcProperties, dstProperty };
        },

        convert: function ({ srcProperties, dstProperty }, data) {
            const result = toArray(data).map(e => {
                const result = {};
                if (srcProperties) {
                    const part = {};
                    srcProperties.forEach(sp => part[sp] = e[sp]);
                    e = part;
                }
                result[dstProperty] = e;
                return result;
            });
            return Array.isArray(data) ? result : result[0];
        }
    },

    sortArray: {
        init: function ({ array, desc, properties: inProperties }) {
            array = validatePropertyConfig(array);
            let properties = [];
            for (let p of inProperties) {
                let { desc, property } = typeof p === 'string' ? { property: p } : p;
                property = validatePropertyConfig(property);
                desc = toBoolean(desc) || undefined;
                properties.push({ property, desc });
            }
            if (properties.length > 0) {
                desc = undefined;
            } else {
                properties = undefined;
                desc = toBoolean(desc) || undefined;
            }
            return { array, properties, desc };
        },

        convert: function ({ array, properties, desc }, data) {
            toArray(data).forEach(e => {
                const a = e[array];
                if (!a) {
                    return;
                }
                assert(Array.isArray(a));
                a.sort((e1, e2) => {
                    if (!properties) {
                        let r = e2 === e1 ? 0 : (e1 > e2 ? -1 : 1);
                        desc && (r *= -1);
                        return r;
                    }
                    for (const { property, desc } of properties) {
                        const p1 = getDeepValue(e1, property);
                        const p2 = getDeepValue(e2, property);
                        if (p1 === p2) {
                            continue;
                        }
                        let r = p1 > p2 ? -1 : 1;
                        desc && (r *= -1);
                        return r;
                    }
                    return 0;
                });
            });
            return data;
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

const addConverter = (name, init, convert) => {
    validateString(name);
    assert(typeof init, 'function');
    assert(typeof convert, 'function');
    OBJECT_CONVERTERS[name] = { init, convert };
};

module.exports = { init, convert, addConverter };