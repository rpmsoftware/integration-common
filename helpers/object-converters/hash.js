const { validateString, toArray } = require('../../util');
const assert = require('assert');
const hash = require('object-hash');

module.exports = {
    init: function ({ dstProperty, properties }) {
        validateString(dstProperty);
        properties = toArray(properties);
        assert(properties.length > 0);
        properties.forEach(validateString);
        return { dstProperty, properties };
    },
    convert: function ({ dstProperty, properties }, obj) {
        for (const e of toArray(obj)) {
            e[dstProperty] = hash(properties.map(p => e[p]));
        }
        return obj;
    }
};


