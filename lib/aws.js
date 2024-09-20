const {
    SecretsManagerClient, GetSecretValueCommand
} = require("@aws-sdk/client-secrets-manager");

const client = new SecretsManagerClient();

exports.readSecret = async secretName =>
    (await client.send(new GetSecretValueCommand({ SecretId: secretName }))).SecretString;
