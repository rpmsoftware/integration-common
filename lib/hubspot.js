/* global Buffer */
const assert = require('assert');
const { createHmac, timingSafeEqual } = require('crypto');
const {
    toBoolean, throwError, validateString, createCaselessGetter, normalizeInteger,
    toArray, isEmpty, getEager, isResponseJSON,
    isEmptyValue, createParallelRunner
} = require('./util');
const debug = require('debug')('rpm:hubspot:api');

const MAX_ALLOWED_TIMESTAMP = 5 * 60 * 1000;

const TIMESTAMP_HEADER = 'x-hubspot-request-timestamp';
const SIGNATURE_HEADER = 'x-hubspot-signature-v3';

const HUBSPOT_ERROR = 'HubSpotError';
const MSG_TIMESTAMP = 'Timestamp is invalid';
const MSG_SIGNATURE = 'Bad signature';

const STATUS_RESOURCE_NOT_FOUND = 404;

const TYPE_ENUMERATION = 'enumeration';
const REFERENCE_TYPE_OWNER = 'OWNER';

const OBJECT_TYPES = {
    deals: 'deals',
    deal: 'deals',
    contacts: 'contacts',
    contact: 'contacts',
    companies: 'companies',
    company: 'companies',
    goal_targets: 'goal_targets',
    goal_target: 'goal_targets',
    leads: 'leads',
    lead: 'leads'
};

const FT_CHECKBOX = 'checkbox';

const ValueDelimiter = ';';

const normalizeObjectType = type => getEager(OBJECT_TYPES, type.toLowerCase());

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

const CACHE_TTL = 1 * 60 * 1000;

const ALREADY_EXTENDED = Symbol();
const OBJECT_TYPE_OWNER = Symbol();

const DEFAULT_PARALLEL_CALLS = 20;


class HubSpotAPI {

    #parallelRunner;

    constructor({ accessToken, cacheTTL, parallelCalls }) {
        cacheTTL = +cacheTTL;
        this.cacheTTL = cacheTTL > 0 ? cacheTTL : CACHE_TTL;
        validateString(accessToken);
        Object.defineProperty(this, 'headers', {
            value: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        this.cachedDefinitions = {};
        parallelCalls = parallelCalls ? normalizeInteger(parallelCalls) : undefined;
        this.parallelCalls = parallelCalls > 0 ? parallelCalls : DEFAULT_PARALLEL_CALLS;
    }

    get parallelRunner() {
        return this.#parallelRunner || (this.#parallelRunner = createParallelRunner(this.parallelCalls));
    };


    async getProperties(objectType, includeArchived) {
        validateString(objectType);
        const url = new URL(BASE_CRM_URL_V3 + `properties/${objectType}`);
        includeArchived && url.searchParams.append('archived', 'true');
        return (await this._fetch(url)).results;
    }

    async getPropertiesCached(objectType) {
        const { cachedDefinitions, cacheTTL } = this;
        let result = cachedDefinitions[objectType];
        if (result) {
            const { data, expires } = await result;
            if (expires > Date.now()) {
                return data;
            }
        }
        result = cachedDefinitions[objectType] = this.getProperties(objectType)
            .then(r => ({
                data: r.toObject('name'),
                expires: Date.now() + cacheTTL
            }));
        return (await result).data;
    }

    async getOwnersCached() {
        const { cachedDefinitions, cacheTTL } = this;
        let result = cachedDefinitions[OBJECT_TYPE_OWNER];
        if (result) {
            const { data, expires } = await result;
            if (expires > Date.now()) {
                return data;
            }
        }
        result = cachedDefinitions[OBJECT_TYPE_OWNER] = this.getOwners()
            .then(data => ({ data, expires: Date.now() + cacheTTL }));
        return (await result).data;
    }

    async _extendObject(object, objectType) {
        if (object[ALREADY_EXTENDED]) {
            return object;
        }
        const { properties: objectProperties } = object;
        const [propertyDefinitions, owners] = await Promise.all([
            this.getPropertiesCached(objectType),
            this.getOwnersCached()
        ]);
        for (const propName in objectProperties) {
            let propValue = objectProperties[propName];
            if (isEmptyValue(propValue)) {
                continue;
            }
            const { options, type, referencedObjectType, fieldType } = getEager(propertyDefinitions, propName);
            if (type !== TYPE_ENUMERATION) {
                continue;
            }

            const multiple = (fieldType === FT_CHECKBOX);

            propValue = propValue.split(ValueDelimiter);

            let result;
            if (referencedObjectType === REFERENCE_TYPE_OWNER) {
                result = propValue.map(pv => {
                    const { id, email, type, firstName, lastName } =
                        owners.demand(({ id }) => id === pv);
                    return { id, email, type, firstName, lastName };
                });
            } else {
                result = propValue.map(propValue => {
                    const { label, value } = options.demand(({ value }) => value === propValue);
                    return objectProperties[propName] = { label, value };
                });
            }
            objectProperties[propName] = multiple ? result : result[0];
        }
        Object.defineProperty(object, ALREADY_EXTENDED, { value: true });
        return object;
    }

    async demandObject(objectType, id, properties, extend) {
        objectType = normalizeObjectType(objectType);
        id = +id;
        assert(id > 0);
        const url = new URL(BASE_CRM_URL_V4 + `objects/${objectType}/${id}`);
        properties = toArray(properties);
        properties.length > 0 && (url.searchParams.append('properties', properties.join(',')));
        const result = await this._fetch(url);
        return toBoolean(extend) ? this._extendObject(result, objectType) : result;
    }

    getObject() {
        return this.demandObject.apply(this, arguments).catch(error => {
            if (error.status !== STATUS_RESOURCE_NOT_FOUND) {
                throw error;
            }
        });
    }

    async getObjects(objectType, properties, extend) {
        objectType = normalizeObjectType(objectType);
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
        return toBoolean(extend) ?
            Promise.all(results.map(r => this._extendObject(r, objectType))) :
            results;
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
        objectType = normalizeObjectType(objectType);
        id = +id;
        assert(id > 0);
        assert(!isEmpty(properties));
        return this._fetch(
            BASE_CRM_URL_V4 + `objects/${objectType}/${id}`,
            { method: 'PATCH', body: JSON.stringify({ properties }) }
        );
    }

    createObject(objectType, properties) {
        objectType = normalizeObjectType(objectType);
        assert(!isEmpty(properties));
        return this._fetch(
            BASE_CRM_URL_V4 + `objects/${objectType}`,
            { method: 'POST', body: JSON.stringify({ properties }) }
        );
    }

    async getAssociationDefinitions(fromObjectType, toObjectType) {
        fromObjectType = normalizeObjectType(fromObjectType);
        toObjectType = normalizeObjectType(toObjectType);
        const url = BASE_CRM_URL_V4 + `associations/definitions/configurations/${fromObjectType}/${toObjectType}`;
        let response = await this._fetch(url);
        let { results } = response;
        let nextPageLink;
        while ((nextPageLink = response.paging?.next?.link)) {
            response = await this._fetch(nextPageLink);
            results = results.concat(response.results);
        }
        return results;
    }

    async getAssociations(fromObjectType, fromObjectID, toObjectType) {
        fromObjectType = normalizeObjectType(fromObjectType);
        toObjectType = normalizeObjectType(toObjectType);
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
        results.forEach(r => r.fromObjectId = fromObjectID);
        return results;
    }

    getAssociationLabels(fromObjectType, toObjectType) {
        fromObjectType = normalizeObjectType(fromObjectType);
        toObjectType = normalizeObjectType(toObjectType);
        return this._fetch(BASE_CRM_URL_V4 + `associations/${fromObjectType}/${toObjectType}/labels`)
            .then(({ results }) => results);
    }

    async getAssociationsFlat() {
        const result = [];
        (await this.getAssociations.apply(this, arguments)).forEach(({ fromObjectId, toObjectId, associationTypes }) =>
            associationTypes.forEach(at => result.push(Object.assign({ fromObjectId, toObjectId }, at)))
        );
        return result;
    }

    async getAssociatedObjects(fromObjectType, fromObjectId, toObjectType, associationTypeID, properties) {
        associationTypeID = +associationTypeID;
        assert(associationTypeID > 0);
        let result = await this.getAssociationsFlat(fromObjectType, fromObjectId, toObjectType);
        result = result.filter(({ typeId }) => typeId === associationTypeID);
        const { parallelRunner } = this;
        return Promise.all(result.map(a => parallelRunner(async () =>
            Object.assign(a, await this.demandObject(toObjectType, a.toObjectId, properties, true))
        )));
    }

    createAssociation(fromObjectType, fromObjectID, toObjectType, toObjectID, typeID, category) {
        category = getEager(AssociationCategories, category);
        typeID = +typeID;
        assert(typeID > 0);
        fromObjectType = normalizeObjectType(fromObjectType);
        toObjectType = normalizeObjectType(toObjectType);
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
        fromObjectType = normalizeObjectType(fromObjectType);
        toObjectType = normalizeObjectType(toObjectType);
        fromObjectID = +fromObjectID;
        assert(fromObjectID > 0);
        toObjectID = +toObjectID;
        assert(toObjectID > 0);
        return this._fetch(
            BASE_CRM_URL_V4 + `objects/${fromObjectType}/${fromObjectID}/associations/${toObjectType}/${toObjectID}`,
            { method: 'DELETE' }
        );
    }

    async findByEQ(objectType, values, properties) {
        assert.strictEqual(typeof values, 'object');
        objectType = normalizeObjectType(objectType);
        const filters = [];
        const operator = 'EQ';
        for (let propertyName in values) {
            filters.push({ propertyName, operator, value: values[propertyName] });
        }
        assert(filters.length > 0);
        properties = properties ? toArray(properties).map(validateString) : [];
        properties.length > 0 || (properties = undefined);
        const { results, paging } = await this._fetch(
            BASE_CRM_URL_V3 + `objects/${objectType}/search`,
            { method: 'POST', body: JSON.stringify({ filters, properties, limit: 200 }) }
        );
        assert(!paging);
        return results;
    }
}

const AssociationCategories = {
    HubSpot: 'HUBSPOT_DEFINED',
    User: 'USER_DEFINED',
    Integrator: 'INTEGRATOR_DEFINED'
};

module.exports = {
    createRequestValidator,
    HubSpotAPI,
    ValueDelimiter,
    AssociationCategories
};