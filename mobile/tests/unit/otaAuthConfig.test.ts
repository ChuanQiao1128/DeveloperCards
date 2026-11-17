import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
  fs.writeFileSync(path.join(dir, 'launch.hbc.map'), JSON.stringify({ version: 3, sources: ['src/auth/amplify.ts'], mappings: 'AAAA' }));
  fs.writeFileSync(path.join(dir, 'assetmap.json'), '{}');
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
  it('requires source maps for the existing post-publication error tracking upload', () => {
    const dir = fixture(Object.values(settings).join('\0'));
    fs.rmSync(path.join(dir, 'launch.hbc.map'));
    expect(() => verifyBundle(dir, settings)).toThrow();
    const prepare = fs.readFileSync(new URL('../../scripts/release/prepare-ota.cjs', import.meta.url), 'utf8');
    expect(prepare).toContain("'--source-maps'");
    expect(prepare).toContain("'--dump-assetmap'");
  });
  it.each([0, 1])('isolates Metro cache and removes it after export exits %s', exit => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-prepare-')); dirs.push(parent);
    const bin = path.join(parent, 'bin'); fs.mkdirSync(bin);
    const fake = path.join(bin, 'npx');
    fs.writeFileSync(fake, `#!/usr/bin/env node\nconst fs=require('fs');\nfs.writeFileSync('cache-path.txt',process.env.TMPDIR);\nfs.mkdirSync('dist',{recursive:true});\nfs.writeFileSync('dist/launch.hbc',${JSON.stringify(Object.values(settings).join('\0'))});\nfs.writeFileSync('dist/launch.hbc.map',JSON.stringify({version:3,sources:['src/auth/amplify.ts']}));\nfs.writeFileSync('dist/assetmap.json','{}');\nfs.writeFileSync('dist/metadata.json',JSON.stringify({fileMetadata:{ios:{bundle:'launch.hbc'}}}));\nprocess.exit(${exit});\n`, { mode: 0o755 });
    const script = fileURLToPath(new URL('../../scripts/release/prepare-ota.cjs', import.meta.url));
    const result = spawnSync(process.execPath, [script], { cwd: parent, env: { ...process.env, ...settings, PATH: bin + path.delimiter + process.env.PATH }, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(exit);
    const cache = fs.readFileSync(path.join(parent, 'cache-path.txt'), 'utf8');
    expect(path.basename(cache)).toMatch(/^developercards-ota-/);
    expect(cache).not.toBe(os.tmpdir());
    expect(fs.existsSync(cache)).toBe(false);
    expect(result.stdout.includes('verified:')).toBe(exit === 0);
  });
});
