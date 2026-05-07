import { readConfig as readConf, validateString } from '../util.mjs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient();

export const readSecret = async (secretName: string) =>
    (await client.send(new GetSecretValueCommand({ SecretId: secretName }))).SecretString;

export const readConfig = async () => {
    let config = readConf('RPM_CONFIG', 'config.json');
    const { awsSecret } = config;
    delete config.awsSecret;
    if (awsSecret) {
        const secret = await readSecret(validateString(awsSecret));
        secret && (config = Object.assign(JSON.parse(secret), config));
    }
    return config;
};