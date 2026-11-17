import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { authSettings, verifyBundle } = require('../../scripts/release/prepare-ota.cjs');
const settings = { EXPO_PUBLIC_AWS_REGION: 'ap-southeast-2', EXPO_PUBLIC_COGNITO_USER_POOL_ID: 'ap-southeast-2_testpool', EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID: 'testclient123' };
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
function fixture(bytes: string) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-auth-')); dirs.push(parent);
  const dir = path.join(parent, 'export'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'launch.hbc'), bytes);
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ fileMetadata: { ios: { bundle: 'launch.hbc' } } }));
  return dir;
}
describe('OTA authentication configuration', () => {
  it('rejects missing values and mismatched regional configuration before exporting', () => {
    expect(authSettings(settings)).toEqual(settings);
    for (const name of Object.keys(settings)) expect(() => authSettings({ ...settings, [name]: ' ' })).toThrow(name);
    expect(() => authSettings({ ...settings, EXPO_PUBLIC_AWS_REGION: 'us-east-1' })).toThrow('invalid');
  });
  it('blocks a launch bundle with empty auth settings even when the release environment has valid values', () => {
    const dir = fixture('configureAmplifyOnce region="" pool="" client=""');
    expect(() => verifyBundle(dir, settings)).toThrow('missing compiled setting');
    fs.writeFileSync(path.join(dir, 'launch.hbc'), Object.values(settings).join('\0'));
    expect(verifyBundle(dir, settings)).toMatch(/^[a-f0-9]{64}$/);
  });
  it('checks every setting and refuses metadata that points outside the exported artifact', () => {
    const dir = fixture(settings.EXPO_PUBLIC_AWS_REGION + '\0' + settings.EXPO_PUBLIC_COGNITO_USER_POOL_ID);
    expect(() => verifyBundle(dir, settings)).toThrow('EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID');
    fs.writeFileSync(path.join(path.dirname(dir), 'outside.hbc'), Object.values(settings).join('\0'));
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ fileMetadata: { ios: { bundle: '../outside.hbc' } } }));
    expect(() => verifyBundle(dir, settings)).toThrow('outside the export');
  });
  it('publishes the verified export without invoking a second bundler', () => {
    const script = fs.readFileSync(new URL('../../scripts/release/ota.sh', import.meta.url), 'utf8');
    const prepare = script.indexOf('eas env:exec production --non-interactive "node scripts/release/prepare-ota.cjs"');
    const publish = script.indexOf('eas update --skip-bundler --input-dir dist');
    expect(prepare).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(prepare);
  });
});
