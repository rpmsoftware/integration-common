const { validateString, toArray, validatePropertyConfig, getDeepValue } = require('../../util');
const assert = require('assert');
const hash = require('object-hash');
const { init: initCondition, process: processCondition } = require('../../conditions');

module.exports = {
    init: function ({ dstProperty, properties, condition }) {
        validateString(dstProperty);
        properties = toArray(properties);
        assert(properties.length > 0);
        properties = properties.map(validatePropertyConfig);
        condition = condition ? initCondition(condition) : undefined;
        return { dstProperty, properties, condition };
    },
    convert: function ({ dstProperty, properties, condition }, obj) {
        for (const e of toArray(obj)) {
            (!condition || processCondition(condition, e)) &&
                (e[dstProperty] = hash(properties.map(p => getDeepValue(e, p))));
        }
        return obj;
    }
};
