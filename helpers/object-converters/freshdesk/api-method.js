const { validateString, toArray, validatePropertyConfig, getDeepValue } = require('../../../util');
const { init: initCondition, process: processCondition } = require('../../../conditions');
const assert = require('assert');
const { getFreshDeskApi } = require('./util');

module.exports = {
    init: function ({ dstProperty, parameters, condition, method }) {
        validateString(method);
        validateString(dstProperty);
        parameters = toArray(parameters);
        parameters = parameters.map(c => {
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
        const api = getFreshDeskApi.call(this);
        for (const e of toArray(obj)) {
            (!condition || processCondition(condition, e)) && (
                e[dstProperty] = await api[method].apply(api, parameters.map(
                    ({ value, property }) => value === undefined ? getDeepValue(e, property) : value)
                )
            );
        }
        return obj;
    }
};
