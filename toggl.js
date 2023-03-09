const { fetch2json, validateString, toBoolean, normalizeInteger, getEager } = require('integration-common/util');
const fetch = require('node-fetch');
const debug = require('debug')('rpm:toggl');
const assert = require('assert');

const BASE_URL = 'https://api.track.toggl.com/api/v9/';

class TogglTrackAPI {

    static STATUS_NOT_FOUND = 404;
    static _TYPES = ['projects', 'clients'];

    static validateType(type) {
        assert(TogglTrackAPI._TYPES.indexOf(type) >= 0, `Type "${type}" is not supported`);
        return type;
    }

    constructor({ userName, password, apiToken, dryRun, workspaceID }) {
        const credentials = Buffer.from(apiToken ?
            `${validateString(apiToken)}:api_token` :
            `${validateString(userName)}:${validateString(password)}`
        ).toString('base64');
        Object.defineProperty(this, 'headers', {
            value: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' }
        });
        this.dryRun = toBoolean(dryRun) || undefined;
        this.setWorkspace(workspaceID);
    }

    setWorkspace(workspaceID) {
        this.workspaceID = normalizeInteger(workspaceID);
    }

    getMe() {
        return this._get('me');
    }

    getUsers(organizationID) {
        organizationID = normalizeInteger(organizationID);
        return this._get(`organizations/${organizationID}/workspaces/${this.workspaceID}/workspace_users`);
    }

    getOrganizations() {
        return this._get('me/organizations');
    }

    getWorkspaces() {
        return this._get('workspaces');
    }

    getProjects() {
        return this.getEntities('projects');
    }

    getClients() {
        return this.getEntities('clients');
    }

    _getFromWorkspace(endpoint) {
        return this._requestWorkspace('GET', endpoint);
    }

    _get(endpoint) {
        return this._request('GET', endpoint);
    }

    _request(method, endpoint, data) {
        const { headers } = this;
        const url = BASE_URL + endpoint;
        data = data ? JSON.stringify(data) : undefined;
        debug('%s %s\n%s', method.toUpperCase(), url, data || '');
        return fetch(url, { headers, method, body: data }).then(fetch2json);
    }

    _requestWorkspace(method, endpoint, data) {
        return this._request(method, `workspaces/${this.workspaceID}/${endpoint}`, data);
    }

    async getEntities(type, query) {
        TogglTrackAPI.validateType(type);
        return (await this._requestWorkspace('GET', `${type}`, query || undefined)) || [];
    }

    demandEntity(type, id) {
        TogglTrackAPI.validateType(type);
        id = normalizeInteger(id);
        return this._requestWorkspace('GET', `${type}/${id}`);
    }

    async getEntity() {
        try {
            return await this.demandEntity.apply(this, arguments);
        } catch (e) {
            if (e.status !== TogglTrackAPI.STATUS_NOT_FOUND) {
                throw e;
            }
        }
    }

    createEntity(type, data) {
        TogglTrackAPI.validateType(type);
        return this._requestWorkspace('POST', type, data);
    }

    editEntity(type, id, data) {
        TogglTrackAPI.validateType(type);
        id = normalizeInteger(id);
        return this._requestWorkspace('PUT', `${type}/${id}`, data);
    }

    deleteEntity(type, id) {
        TogglTrackAPI.validateType(type);
        id = normalizeInteger(id);
        return this._requestWorkspace('DELETE', `${type}/${id}`);
    }

}

module.exports = TogglTrackAPI;
