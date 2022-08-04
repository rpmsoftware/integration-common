const { fetch2json, validateString, toBoolean } = require('./util');
const fetch = require('node-fetch');
const assert = require('assert');
const debug = require('debug')('rpm:salesforce');

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
        this.instanceUrl = validateString(instanceUrl) + '/services/data/v55.0/';
        this.headers = { Authorization: 'Bearer ' + validateString(accessToken), 'Content-Type': 'application/json' };
        this.dryRun = toBoolean(dryRun) || undefined;
    }

    _get(path) {
        let { headers, instanceUrl } = this;
        if (path) {
            assert(!path.startsWith('/'));
            instanceUrl += path;
        }
        return fetch(instanceUrl, { headers }).then(fetch2json);
    }

    getResources() {
        return this._get();
    }

    getObjects() {
        return this._get('sobjects');
    }

    getSObject(sObject, id) {
        return this._request(`sobjects/${sObject}/${id}`);
    }

    updateSObject(sObject, id, data) {
        validateString(sObject);
        validateString(id);
        assert(typeof data === 'object');
        return this._request(`sobjects/${sObject}/${id}`, 'PATCH', data);
    }

    _request(path, method, body) {
        method || (method = undefined);
        body = body ? JSON.stringify(body) : undefined;
        let { headers, instanceUrl: url } = this;
        if (path) {
            assert(!path.startsWith('/'));
            url += path;
        }
        debug('%s %s\n%s', method || 'GET', url, body || '');
        return fetch(url, { method, headers, body }).then(fetch2json);
    }

}

module.exports = SalesForceAPI;
