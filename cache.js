const assert = require('assert');

function getKey(id, params) {
    params = Array.isArray(params) ? params.map(JSON.stringify).join(',') : JSON.stringify(params);
    return id + '(' + params + ')';
}

class Cache {
    constructor() {
        this.cache = {};
    }

    clear() {
        this.cache = {};
    }

    cachify(f, id) {
        assert.equal(typeof f, 'function');
        id = id || f.name;
        assert(id);
        const self = this;
        return async function () {
            let key = getKey(id, Array.from(arguments));
            let result = self.cache[key];
            if (!result) {
                try {
                    const value = await f.apply(this, arguments);
                    result = { value };
                } catch (error) {
                    result = { error };
                }
                self.cache[key] = result;
            }
            if (result.error) {
                throw result.error;
            }
            return result.value;
        };
    }


    put(id, params, value) {
        this.cache[getKey(id, params)] = { value };
    }

}

module.exports = Cache;
