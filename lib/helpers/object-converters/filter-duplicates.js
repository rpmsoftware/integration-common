const { toArray, validatePropertyConfig, getDeepValue, validateString } = require('../../util');
const assert = require('assert');
const hash = require('object-hash');

const HASHES = {};

module.exports = {

    init: function ({ type, idProperty, duplicateProperties }) {
        type = type ? validateString(type) : '';
        idProperty = validatePropertyConfig(idProperty);
        duplicateProperties = duplicateProperties.map(validatePropertyConfig);
        assert(duplicateProperties.length > 0);
        return { type, idProperty, duplicateProperties };
    },

    convert: function ({ type, idProperty, duplicateProperties }, obj) {
        const hashes = HASHES[type] || (HASHES[type] = {});
        const result = toArray(obj).filter(e => {
            const id = getDeepValue(e, idProperty);
            const newHash = hash(duplicateProperties.map(prop => getDeepValue(e, prop)));
            const savedHash = hashes[id];
            const include = savedHash !== newHash;
            include && (hashes[id] = newHash);
            return include;
        });
        console.log('HASHES: %j', hashes);
        return result;
    }
};
