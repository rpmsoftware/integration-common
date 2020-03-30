const assert = require('assert');
const { validateString, isEmpty, toBoolean, normalizeInteger } = require('./util');
const { Client } = require('node-rest-client');
const moment = require("moment");
const debug = require('debug')('rpm:freshdesk');

const DEFAULT_HEADERS = {
    'Content-Type': 'application/json'
};

const REGEX_NEXT_PAGE_LINK = /<(https:\/\/\S+)>; rel="next"/i;
const GET_DEFAULTS = { per_page: 100 }


class API {

    constructor(url, key) {
        if (typeof url === 'object') {
            key = url.key;
            url = url.url;
        }
        validateString(url);
        validateString(key);
        this.url = url.toLowerCase().ensureRight('/').ensureRight('api/').ensureRight('v2/').toString();
        Object.defineProperty(this, 'client', { value: new Client({ user: key, password: 'X' }) });
    }

    getUrl(endpoint) {
        return this.url + endpoint;
    };

    getPaged(endpoint, parameters) {
        return this.get(endpoint, Object.assign({}, GET_DEFAULTS, parameters || undefined));
    }

    get(endpoint, parameters) {
        if (typeof parameters === 'object') {
            for (const name in parameters) {
                if (parameters[name] === undefined) {
                    delete parameters[name];
                }
            }
        }
        return this.requestEndpoint('get', endpoint, parameters && !isEmpty(parameters) ?
            { parameters } : undefined);
    }

    async requestEndpoint(method, endpoint, options) {
        let partialResult = await this.request(method, this.getUrl(endpoint), options);
        let result = partialResult;
        while (partialResult.nextLink) {
            assert(Array.isArray(result));
            partialResult = await this.request(method, partialResult.nextLink);
            result = result.concat(partialResult);
        }
        return result;
    }

    request(method, url, options) {
        debug(`${method.toUpperCase()} ${url} ${this.logRequestData && options ? '\n' + JSON.stringify(options) : ''}`);
        options = options || {};
        options.headers = DEFAULT_HEADERS;
        return new Promise((resolve, reject) => {
            this.client[method.toLowerCase()](url, options, (data, response) => {
                switch (response.statusCode) {
                    case 200:
                    case 201:
                        let nextLink = response.headers.link;
                        nextLink = nextLink && REGEX_NEXT_PAGE_LINK.exec(nextLink)[1];
                        nextLink && Object.defineProperty(data, 'nextLink', { value: nextLink });
                        return resolve(data);
                    case 204:
                        return resolve();
                    default:
                        if (Buffer.isBuffer(data)) {
                            data = data.toString();
                        }
                        if (typeof data === 'object') {
                            data.statusCode = response.statusCode;
                        }
                        reject(data || response.statusCode);
                }

            })
        });
    };

    getTimeEntries(before, after, billable) {
        if (typeof before === 'object' && !moment.isMoment(before)) {
            billable = before.billable;
            after = before.after;
            before = before.before;
        }
        before = before ? (moment.isMoment(before) ? before : moment(before)).toISOString() : undefined;
        after = after ? (moment.isMoment(after) ? after : moment(after)).toISOString() : undefined;
        if (billable !== undefined) {
            billable = toBoolean(billable);
        }
        return this.getPaged('time_entries', {
            executed_after: after,
            executed_before: before,
            billable
        });
    }

    getAgents() {
        return this.getPaged('agents');
    }

    getAgent(id) {
        return this.get('agents/' + normalizeInteger(id));
    }

    getCompany(id) {
        return this.get('companies/' + normalizeInteger(id));
    }

    getCompanies() {
        return this.getPaged('companies');
    }

    getTicket(id) {
        return this.get('tickets/' + normalizeInteger(id));
    }

    getTickets(since) {
        return this.getPaged('tickets', {
            updated_since: since ? (moment.isMoment(since) ? since : moment(since)).toISOString() : undefined
        });
    }

}

module.exports = API;