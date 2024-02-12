const { Store } = require('./common');
const assert = require('assert');

const MEMCACHE_PROPERTY = 'memcache';

let hash;
const getHash = value => {
    hash || (hash = require('object-hash'));
    return hash(value);
};

module.exports = {
    cachedInit: async function (config, cbInit) {
        assert(this instanceof Store);
        let key = config[MEMCACHE_PROPERTY];
        if (!key) {
            return cbInit(config);
        }
        const checksum = getHash(config);
        let cached = await this.get(key);
        if (cached && cached.checksum === checksum) {
            return cached.value;
        }
        const value = await cbInit(config);
        await this.set(key, { checksum, value });
        return value;
    },

    createStore: conf => {
        typeof conf === 'string' && (conf = { provider: conf });
        return require('./' + conf.provider)(conf);
    },

    Store
};
