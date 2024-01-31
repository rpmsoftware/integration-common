const { validateString, toBoolean, fetch: baseFetch, throwError } = require('./util');
const debug = require('debug')('rpm:asana');
const BASE_URL = 'https://app.asana.com/api/1.0/';

const METHODS = {
    get: 'GET',
    post: 'POST'
};

const API_ERROR = 'AsanaApiError';

async function fetch() {
    try {
        return await baseFetch.apply(this, arguments);
    } catch (e) {
        const { errors } = e.response;
        if (!Array.isArray(errors)) {
            throw e;
        }
        const { message } = errors[0];
        throwError(message, API_ERROR, { errors });
    }
}

class API {

    constructor({ apiToken, dryRun, workspaceID }) {
        Object.defineProperty(this, 'headers', {
            value: {
                authorization: 'Bearer ' + validateString(apiToken),
                accept: 'application/json'
            }
        });
        this.dryRun = toBoolean(dryRun) || undefined;
        this.setWorkspace(workspaceID);

    }

    getMe() {
        return this._get('me');
    }

    getWorkspaces() {
        return this._get('workspaces');
    }

    setWorkspace(workspaceID) {
        this._workspaceID = workspaceID ? validateString(workspaceID) : undefined;
    }

    getProjects(workspaceID) {
        workspaceID || (workspaceID = this._workspaceID);
        return workspaceID ?
            this._getFromWorkspace(workspaceID, 'projects') :
            this._get('projects');
    }

    getTeams(workspaceID) {
        workspaceID || (workspaceID = this._workspaceID);
        return this._getFromWorkspace(workspaceID, 'teams');
    }

    getUserTeams(userID, workspaceID) {
        workspaceID || (workspaceID = this._workspaceID);
        userID || (userID = 'me');
        return this._get(`users/${userID}/teams?workspace=${workspaceID}`);
    }

    getTasksFromList(id) {
        return this._get(`user_task_lists/${id}/tasks`);
    }

    createTask(data, workspaceID) {
        workspaceID || (workspaceID = this._workspaceID);
        data || (data = {});
        data.workspace = workspaceID;
        return this._request(METHODS.post, 'tasks', data);
    }

    async createAttachmentFromUrl(parentID, name, url) {
        const { headers } = this;
        const body = new FormData();
        body.append('url', url);
        body.append('name', name);
        body.append('parent', parentID);
        body.append('resource_subtype', 'external');
        const method = METHODS.post;
        const endpoint = BASE_URL + 'attachments';
        debug('%s %s', method, endpoint);
        let result = await fetch(endpoint, { headers, method, body });
        result = await result.json();
        return result.data || result;
    }

    _getFromWorkspace(workspaceID, endpoint) {
        return this._requestWorkspace(workspaceID, METHODS.get, endpoint);
    }

    _get(endpoint) {
        return this._request(METHODS.get, endpoint);
    }

    async _request(method, endpoint, data) {
        let { headers } = this;
        const url = BASE_URL + endpoint;
        data = data ? JSON.stringify({ data }) : undefined;
        headers = Object.assign({ 'content-Type': 'application/json' }, headers);
        debug('%s %s\n%s', method, url, data || '');
        const result = await fetch(url, { headers, method, body: data }).then(r => r.json());
        return result.data || result;
    }

    _requestWorkspace(workspaceID, method, endpoint, data) {
        let url = `workspaces/${workspaceID}`;
        endpoint && (url += `/${endpoint}`);
        return this._request(method, url, data);
    }

    getUser(id) {
        id || (id = 'me');
        return this._get(`users/${id}`);
    }

    getTaskList(userID, workspaceID) {
        workspaceID || (workspaceID = this._workspaceID);
        userID || (userID = 'me');
        return this._get(`users/${userID}/user_task_list?workspace=${workspaceID}`)
    }

}

module.exports = API;