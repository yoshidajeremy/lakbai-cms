const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const client = new SecretManagerServiceClient();
const cache = {};

async function loadSecret(secretId = 'GITHUB_TOKEN') {
    if (cache[secretId]) return cache[secretId];
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT_ID || process.env.GCLOUD_PROJECT_ID;
    if (!projectId) {
        console.warn('No GCP project env var set; Secret Manager access may fail locally.');
    }
    const name = `projects/${projectId}/secrets/${secretId}/versions/latest`;
    try {
        const [version] = await client.accessSecretVersion({ name });
        const val = version.payload?.data?.toString('utf8') || '';
        cache[secretId] = val.trim();
        return cache[secretId];
    } catch (err) {
        console.warn('Failed to load secret', secretId, err.message || err);
        return '';
    }
}

module.exports = { loadSecret };