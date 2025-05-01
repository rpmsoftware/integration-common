const {
    validateString, toArray, getEager, toBoolean, getDeepValue, isEmptyValue,
    isEmpty, validatePropertyConfig, normalizeInteger, createParallelRunner
} = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');
const assert = require('assert');
const { ObjectType } = require('../../api-enums');

const DEFAULT_CONVERTER = 'getter';

async function init(conf) {
    const result = [];
    for (let c of conf ? toArray(conf) : []) {
        let { name, enabled, throwError, errorProperty } = c;
        if (enabled !== undefined && !toBoolean(enabled)) {
            continue;
        }
        name || (name = DEFAULT_CONVERTER);
        const { init } = OBJECT_CONVERTERS[name] || require('./' + name);
        c = init ? await init.call(this, c) : {};
        c.name || (c.name = name);
        c.throwError = throwError === undefined || toBoolean(throwError);
        c.errorProperty = errorProperty ? validateString(errorProperty) : undefined;
        result.push(c);
    }
    return result;
}

async function convert(conf, obj) {
    for (let c of conf) {
        const { name, throwError, errorProperty } = c;
        try {
            obj = await (OBJECT_CONVERTERS[name] || require('./' + name)).convert.call(this, c, obj);
            errorProperty && delete obj[errorProperty];
        } catch (error) {
            if (errorProperty) {
                obj[errorProperty] = error;
            } else if (throwError) {
                throw error;
            }
            console.error(error);
        }
        if (isEmptyValue(obj) || toArray(obj).length < 1) {
            break;
        }
    }
    return obj;
}

const PARENT_PROPERTY = '_parent';
const KEY_PROPERTY = '_key';

const OBJECT_CONVERTERS = {

    flatten: {
        init: ({ array, forceChildProperties }) => {
            array = toArray(array).map(validateString);
            assert(array.length > 0);
            forceChildProperties = toBoolean(forceChildProperties) || undefined;
            return { array, forceChildProperties };
        },
        convert: ({ array, forceChildProperties }, obj) => {
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
                    child = Object.assign({},
                        forceChildProperties ? parent : child,
                        forceChildProperties ? child : parent
                    );
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
        init: async function ({ condition, single }) {
            condition = initCondition(condition);
            single = toBoolean(single) || undefined;
            return { condition, single };
        },
        convert: async function ({ condition, single }, obj) {
            let result = toArray(obj).filter(e => processCondition(condition, e));
            if (single) {
                assert(result.length < 2);
                result = result[0];
            }
            return result;
        }
    },

    filterArray: {
        init: async function ({ condition, dstProperty, array }) {
            dstProperty = validateString(dstProperty || array);
            validatePropertyConfig(array);
            condition = initCondition(condition);
            return { condition, dstProperty, array };
        },
        convert: async function ({ array: arrayProperty, condition, dstProperty }, obj) {
            for (const parent of toArray(obj)) {
                const srcContainer = getDeepValue(parent, arrayProperty);
                if (!srcContainer) {
                    continue;
                }
                const array = Array.isArray(srcContainer);
                const r = array ? [] : {};
                for (let k in srcContainer) {
                    const e = srcContainer[k];
                    e[PARENT_PROPERTY] = parent;
                    processCondition(condition, e) && (array ? r.push(e) : (r[k] = e));
                    delete e[PARENT_PROPERTY];
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

    toFlatArray: {
        init: function ({ properties, dstProperty, unique }) {
            validateString(dstProperty);
            properties = properties.map(p => toArray(validatePropertyConfig(p)));
            assert(properties.length > 0);
            unique = toBoolean(unique) || undefined;
            return { properties, dstProperty, unique };
        },
        convert: function ({ properties: propertiesConf, dstProperty, unique }, obj) {
            toArray(obj).forEach(e => {
                let result = [];
                propertiesConf.forEach(properties => {
                    const process = (value, level) => {
                        if (typeof value !== 'object') {
                            return;
                        }
                        level > 0 || (level = 0);
                        const property = properties[level];
                        if (!property) {
                            return;
                        }
                        value = value[property];
                        if (value === undefined) {
                            return;
                        }
                        ++level;
                        level >= properties.length ?
                            (unique && result.indexOf(value) >= 0 || result.push(value)) :
                            (Array.isArray(value) ? value.forEach(e => process(e, level)) : process(value, level));
                    };
                    process(e);
                });
                e[dstProperty] = result;
            });
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
            const runner = createParallelRunner(parallel || 1);
            if (arrayProperty) {
                const promises = [];
                for (const parent of toArray(obj)) {
                    const array = getDeepValue(parent, arrayProperty);
                    if (typeof array !== 'object') {
                        continue;
                    }
                    const isArray = Array.isArray(array);
                    for (let key in array) {
                        isArray && (key = +key);
                        const e = array[key];
                        Object.defineProperty(e, PARENT_PROPERTY, { value: parent, configurable: true });
                        Object.defineProperty(e, KEY_PROPERTY, { value: key, configurable: true });
                        if (condition && !processCondition(condition, e)) {
                            continue;
                        }
                        promises.push(runner(async () => array[key] = await convert.call(this, convertConf, e)));
                    }
                }
                await Promise.all(promises);
            } else {
                obj = await Promise.all(toArray(obj).map(e =>
                    condition && !processCondition(condition, e) ? e :
                        runner(() => convert.call(this, convertConf, e))
                ));
            }
            return obj;
        }
    },

    forProperty: {
        init: async function ({ srcProperty, dstProperty, convert }) {
            dstProperty = dstProperty ? validateString(dstProperty) : undefined;
            srcProperty = validatePropertyConfig(srcProperty);
            convert = await init.call(this, convert);
            return { srcProperty, convert, dstProperty };
        },
        convert: async function ({ srcProperty, convert: convertConf, dstProperty }, data) {
            for (const e of toArray(data)) {
                let o = getDeepValue(e, srcProperty);
                if (o) {
                    toArray(o).forEach(o =>
                        Object.defineProperty(o, PARENT_PROPERTY, { value: e, configurable: true })
                    );
                    const r = await convert.call(this, convertConf, o);
                    dstProperty && (e[dstProperty] = r);
                    toArray(o).forEach(o => delete o[PARENT_PROPERTY]);
                }
            }
            return data;
        }
    },

    valueMap: {
        init: function (conf) {

            const initSingle = (dstProperty, { property, keyProperty, valueMap, propertyMap }) => {
                validateString(dstProperty);
                keyProperty = validatePropertyConfig(keyProperty || property || dstProperty);
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
                        (!condition || processCondition(condition, c)) && (e[destination] = e[destination] + (+c[total] || 0));
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
                    if (!a) {
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
            deleteSources = toBoolean(deleteSources) || undefined;
            arrays = toArray(arrays);
            assert(arrays.length > 0);
            arrays = arrays.map(deleteSources ? validateString : validatePropertyConfig);
            return { arrays, dstProperty, deleteSources };
        },

        convert: function ({ arrays, dstProperty, deleteSources }, data) {
            toArray(data).forEach(e => {
                let result = [];
                arrays.forEach(prop => {
                    let a = getDeepValue(e, prop);
                    if (a === undefined) {
                        return;
                    }
                    result = result.concat(Array.isArray(a) ? a : Object.values(a));
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
        init: function ({ array, group, properties: inProperties }) {
            array = array ? validateString(array) : undefined;
            group = toArray(group);
            assert(group.length > 0);
            group.forEach(validateString);
            const properties = {};
            let initialized = false;
            const ctx = {};
            for (const destination in inProperties) {
                const src = inProperties[destination];
                let { total, condition } = typeof src === 'object' ? src : { total: src };
                validateString(total);
                condition = condition ? initCondition.call(ctx, condition) : undefined;
                properties[destination] = { total, condition };
                initialized = true;
            }
            assert(initialized);
            return { array, group, properties };
        },

        convert: function ({ array, group, properties }, data) {

            const processArray = a => {
                assert(Array.isArray(a));
                const result = a.group(PROP_CHILDREN, group);
                result.forEach(e => {
                    e[PROP_CHILDREN].forEach(c => {
                        for (const destination in properties) {
                            const { total, condition } = properties[destination];
                            e[destination] === undefined && (e[destination] = 0);
                            condition && !processCondition(condition, c) || (e[destination] = e[destination] + (+c[total] || 0));
                        }
                    })
                    delete e[PROP_CHILDREN];
                });
                return result
            };

            if (array) {
                toArray(data).forEach(e => {
                    const a = e[array];
                    a && (e[array] = processArray(a));
                });
                return data;
            }
            return processArray(data);
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
            for (let p of toArray(inProperties)) {
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
    },

    if: {
        init: async function ({ condition, convert }) {
            condition = initCondition(condition);
            convert = await init.call(this, convert);
            return { convert, condition };
        },
        convert: async function ({ convert: convertConf, condition }, obj) {
            for (const e of toArray(obj)) {
                processCondition(condition, e) && await convert.call(this, convertConf, e);
            }
            return obj;
        }
    },

    processCondition: {
        init: async function ({ condition, dstProperty, conditions: inConditions }) {
            if (!inConditions) {
                inConditions = {};
                inConditions[validateString(dstProperty)] = condition;
            }
            const conditions = {};
            for (dstProperty in inConditions) {
                conditions[dstProperty] = initCondition(inConditions[dstProperty]);
            }
            assert(!isEmpty(inConditions));
            return { conditions };
        },

        convert: async function ({ conditions }, obj) {
            for (const e of toArray(obj)) {
                for (const dstProperty in conditions) {
                    e[dstProperty] = processCondition(conditions[dstProperty], e);
                }
            }
            return obj;
        }
    },

    blank: {
        init: function () {
            return {};
        },

        convert: function () {
            return {};
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