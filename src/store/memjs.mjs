import { Client } from 'memjs';
import { validateString } from '../util.mjs';
import { Store } from './common.mjs';

class MemJsClient extends Store {

    constructor(conf) {
        super();
        const { servers, options } = conf || {};
        if (servers) {
            this.core = Client.create(validateString(servers), options ? Object.assign({}, options) : undefined);
        } else {
            const {
                MEMCACHEDCLOUD_SERVERS: servers,
                MEMCACHEDCLOUD_USERNAME: username,
                MEMCACHEDCLOUD_PASSWORD: password
            } = process.env;
            this.core = servers ?
                Client.create(servers, { username, password }) :
                Client.create();
        }
    }

    _set(key, value) {
        return value ? this.core.set(key, value, {}) : this.core.delete(key);
    }

    async _get(key) {
        return (await this.core.get(key)).value;
    }

    flush() {
        return this.core.flush();
    }

    close() {
        this.core.quit();
    }
}

export default function (conf) {
    return new MemJsClient(conf);
};
