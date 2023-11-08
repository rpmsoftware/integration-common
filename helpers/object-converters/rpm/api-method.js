const { validateString, toArray, validatePropertyConfig, getDeepValue } = require('../../../util');
const { init: initCondition, process: processCondition } = require('../../../conditions');
const assert = require('assert');

module.exports = {
    init: function ({ dstProperty, parameters, condition, method }) {
        validateString(method);
        dstProperty = dstProperty ? validateString(dstProperty) : undefined;
        parameters = toArray(parameters).map(c => {
            let { value, property } = (c === null) ? { value: null } : c;
            if (value !== undefined) {
                property = undefined;
            } else if (!property) {
                property = c;
            }
            if (property) {
                value = undefined;
                property = validatePropertyConfig(property);
            } else {
                assert(value !== undefined);
            }
            return { value, property };
        });
        condition = condition ? initCondition(condition) : undefined;
        return { dstProperty, parameters, condition, method };
    },

    convert: async function ({ method, dstProperty, parameters, condition }, obj) {
        const { api } = this;
        for (const e of toArray(obj)) {
            if (condition && !processCondition(condition, e)) {
                continue;
            }
            const result = await api[method].apply(api, parameters.map(
                ({ value, property }) => value === undefined ? getDeepValue(e, property) : value)
            );
            dstProperty ? (e[dstProperty] = result) : Object.assign(e, result);

        }
        return obj;
    }
};
