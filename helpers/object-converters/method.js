const { propertyOrValue } = require('./util');
const { validateString, toArray } = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');

module.exports = {
    init: function ({ srcProperty, dstProperty, parameters, condition, method }) {
        validateString(method);
        dstProperty = dstProperty ? validateString(dstProperty) : undefined;
        srcProperty = srcProperty ? validateString(srcProperty) : undefined;
        parameters = toArray(parameters);
        parameters = parameters.map(propertyOrValue.init);
        condition = condition ? initCondition(condition) : undefined;
        return { srcProperty, dstProperty, parameters, condition, method };
    },

    convert: async function ({ method, dstProperty, parameters, condition, getMethodContext }, obj) {
        (typeof getMethodContext === 'function') || (getMethodContext = e => e);
        for (const e of toArray(obj)) {
            if (condition && !processCondition(condition, e)) {
                continue;
            }
            const context = await getMethodContext(e);
            const r = await context[method].apply(context, parameters.map(c => propertyOrValue.get(c, e)));
            dstProperty && (e[dstProperty] = r);
        }
        return obj;
    }
};
