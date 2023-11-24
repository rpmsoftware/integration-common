const { validateString, toArray, validatePropertyConfig, getDeepValue, toBoolean, isEmptyValue } = require('../../util');
const assert = require('assert');
const hash = require('object-hash');
const { init: initCondition, process: processCondition } = require('../../conditions');

module.exports = {

    init: function ({ dstProperty, properties, condition, normalize }) {
        validateString(dstProperty);
        properties = toArray(properties);
        assert(properties.length > 0);
        properties = properties.map(validatePropertyConfig);
        condition = condition ? initCondition(condition) : undefined;
        normalize = toBoolean(normalize) || undefined;
        return { dstProperty, properties, condition, normalize };
    },

    convert: function ({ dstProperty, properties, condition, normalize }, obj) {
        const emptyString = '';
        normalize = normalize ?
            v => isEmptyValue(v) ? emptyString : (v + emptyString) :
            v => v;
        for (const e of toArray(obj)) {
            (!condition || processCondition(condition, e)) &&
                (e[dstProperty] = hash(properties.map(p => normalize(getDeepValue(e, p)))));
        }
        return obj;
    }
};
