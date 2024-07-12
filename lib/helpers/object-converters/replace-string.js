const { validateString, toArray, getDeepValue, validatePropertyConfig } = require('../../util');

module.exports = {
    init: function ({ dstProperty, srcProperty, regexp, flags, replacement }) {
        flags = flags ? validateString(flags) : undefined;
        dstProperty = validateString(dstProperty || srcProperty);
        replacement = replacement ? validateString(replacement) : '';
        validatePropertyConfig(srcProperty);
        validateString(regexp);
        return { dstProperty, srcProperty, regexp, flags, replacement };
    },

    convert: function (config, data) {
        let { dstProperty, srcProperty, regexp, flags, replacement } = config;
        regexp instanceof RegExp || (regexp = config.regexp = new RegExp(regexp, flags));
        toArray(data).forEach(obj => {
            const v = getDeepValue(obj, srcProperty);
            obj[dstProperty] = (v === undefined || typeof v === 'object') ? undefined :
                (v + '').replace(regexp, replacement);
        });
        return data;
    }
};