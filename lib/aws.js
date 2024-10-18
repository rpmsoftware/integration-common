const { validateSignature, WebhookHeaders } = require('./webhooks');
let { readConfig, validateString } = require('./util');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const assert = require('assert');

const client = new SecretsManagerClient();

const readSecret = exports.readSecret = async secretName =>
    (await client.send(new GetSecretValueCommand({ SecretId: secretName }))).SecretString;

const createHeaderGetter = headers => {
    const hdrs = {};
    for (const name in headers) {
        hdrs[name.toLocaleLowerCase()] = headers[name];
    }
    return name => hdrs[name.toLocaleLowerCase()];
};

exports.normalizeRpmWebhook = async function ({ headers, body }) {
    const { signSecret } = this;
    const getHeader = createHeaderGetter(headers);
    const Subscriber = +getHeader(WebhookHeaders.Subscriber);
    const InstanceID = +getHeader(WebhookHeaders.InstanceID);
    assert(Subscriber > 0);
    assert(InstanceID > 0);
    signSecret && validateSignature(getHeader(WebhookHeaders.Signature), body, signSecret);
    typeof body === 'object' || (body = JSON.parse(validateString(body)));
    body.Subscriber = Subscriber;
    body.InstanceID = InstanceID;
    return body;
};

readConfig = readConfig.bind(undefined, 'RPM_CONFIG', 'config.json');

exports.readConfig = async () => {
    const config = readConfig();
    const { awsSecret } = config;
    delete config.awsSecret;
    awsSecret && (config =
        Object.assign(JSON.parse(await readSecret(validateString(awsSecret))), config)
    );
    return config;
};