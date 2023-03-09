const assert = require('assert');
const { normalizeInteger, toMoment } = require('../util');

module.exports = {

    init: ({ set, shift }) => {
        set = set || {};
        shift = shift || {};
        assert.strictEqual(typeof set, 'object');
        assert.strictEqual(typeof shift, 'object');
        for (const key in set) {
            set[key] = normalizeInteger(set[key]);
        }
        for (const key in shift) {
            shift[key] = normalizeInteger(shift[key]);
        }
        return { set, shift };
    },

    process: ({ set, shift }, dateTime) => {
        typeof dateTime === 'string' && (dateTime = dateTime.trim());
        if (!dateTime) {
            return;
        }
        dateTime = toMoment(dateTime);
        for (let unit in shift) {
            dateTime = dateTime.add(shift[unit], unit);
        }
        for (let unit in set) {
            dateTime = dateTime.set(unit, set[unit]);
        }
        assert(dateTime.isValid());
        return dateTime;
    }

};