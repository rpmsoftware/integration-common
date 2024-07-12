const { validatePropertyConfig, getDeepValue, validateString, toArray, toBoolean } = require('../../../util');
const { write } = require('xlsx');
const { init: initCondition, process: processCondition } = require('../../../conditions');

module.exports = {
    init: async function ({ srcProperty, dstProperty, bookType, type, cellDates, condition }) {
        validateString(dstProperty);
        srcProperty = validatePropertyConfig(srcProperty);
        bookType = bookType ? validateString(bookType) : 'xlsx';
        type = type ? validateString(type) : 'array';
        cellDates = cellDates === undefined || toBoolean(cellDates);
        condition = condition ? initCondition(condition) : undefined;
        return { srcProperty, dstProperty, bookType, type, cellDates, condition };
    },

    convert: async function ({ srcProperty, dstProperty, bookType, type, cellDates, condition }, data) {
        const options = { bookType, type, cellDates };
        toArray(data).forEach(e => {
            if (condition && !processCondition(condition, e)) {
                return;
            }
            const d = getDeepValue(e, srcProperty);
            e[dstProperty] = d ? write(d, options) : undefined;
        });
        return data;
    }
};