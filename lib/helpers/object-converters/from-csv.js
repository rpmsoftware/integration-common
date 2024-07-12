const { validateString, toArray, getDeepValue, validatePropertyConfig, } = require('../../util');
const { parse: parseCsv } = require('csv-parse/sync');

module.exports = {
    init: function ({ dstProperty, srcProperty }) {
        validateString(dstProperty);
        srcProperty = validatePropertyConfig(srcProperty);
        return { dstProperty, srcProperty };
    },

    convert: async function ({ dstProperty, srcProperty }, data) {
        const options = { columns: true };
        for (const e of toArray(data)) {
            const value = getDeepValue(e, srcProperty);
            value && (e[dstProperty] = parseCsv(value.trim(), options));
        }
        return data;
    }
};
