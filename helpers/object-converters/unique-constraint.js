const { isEmpty, toArray, validatePropertyConfig, getDeepValue, toBoolean } = require('../../util');
const assert = require('assert');
const hash = require('object-hash');

module.exports = {
    init: function ({ properties, ignoreEmpty }) {
        ignoreEmpty = toBoolean(ignoreEmpty) || undefined;
        properties = toArray(properties);
        assert(properties.length > 0);
        properties = properties.map(validatePropertyConfig);
        return { properties, ignoreEmpty };
    },
    convert: function ({ properties, ignoreEmpty }, obj) {
        const uniqueObjects = {};
        let duplicates = {};
        for (const e of toArray(obj)) {
            let empty = true;
            const values = properties.map(p => {
                const r = getDeepValue(e, p);
                empty = empty && (r === undefined || r === null || r === '');
                return r;
            });

            if (empty && ignoreEmpty) {

                continue;
            }
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
