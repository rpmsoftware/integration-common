const { validatePropertyConfig, getDeepValue, validateString, toArray } = require('../../../util');
const { write } = require('xlsx');

module.exports = {
    init: async function ({ srcProperty, dstProperty, bookType, type }) {
        validateString(dstProperty);
        srcProperty = validatePropertyConfig(srcProperty);
        bookType = bookType ? validateString(bookType) : 'xlsx';
        type = type ? validateString(type) : 'array';
        return { srcProperty, dstProperty, bookType, type };
    },

    convert: async function ({ srcProperty, dstProperty, bookType, type }, data) {
        const options = { bookType, type };
        toArray(data).forEach(e => {
            const d = getDeepValue(e, srcProperty);
            e[dstProperty] = d ? write(d, options) : undefined;
        });
        return data;
    }
};