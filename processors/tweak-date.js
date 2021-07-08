const NAME = 'tweakDate';

const assert = require('assert');
const { toBoolean, normalizeInteger, toMoment } = require('../util');
const dayjs = require('dayjs');

module.exports = {

    name: NAME,

    init: function ({ set, shift, testDate }) {
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
        return { set, shift, testDate: toBoolean(testDate) || undefined };
    },

    process: function ({ set, shift, testDate }, dateTime) {
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
        const now = dayjs().add(1, 'minute');
        if (testDate && now.isAfter(testDate)) {
            dateTime = dateTime.hour(now.hour()).minute(now.minute()).second(now.second());
        }
        assert(dateTime.isValid());
        return dateTime;
    }

};