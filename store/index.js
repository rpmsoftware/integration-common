const Store = require('./common').Store;
const assert = require('assert');

const MEMCACHE_PROPERTY = 'memcache';

let hash;
function getHash(value) {
    if (!hash) {
        hash = require('object-hash');
    }
    return hash(value);
}

exports.cachedInit = async function (config, cbInit) {
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
};

exports.createStore = function (module, ...parms) {
    return require('./' + module).apply(undefined, parms);
}