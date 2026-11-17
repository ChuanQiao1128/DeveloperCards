const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const AUTH_NAMES = ['EXPO_PUBLIC_AWS_REGION', 'EXPO_PUBLIC_COGNITO_USER_POOL_ID', 'EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID'];

function authSettings(env) {
  const settings = Object.fromEntries(AUTH_NAMES.map(name => [name, String(env[name] ?? '').trim()]));
  for (const [name, value] of Object.entries(settings)) {
    if (!value) throw new Error(`OTA configuration missing: ${name}`);
  }
  const [region, pool, client] = AUTH_NAMES.map(name => settings[name]);
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region) || !new RegExp(`^${region}_[A-Za-z0-9]+$`).test(pool) || !/^[a-z0-9]+$/.test(client)) {
    throw new Error('OTA Cognito configuration is invalid');
  }
  return settings;
}

function verifyBundle(directory, settings) {
  const root = fs.realpathSync(directory);
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'metadata.json'), 'utf8'));
  const bundleName = metadata.fileMetadata?.ios?.bundle;
  if (typeof bundleName !== 'string') throw new Error('OTA export has no iOS launch bundle');
  const file = fs.realpathSync(path.resolve(root, bundleName));
  if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) throw new Error('OTA launch bundle is outside the export');
  const bytes = fs.readFileSync(file);
  for (const name of AUTH_NAMES) {
    if (!bytes.includes(Buffer.from(settings[name]))) throw new Error(`OTA launch bundle is missing compiled setting: ${name}`);
  }
  return createHash('sha256').update(bytes).digest('hex');
}

function prepare() {
  const settings = authSettings(process.env);
  const result = spawnSync('npx', ['expo', 'export', '--platform', 'ios', '--output-dir', 'dist', '--clear'], {
    stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production', EXPO_NO_DOTENV: '1' },
  });
  if (result.error || result.status !== 0) throw new Error('OTA export failed; nothing published');
  const sha256 = verifyBundle('dist', settings);
  console.log(`OTA iOS launch bundle verified: sha256=${sha256}`);
}

if (require.main === module) {
  try { prepare(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { authSettings, verifyBundle };
