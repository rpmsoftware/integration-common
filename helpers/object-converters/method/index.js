const { propertyOrValue } = require('../util');
const { validateString, toArray, toBoolean, getGlobal, getEager } = require('../../../util');
const { init: initCondition, process: processCondition } = require('../../../conditions');
const assert = require('assert');

const initParameter = conf => {
    let result;
    if (typeof conf === 'object' && conf.value === undefined && conf.property === undefined) {
        result = Array.isArray(conf) ? [] : {};
        for (const k in conf) {
            result[k] = initParameter(conf[k]);
        }
    } else {
        result = propertyOrValue.init(conf);
    }
    return result;
};

const extractParameter = (conf, data) => {
    let result;
    if (conf.value === undefined && conf.property === undefined) {
        result = Array.isArray(conf) ? [] : {};
        for (const k in conf) {
            result[k] = extractParameter(conf[k], data);
        }
    } else {
        result = propertyOrValue.get(conf, data);
    }
    return result;
};

const PROP_INSTANCES = Symbol();

const getInstances = () => {
    const g = getGlobal();
    let instances = g[PROP_INSTANCES];
    instances || (instances = {}) && Object.defineProperty(g, PROP_INSTANCES, { value: instances });
    return instances;
};

module.exports = {
    init: function ({ srcProperty, dstProperty, parameters, condition, method, merge, contextFactory }) {
        method = method ? validateString(method) : undefined;
        dstProperty = dstProperty ? validateString(dstProperty) : undefined;
        srcProperty = srcProperty ? validateString(srcProperty) : undefined;
        parameters = toArray(parameters).map(initParameter);
        condition = condition ? initCondition(condition) : undefined;
        merge = toBoolean(merge) || undefined;
        contextFactory ? getEager(getGlobal(), validateString(contextFactory)) : (contextFactory = undefined);
        return { srcProperty, dstProperty, parameters, condition, method, merge, contextFactory };
    },

    convert: async function (conf, obj) {
        let { method, dstProperty, parameters: paramConf, condition, getMethodContext, merge, contextFactory } = conf;
        if (getMethodContext !== 'function') {
            if (contextFactory) {
                const instances = getInstances();
                getMethodContext = instances[contextFactory];
                if (!getMethodContext) {
                    let contextConf = getEager(getGlobal(), contextFactory);
                    typeof contextConf === 'string' && (contextConf = { name: contextConf });
                    getMethodContext = instances[contextFactory] = await require(`./${contextConf.name}`)(contextConf);
                }
                assert.strictEqual(typeof getMethodContext, 'function');
            } else {
                getMethodContext = e => e;
            }
            conf.getMethodContext = getMethodContext;
        }
        for (const e of toArray(obj)) {
            if (condition && !processCondition(condition, e)) {
                continue;
            }
            const context = await getMethodContext(e);
            const params = paramConf.map(c => extractParameter(c, e));
            const r = await (method ? context[method].apply(context, params) : context.apply(undefined, params));
            dstProperty ? (e[dstProperty] = r) : (merge && Object.assign(e, r));
        }
        return obj;
    }
};