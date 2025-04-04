/* global Buffer */
const assert = require('assert');
const { createHmac, timingSafeEqual } = require('crypto');
const {
    toBoolean, throwError, validateString, createCaselessGetter, normalizeInteger,
    toArray
} = require('./util');
const debug = require('debug')('rpm:hubspot:api');

const MAX_ALLOWED_TIMESTAMP = 5 * 60 * 1000;

const TIMESTAMP_HEADER = 'x-hubspot-request-timestamp';
const SIGNATURE_HEADER = 'x-hubspot-signature-v3';

const HUBSPOT_ERROR = 'HubSpotError';
const MSG_TIMESTAMP = 'Timestamp is invalid';
const MSG_SIGNATURE = 'Bad signature';
const MAX_PAGE_SIZE = 100;

const createRequestValidator = (clientSecret, validateTime) => {
    if (!clientSecret) {
        return req => req;
    }
    validateString(clientSecret);
    validateTime = validateTime === undefined || toBoolean(validateTime);

    return req => {
        const {
            url,
            method,
            body,
            headers,
            hostname
        } = req;

        const getHeader = createCaselessGetter(headers);
        const signatureHeader = validateString(getHeader(SIGNATURE_HEADER));
        const timestamp = normalizeInteger(getHeader(TIMESTAMP_HEADER));

        (validateTime && Date.now() - timestamp > MAX_ALLOWED_TIMESTAMP) &&
            throwError(MSG_TIMESTAMP, HUBSPOT_ERROR);

        const rawString = `${method}https://${hostname}${url}${JSON.stringify(body)}${timestamp}`;

        const hashedString = createHmac('sha256', clientSecret).update(rawString).digest('base64');

        (!timingSafeEqual(Buffer.from(hashedString), Buffer.from(signatureHeader))) &&
            throwError(MSG_SIGNATURE, HUBSPOT_ERROR);


        return req;
    };
};

const BASE_URL = 'https://api.hubapi.com/crm/v3/';

class HubSpotAPI {

    constructor({ accessToken }) {
        validateString(accessToken);
        Object.defineProperty(this, 'headers', {
            value: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
    }


    async getProperties(objectType, includeArchived) {
        validateString(objectType);
        const url = new URL(BASE_URL + `properties/${objectType}`);
        includeArchived && url.searchParams.append('archived', 'true');
        return (await this._fetch(url)).results;
    }

    getObject(objectType, id, properties) {
        validateString(objectType);
        id = +id;
        assert(id > 0);
        const url = new URL(BASE_URL + `objects/${objectType}/${id}`);
        properties = toArray(properties);
        properties.length > 0 && (url.searchParams.append('properties', properties.join(',')));
        return this._fetch(url);
    }

    async getObjects(objectType, properties) {
        validateString(objectType);
        const url = new URL(BASE_URL + `objects/${objectType}`);
        url.searchParams.append('limit', MAX_PAGE_SIZE);
        properties = toArray(properties);
        properties.length > 0 && (url.searchParams.append('properties', properties.join(',')));
        let response = await this._fetch(url);
        let { results } = response;
        let nextPageLink;
        while ((nextPageLink = response.paging?.next?.link)) {
            response = await this._fetch(nextPageLink);
            results = results.concat(response.results);
        }
        return results;
    }

    async _fetch(url, requestInit) {
        let { method } = requestInit || (requestInit = {});
        method = (method || 'GET').toUpperCase();
        requestInit.headers = this.headers;
        debug(`${method} ${url}`);
        let response = await fetch(url, requestInit);
        if (response.ok) {
            return response.json();
        }
        const { status, statusText } = response;
        response = await response.text();
        let message;
        try {
            message = JSON.parse(response).message;
            validateString(message);
        } catch {
            message = statusText || status;
        }
        throwError(message, HUBSPOT_ERROR, { status });
    }

}


module.exports = {
    createRequestValidator, HubSpotAPI
};