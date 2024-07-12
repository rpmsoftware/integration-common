const { validateString, toArray, toMoment } = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');
const { init: initPropVal, get: getPropVal } = require('../property-value');

const NOW = 'now';

module.exports = {
    init: function ({ dstProperty, srcDate, condition, format, set, shift }) {
        dstProperty = validateString(dstProperty);
        srcDate = initPropVal(srcDate);
        typeof set === 'object' || (set = {});
        for (let k in set) {
            set[k] = initPropVal(set[k]);
        }
        typeof shift === 'object' || (shift = {});
        for (let k in shift) {
            shift[k] = initPropVal(shift[k]);
        }
        condition = condition ? initCondition(condition) : undefined;
        format = format ? validateString(format) : undefined;
        return { dstProperty, srcDate, condition, format, set, shift };
    },

    convert: function ({ dstProperty, srcDate, condition, format, set, shift }, obj) {
        for (const e of toArray(obj)) {
            if (condition && !processCondition(condition, e)) {
                continue;
            }
            let dateTime = getPropVal(srcDate, e);
            typeof dateTime === 'string' && !(dateTime = dateTime.trim().toLowerCase()) && (dateTime = undefined);
            if (dateTime === undefined) {
                continue;
            }
            dateTime = toMoment(dateTime === NOW ? undefined : dateTime);
            for (const unit in shift) {
                const v = +getPropVal(shift[unit], e);
                v && (dateTime = dateTime.add(v, unit));
            }
            for (const unit in set) {
                const v = +getPropVal(set[unit], e);
                v && (dateTime = dateTime.set(unit, v));
            }
            e[dstProperty] = dateTime.isValid() ? dateTime.format(format) : undefined;
        }
        return obj;
    }
};
