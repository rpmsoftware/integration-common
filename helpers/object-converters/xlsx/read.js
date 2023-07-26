const { validatePropertyConfig, getDeepValue, toBuffer, validateString, toArray } = require('../../../util');
const { read: readExcel } = require('xlsx');

const OPTIONS = { dense: true, cellDates: true };

module.exports = {
    init: async function ({ srcProperty, dstProperty }) {
        validateString(dstProperty);
        srcProperty = validatePropertyConfig(srcProperty);
        return { srcProperty, dstProperty };
    },

    convert: async function ({ srcProperty, dstProperty }, data) {
        toArray(data).forEach(e => {
            const d = getDeepValue(e, srcProperty);
            d && (e[dstProperty] = readExcel(toBuffer(d), OPTIONS));
        });
        return data;
    }
};