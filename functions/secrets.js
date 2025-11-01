// safe secret loader: require client lazily and handle missing ADC for local dev
const cache = {};

async function loadSecret(secretId = 'GITHUB_TOKEN') {
  if (cache[secretId]) return cache[secretId];

  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT_ID || process.env.GCP_PROJECT_ID;
  if (!projectId) {
    // running locally without project env — fall back to .env or skip
    console.warn('secrets: no GCP project env var set; skipping Secret Manager');
    return '';
  }

  let SecretManagerServiceClient;
  try {
    // require lazily so importing this module doesn't attempt auth
    SecretManagerServiceClient = require('@google-cloud/secret-manager').SecretManagerServiceClient;
  } catch (e) {
    console.warn('secrets: @google-cloud/secret-manager not installed or failed to load', e.message || e);
    return '';
  }

  const client = new SecretManagerServiceClient();
  const name = `projects/${projectId}/secrets/${secretId}/versions/latest`;

  try {
    const [version] = await client.accessSecretVersion({ name });
    const val = version.payload && version.payload.data ? version.payload.data.toString('utf8') : '';
    cache[secretId] = val.trim();
    return cache[secretId];
  } catch (err) {
    // common when ADC not available locally — return empty and let caller handle it
    console.warn('secrets.loadSecret failed', secretId, err.message || err);
    return '';
  }
}

module.exports = { loadSecret, _cache: cache };