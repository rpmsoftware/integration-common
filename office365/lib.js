const { logErrorStack, getEager } = require('../util');
const { ClientCredentials } = require('simple-oauth2');

const RESOURCE = 'https://graph.microsoft.com/.default';
const TOKEN_PATH = '/oauth2/v2.0/token';
const AUTHORIZE_PATH = '/oauth2/v2.0/authorize';
const TOKEN_HOST = 'https://login.microsoftonline.com/';

exports.createOutlookTokenFactory = function (config) {
    const tokenHost = TOKEN_HOST + config.tenantID;

    const client = new ClientCredentials({
        client: {
            id: getEager(config, 'clientID'),
            secret: getEager(config, 'clientSecret'),
        },
        auth: {
            tokenHost,
            tokenPath: tokenHost + TOKEN_PATH,
            authorizePath: tokenHost + AUTHORIZE_PATH
        }
    });

    const tokenConfig = {
        tenant: getEager(config, 'tenantID'),
        scope: config.scope || RESOURCE
    };

    let token;
    return async function () {
        if (!token || token.expired()) {
            token = await client.getToken(tokenConfig);
        }
        return token.token.access_token;
    };
};

const ETAG_REGEX = /^\s*(W\/)?\s*"(\S+)"\s*$/;

function ETag(str) {
    let parts = str.match(ETAG_REGEX);
    if (!parts) {
        throw new TypeError('Not an ETag: ' + str);
    }
    this.weak = Boolean(parts[1]);
    this.tag = parts[2];
}


ETag.prototype.toString = function () {
    return (this.weak ? 'W/' : '') + '"' + this.tag + '"';
};

exports.getODataEtag = function (object, asObject) {
    let result = object['@odata.etag'];
    if (result && asObject) {
        result = new ETag(result);
    }
    return result;
};

exports.logMsError = function (error) {
    logErrorStack(error);
    if (typeof error.getAllResponseHeaders === 'function') {
        console.error('Error headers:', error.getAllResponseHeaders());
    }
};

exports.getODataType = function (object) {
    return object['@odata.type'];
};

exports.ETag = ETag;
