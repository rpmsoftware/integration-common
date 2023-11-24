const { validateString, throwError } = require('../util');
const createTokenFactory = require('../office365/token-factory');
const assert = require('assert');
const debug = require('debug')('rpm:sharepoint2');

const BASE_URL = `https://graph.microsoft.com/v1.0/`;
const SCOPE = `https://graph.microsoft.com/.default`;

const SUBSCRIPTION_TTL = 43200; // minutes
const SHAREPOINT_ERROR = 'SharepointError';

class SharepointApi {
    #getAccessToken;

    constructor(conf) {
        conf = Object.assign({}, conf);
        conf.scope = SCOPE;
        this.#getAccessToken = createTokenFactory(conf);
    }

    get(url, absolute) {
        return this.#request('GET', absolute ? url : (BASE_URL + url)).then(r => r.json());
    }

    post(url, body) {
        return this.#request('POST', BASE_URL + url, body).then(r => r.json());
    }

    put(url, body, headers) {
        return this.#request('PUT', BASE_URL + url, body, headers).then(r => r.json());
    }

    delete(url) {
        return this.#request('DELETE', BASE_URL + url).then(r => r.text());
    }

    download(url, absolute) {
        return this.#request('GET', absolute ? url : (BASE_URL + url)).then(r => r.arrayBuffer());
    }

    async #request(method, url, body, headers) {
        debug(method, url);
        body || (body = undefined);
        headers || (headers = { 'Content-Type': 'application/json' });
        headers.Authorization = 'Bearer ' + await this.#getAccessToken();
        const response = await fetch(url, { method, headers, body });
        let { ok, status, statusText } = response;
        if (!ok) {
            const { code, innerError, message } = (await response.json()).error;
            throwError(message, SHAREPOINT_ERROR, { status, statusText, code, innerError });
        }
        return response;
    }

    async getRootSite() {
        return new Site(this, await this.get('sites/root'));
    }

    async getSites() {
        return (await this.get('sites')).value.map(s => new Site(this, s));
    }

    async getSubscriptions() {
        return (await this.get('subscriptions')).value.map(s => new Subscription(this, s));
    }

    async getLists(site) {
        site || (site = 'root');
        return (await this.get(`sites/${site}/lists`)).value.map(s => new List(this, s));
    }

    async getDrives() {
        return (await this.get('sites/root/drives')).value.map(s => new Drive(this, s));
    }

    async getDriveItems(siteID, parentID) {
        return (await this.get(`sites/${siteID}/drive/items/${parentID}/children`)).value.map(i => i.file ? new File(this, i) : i);
    }

    async getDriveItem(siteID, id) {
        const item = await this.get(`sites/${siteID}/drive/items/${id}`);
        return item.file ? new File(this, item) : item;
    }

    async getListsItems(list) {
        list = validateString(list.id || list);
        return (await this.get(`sites/root/lists/${list}/items`)).value.map(s => new Item(this, s));
    }
}

class SPObject {
    #api;
    constructor(api, obj) {
        assert(api instanceof SharepointApi);
        assert(typeof obj, 'object');
        this.#api = api;
        Object.assign(this, obj);
    }

    get api() {
        return this.#api;
    }

    async getLists() {
        let { value: result } = await this.api.get(`sites/${this.id}/lists`);
        return result.map(l => new List(this.api, l));
    }
}

class File extends SPObject {

    constructor(api, obj) {
        super(api, obj);
    }

    download() {
        const { '@microsoft.graph.downloadUrl': url, api } = this;
        return api.download(url, true);
    }

    async upload(data) {
        const { api, parentReference, id } = this;
        const { siteId } = parentReference;
        const result = await api.put(`sites/${siteId}/drive/items/${id}/content`, data, {});
        return Object.assign(this, result);
    }

}

const SLASH = '/';

class Drive extends SPObject {
    constructor(api, obj) {
        super(api, obj);
    }
}

class Site extends SPObject {
    constructor(api, obj) {
        super(api, obj);
    }

    async getLists() {
        let { value: result } = await this.api.get(`sites/${this.id}/lists`);
        return result.map(l => new List(this.api, l));
    }

    async getDrives() {
        let { value: result } = await this.api.get(`sites/${this.id}/drives`);
        return result.map(l => new Drive(this.api, l));
    }

    getDriveItem(path) {
        validateString(path);
        path.startsWith(SLASH) || (path = SLASH + path);
        return this.api.get(`sites/${this.id}/drive/root:${path}`);
    }


}

class List extends SPObject {
    constructor(api, obj) {
        super(api, obj);
    }

    async getItems() {
        const { siteId } = this.parentReference;
        let { value: result } = await this.api.get(`sites/${siteId}/lists/${this.id}/items`);
        return result.map(l => new Item(this.api, l));
    }

    createSubscription(notificationUrl, clientState) {
        validateString(notificationUrl);
        clientState = clientState ? validateString(clientState) : undefined;
        const { siteId } = this.parentReference;
        const d = new Date();
        d.setMinutes(d.getMinutes() + SUBSCRIPTION_TTL);
        d.setSeconds(0);
        d.setMilliseconds(0);
        return this.api.post('subscriptions', {
            notificationUrl,
            resource: `sites/${siteId}/lists/${this.id}`,
            expirationDateTime: d.toISOString(),
            changeType: 'updated',
            clientState
        });

    }

}

class Item extends SPObject {
    constructor(api, obj) {
        super(api, obj);
    }

    async refresh() {
        const { siteId, listId } = this.parentReference;
        return new Item(this.api, await this.api.get(`sites/${siteId}/lists/${listId}/items/${this.id}`));
    }

    load() {
        return this.api.get(this.webUrl, true);
    }
}

class Subscription extends SPObject {
    constructor(api, obj) {
        super(api, obj);
    }

    delete() {
        const { api, id } = this;
        return api.delete(`subscriptions/${id}`);
    }

}


module.exports = SharepointApi