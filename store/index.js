const { Store } = require('./common');
const assert = require('assert');
const { getGlobal } = require('../util')

const MEMCACHE_PROPERTY = 'memcache';
const GLOBAL_CONFIG_KEY = 'keyValueStore';
const DEFAULT_CONF = {
    provider: 'memjs'
};
const PROP_STORE = Symbol();

let hash;
const getHash = value => {
    hash || (hash = require('object-hash'));
    return hash(value);
};

const createStore = conf => {
    typeof conf === 'string' && (conf = { provider: conf });
    return require('./' + conf.provider)(conf);
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

    createStore,

    getStore: () => {
        const g = getGlobal();
        let result = g[PROP_STORE];
        if (!result) {
            result = createStore(g[GLOBAL_CONFIG_KEY] || DEFAULT_CONF);
            Object.defineProperty(g, PROP_STORE, { value: result, configurable: true });
        }
        return result;
    },

    Store
};
