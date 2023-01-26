const { isEmpty, toArray, validatePropertyConfig, getDeepValue } = require('../../util');
const assert = require('assert');
const hash = require('object-hash');

module.exports = {
    init: function ({ properties }) {
        properties = toArray(properties);
        assert(properties.length > 0);
        properties = properties.map(validatePropertyConfig);
        return { properties };
    },
    convert: function ({ properties }, obj) {
        const uniqueObjects = {};
        let duplicates = {};
        for (const e of toArray(obj)) {
            const values = properties.map(p => getDeepValue(e, p));
            const h = hash(values);
            const d = uniqueObjects[h];
            d ?
                (duplicates[h] || (duplicates[h] = values)) :
                (uniqueObjects[h] = true);

        }
        if (!isEmpty(duplicates)) {
            duplicates = Object.values(duplicates).map(values => values.join(',')).join('\n');
            throw new Error(`Duplicate entries found:\n${duplicates}`);
        }
        return obj;
    }
};
