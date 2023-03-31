const { isEmpty, toArray, validatePropertyConfig, getDeepValue, toBoolean } = require('../../util');
const assert = require('assert');
const hash = require('object-hash');

module.exports = {
    init: function ({ properties, ignoreEmpty, removeDuplicates }) {
        ignoreEmpty = toBoolean(ignoreEmpty) || undefined;
        removeDuplicates = toBoolean(removeDuplicates) || undefined;
        properties = toArray(properties);
        assert(properties.length > 0);
        properties = properties.map(validatePropertyConfig);
        return { properties, ignoreEmpty, removeDuplicates };
    },
    convert: function ({ properties, ignoreEmpty, removeDuplicates }, obj) {
        const objectsByHash = {};
        let duplicates = {};
        if (Array.isArray(obj)) {
            for (const e of obj) {
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
                const d = objectsByHash[h] || (objectsByHash[h] = []);
                d.push(e);
                d.length > 1 && !duplicates[h] && (duplicates[h] = values);
            }
            if (isEmpty(duplicates)) {
                // do nothing
            } else if (removeDuplicates) {
                obj = [];
                for (let o in objectsByHash) {
                    o = objectsByHash[o];
                    o.length < 2 && (obj = obj.concat(o));
                }
            } else {
                duplicates = Object.values(duplicates).map(values => values.join(',')).join('\n');
                throw new Error(`Duplicate entries found:\n${duplicates}`);
            }
        }
        return obj;
    }
};
