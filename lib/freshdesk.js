const assert = require('assert');
const { validateString, toBoolean, normalizeInteger, toBase64, toMoment, fetch, fetch2json } = require('./util');
const moment = require('dayjs');
const debug = require('debug')('rpm:freshdesk');

const DEFAULT_HEADERS = {
    'Content-Type': 'application/json'
};

const REGEX_NEXT_PAGE_LINK = /<(https:\/\/\S+)>; rel="next"/i;
const GET_DEFAULTS = { per_page: 100 }
const MAX_PAGES = 300;

class API {

    constructor(url, key) {
        let maxPages;
        if (typeof url === 'object') {
            key = url.key;
            maxPages = url.maxPages;
            url = url.url;
        }
        this.maxPages = (maxPages > 0 && maxPages <= MAX_PAGES) ? maxPages : MAX_PAGES;
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
        let c = 1;
        while (partialResult.nextLink) {
            if (c >= this.maxPages) {
                debug('Page limit exceeded');
                break;
            }
            assert(Array.isArray(result));
            partialResult = await this.request(method, partialResult.nextLink);
            result = result.concat(partialResult);
            ++c;
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

    getTimeEntries(after, before, billable) {
        if (after && typeof after === 'object' && !moment.isDayjs(after)) {
            billable = after.billable;
            before = after.before;
            after = after.after;
        }
        before = before ? toMoment(before).toISOString() : undefined;
        after = after ? toMoment(after).toISOString() : undefined;
        billable === undefined || (billable = toBoolean(billable));
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

    async getTicketFields(normalize) {
        const result = await this.getPaged('ticket_fields');
        if (toBoolean(normalize)) {
            let statuses = result.demand(({ name }) => name === 'status');
            const normalizedChoices = [];
            const { choices } = statuses;
            for (const id in choices) {
                const [label_for_agents, label_for_customers] = choices[id];
                normalizedChoices.push({ id, label_for_agents, label_for_customers });
            }
            statuses.choices = normalizedChoices;
            const fixChoices = containerName => {
                const container = result.demand(({ name }) => name === containerName);
                const normalizedChoices = [];
                const { choices } = container;
                for (const label in choices) {
                    const id = choices[label];
                    normalizedChoices.push({ id, label });
                }
                container.choices = normalizedChoices;
            }
            fixChoices('source');
            fixChoices('priority');
            fixChoices('group');
            fixChoices('agent');
            fixChoices('product');

        }
        return result;
    }

    getTimeEntry(id) {
        return this.get('time_entries/' + normalizeInteger(id));
    }

    getTickets(since, filter) {
        return this.getPaged('tickets', {
            updated_since: since ? toMoment(since).toISOString() : undefined,
            order_by: 'updated_at',
            order_type: 'asc',
            filter: filter ? validateString(filter) : undefined
        });
    }

    getProducts() {
        return this.getPaged('products');
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