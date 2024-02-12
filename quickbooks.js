/* global Buffer */

const { getEager, validateString, fetch, normalizeInteger } = require('./util');
const debug = require('debug')('rpm:quickbooks');

const TOKEN_ENDPOINT = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

const HOSTS = {
    sandbox: 'sandbox-quickbooks.api.intuit.com',
    production: 'quickbooks.api.intuit.com',
};

const Token = require('./token');

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
        return fetch(TOKEN_ENDPOINT, {
            method: Methods.post,
            headers: this.#headers,
            body: new URLSearchParams(body).toString()
        }).then(r => r.json());
    }
}

class QuickbooksApi extends TokenBase {
    #token = undefined;
    #baseUrl;

    constructor(config) {
        let { environment, refreshToken, realmID } = config;
        super(config);
        this.refreshToken = validateString(refreshToken);
        const host = getEager(HOSTS, environment.trim().toLowerCase());
        realmID = normalizeInteger(realmID);
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
        debug('Refreshing access token');
        token = this.#token = new Token(await this.requestToken({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        }));
        await this._storeToken(token);
        debug('New Token: %j', token);
        return token;
    }


    async request(method, url, data) {
        const token = await this.getToken();
        const { accessToken } = token;
        url = this.#baseUrl + url;
        debug('%s %s\n%j', method, url, data);
        return fetch(url, {
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
        const result = await this.request(Methods.get, 'query?' + new URLSearchParams({ query }).toString());
        return getEager(result, 'QueryResponse');
    }

    getCompanyInfo(id) {
        return this.request(Methods.get, `companyinfo/${id}`);
    }

    queryCompanyInfo() {
        return this.select('select * from CompanyInfo');
    }

    queryInvoices() {
        return this.select('select * from Invoice');
    }
}

const Methods = {
    get: 'GET',
    post: 'POST'
};

module.exports = { QuickbooksApi, TokenBase };

