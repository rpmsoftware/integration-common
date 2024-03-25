/* global Buffer */
const { fetch2json, validateString, fetch, pause } = require('integration-common/util');
const debug = require('debug')('rpm:toggl-reports');
const assert = require('assert');

const BASE_URL = 'https://api.track.toggl.com/reports/api/v3/';
const HDR_NEXT_ROW_NUMBER = 'x-next-row-number';

const STATUS_TOO_MANY_REQUESTS = 429;
const PAUSE = 5000; 

class TogglReportAPI {

    constructor({ apiToken, workspaceID }) {
        assert.strictEqual(typeof workspaceID, 'number');
        const credentials = Buffer.from(`${validateString(apiToken)}:api_token`).toString('base64');
        Object.defineProperties(this, {
            headers: {
                value: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' }
            }, workspaceID: {
                value: workspaceID,
                enumerable: true
            }
        });
    }

    getDetailed(params) {
        return this._workspaceRequest('search/time_entries', params);
    }

    getProjectUsers(params) {
        return this._workspaceRequest('filters/project_users', params);
    }

    getProjectGroups(params) {
        return this._workspaceRequest('filters/project_groups', params);
    }

    getUsers(params) {
        return this._workspaceRequest('filters/users', params);
    }

    getWeekly(params) {
        return this._workspaceRequest('weekly/time_entries', params);
    }

    _workspaceRequest(endpoint, params) {
        return this._request(`workspace/${this.workspaceID}/${endpoint}`, params);
    }

    async _request(endpoint, params) {
        const { headers } = this;
        const url = BASE_URL + endpoint;
        const method = 'POST';
        params ? assert.strictEqual(typeof params, 'object') : (params = undefined);
        params = Object.assign({}, params);
        let a = [];
        let nextRowNumber;
        do {
            params.first_row_number = nextRowNumber;
            const options = { headers, method, body: JSON.stringify(params) };
            debug('%s %s\n%j', method, url, params || '');
            let response;
            try {
                response = await fetch(url, options);
            } catch (e) {
                if (e.status === STATUS_TOO_MANY_REQUESTS) {
                    await pause(PAUSE);
                    response = await fetch(url, options);
                }
            }
            nextRowNumber = +response.headers.get(HDR_NEXT_ROW_NUMBER);
            a = a.concat(await fetch2json(response));
        } while (nextRowNumber > 0);
        return a;
    }

}

module.exports = TogglReportAPI;
