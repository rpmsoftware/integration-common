const { validateString, toArray, validatePropertyConfig, getDeepValue } = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');

module.exports = {
    init: function ({ dstProperty, parameters, condition, method }) {
        validateString(method);
        validateString(dstProperty);
        parameters = toArray(parameters);
        parameters = parameters.map(validatePropertyConfig);
        condition = condition ? initCondition(condition) : undefined;
        return { dstProperty, parameters, condition, method };
    },
    convert: async function ({ method, dstProperty, parameters, condition }, obj) {
        for (const e of toArray(obj)) {
            (!condition || processCondition(condition, e)) &&
                (e[dstProperty] = await e[method].apply(e, parameters.map(p => getDeepValue(e, p))));
        }
        return obj;
    }
};
