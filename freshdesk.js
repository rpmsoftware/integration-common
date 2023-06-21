const assert = require('assert');
const { validateString, toBoolean, normalizeInteger, toBase64, toMoment, fetch2json } = require('./util');
const moment = require('dayjs');
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
        this.headers = Object.assign({
            Authorization: 'Basic ' + toBase64(`${key}:X`)
        }, DEFAULT_HEADERS);
    }

    getUrl(endpoint) {
        return this.url + endpoint;
    }

    getPaged(endpoint, parameters) {
        return this.get(endpoint, Object.assign({}, GET_DEFAULTS, parameters));
    }

    get(endpoint, options) {
        const body = new URLSearchParams();
        if (options) {
            for (const k in options) {
                const v = options[k];
                v === undefined || body.set(k, v);
            }
            endpoint = endpoint + '?' + body.toString();
        }
        return this.requestEndpoint('get', endpoint);
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

    async request(method, url, options) {
        debug(`${method.toUpperCase()} ${url} ${this.logRequestData && options ? '\n' + JSON.stringify(options) : ''}`);

        const response = await fetch(url, {
            method,
            headers: this.headers,
            body: JSON.stringify(options)
        });

        const { status: statusCode, headers } = response;

        let nextLink, data;
        switch (statusCode) {
            case 200:
            case 201:
                nextLink = headers.get('link');
                nextLink = nextLink && REGEX_NEXT_PAGE_LINK.exec(nextLink)[1];
                data = await fetch2json(response);
                nextLink && Object.defineProperty(data, 'nextLink', { value: nextLink });
                return data;
            case 204:
                return;
            default:
                throw await fetch2json(response);
        }

    }

    getTimeEntries(before, after, billable) {
        if (typeof before === 'object' && !moment.isDayjs(before)) {
            billable = before.billable;
            after = before.after;
            before = before.before;
        }
        before = before ? toMoment(before).toISOString() : undefined;
        after = after ? toMoment(after).toISOString() : undefined;
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

    getContact(id) {
        return this.get('contacts/' + normalizeInteger(id));
    }

    getContacts() {
        return this.getPaged('contacts');
    }

    getGroups() {
        return this.getPaged('groups');
    }

    getTicket(id) {
        return this.get('tickets/' + normalizeInteger(id));
    }

    getTimeEntry(id) {
        return this.get('time_entries/' + normalizeInteger(id));
    }

    getTickets(since) {
        return this.getPaged('tickets', {
            updated_since: since ? toMoment(since).toISOString() : undefined
        });
    }

    updateContact(id, data) {
        assert.strictEqual(typeof data, 'object');
        return this.requestEndpoint('put', `contacts/${id}`, data);
    }

    updateTicket(id, data) {
        assert.strictEqual(typeof data, 'object');
        return this.requestEndpoint('put', `tickets/${id}`, data);
    }

}

module.exports = API;