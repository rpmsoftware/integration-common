const { validateString } = require('../util');
const createTokenFactory = require('../office365/token-factory');
const assert = require('assert');
const debug = require('debug')('rpm:sharepoint');

const FileSystemObjectType = {
    Invalid: -1,
    File: 0,
    Folder: 1,
    Web: 2
};

class SharepointApi {
    #getAccessToken;
    #baseUrl;

    constructor(conf) {
        conf = Object.assign({}, conf);
        let { tenant, site } = conf;
        validateString(tenant);
        delete conf.site;
        delete conf.tenant;
        site = site ? `sites/${site}/` : '';
        this.#baseUrl = `https://${tenant}.sharepoint.com/${site}_api/`;
        conf.scope = `https://${tenant}.sharepoint.com/.default`;
        this.#getAccessToken = createTokenFactory(conf);
    }

    get(url) {
        return this.#requestJson('GET', this.#baseUrl + url);
    }

    post(url, body) {
        return this.#requestJson('POST', this.#baseUrl + url, body);
    }

    delete(url) {
        return this.#request('DELETE', this.#baseUrl + url).then(r => r.text());
    }

    async #getHeaders() {
        return {
            Authorization: 'Bearer ' + await this.#getAccessToken(),
            'Content-Type': 'application/json',
            Accept: 'application/json'
        };
    }


    #requestJson(method, url, body) {
        return this.#request(method, url, body).then(r => r.json());
    }

    _download(url) {
        return this.#request('GET', this.#baseUrl + url).then(r => r.arrayBuffer());
    }

    async #request(method, url, body) {
        debug(method, url);
        if (body || (body = undefined)) {
            typeof body === 'object' && (body = JSON.stringify(body));
            debug(body);
        }

        const response = await fetch(url, { method, headers: await this.#getHeaders(), body });
        let { ok, status, statusText } = response;
        if (!ok) {
            throw Object.assign({ status, statusText }, await response.json());
        }
        return response;
    }

    async getFolders() {
        return (await this.get('web/folders')).value.map(f => new Folder(this, f));
    }

    async getLists() {
        const { value } = await this.get('web/lists');
        return value.map(l => new List(this, l));
    }

    async getFolderByName(name) {
        return this.get(`web/GetFolderByServerRelativeUrl('${name}')`);
    }

    async getObjectByEditLink(url) {
        const result = await this.get(url);
        const Cls = Prototypes[result['odata.type']];
        return Cls ? new Cls(this, result) : result;
    }

    async getItemByEditLink(url) {
        return new Item(this, await this.get(url));
    }

    async getFiles(folder) {
        folder || (folder = '');
        return (await this.get(`web/GetFolderByServerRelativeUrl('${folder}')/Files`)).value;

    }
}

class SPObject {

    #api;

    constructor(api, obj) {
        assert(api instanceof SharepointApi);
        this.#api = api;
        assert(typeof obj, 'object');
        Object.assign(this, obj);
    }

    get api() {
        return this.#api;
    }

}

class List extends SPObject {
    constructor(api, obj) {
        super(api, obj);
    }

    async getItems() {
        const { api, 'odata.editLink': url } = this;
        let { value: result } = await api.get(url + '/items');
        return result.map(l => new Item(api, l));
    }

    async getSubscriptions() {
        const { api, 'odata.editLink': url } = this;
        return (await api.get(url + '/subscriptions')).value.map(s => new Subscription(api, s));
    }

    async createSubscription(notificationUrl, clientState) {
        validateString(notificationUrl);
        clientState = clientState ? validateString(clientState) : undefined;
        const { api, 'odata.editLink': url, 'odata.id': resource } = this;
        let d = new Date();
        d.setDate(d.getDate() + 180);
        return api.post(url + '/subscriptions', {
            resource,
            notificationUrl,
            clientState,
            expirationDateTime: d.toISOString()
        });
    }

}

class Subscription extends SPObject {
    constructor(api, obj) {
        super(api, obj);
    }

    delete() {
        const { api, id, resource } = this;
        return api.delete(`web/lists('${resource}')/subscriptions('${id}')`);
    }

}

class Folder extends SPObject {
    constructor(api, obj) {
        super(api, obj);
    }

    async getFiles() {
        const { api, 'odata.editLink': url } = this;
        let { value: result } = await api.get(url + '/Files');
        return result.map(f => new File(api, f));
    }

}

class File extends SPObject {
    constructor(api, obj) {
        super(api, obj);
    }

    download() {
        const { api, 'odata.editLink': url } = this;
        return api._download(url + '/$value');
    }

}

class Item extends SPObject {
    constructor(api, obj) {
        super(api, obj);
    }

    async getFile() {
        const { api, 'odata.editLink': url } = this;
        return new File(api, await api.get(url + '/File'));
    }
}

const Prototypes = {
    'SP.File': File
};


module.exports = {
    SharepointApi,
    FileSystemObjectType
};