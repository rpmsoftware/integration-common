const { validateString, fetch, toArray, toBoolean } = require('./util');
const debug = require('debug')('rpm:heroku');
const assert = require('assert');

const DEFAULT_HEADERS = {
    'Content-Type': 'application/json',
    Accept: 'application/vnd.heroku+json; version=3'
};
const BASE_URL = 'https://api.heroku.com/';

class HerokuApi {

    #headers

    constructor({ apiKey }) {
        validateString(apiKey);
        this.#headers = Object.assign({ Authorization: `Bearer ${apiKey}` }, DEFAULT_HEADERS);
    }

    _request(method, endpoint, data) {
        const url = BASE_URL + endpoint;
        data || (data = undefined);
        debug('%s %s', method, url);
        data && debug('%j', data);
        return fetch(url, { method, headers: this.#headers }).then(r => r.json());
    }

    _get(endpoint) {
        return this._request('GET', endpoint);
    }

    _patch(endpoint, data) {
        assert.strictEqual(typeof data, 'object');
        return this._request('PATCH', endpoint, data);
    }

    _post(endpoint, data) {
        assert.strictEqual(typeof data, 'object');
        return this._request('POST', endpoint, data);
    }

    getApps() {
        return this._get('apps');
    }

    getStack(id) {
        validateString(id);
        return this._get(`stacks/${id}`);
    }

    getStacks() {
        return this._get('stacks');
    }

    getDynos(appNameOrID) {
        validateString(appNameOrID)
        return this._get(`apps/${appNameOrID}/dynos`);
    }

    getAddons(appNameOrID) {
        validateString(appNameOrID)
        return this._get(`apps/${appNameOrID}/addons`);
    }


    getAddon(addonNameOrID) {
        validateString(addonNameOrID)
        return this._get(`addons/${addonNameOrID}`);
    }

    getAddonConfig(addonNameOrID) {
        validateString(addonNameOrID)
        return this._get(`addons/${addonNameOrID}/config`);
    }

    getApp(appNameOrID) {
        validateString(appNameOrID)
        return this._get(`apps/${appNameOrID}`);
    }

    getAppConfig(appNameOrID) {
        validateString(appNameOrID)
        return this._get(`apps/${appNameOrID}/config-vars`);
    }

    setAppConfig(appNameOrID, data) {
        assert.strictEqual(typeof data, 'object');
        for (const k in data) {
            validateString(data[k]);
        }
        return this._patch(`apps/${appNameOrID}/config-vars`, data);
    }

    getAppWebhooks(appNameOrID) {
        validateString(appNameOrID)
        return this._get(`apps/${appNameOrID}/webhooks`);
    }

    createAppWebhook(appNameOrID, { include, sync: level, url, secret }) {
        validateString(appNameOrID);
        level = toBoolean(level) ? 'sync' : 'notify';
        validateString(url);
        secret = secret ? validateString(secret) : undefined;
        include = toArray(include).map(validateString);
        return this._post(`apps/${appNameOrID}/webhooks`, { include, level, url, secret });
    }

}

module.exports = HerokuApi;
