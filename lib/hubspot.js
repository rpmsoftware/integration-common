/* global Buffer */
const assert = require('assert');
const { createHmac, timingSafeEqual } = require('crypto');
const {
    toBoolean, throwError, validateString, createCaselessGetter, normalizeInteger,
    toArray, isEmpty, getEager, isResponseJSON
} = require('./util');
const debug = require('debug')('rpm:hubspot:api');

const MAX_ALLOWED_TIMESTAMP = 5 * 60 * 1000;

const TIMESTAMP_HEADER = 'x-hubspot-request-timestamp';
const SIGNATURE_HEADER = 'x-hubspot-signature-v3';

const HUBSPOT_ERROR = 'HubSpotError';
const MSG_TIMESTAMP = 'Timestamp is invalid';
const MSG_SIGNATURE = 'Bad signature';

const STATUS_RESOURCE_NOT_FOUND = 404;

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

const BASE_CRM_URL = 'https://api.hubapi.com/crm/';
const BASE_CRM_URL_V3 = BASE_CRM_URL + 'v3/';
const BASE_CRM_URL_V4 = BASE_CRM_URL + 'v4/';

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
        const url = new URL(BASE_CRM_URL_V4 + `properties/${objectType}`);
        includeArchived && url.searchParams.append('archived', 'true');
        return (await this._fetch(url)).results;
    }

    demandObject(objectType, id, properties) {
        validateString(objectType);
        id = +id;
        assert(id > 0);
        const url = new URL(BASE_CRM_URL_V4 + `objects/${objectType}/${id}`);
        properties = toArray(properties);
        properties.length > 0 && (url.searchParams.append('properties', properties.join(',')));
        return this._fetch(url);
    }

    getObject() {
        return this.demandObject.apply(this, arguments).catch(error => {
            if (error.status !== STATUS_RESOURCE_NOT_FOUND) {
                throw error;
            }
        });
    }

    async getObjects(objectType, properties) {
        validateString(objectType);
        const url = new URL(BASE_CRM_URL_V4 + `objects/${objectType}`);
        url.searchParams.append('limit', 100);
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

    getOwners() {
        return this._fetch(BASE_CRM_URL_V3 + 'owners').then(({ results }) => results);
    }

    getOwner(id) {
        id = +id;
        assert(id > 0);
        return this._fetch(BASE_CRM_URL_V3 + `owners/${id}`);
    }

    async _fetch(url, requestInit) {
        let { method } = requestInit || (requestInit = {});
        method = (method || 'GET').toUpperCase();
        requestInit.headers = this.headers;
        debug(`${method} ${url}`);
        let response = await fetch(url, requestInit);
        const { ok, status, statusText } = response;
        if (ok) {
            return isResponseJSON(response) ? response.json() : response.text();
        }
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

    updateObject(objectType, id, properties) {
        validateString(objectType);
        id = +id;
        assert(id > 0);
        assert(!isEmpty(properties));
        return this._fetch(
            BASE_CRM_URL_V4 + `objects/${objectType}/${id}`,
            { method: 'PATCH', body: JSON.stringify({ properties }) }
        );
    }

    createObject(objectType, properties) {
        validateString(objectType);
        assert(!isEmpty(properties));
        return this._fetch(
            BASE_CRM_URL_V4 + `objects/${objectType}`,
            { method: 'POST', body: JSON.stringify({ properties }) }
        );
    }

    async getAssociations(fromObjectType, fromObjectID, toObjectType) {
        validateString(fromObjectType);
        validateString(toObjectType);
        fromObjectID = +fromObjectID;
        assert(fromObjectID > 0);
        const url = new URL(BASE_CRM_URL_V4 + `objects/${fromObjectType}/${fromObjectID}/associations/${toObjectType}`);
        url.searchParams.append('limit', 500);
        let response = await this._fetch(url);
        let { results } = response;
        let nextPageLink;
        while ((nextPageLink = response.paging?.next?.link)) {
            response = await this._fetch(nextPageLink);
            results = results.concat(response.results);
        }
        return results;
    }

    getAssociationLabels(fromObjectType, toObjectType) {
        validateString(fromObjectType);
        validateString(toObjectType);
        return this._fetch(BASE_CRM_URL_V4 + `associations/${fromObjectType}/${toObjectType}/labels`);
    }

    async getAssociationsFlat() {
        const result = [];
        (await this.getAssociations.apply(this, arguments)).forEach(({ toObjectId, associationTypes }) =>
            associationTypes.forEach(at => result.push(Object.assign({ toObjectId }, at)))
        );
        return result;
    }

    createAssociation(fromObjectType, fromObjectID, toObjectType, toObjectID, typeID, category) {
        category = getEager(AssociationCategories, category);
        typeID = +typeID;
        assert(typeID > 0);
        validateString(fromObjectType);
        validateString(toObjectType);
        fromObjectID = +fromObjectID;
        assert(fromObjectID > 0);
        toObjectID = +toObjectID;
        assert(toObjectID > 0);
        return this._fetch(
            BASE_CRM_URL_V4 + `objects/${fromObjectType}/${fromObjectID}/associations/${toObjectType}/${toObjectID}`,
            { method: 'PUT', body: JSON.stringify([{ associationCategory: category, associationTypeId: typeID }]) }
        );
    }

    deleteAssociation(fromObjectType, fromObjectID, toObjectType, toObjectID) {
        validateString(fromObjectType);
        validateString(toObjectType);
        fromObjectID = +fromObjectID;
        assert(fromObjectID > 0);
        toObjectID = +toObjectID;
        assert(toObjectID > 0);
        return this._fetch(
            BASE_CRM_URL_V4 + `objects/${fromObjectType}/${fromObjectID}/associations/${toObjectType}/${toObjectID}`,
            { method: 'DELETE' }
        );
    }
}

const AssociationCategories = {
    HubSpot: 'HUBSPOT_DEFINED',
    User: 'USER_DEFINED',
    Integrator: 'INTEGRATOR_DEFINED'
};

module.exports = {
    createRequestValidator, HubSpotAPI
};