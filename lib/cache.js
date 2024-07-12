const assert = require('assert');

const DELIMITER = ',';

class Cache {
    static getKey(id, params) {
        params = Array.isArray(params) ? params.map(JSON.stringify).join(DELIMITER) : JSON.stringify(params);
        if (params.length > 0) {
            params += DELIMITER;
        }
        return id + '(' + params;
    }

    constructor() {
        this.cache = {};
    }

    clear() {
        if (arguments.length < 1) {
            this.cache = {};
            return;
        }
        const params = Array.from(arguments);
        const id = params.shift();
        const key = Cache.getKey(id, params);
        const deletedEntities = [];
        Object.keys(this.cache).forEach(prop => {
            if (prop.startsWith(key)) {
                deletedEntities.push(this.cache[prop].value);
                delete this.cache[prop];
            }
        });
        return deletedEntities;
    }

    cachify(f, id) {
        assert.equal(typeof f, 'function');
        id = id || f.name;
        assert(id);
        const self = this;
        return async function () {
            let key = Cache.getKey(id, Array.from(arguments));
            let result = self.cache[key];
            try {
                if (!result) {
                    result = f.apply(this, arguments);
                    if (result instanceof Promise) {
                        self.cache[key] = result = result.then(
                            value => self.cache[key] = { value },
                            error => self.cache[key] = { error }
                        );
                    } else {
                        self.cache[key] = result = { value: result };
                    }
                }
                if (result instanceof Promise) {
                    result = await result;
                }
            } catch (error) {
                result = self.cache[key] = { error };
            }
            if (result.error) {
                throw result.error;
            }
            return result.value;
        };
    }


    put(id, params, value) {
        this.cache[Cache.getKey(id, params)] = { value };
    }

}

module.exports = Cache;
