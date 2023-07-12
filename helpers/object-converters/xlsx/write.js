const { validatePropertyConfig, getDeepValue, validateString, toArray, toBoolean } = require('../../../util');
const { write } = require('xlsx');

module.exports = {
    init: async function ({ srcProperty, dstProperty, bookType, type, cellDates }) {
        validateString(dstProperty);
        srcProperty = validatePropertyConfig(srcProperty);
        bookType = bookType ? validateString(bookType) : 'xlsx';
        type = type ? validateString(type) : 'array';
        cellDates = cellDates === undefined || toBoolean(cellDates);
        return { srcProperty, dstProperty, bookType, type, cellDates };
    },

    convert: async function ({ srcProperty, dstProperty, bookType, type, cellDates }, data) {
        const options = { bookType, type, cellDates };
        toArray(data).forEach(e => {
            const d = getDeepValue(e, srcProperty);
            e[dstProperty] = d ? write(d, options) : undefined;
        });
        return data;
    }
};