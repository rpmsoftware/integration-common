/* global Buffer */
const { randomUUID } = require('crypto');
const assert = require('assert');
const { fetch2json, validateString, fetch } = require('../util');

const DEFAULT_SCOPE = 'https://graph.microsoft.com/.default';

module.exports = ({ clientID, tenantID, scope, clientSecret, certificate }) => {
    const params = new URLSearchParams();
    params.set('client_id', validateString(clientID));
    params.set('tenant', validateString(tenantID));
    params.set('grant_type', 'client_credentials');
    params.set('scope', scope ? validateString(scope) : DEFAULT_SCOPE);

    let getParameters;
    if (clientSecret) {
        params.set('client_secret', validateString(clientSecret));
        getParameters = () => params;
    } else {
        assert(certificate);
        const { key, thumbprint } = certificate;
        validateString(key);
        validateString(thumbprint);
        params.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
        const { sign } = require('jsonwebtoken');
        const payload = {
            aud: `https://login.microsoftonline.com/${tenantID}/oauth2/v2.0/token`,
            iss: clientID,
            sub: clientID,
        };
        const options = {
            header: {
                alg: 'RS256',
                typ: 'JWT',
                x5t: Buffer.from(thumbprint, 'hex').toString('base64url')
            }
        };
        getParameters = () => {
            payload.exp = Math.floor(Date.now() / 1000) + 10 * 60;
            payload.jti = randomUUID();
            const token = sign(payload, key, options);
            params.set('client_assertion', token);
            return params;
        };
    }

    let expiresAt = -1;
    let accessToken;

    const url = `https://login.microsoftonline.com/${tenantID}/oauth2/v2.0/token`;

    return async () => {
        if (expiresAt < Date.now()) {
            const { expires_in, access_token } = await fetch(url, {
                method: 'post',
                body: getParameters()
            }).then(fetch2json);
            expiresAt = Date.now() + expires_in * 1000;
            accessToken = access_token;
        }
        return accessToken;
    };
};
