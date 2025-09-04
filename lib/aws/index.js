let { readConfig, validateString } = require('../util');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const client = new SecretsManagerClient();

const readSecret = exports.readSecret = async secretName =>
    (await client.send(new GetSecretValueCommand({ SecretId: secretName }))).SecretString;

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