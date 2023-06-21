/* global Buffer */
const { validateString } = require('../util');
const assert = require('assert');
const debug = require('debug')('rpm:face:ms');

const ErrorCodes = Object.seal({
    PersonNotFound: 'PersonNotFound',
    PersonGroupNotFound: 'PersonGroupNotFound',
    PersistedFaceNotFound: 'PersistedFaceNotFound'
});

const METHODS = {
    get: 'GET',
    put: 'PUT',
    post: 'POST',
    delete: 'DELETE',
    patch: 'PATCH'
};

const DEFAULT_PREPARE_BODY = body => body;
const CONTENT = {
    binary: 'application/octet-stream',
    json: {
        value: 'application/json',
        prepareBody: body => typeof body === 'object' ? JSON.stringify(body) : body
    }
};
for (const k in CONTENT) {
    let v = CONTENT[k];
    if (typeof v === 'string') {
        v = CONTENT[k] = { value: v };
    }
    if (!v.prepareBody) {
        v.prepareBody = DEFAULT_PREPARE_BODY;
    }
}

const isNotFoundError = error => {
    const { code } = error;
    return code === ErrorCodes.PersonNotFound ||
        code === ErrorCodes.PersonGroupNotFound ||
        code === ErrorCodes.PersistedFaceNotFound;
};

class Person {

    get _baseUrl() {
        return `persongroups/${this.personGroupId}/persons/${this.personId}`;
    }

    get _facesBaseUrl() {
        return `${this._baseUrl}/persistedFaces`;
    }

    getFace(id) {
        id = id.persistedFaceId || id;
        return this.api._fetch(METHODS.get, `${this._facesBaseUrl}/${id}`).then(parseJson);
    }

    async addFace(photo) {
        if (typeof photo === 'string') {
            photo = { url: photo };
        } else {
            assert(Buffer.isBuffer(photo));
        }
        return this.api._fetch(METHODS.post, this._facesBaseUrl, photo).then(parseJson);
    }

    async updateFace(photo) {
        if (typeof photo === 'string') {
            photo = { url: photo };
        } else {
            assert(Buffer.isBuffer(photo));
        }
        return this.api._fetch(METHODS.post, this._facesBaseUrl, photo).then(parseJson);
    }

    async deleteFace(id) {
        id = id.persistedFaceId || id;
        const response = await this.api._fetch(METHODS.delete, `${this._facesBaseUrl}/${id}`);
        response.ok || await parseJson(response);
    }

    async _get() {
        return this._extendPerson(
            await this.api._fetch(METHODS.get, this._baseUrl).then(parseJson)
        );
    }

    async update(name) {
        name = validateString(name);
        const response = await this.api._fetch(METHODS.post, this._baseUrl, { name });
        response.ok || await parseJson(response);
        Object.assign(this, await this._get());
        return this;
    }

    async delete() {
        const response = await this.api._fetch(METHODS.delete, this._baseUrl);
        response.ok || await parseJson(response);
        delete this.personId;
    }

}


class PersonGroup {

    get _baseUrl() {
        return `persongroups/${this.personGroupId}`;
    }

    get _personsBaseUrl() {
        return `${this._baseUrl}/persons`;
    }

    _extendPerson(person) {
        return person && Object.defineProperty(person, 'group', { value: this });
    }

    async getPersons() {
        const result = await this.api.getGroupPersons();
        result.forEach(p => this._extendPerson(p));
        return result;
    }

    async demandPerson(id) {
        id = id.personId || id;
        return this._extendPerson(
            await this.api.demandGroupPerson(this.personGroupId, id)
        );
    }

    async getPerson(id) {
        id = id.personId || id;
        return this._extendPerson(
            await this.api.getGroupPerson(this.personGroupId, id)
        );
    }

    async createPerson(name) {
        return this._extendPerson(
            await this.api.createGroupPerson(this.personGroupId, name)
        );
    }

    async deletePerson(id) {
        id = id.personId || id;
        const response = await this.api._fetch(METHODS.delete, `${this._personsBaseUrl}/${id}`);
        try {
            response.ok || await parseJson(response);
        } catch (e) {
            if (this.throwNotFound || !isNotFoundError(e)) {
                throw e;
            }
        }
    }

    _get() {
        return this._fetch(METHODS.get, `${this._baseUrl}?returnRecognitionModel=true`).then(parseJson);
    }

    async update(name) {
        name = validateString(name);
        const response = await this.api._fetch(METHODS.patch, this._baseUrl, { name });
        response.ok || await parseJson(response);
        Object.assign(this, await this._get());
        return this;
    }

    async delete() {
        await this.api.deletePersonGroup(this.personGroupId);
        delete this.personGroupId;
    }

    train() {
        return this.api.trainGroup(this.personGroupId);
    }

    getTrainingStatus() {
        return this.api.getGroupTraining(this.personGroupId);
    }

    identify(faceId, maxNumOfCandidatesReturned) {
        return this.api.identify(this.personGroupId, faceId, maxNumOfCandidatesReturned);
    }

}

const parseJson = async response => {
    const { error } = response = await response.json();
    if (error) {
        throw error;
    }
    return response;
};

const getContentType = data => {
    if (data === undefined || data === null || data === '') {
        return;
    }
    assert.strictEqual(typeof data, 'object');
    return Buffer.isBuffer(data) ? CONTENT.binary : CONTENT.json;
};


const DEFAULT_RECOGNITION_MODEL = 'recognition_03';
const DEFAULT_DETECTION_MODEL = 'detection_02';
const DEFAULT_MAX_CANDIDATES = 1;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

class MsFaceApi {

    constructor(config) {
        this.host = validateString(config.host);
        this.key = validateString(config.key);
        this.recognitionModel = DEFAULT_RECOGNITION_MODEL;
        this.detectionModel = DEFAULT_DETECTION_MODEL;
        this.maxNumOfCandidatesReturned = DEFAULT_MAX_CANDIDATES;
        this.confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD;
    }

    _getHeaders(contentType) {
        return {
            'Ocp-Apim-Subscription-Key': this.key,
            'Content-Type': typeof contentType === 'object' ? contentType.value : (contentType || undefined)
        };
    }

    _getUrl(endpoint) {
        return `https://${this.host}/face/v1.0/${endpoint}`;
    }


    _assignTo(obj) {
        return Object.defineProperty(obj, 'api', { value: this });
    }

    async _fetch(method, endpoint, body) {
        const contentType = body ? getContentType(body) : undefined;
        const headers = this._getHeaders(contentType);
        if (contentType) {
            body = contentType.prepareBody(body);
        }
        const url = this._getUrl(endpoint);
        debug(method, url, body);
        return fetch(url, { method, headers, body });
    }

    async getPersonGroups() {
        const result = await this._fetch(METHODS.get, `persongroups/?returnRecognitionModel=true`).then(parseJson);
        result.forEach(g => this._extendPersonGroup(g));
        return result;
    }

    _extendPersonGroup(group) {
        this._assignTo(group);
        Object.setPrototypeOf(group, PersonGroup.prototype);
        return group;
    }

    async demandPersonGroup(id) {
        return this._extendPersonGroup(
            await this._fetch(METHODS.get, `persongroups/${id.personGroupId || id}?returnRecognitionModel=true`).then(parseJson)
        );
    }

    async getPersonGroup() {
        try {
            return await this.demandPersonGroup.apply(this, arguments);
        } catch (e) {
            if (this.throwNotFound || !isNotFoundError(e)) {
                throw e;
            }
        }
    }

    async createPersonGroup(id, name) {
        validateString(id);
        const response = await this._fetch(METHODS.put, `persongroups/${id}`, {
            name: name || id,
            recognitionModel: this.recognitionModel || undefined
        });
        response.ok || await parseJson(response);
        return this.demandPersonGroup(id);
    }

    async updatePersonGroup(id, name) {
        id = id.personGroupId || id;
        validateString(id);
        validateString(name);
        const response = await this._fetch(METHODS.patch, `persongroups/${id}`, { name });
        response.ok || await parseJson(response);
        return this.demandPersonGroup(id);
    }

    async deletePersonGroup(id) {
        id = id.personGroupId || id;
        const response = await this._fetch(METHODS.delete, `persongroups/${id}`);
        response.ok || await parseJson(response);
    }

    detect(photo) {
        if (typeof photo === 'string') {
            photo = { url: photo };
        } else {
            assert(Buffer.isBuffer(photo));
        }
        return this._fetch(
            METHODS.post,
            `detect?recognitionModel=${this.recognitionModel}&detectionModel=${this.detectionModel}`,
            photo
        ).then(parseJson);
    }

    _getGroupUrl(personGroupId) {
        return `persongroups/${personGroupId}`;
    }

    _getPersonsUrl(personGroupId) {
        return `${this._getGroupUrl(personGroupId)}/persons`;
    }

    _getPersonUrl(personGroupId, personId) {
        return `${this._getPersonsUrl(personGroupId)}/${personId}`;
    }

    _getPersonFaceUrl(personGroupId, personId, persistedFaceId) {
        return `${this._getPersonUrl(personGroupId, personId)}/persistedFaces/${persistedFaceId}`;
    }

    async deleteGroupPerson(personGroupId, personId) {
        const response = await this._fetch(METHODS.delete, this._getPersonUrl(personGroupId, personId));
        if (response.ok) {
            return;
        }
        try {
            await parseJson(response);
        } catch (e) {
            if (this.throwNotFound || !isNotFoundError(e)) {
                throw e;
            }
        }
    }

    async deletePersonFace(personGroupId, personId, persistedFaceId) {
        const response = await this._fetch(METHODS.delete, this._getPersonFaceUrl(personGroupId, personId, persistedFaceId));
        if (response.ok) {
            return;
        }
        try {
            await parseJson(response);
        } catch (e) {
            if (this.throwNotFound || !isNotFoundError(e)) {
                throw e;
            }
        }
    }

    async trainGroup(personGroupId) {
        const response = await this._fetch(METHODS.post, this._getGroupUrl(personGroupId) + '/train');
        response.ok || await parseJson(response);
    }

    getGroupTraining(personGroupId) {
        return this._fetch(METHODS.get, this._getGroupUrl(personGroupId) + '/training').then(parseJson);
    }

    async getGroupPersons(personGroupId) {
        const result = await this._fetch(METHODS.get, this._getPersonsUrl(personGroupId)).then(parseJson);
        result.forEach(p => this._extendPerson(p));
        return result;
    }

    async demandGroupPerson(personGroupId, personId) {
        const result = await this._fetch(METHODS.get, this._getPersonUrl(personGroupId, personId)).then(parseJson);
        result.personGroupId = personGroupId;
        this._assignTo(result);
        Object.setPrototypeOf(result, Person.prototype);
        return result;
    }

    async getGroupPerson(personGroupId, personId) {
        try {
            return await this.demandGroupPerson(personGroupId, personId);
        } catch (e) {
            if (!isNotFoundError(e)) {
                throw e;
            }
        }
    }

    async createGroupPerson(personGroupId, name) {
        const { personId } = await this._fetch(METHODS.post, this._getPersonsUrl(personGroupId), { name: validateString(name) }).then(parseJson);
        return this.demandGroupPerson(personGroupId, personId);
    }

    identify(personGroupId, faceId) {
        faceId = validateString(faceId.faceId || faceId);
        personGroupId = validateString(personGroupId.personGroupId || personGroupId);
        return this._fetch(METHODS.post, 'identify', {
            personGroupId,
            faceIds: [faceId],
            maxNumOfCandidatesReturned: this.maxNumOfCandidatesReturned,
            confidenceThreshold: this.confidenceThreshold
        }).then(parseJson);
    }

}
module.exports.API = MsFaceApi;
module.exports.ErrorCodes = ErrorCodes;
