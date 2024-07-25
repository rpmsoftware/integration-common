/* global process */

const { Client } = require('memjs');
const { validateString } = require('../util');

class MemJsClient extends require('./common').Store {

    constructor(conf) {
        super();
        const { servers, options } = conf || {};
        if (servers) {
            this.core = Client.create(validateString(servers), options ? Object.assign({}, options) : undefined);
        } else {
            this.core = process.env.MEMCACHEDCLOUD_SERVERS ?
                Client.create(process.env.MEMCACHEDCLOUD_SERVERS, {
                    username: process.env.MEMCACHEDCLOUD_USERNAME,
                    password: process.env.MEMCACHEDCLOUD_PASSWORD
                }) :
                Client.create();
        }
    }

    _set(key, value) {
        return value ? this.core.set(key, value, {}) : this.core.delete(key);
    }

    async _get(key) {
        const result = await this.core.get(key);
        return result.value;
    }

    flush() {
        return this.core.flush();
    }

    close() {
        this.core.quit();
    }
}

module.exports = function (conf) {
    return new MemJsClient(conf);
};
