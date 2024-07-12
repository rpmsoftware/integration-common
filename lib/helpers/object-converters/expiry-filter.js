const { getDeepValue, toArray, validatePropertyConfig, toBoolean } = require('../../util');
const assert = require('assert');
const hash = require('object-hash');

const PROPERTY_TIMESTAMPS = Symbol();

module.exports = {
    init: function ({ properties, ttl: ttlMs, hash }) {
        hash = (hash === undefined) || toBoolean(hash);
        ttlMs = +ttlMs;
        assert(ttlMs > 0);
        properties = toArray(properties).map(validatePropertyConfig);
        assert(properties.length > 0);
        properties.length > 1 && (hash = true);
        return { properties, ttl: ttlMs, hash };
    },

    convert: function (conf, data) {
        const { properties, ttl, hash: hashIt } = conf;
        const timestamps = conf[PROPERTY_TIMESTAMPS] || (conf[PROPERTY_TIMESTAMPS] = {});
        const now = Date.now();
        const newExpiry = now + ttl;
        const result = toArray(data).filter(obj => {
            let key = properties.map(p => getDeepValue(obj, p));
            hashIt && (key = hash(key));
            const expiry = timestamps[key];
            if (!expiry || expiry < now) {
                timestamps[key] = newExpiry;
                return true;
            }
        });
        for (const k in timestamps) {
            timestamps[k] < now && (delete timestamps[k]);
        }
        return result;
    }
};