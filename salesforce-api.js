const { fetch2json, validateString, toBoolean } = require('./util');
const assert = require('assert');
const debug = require('debug')('rpm:salesforce');

const REGEX_WHITESPACE = /\s+/g;
const PLUS = '+';
const BASE_PATH = '/services/data/v55.0/';
const URL_TOKEN = 'https://login.salesforce.com/services/oauth2/token';
const TOKEN_TTL = 3 * 60 * 60 * 1000;

class SalesForceAPI {

    constructor({ userName, password, clientID, clientSecret, securityToken, dryRun }) {
        validateString(userName);
        validateString(password);
        validateString(clientID);
        validateString(clientSecret);
        securityToken && (password += securityToken);
        Object.defineProperty(this, 'authParams', {
            value: new URLSearchParams({
                grant_type: 'password',
                password: password,
                username: userName,
                client_id: clientID,
                client_secret: clientSecret
            })
        });
        this.dryRun = toBoolean(dryRun) || undefined;
    }

    async _getAccessToken() {
        let { token, authParams: body } = this;
        if (!token || Date.now() - token.issued_at > TOKEN_TTL) {
            token = await fetch(URL_TOKEN, { method: 'POST', body }).then(fetch2json);
            assert(token.issued_at = +token.issued_at);
            this.token = token;
            const { instance_url, access_token } = token;
            validateString(access_token);
            validateString(instance_url);
        }
        return token;
    }

    getResources() {
        return this._request();
    }

    getSObjects() {
        return this._request('sobjects');
    }

    getSObject(sObject, id) {
        validateString(sObject);
        validateString(id);
        return this._request(`sobjects/${sObject}/${id}`);
    }

    describe(sObject) {
        validateString(sObject);
        return this._request(`sobjects/${sObject}/describe`);
    }

    async query(query) {
        validateString(query);
        query = query.trim().replace(REGEX_WHITESPACE, PLUS);
        let { nextRecordsUrl, records } = await this._request(`query?q=${query}`);
        while (nextRecordsUrl) {
            const response = await this._requestAbsolute(nextRecordsUrl);
            records = records.concat(response.records);
            nextRecordsUrl = response.nextRecordsUrl
        }
        return records;
    }

    updateSObject(sObject, id, data) {
        validateString(sObject);
        validateString(id);
        assert(typeof data === 'object');
        return this._request(`sobjects/${sObject}/${id}`, 'PATCH', data);
    }

    _request(path, method, body) {
        path ? assert(!path.startsWith('/')) : (path = '');
        return this._requestAbsolute(BASE_PATH + path, method, body);
    }

    async _requestAbsolute(path, method, body) {
        validateString(path);
        assert(path.startsWith('/'));
        method || (method = undefined);
        body = body ? JSON.stringify(body) : undefined;
        let { instance_url: url, access_token } = await this._getAccessToken();
        url += path;
        const headers = { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' };
        debug('%s %s\n%s', method || 'GET', url, body || '');
        return fetch(url, { method, headers, body }).then(fetch2json);
    }
}

module.exports = SalesForceAPI;
