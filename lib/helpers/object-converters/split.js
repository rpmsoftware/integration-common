const { validateString, toArray, validatePropertyConfig, getDeepValue, isEmptyValue } = require('../../util');

module.exports = {

    init: function ({ srcProperty, dstProperty, delimiter }) {
        validateString(dstProperty);
        srcProperty = validatePropertyConfig(srcProperty);
        validateString(delimiter);
        return { srcProperty, dstProperty, delimiter };
    },

    convert: function ({ srcProperty, dstProperty, delimiter }, obj) {
        for (const e of toArray(obj)) {
            const v = getDeepValue(e, srcProperty);
            e[dstProperty] = isEmptyValue(v) ? [] : (v + '').split(delimiter);
        }
        return obj;
    }

};