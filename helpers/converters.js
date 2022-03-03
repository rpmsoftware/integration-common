const assert = require('assert');
const { toBoolean } = require('../util');
const dayjs = require('dayjs');
const { ISO_DATE_FORMAT } = require('../api-wrappers');

module.exports = {
    number: value => {
        const result = +value;
        assert(!isNaN(result), value);
        return result;
    },
    boolean: value => toBoolean(value),
    isoDate: value => {
        if (!value) {
            return;
        }
        value = dayjs(value);
        assert(value.isValid());
        return value.format(ISO_DATE_FORMAT);
    }
};
