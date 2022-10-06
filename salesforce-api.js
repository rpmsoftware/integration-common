const { fetch2json, validateString, toBoolean } = require('./util');
const fetch = require('node-fetch');
const assert = require('assert');
const debug = require('debug')('rpm:salesforce');

const REGEX_WHITESPACE = /\s+/g;
const PLUS = '+';
const BASE_PATH = '/services/data/v55.0/';

class SalesForceAPI {
    static async create({ userName, password, clientID, clientSecret, securityToken, dryRun }) {
        validateString(userName);
        validateString(password);
        validateString(clientID);
        validateString(clientSecret);
        securityToken && (password += securityToken);
        const { instance_url, access_token } = await fetch('https://login.salesforce.com/services/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({
                grant_type: 'password',
                password: password,
                username: userName,
                client_id: clientID,
                client_secret: clientSecret
            })
        }).then(fetch2json);
        return new SalesForceAPI(instance_url, access_token, dryRun);
    }

    constructor(instanceUrl, accessToken, dryRun) {
        validateString(instanceUrl);
        this.instanceUrl = instanceUrl;
        this.headers = { Authorization: 'Bearer ' + validateString(accessToken), 'Content-Type': 'application/json' };
        this.dryRun = toBoolean(dryRun) || undefined;
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

    _requestAbsolute(path, method, body) {
        method || (method = undefined);
        body = body ? JSON.stringify(body) : undefined;
        let { headers, instanceUrl: url } = this;
        validateString(path);
        assert(path.startsWith('/'));
        url += path;
        debug('%s %s\n%s', method || 'GET', url, body || '');
        return fetch(url, { method, headers, body }).then(fetch2json);
    }
}

module.exports = SalesForceAPI;
