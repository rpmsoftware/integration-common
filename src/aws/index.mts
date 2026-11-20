import { readConfig as readConf, type THashMap, validateString } from '../util.mjs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import assert from 'assert';

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

type AwsSqsEvent = {
    Records: {
        eventSource: 'aws:sqs';
        eventSourceARN: string;
        body: string;
    }[];
};

export const unwrapSqsEvent = (event: THashMap, returnOriginal = false) => {
    try {
        const { Records } = event as AwsSqsEvent;
        assert(Array.isArray(Records));
        const result = Records.map(r => {
            assert.strictEqual(r.eventSource, 'aws:sqs');
            validateString(r.eventSourceARN);
            return JSON.parse(validateString(r.body)) as THashMap;
        });
        return result;
    } catch (cause) {
        if (returnOriginal) {
            return [event];
        }
        throw new TypeError('Unsupported event: ' + JSON.stringify(event), { cause });
    }
};
