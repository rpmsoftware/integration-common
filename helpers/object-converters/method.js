const { propertyOrValue } = require('./util');
const { validateString, toArray, toBoolean } = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');

module.exports = {
    init: function ({ srcProperty, dstProperty, parameters, condition, method, merge }) {
        validateString(method);
        dstProperty = dstProperty ? validateString(dstProperty) : undefined;
        srcProperty = srcProperty ? validateString(srcProperty) : undefined;

        typeof parameters === 'object' && !Array.isArray(parameters) || (parameters = toArray(parameters));
        for (const k in parameters) {
            parameters[k] = propertyOrValue.init(parameters[k]);
        }

        condition = condition ? initCondition(condition) : undefined;
        merge = toBoolean(merge) || undefined;
        return { srcProperty, dstProperty, parameters, condition, method, merge };
    },

    convert: async function (conf, obj) {
        let { method, dstProperty, parameters, condition, getMethodContext, merge, extractParams } = conf;
        (typeof getMethodContext === 'function') || (getMethodContext = e => e);
        extractParams || (extractParams = conf.extractParams =
            Array.isArray(parameters) ?
                e => parameters.map(c => propertyOrValue.get(c, e)) :
                e => {
                    const r = {};
                    for (const k in parameters) {
                        r[k] = propertyOrValue.get(parameters[k], e);
                    }
                    return [r];
                }
        );

        for (const e of toArray(obj)) {
            if (condition && !processCondition(condition, e)) {
                continue;
            }
            const context = await getMethodContext(e);
            const r = await context[method].apply(context, extractParams(e));
            dstProperty ? (e[dstProperty] = r) : (merge && Object.assign(e, r));
        }
        return obj;
    }
};
