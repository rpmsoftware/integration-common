const { propertyOrValue } = require('./util');
const { validateString, toArray, toBoolean } = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');

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

module.exports = {
    init: function ({ srcProperty, dstProperty, parameters, condition, method, merge }) {
        method = method ? validateString(method) : undefined;
        dstProperty = dstProperty ? validateString(dstProperty) : undefined;
        srcProperty = srcProperty ? validateString(srcProperty) : undefined;
        parameters = toArray(parameters).map(initParameter);
        condition = condition ? initCondition(condition) : undefined;
        merge = toBoolean(merge) || undefined;
        return { srcProperty, dstProperty, parameters, condition, method, merge };
    },

    convert: async function (conf, obj) {
        let { method, dstProperty, parameters: paramConf, condition, getMethodContext, merge } = conf;
        (typeof getMethodContext === 'function') || (getMethodContext = e => e);
        for (const e of toArray(obj)) {
            if (condition && !processCondition(condition, e)) {
                continue;
            }
            const context = await getMethodContext(e);
            const params = paramConf.map(c => extractParameter(c, e));
            const r = await (method ? context[method].apply(context, params) : context(params));
            dstProperty ? (e[dstProperty] = r) : (merge && Object.assign(e, r));
        }
        return obj;
    }
};
