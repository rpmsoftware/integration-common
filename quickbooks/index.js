/* global Buffer */

const { getEager, validateString, fetch, normalizeInteger,
    throwError, toBoolean, isEmpty } = require('../util');
const debug = require('debug')('rpm:quickbooks');
const assert = require('assert');

const TOKEN_ENDPOINT = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

const HOSTS = {
    sandbox: 'sandbox-quickbooks.api.intuit.com',
    production: 'quickbooks.api.intuit.com',
};

const Token = require('./token');
const QB_ERROR = 'QuickbooksError';

const tryQBError = ({ Fault }) => {
    const err = Fault?.Error?.[0];
    if (err) {
        console.error('%j', err);
        throwError(err.Message, QB_ERROR, err);
    }
};

const qbFetch = function () {
    return fetch.apply(this, arguments).catch(e => {
        tryQBError(e.response);
        throw e;
    });
};

class TokenBase {
    #headers;

    constructor({ clientID, clientSecret }) {
        validateString(clientID);
        validateString(clientSecret);
        const authHeader = Buffer.from(`${clientID}:${clientSecret}`).toString('base64');
        this.#headers = {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json'
        };
    }

    requestToken(body) {
        return qbFetch(TOKEN_ENDPOINT, {
            method: Methods.post,
            headers: this.#headers,
            body: new URLSearchParams(body).toString()
        }).then(r => r.json());
    }
}

class QuickbooksApi extends TokenBase {
    #token = undefined;
    #baseUrl;
    #realmID

    constructor(config) {
        let { environment, refreshToken, realmID } = config;
        super(config);
        this.refreshToken = validateString(refreshToken);
        const host = getEager(HOSTS, environment.trim().toLowerCase());
        this.#realmID = realmID = normalizeInteger(realmID);
        this.#baseUrl = `https://${host}/v3/company/${realmID}/`;
    }

    async _getStoredToken() {
    }

    _storeToken(/* token */) {
    }

    async getToken() {
        let token = this.#token;
        if (!token) {
            this.#token = token = await this._getStoredToken();
            token && Object.setPrototypeOf(token, Token.prototype);
        }
        if (token && token.isAccessTokenValid) {
            return token;
        }

        const { refreshToken } = token || this;
        debug('Refreshing access token (%s)', refreshToken);
        token = this.#token = new Token(await this.requestToken({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        }));
        await this._storeToken(token);
        debug('New Token: %j', token);
        return token;
    }


    async request(method, url, data) {
        const { accessToken } = await this.getToken();
        url = this.#baseUrl + url;
        debug('%s %s\n%j', method, url, data || {});
        return qbFetch(url, {
            method,
            headers: {
                Authorization: `Bearer ${await accessToken}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: data ? JSON.stringify(data) : undefined
        }).then(r => r.json());
    }

    async select(query) {
        let result;
        const { QueryResponse } = await this.request(Methods.get, 'query?' + new URLSearchParams({ query }).toString());
        for (let k in QueryResponse) {
            const v = QueryResponse[k];
            if (Array.isArray(v)) {
                result = v;
                break;
            }
        }
        return result || [];
    }

    getCompanyInfo(id) {
        return this.get('companyinfo', id);
    }

    queryCompanyInfo() {
        return this.select('select * from CompanyInfo');
    }

    queryInvoices() {
        return this.select('select * from Invoice');
    }

    getVendor(id) {
        return this.get('vendor', id);
    }

    async get(type, id) {
        validateString(type);
        return strip(type, this.request(Methods.get, `${type}/${id}`));
    }

    create(type, data) {
        validateString(type);
        return strip(type, this.request(Methods.post, type, data));
    }

    async update(type, id, data) {
        validateString(type);
        if (typeof id === 'object') {
            data = id;
            id = data.Id;
        }
        assert(!isEmpty(data));
        const { sparse } = data;
        data = Object.assign({}, data);
        data.Id = normalizeInteger(id) + '';
        data.sparse = (sparse === undefined || toBoolean(sparse)) + '';
        return strip(type, this.request(Methods.post, type, data));
    }
}

const strip = async (type, obj) => {
    obj = await (obj);
    let result;
    for (let k in obj) {
        if (k.toLowerCase() === type) {
            result = obj[k];
            break;
        }
    }
    return result;
};

const Methods = {
    get: 'GET',
    post: 'POST'
};

module.exports = { QuickbooksApi, TokenBase };

