// Real locked Expo/Xcode APIs; this exercises prebuild mutation, not signing.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const xcode = require('xcode');
const { withPlugins } = require('expo/config-plugins');
const plugin = require('../../plugins/withBuildProvenance.js');
const sentryPath = path.join(path.dirname(require.resolve('@sentry/react-native/package.json')), 'plugin/build/withSentryIOS.js');
const { addSentryWithBundledScriptsToBundleShellScript: withSentry } = require(sentryPath);
const phaseName = '"Bundle React Native code and images"';
const observer = '"$PROJECT_DIR/../scripts/release/observeNativeBundle.cjs"';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

function fixture(config = plugin({ name: 'Xcode API regression', slug: 'xcode-api-regression' }), sentryWrapped = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provenance-real-xcode-'));
  dirs.push(dir);
  const file = path.join(dir, 'project.pbxproj');
  fs.writeFileSync(file, execFileSync('tar', ['-xOf', path.join(mobile, 'node_modules/expo/template.tgz'),
    'package/ios/HelloWorld.xcodeproj/project.pbxproj']));
  const project = xcode.project(file);
  project.parseSync();
  const phases = project.hash.project.objects.PBXShellScriptBuildPhase;
  const [id, phase] = Object.entries(phases).find(([, value]: [string, any]) => value?.name === phaseName)! as [string, any];
  if (sentryWrapped) phase.shellScript = JSON.stringify(withSentry(JSON.parse(phase.shellScript)));
  // Invoke the registered Expo withXcodeProject mod with an actual xcode.project,
  // as Expo's iOS base mod provider does after parseSync().
  const apply = () => config.mods.ios.xcodeproj({ ...config, modResults: project,
    modRequest: { projectRoot: mobile, platformProjectRoot: dir, platform: 'ios', modName: 'xcodeproj' } });
  return { file, project, phases, id, phase, apply };
}

describe('build provenance plugin with the real locked Expo/Xcode parser', () => {
  it('wraps the entire actual Sentry invocation with the production config plugin order', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provenance-real-config-'));
    dirs.push(dir);
    fs.copyFileSync(path.join(mobile, 'app.config.js'), path.join(dir, 'app.config.js'));
    fs.cpSync(path.join(mobile, 'scripts/release'), path.join(dir, 'scripts/release'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ownership-build.json'), JSON.stringify({ schema: 2,
      sourceCommit: 'a'.repeat(40), sourceArchiveSha256: 'b'.repeat(64), buildNonce: 'c'.repeat(64), runDir: dir }));
    const input = JSON.parse(fs.readFileSync(path.join(mobile, 'app.json'), 'utf8')).expo;
    const resolved = require(path.join(dir, 'app.config.js'))({ config: input });
    const config = withPlugins({ ...resolved, _internal: { projectRoot: mobile } }, resolved.plugins);
    const f = fixture(config, false);
    const original = JSON.parse(f.phase.shellScript);
    const sentryPath = path.join(path.dirname(require.resolve('@sentry/react-native/package.json')), 'plugin/build/withSentryIOS.js');
    const { addSentryWithBundledScriptsToBundleShellScript } = require(sentryPath);
    await f.apply();
    const script = JSON.parse(f.phase.shellScript);
    expect(script).toBe(plugin.patchPhase(addSentryWithBundledScriptsToBundleShellScript(original)));
    expect(script).not.toContain('sentry-xcode.sh');
    expect(script.split(observer)).toHaveLength(2);
    expect(script).not.toContain('/scripts/react-native-xcode.sh');
    expect(f.phase.alwaysOutOfDate).toBe(1);
  });

  it('patches exactly the outer Sentry/RN invocation and survives Xcode write/read', async () => {
    const f = fixture();
    const original = JSON.parse(f.phase.shellScript);
    const unrelated = JSON.stringify(Object.fromEntries(Object.entries(f.phases).filter(([id]) => id !== f.id)));
    await f.apply();
    const patched = JSON.parse(f.phase.shellScript);
    expect(patched).toBe(plugin.patchPhase(original));
    expect(patched.split(observer)).toHaveLength(2);
    expect(patched).not.toContain('/scripts/react-native-xcode.sh');
    expect(f.phase.alwaysOutOfDate).toBe(1);
    expect(JSON.stringify(Object.fromEntries(Object.entries(f.phases).filter(([id]) => id !== f.id)))).toBe(unrelated);
    fs.writeFileSync(f.file, f.project.writeSync());
    const reread = xcode.project(f.file);
    reread.parseSync();
    expect(reread.hash.project.objects.PBXShellScriptBuildPhase[f.id]).toEqual(f.phase);
    // A second installation must not silently wrap or observe another command.
    await expect(f.apply()).rejects.toThrow('unsupported Xcode bundling invocation');
  });

  it.each(['bare RN', 'unknown wrapper', 'extra argument', 'nested legacy observer'])('rejects %s invocation', async fault => {
    const f = fixture();
    const known = JSON.parse(f.phase.shellScript);
    if (fault === 'bare RN') f.phase.shellScript = JSON.stringify(known.replace(/\/bin\/sh `[^\n]*sentry-xcode\.sh'"` /, ''));
    if (fault === 'unknown wrapper') f.phase.shellScript = JSON.stringify(known.replace('/bin/sh `', 'CUSTOM_WRAPPER `'));
    if (fault === 'extra argument') f.phase.shellScript = JSON.stringify(known.trimEnd() + ' extra\n');
    if (fault === 'nested legacy observer') f.phase.shellScript = JSON.stringify(known.replace(/`"\$NODE_BINARY" --print "require\('path'\)\.dirname\(require\.resolve\('react-native\/package\.json'\)\) \+ '\/scripts\/react-native-xcode\.sh'"`/, observer));
    const before = f.project.writeSync();
    await expect(f.apply()).rejects.toThrow('unsupported Xcode bundling invocation');
    expect(f.project.writeSync()).toBe(before);
  });

  it.each(['absent section', 'absent phase', 'duplicate phase'])('rejects %s before any phase mutation', async fault => {
    const f = fixture();
    if (fault === 'absent section') delete f.project.hash.project.objects.PBXShellScriptBuildPhase;
    if (fault === 'absent phase') delete f.phases[f.id];
    if (fault === 'duplicate phase') f.phases.DUPLICATE = { ...f.phase };
    const before = f.project.writeSync();
    await expect(f.apply()).rejects.toThrow('expected one Xcode RN bundling phase');
    expect(f.project.writeSync()).toBe(before);
  });

  it.each(['unknown invocation', 'repeated invocation', 'malformed shellScript'])('rejects %s without partial mutation', async fault => {
    const f = fixture();
    if (fault === 'unknown invocation') f.phase.shellScript = JSON.stringify('unsupported bundler');
    if (fault === 'repeated invocation') f.phase.shellScript = JSON.stringify(JSON.parse(f.phase.shellScript).repeat(2));
    if (fault === 'malformed shellScript') f.phase.shellScript = 'not JSON';
    const before = f.project.writeSync();
    await expect(f.apply()).rejects.toThrow();
    expect(f.project.writeSync()).toBe(before);
  });
});
