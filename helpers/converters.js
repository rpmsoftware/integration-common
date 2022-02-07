const assert = require('assert');
const { toBoolean } = require('../util');

module.exports = {
    number: value => {
        if (value === '' || value === null) {
            return undefined;
        }
        const result = +value;
        assert(!isNaN(result), value);
        return result;
    },
    boolean: value => toBoolean(value)
};
