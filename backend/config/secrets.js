const {
  GetSecretValueCommand,
  SecretsManagerClient
} = require('@aws-sdk/client-secrets-manager');

const client = new SecretsManagerClient({
  region: process.env.AWS_REGION || 'ap-south-1'
});
const cache = new Map();

async function readSecret(secretArn, { refresh = false } = {}) {
  if (!secretArn) throw new Error('A Secrets Manager secret ARN is required.');
  if (refresh) cache.delete(secretArn);
  if (!cache.has(secretArn)) {
    cache.set(secretArn, client.send(
      new GetSecretValueCommand({ SecretId: secretArn })
    ).then(response => {
      if (!response.SecretString) {
        throw new Error(`Secret ${secretArn} does not contain a SecretString.`);
      }
      return JSON.parse(response.SecretString);
    }).catch(error => {
      cache.delete(secretArn);
      throw error;
    }));
  }
  return cache.get(secretArn);
}

async function loadRuntimeSecrets() {
  if (process.env.APP_SECRET_ARN) {
    const secret = await readSecret(process.env.APP_SECRET_ARN);
    if (!secret.jwtSecret) {
      throw new Error('The application secret is missing its jwtSecret value.');
    }
    process.env.JWT_SECRET = secret.jwtSecret;
    process.env.ADMIN_EMAIL = secret.adminEmail || '';
    process.env.ADMIN_PASSWORD = secret.adminPassword || '';
  }

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters.');
  }
}

module.exports = { loadRuntimeSecrets, readSecret };
