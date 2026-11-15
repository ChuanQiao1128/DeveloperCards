// Real locked Expo/Sentry/RN shell integration with deterministic fake
// Sentry CLI, Metro, Hermes and source-map tools. No network/signing evidence.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { patchPhase } = require('../../plugins/withBuildProvenance.js');
const { observe } = require('../../scripts/release/observeNativeBundle.cjs');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
const write = (file: string, bytes: string | Buffer) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
const hbc = Buffer.concat([Buffer.from('c61fbc03c103191f', 'hex'), Buffer.from(' FAKE final Hermes')]);
function fixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sentry-observer-FAKE-'))); dirs.push(dir);
  const root = path.join(dir, 'mobile');
  const build = path.join(dir, 'derived-data/Build/Products/Release-iphoneos');
  const ios = path.join(root, 'ios');
  const log = path.join(dir, 'chain.jsonl');
  fs.mkdirSync(path.join(build, 'FAKE.app'), { recursive: true }); fs.mkdirSync(ios, { recursive: true });
  const context = { schema: 2, sourceCommit: 'a'.repeat(40), sourceArchiveSha256: 'b'.repeat(64), buildNonce: 'c'.repeat(64), runDir: dir };
  write(path.join(root, '.ownership-build.json'), JSON.stringify(context));
  for (const name of ['observeNativeBundle.cjs', 'nativeBuildProvenance.cjs', 'queueOwnershipRollout.cjs']) {
    const dest = path.join(root, 'scripts/release', name);
    write(dest, fs.readFileSync(path.join(mobile, 'scripts/release', name))); fs.chmodSync(dest, 0o755);
  }
  for (const [pkg, version] of [['react-native', '0.81.5'], ['@sentry/react-native', '7.2.0'], ['@sentry/cli', '2.55.0']]) {
    write(path.join(root, 'node_modules', pkg, 'package.json'), JSON.stringify({ version }));
  }
  for (const name of ['react-native/scripts/react-native-xcode.sh', 'react-native/scripts/node-binary.sh', '@sentry/react-native/scripts/sentry-xcode.sh']) {
    const dest = path.join(root, 'node_modules', name);
    write(dest, fs.readFileSync(path.join(mobile, 'node_modules', name))); fs.chmodSync(dest, 0o755);
  }
  const prelude = `const fs=require('node:fs'), cp=require('node:child_process'), path=require('node:path'), assert=require('node:assert'); const env=process.env, args=process.argv.slice(2); const log=v=>fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(v)+'\\n');`;
  const tool = (rel: string, code: string) => {
    const file = path.join(root, rel); write(file, `#!${process.execPath}\n${prelude}\n${code}\n`); fs.chmodSync(file, 0o755); return file;
  };
  const cli = tool('node_modules/@expo/cli/cli.js', `
    assert.equal(env.__SENTRY_RN_WRAP_XCODE_CALL,'1'); assert.equal(args[0],'export:embed');
    const out=args[args.indexOf('--bundle-output')+1], map=args[args.indexOf('--sourcemap-output')+1];
    log('metro'); fs.writeFileSync(out,'FAKE Metro JS'); fs.writeFileSync(map,'{}');`);
  write(path.join(root, 'node_modules/@expo/cli/package.json'), '{"main":"cli.js"}');
  tool('node_modules/react-native/scripts/compose-source-maps.js', `
    assert.equal(env.__SENTRY_RN_WRAP_XCODE_CALL,'1'); log('compose');
    fs.writeFileSync(args[args.indexOf('-o')+1],'FAKE composed source map');`);
  const hermes = tool('ios/Pods/hermes-engine/destroot/bin/hermesc', `
    assert.equal(env.__SENTRY_RN_WRAP_XCODE_CALL,'1'); log('hermes');
    const out=args[args.indexOf('-out')+1]; fs.writeFileSync(out,Buffer.from('${hbc.toString('hex')}','hex')); fs.writeFileSync(out+'.map','{}');`);
  tool('node_modules/@sentry/cli/bin/sentry-cli', `
    if (env.__SENTRY_RN_WRAP_XCODE_CALL === '1') {
      const compiling=args.includes('-emit-binary'); log(compiling?'sentry-wrap-hermes':'sentry-wrap-node');
      const result=cp.spawnSync(compiling?env.SENTRY_RN_REAL_HERMES_CLI_PATH:env.SENTRY_RN_REAL_NODE_BINARY,args,{env,stdio:'inherit'});
      if (result.status!==0) process.exit(result.status??1);
      const report=JSON.parse(fs.readFileSync(env.SENTRY_RN_SOURCEMAP_REPORT));
      if (args.includes('--bundle-output')) { report.packager_bundle_path=args[args.indexOf('--bundle-output')+1]; report.packager_sourcemap_path=args[args.indexOf('--sourcemap-output')+1]; }
      if (compiling) report.hermes_bundle_path=args[args.indexOf('-out')+1];
      if (args.includes('-o')) report.hermes_sourcemap_path=args[args.indexOf('-o')+1];
      fs.writeFileSync(env.SENTRY_RN_SOURCEMAP_REPORT,JSON.stringify(report)); process.exit(0);
    }
    assert.deepEqual(args.slice(0,2),['react-native','xcode']); assert.equal(args.length,3);
    assert.equal(args[2],path.join(${JSON.stringify(root)},'node_modules/react-native/scripts/react-native-xcode.sh'));
    assert.equal(process.cwd(),${JSON.stringify(ios)}); assert.equal(env.NODE_BINARY,${JSON.stringify(process.execPath)});
    assert.equal(env.HERMES_CLI_PATH,${JSON.stringify(hermes)}); assert.notEqual(env.SENTRY_DISABLE_AUTO_UPLOAD,'true');
    assert.equal(env.SENTRY_ALLOW_FAILURE,'true'); log('sentry-cli');
    const reportFile=${JSON.stringify(path.join(dir, 'FAKE-report.json'))}; fs.writeFileSync(reportFile,'{}');
    // The exact Sentry CLI 2.55.0 xcode.rs 261-274 injection protocol.
    const injected={...env,NODE_BINARY:__filename,HERMES_CLI_PATH:__filename,
      SENTRY_RN_REAL_NODE_BINARY:env.NODE_BINARY,SENTRY_RN_REAL_HERMES_CLI_PATH:env.HERMES_CLI_PATH,
      SENTRY_RN_SOURCEMAP_REPORT:reportFile,__SENTRY_RN_WRAP_XCODE_CALL:'1'};
    const result=cp.spawnSync(args[2],[],{env:injected,stdio:'inherit'}); if(result.status!==0)process.exit(result.status??1);
    const report=JSON.parse(fs.readFileSync(reportFile));
    for(const key of ['packager_bundle_path','packager_sourcemap_path','hermes_bundle_path','hermes_sourcemap_path']) assert(report[key]);
    assert.equal(fs.readFileSync(report.hermes_sourcemap_path,'utf8'),'FAKE composed source map');
    if(env.FAKE_SENTRY_FAILURE) { console.error('FAKE_PRIVATE_OUTPUT'); process.exit(9); }
    // Simulate Sentry's post-bundle work so observation must follow it.
    fs.appendFileSync(report.hermes_bundle_path,' FAKE Sentry finalized'); log('sentry-report-upload-attempt');`);
  const collect = path.join(root, 'node_modules/@sentry/react-native/scripts/collect-modules.sh');
  write(collect, `#!/bin/sh\n"${process.execPath}" -e 'require("fs").appendFileSync(${JSON.stringify(log)},JSON.stringify("sentry-collect")+"\\n")'\n`);
  write(path.join(root, 'index.ts'), '// FAKE entry');
  const env = { NODE_ENV: 'production', PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, CONFIGURATION: 'Release', PLATFORM_NAME: 'iphoneos',
    PROJECT_DIR: ios, CONFIGURATION_BUILD_DIR: build, UNLOCALIZED_RESOURCES_FOLDER_PATH: 'FAKE.app', PODS_ROOT: path.join(ios, 'Pods'),
    DERIVED_FILE_DIR: path.join(build, 'DerivedSources'), NODE_BINARY: process.execPath, ENTRY_FILE: path.join(root, 'index.ts'), CLI_PATH: cli,
    SENTRY_ALLOW_FAILURE: 'true' };
  fs.mkdirSync(env.DERIVED_FILE_DIR);
  const raw = execFileSync('tar', ['-xOf', path.join(mobile, 'node_modules/expo/template.tgz'), 'package/ios/HelloWorld.xcodeproj/project.pbxproj'], { encoding: 'utf8' });
  const template = JSON.parse(raw.match(/name = "Bundle React Native code and images";[\s\S]*?shellScript = ("[^\n]*");/)![1]);
  const sentryPath = path.join(path.dirname(require.resolve('@sentry/react-native/package.json')), 'plugin/build/withSentryIOS.js');
  const generated = require(sentryPath).addSentryWithBundledScriptsToBundleShellScript(template);
  return { dir, root, build, env, log, generated, context };
}

describe('outer native observer with the locked Sentry injection protocol (fake tools)', () => {
  it('reproduces the legacy nested observer refusal before Metro without accepting any bytes', () => {
    const f = fixture();
    const nested = f.generated.replace(/`"\$NODE_BINARY" --print "require\('path'\)\.dirname\(require\.resolve\('react-native\/package\.json'\)\) \+ '\/scripts\/react-native-xcode\.sh'"`/, '"$PROJECT_DIR/../scripts/release/observeNativeBundle.cjs"');
    // Call the observer with the same injected fields used by the fake Sentry
    // protocol; its override rejection happens before any child tool can run.
    expect(nested).toContain('sentry-xcode.sh');
    expect(() => observe(f.root, { ...f.env, HERMES_CLI_PATH: 'FAKE-sentry-cli', __SENTRY_RN_WRAP_XCODE_CALL: '1' })).toThrow('uncontrolled bundle override: HERMES_CLI_PATH');
    expect(fs.existsSync(f.log)).toBe(false); expect(fs.existsSync(path.join(f.dir, 'bundle-stage.json'))).toBe(false);
  });
  it('runs generated Expo phase → outer observer → Sentry → RN → wrapped tools → Sentry completion, then observes final HBC', () => {
    const f = fixture();
    const phase = patchPhase(f.generated);
    expect(phase).not.toContain('sentry-xcode.sh');
    const result = spawnSync('/bin/bash', ['-c', phase], { cwd: f.env.PROJECT_DIR, env: f.env, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(f.log, 'utf8').trim().split('\n').map(line => JSON.parse(line))).toEqual([
      'sentry-cli', 'sentry-wrap-node', 'metro', 'sentry-wrap-hermes', 'hermes', 'sentry-wrap-node', 'compose', 'sentry-report-upload-attempt', 'sentry-collect',
    ]);
    const final = Buffer.concat([hbc, Buffer.from(' FAKE Sentry finalized')]);
    expect(fs.readFileSync(path.join(f.dir, 'observed-main.jsbundle'))).toEqual(final);
    expect(fs.readFileSync(path.join(f.build, 'FAKE.app/main.jsbundle'))).toEqual(final);
    const stage = JSON.parse(fs.readFileSync(path.join(f.dir, 'bundle-stage.json'), 'utf8'));
    expect(stage.provenance).toMatchObject({ sourceCommit: f.context.sourceCommit, sourceArchiveSha256: f.context.sourceArchiveSha256, buildNonce: f.context.buildNonce });
    expect(() => observe(f.root, f.env)).toThrow('pre-existing/stale');
  });
  it('refuses a failed Sentry process after Hermes without recording stage or leaking tool output', () => {
    const f = fixture();
    const result = spawnSync('/bin/bash', ['-c', patchPhase(f.generated)], { cwd: f.env.PROJECT_DIR,
      env: { ...f.env, FAKE_SENTRY_FAILURE: '1' }, encoding: 'utf8' });
    expect(result.status).toBe(7);
    expect(result.stderr).toContain('Sentry/Metro/Hermes build failed; tool output withheld');
    expect(result.stderr + result.stdout).not.toContain('FAKE_PRIVATE_OUTPUT');
    expect(fs.readFileSync(path.join(f.build, 'FAKE.app/main.jsbundle'))).toEqual(hbc);
    expect(fs.existsSync(path.join(f.dir, 'bundle-stage.json'))).toBe(false);
    expect(fs.existsSync(path.join(f.dir, 'observed-main.jsbundle'))).toBe(false);
  });
  it.each(['NODE_OPTIONS', 'NODE_ARGS', 'EXTRA_PACKAGER_ARGS', 'BUNDLE_CONFIG', 'CONFIG_CMD', 'CONFIG_JSON', 'HERMES_CLI_PATH',
    'COMPOSE_SOURCEMAP_PATH', 'SOURCEMAP_FILE', 'SOURCE_MAP_PATH', 'MODULES_PATHS', 'SENTRY_CLI_EXECUTABLE', 'SENTRY_CLI_PACKAGE_PATH',
    'SENTRY_BINARY_PATH', 'SENTRY_PROPERTIES', 'SENTRY_DOTENV_PATH', 'SENTRY_CLI_EXTRA_ARGS', 'SENTRY_CLI_RN_XCODE_EXTRA_ARGS',
    'SENTRY_COLLECT_MODULES', 'SENTRY_RN_PACKAGE_PATH', 'SENTRY_DISABLE_AUTO_UPLOAD', '__SENTRY_RN_WRAP_XCODE_CALL',
    'SENTRY_RN_REAL_NODE_BINARY', 'SENTRY_RN_REAL_HERMES_CLI_PATH', 'SENTRY_RN_SOURCEMAP_REPORT'])('rejects caller injection %s without exposing its value', key => {
    const f = fixture(); let error: any;
    try { observe(f.root, { ...f.env, [key]: 'SECRET_SENTINEL_DO_NOT_PRINT' }); } catch (e) { error = e; }
    expect(error?.message).toBe(`uncontrolled bundle override: ${key}`);
    expect(fs.existsSync(f.log)).toBe(false); expect(fs.existsSync(path.join(f.dir, 'bundle-stage.json'))).toBe(false);
  });
  it.each(['@sentry/react-native', '@sentry/cli', 'react-native'])('refuses unknown %s version before invoking tools', pkg => {
    const f = fixture(); write(path.join(f.root, 'node_modules', pkg, 'package.json'), '{"version":"0.0.0-unknown"}');
    expect(() => observe(f.root, f.env)).toThrow('unsupported RN/Sentry bundling tool'); expect(fs.existsSync(f.log)).toBe(false);
  });
});
