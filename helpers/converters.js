const assert = require('assert');
const { toBoolean } = require('../util');

module.exports = {
    number: value => {
        const result = +value;
        assert(!isNaN(result), value);
        return result;
    },
    boolean: value => toBoolean(value)
};
