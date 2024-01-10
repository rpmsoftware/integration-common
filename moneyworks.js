/* global Buffer */

const debug = require('debug')('rpm:moneyworks');
const { getDeepValue, demandDeepValue, validateString, getEager, toArray } = require('./util');
const assert = require('assert');
const { parse: parseXml } = require('./xml');

const encode = s => encodeURIComponent(s);

class MoneyWorks {

    constructor({ host, document, user, password }) {
        assert.strict(typeof config, 'object');
        this.baseUrl = `https://${validateString(host)}/REST/`;
        this.document = encode(document);
        this.fetchParameters = {
            method: 'GET',
            headers: {
                Authorization: 'Basic ' + Buffer.from(`${encode(user)}:Datacentre:${encode(password)}`).toString('base64')
            }
        };
    }

    async _get(command, includeDocument, expectText) {
        includeDocument = includeDocument === undefined || !!includeDocument;
        const url = `${this.baseUrl}${includeDocument ? this.document : ''}/${command}`;
        debug(url);
        const response = await fetch(url, this.fetchParameters).then(r => r.text());
        return expectText ? response : parseXml(response);
    }

    async getDocuments() {
        return demandDeepValue(await this._get('list', false), 'documents', 'document');
    }

    getVersion() {
        return this._get('version', false, true);
    }

    async _export(table, prms) {
        table = validateString(table).toLowerCase();
        prms = prms || {};
        assert.strictEqual(typeof prms, 'object');
        prms.table = table;
        prms.format = 'xml-terse';
        return toArray(getEager(
            await this._get('export/' + Object.keys(prms).map(name => `${name}=${encode(prms[name])}`).join('&')),
            'table')[table] || []);
    }

    getAccounts() {
        return this._export('account');
    }

    getTransactions() {
        return this._export('transaction');
    }

    getTransactionsByType(types, startDate) {
        assert(Array.isArray(types));
        assert(types.length > 0, 'Types are required');
        let search = types.map(t => `type="${t}"`).join(' or ');
        startDate && (search = `transdate>="${startDate}" and (${search})`);
        return this._export('transaction', { search });
    }

    getTransaction(id) {
        return this._export('transaction', {
            search: `ourref="${id}"`
        });
    }

    async getSalesInvoices(startDate) {
        const result = await this.getTransactionsByType(['DII', 'DIC'], startDate);
        result.forEach(t => {
            t.details = toArray(getDeepValue(t, 'subfile', 'detail') || []);
            delete t.subfile;
        });
        return result;
    }

    async getReceipts(startDate) {
        const result = await this.getTransactionsByType(['CRD'], startDate);
        result.forEach(t => {
            t.details = toArray(getDeepValue(t, 'subfile', 'detail') || []);
            delete t.subfile;
        });
        return result;
    }

    getNames() {
        return this._export('name');
    }

    async setDocument(document) {
        const documents = await this.getDocuments();
        if (documents.indexOf(document) < 0) {
            throw new Error(`Unknown document: "${document}"`);
        }
        return this.document = document;
    }
}

module.exports = MoneyWorks;