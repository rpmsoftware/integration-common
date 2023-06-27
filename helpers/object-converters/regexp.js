const { validateString, toArray, getDeepValue, validatePropertyConfig } = require('../../util');

module.exports = {
    init: function ({ dstProperty, srcProperty, regexp, flags }) {
        flags = flags ? validateString(flags) : undefined;
        validateString(dstProperty);
        validatePropertyConfig(srcProperty);
        validateString(regexp);
        return { dstProperty, srcProperty, regexp, flags };
    },

    convert: function (config, data) {
        let { dstProperty, srcProperty, regexp, flags } = config;
        regexp instanceof RegExp || (regexp = config.regexp = new RegExp(regexp, flags));
        toArray(data).forEach(obj => {
            let v = getDeepValue(obj, srcProperty);
            if (typeof v === 'string') {
                const a = regexp.exec(v);
                v = a ? a[1] : undefined;
            } else {
                v = undefined;
            }
            obj[dstProperty] = v;
            return data;
        });
        return data;
    }
};