const { QuickbooksApi } = require('.');
const { validateString } = require('../util');
const { getStore } = require('../store');

module.exports = class extends QuickbooksApi {

    #tokenStoreKey;

    constructor(config) {
        const { tokenStoreKey } = config;
        validateString(tokenStoreKey);
        super(config);
        this.#tokenStoreKey = tokenStoreKey;
    }

    async _getStoredToken() {
        return getStore().get(this.#tokenStoreKey);
    }

    _storeToken(token) {
        return getStore().set(this.#tokenStoreKey, token);
    }

};
