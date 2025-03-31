const { validateSignature, WebhookHeaders } = require('../webhooks');
let { readConfig, validateString, createCaselessGetter } = require('../util');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const assert = require('assert');

const client = new SecretsManagerClient();

const readSecret = exports.readSecret = async secretName =>
    (await client.send(new GetSecretValueCommand({ SecretId: secretName }))).SecretString;

exports.normalizeRpmWebhook = function ({ headers, body }) {
    const { signSecret } = this;
    const getHeader = createCaselessGetter(headers);
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
    let config = readConfig();
    const { awsSecret } = config;
    delete config.awsSecret;
    awsSecret && (config =
        Object.assign(JSON.parse(await readSecret(validateString(awsSecret))), config)
    );
    return config;
};