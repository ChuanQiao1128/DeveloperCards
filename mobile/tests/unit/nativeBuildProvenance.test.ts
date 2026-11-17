// Explicit local fake Xcode/Metro/Hermes/signature tools. These tests establish
// orchestration only; none of these fixtures is actual signed release evidence.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { baselineReader } from '../fixtures/ownership-baseline/reader';
const require = createRequire(import.meta.url);
const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const producer = require(path.join(mobile, 'scripts/release/nativeBuildProvenance.cjs'));
const guard = require(path.join(mobile, 'scripts/release/queueOwnershipRollout.cjs'));
const observer = require(path.join(mobile, 'scripts/release/observeNativeBundle.cjs'));
const { sha } = guard;
const originalColor = fs.readFileSync(path.join(mobile, 'tests/fixtures/revenuecat-5.50.1/PaywallColor.swift'));
const fixedColor = fs.readFileSync(path.join(mobile, 'native-build-inputs/revenuecat-swift-compatibility/PaywallColor.swift'));
const colorTarget = 'ios/Pods/RevenueCat/Sources/Paywalls/PaywallColor.swift';
const dirs: string[] = [];
const temp = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'native-provenance-STUB-')); dirs.push(p); return p; };
afterEach(() => { vi.unstubAllEnvs(); dirs.splice(0).forEach(dir => fs.rmSync(dir, { force: true, recursive: true })); });
const write = (file: string, data: string | Buffer) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const hbc = Buffer.concat([Buffer.from('c61fbc03c103191f', 'hex'), Buffer.from(' STUB devcards:sync:pendingOwners:v1 PROGRESS_QUEUE_FULL')]);
function fixture() {
  const dir = temp(); const root = path.join(dir, 'repo/mobile');
  for (const f of [...producer.PRODUCER_FILES, 'app.json', 'package.json', 'package-lock.json', 'eas.json', 'src/sync/progressSync.ts']) {
    write(path.join(root, f), f === 'src/sync/progressSync.ts' ? baselineReader : fs.readFileSync(path.join(mobile, f)));
    fs.chmodSync(path.join(root, f), fs.statSync(path.join(mobile, f)).mode);
  }
  fs.cpSync(path.join(mobile, 'vendor'), path.join(root, 'vendor'), { recursive: true });
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  app.expo.ios.appleTeamId = 'STUBTEAM01'; write(path.join(root, 'app.json'), JSON.stringify(app));
  write(path.join(root, 'native-build-inputs/Podfile.lock'), 'STUB locked native inputs');
  execFileSync('git', ['init', '-q'], { cwd: path.dirname(root) });
  const repoGit = (args: string[]) => execFileSync('git', args, { cwd: path.dirname(root), encoding: 'utf8' }).trim();
  repoGit(['add', '.']); repoGit(['-c', 'user.name=STUB', '-c', 'user.email=stub@example.invalid', 'commit', '-qm', 'STUB full archive']);
  return { dir, root, app: app.expo, commit: repoGit(['rev-parse', 'HEAD']), output: path.join(dir, 'new-run'), repoGit };
}
function inspect(ipa: string, app: any) {
  return guard.inspectIpa(ipa, app, (command: string, args: string[], options: any) => {
    if (command === '/usr/bin/codesign') return Buffer.from('STUB Apple signature');
    if (command === '/usr/bin/plutil') return fs.readFileSync(args[args.length - 1]);
    return execFileSync(command, args, options);
  });
}
function writeIpa(output: string, app: any, provenance: any, embedded = hbc) {
  const files = {
    'Payload/STUB.app/Info.plist': Buffer.from(JSON.stringify({ CFBundleShortVersionString: '2.1.1', CFBundleVersion: '26',
      CFBundleIdentifier: app.ios.bundleIdentifier, RecallSmithBuildProvenance: provenance })).toString('base64'),
    'Payload/STUB.app/Expo.plist': Buffer.from(JSON.stringify({ EXUpdatesRuntimeVersion: '2.1.1', EXUpdatesURL: app.updates.url, EXUpdatesRequestHeaders: { 'expo-channel-name': 'production' } })).toString('base64'),
    'Payload/STUB.app/main.jsbundle': embedded.toString('base64'),
  };
  execFileSync('python3', ['-c', 'import json,sys,zipfile,base64\nwith zipfile.ZipFile(sys.argv[1],"x") as z:\n for k,v in json.loads(sys.argv[2]).items(): z.writestr(k,base64.b64decode(v))', output, JSON.stringify(files)]);
}
function fakeBuild(app: any, change?: (c: any) => void) {
  return (c: any) => {
    const root = path.join(c.buildTree, 'mobile');
    const rn = path.join(root, 'node_modules/react-native');
    write(path.join(rn, 'package.json'), JSON.stringify({ version: '0.81.5' }));
    write(path.join(rn, 'scripts/react-native-xcode.sh'), '# STUB tested wrapper execution');
    write(path.join(root, 'node_modules/@expo/cli/package.json'), '{"main":"cli.js"}');
    write(path.join(root, 'node_modules/@expo/cli/cli.js'), '// STUB Metro');
    const build = path.join(c.runDir, 'derived-data/Build/Products/Release-iphoneos');
    fs.mkdirSync(path.join(build, 'STUB.app'), { recursive: true });
    const pods = path.join(root, 'ios/Pods');
    write(path.join(pods, 'hermes-engine/destroot/bin/hermesc'), 'STUB Hermes compiler');
    write(path.join(root, colorTarget), originalColor);
    const revenueCatCompatibility = producer.applyRevenueCatCompatibility(root);
    // Run the real observer, injecting only its Metro/Hermes external process.
    observer.observe(root, { CONFIGURATION: 'Release', PLATFORM_NAME: 'iphoneos', CONFIGURATION_BUILD_DIR: build,
      UNLOCALIZED_RESOURCES_FOLDER_PATH: 'STUB.app', PODS_ROOT: pods }, (_command: string, _args: string[], opts: any) => {
      expect(opts.env.SKIP_BUNDLING).toBe(''); expect(opts.env.BUNDLE_COMMAND).toBe('export:embed');
      write(path.join(build, 'STUB.app/main.jsbundle'), hbc);
      return Buffer.from('STUB Metro + Hermes succeeded');
    });
    write(path.join(c.runDir, 'native-input.json'), producer.encode(producer.manifest(path.join(root, 'ios'), false, c.buildTree)));
    write(path.join(c.runDir, 'public-build-settings.json'), '{"EXPO_PUBLIC_ENV":"STUB"}');
    write(path.join(c.runDir, 'dependency-input.json'), producer.encode(producer.manifest(path.join(root, 'node_modules'), false, c.buildTree)));
    change?.(c);
    if (!fs.existsSync(c.output)) writeIpa(c.output, app, producer.signedContext(c));
    return { publicSettingsSha256: sha(fs.readFileSync(path.join(c.runDir, 'public-build-settings.json'))), node: 'STUB node', npm: 'STUB npm', xcode: 'STUB Xcode', cocoapods: 'STUB pod', reactNative: '0.81.5',
      nativeLockSha256: sha(fs.readFileSync(path.join(root, 'native-build-inputs/Podfile.lock'))),
      nativeInputSha256: sha(fs.readFileSync(path.join(c.runDir, 'native-input.json'))),
      dependencyInputSha256: sha(fs.readFileSync(path.join(c.runDir, 'dependency-input.json'))), revenueCatCompatibility };
  };
}
function produce(f: ReturnType<typeof fixture>, change?: (c: any) => void) {
  return producer.produce(f.root, f.commit, f.output, { inspect, build: fakeBuild(f.app, change) });
}
const completed = (f: ReturnType<typeof fixture>) => path.join(f.output, 'completed.json');
function check(f: ReturnType<typeof fixture>) { return guard.checkProof(f.root, '2.1.1', completed(f), inspect); }

describe('exact official RevenueCat Swift backport', () => {
  it('produces the complete official file from the frozen locked original, then refuses cached fixed input', () => {
    const f = fixture();
    expect(sha(originalColor)).toBe('7d5eb572233ad587841d61be7294b32583d35724be6aa39006982d298774c511');
    expect(sha(fixedColor)).toBe('c24c2c37e341bc2bd33dcdfeb9b0b6f394e1f5eb0609774c3aa50f41b3610344');
    write(path.join(f.root, colorTarget), originalColor);
    fs.chmodSync(path.join(f.root, colorTarget), 0o444);
    const evidence = producer.applyRevenueCatCompatibility(f.root);
    expect(fs.readFileSync(path.join(f.root, colorTarget))).toEqual(fixedColor);
    expect(fs.statSync(path.join(f.root, colorTarget)).mode & 0o777).toBe(0o444);
    expect(evidence).toMatchObject({ beforeSha256: sha(originalColor), afterSha256: sha(fixedColor) });
    expect(() => producer.applyRevenueCatCompatibility(f.root)).toThrow('original source mismatch');
  });
  it.each(['missing', 'unexpected', 'asset', 'symlink'])('refuses %s source/asset before overwriting anything', fault => {
    const f = fixture(); const target = path.join(f.root, colorTarget);
    if (fault !== 'missing') write(target, fault === 'unexpected' ? Buffer.concat([originalColor, Buffer.from(' ')]) : originalColor);
    if (fault === 'asset') fs.appendFileSync(path.join(f.root, 'native-build-inputs/revenuecat-swift-compatibility/PaywallColor.swift'), ' ');
    if (fault === 'symlink') { fs.renameSync(target, `${target}.real`); fs.symlinkSync(`${target}.real`, target); }
    const before = fs.existsSync(target) ? fs.readFileSync(target) : null;
    expect(() => producer.applyRevenueCatCompatibility(f.root)).toThrow(fault === 'missing' ? 'ENOENT' : fault === 'unexpected' ? 'original source mismatch' : fault === 'asset' ? 'asset mismatch' : 'symlink refused');
    expect(fs.existsSync(target) ? fs.readFileSync(target) : null).toEqual(before);
  });
  it('retains exactly the unchanged official private initializer and all other original bytes', () => {
    const block = '    /// "Designated" initializer\n    private init(stringRepresentation: String, underlyingColor: (any Sendable)?) {\n        self.stringRepresentation = stringRepresentation\n        self._underlyingColor = underlyingColor\n    }\n';
    const before = originalColor.toString(); const after = fixedColor.toString();
    expect(before.split(block)).toHaveLength(2); expect(after.split(block)).toHaveLength(2);
    expect(before.replace(`${block}\n`, '')).toBe(after.replace(block, ''));
    expect(before.indexOf(block)).toBeGreaterThan(before.indexOf('private extension PaywallColor'));
    expect(after.indexOf(block)).toBeLessThan(after.indexOf('// MARK: - Public constructors'));
  });
});

describe('producer-owned local provenance orchestration (fake build/signature tools)', () => {
  it('rejects DRY_RUN at the production CLI without creating a run or invoking a build', () => {
    const output = path.join(temp(), 'not-created');
    const result = spawnSync(process.execPath, [path.join(mobile, 'scripts/release/queueOwnershipRollout.cjs'), 'produce', '--commit', 'a'.repeat(40), '--output-dir', output], { encoding: 'utf8', env: { ...process.env, DRY_RUN: '1', NATIVE_BUILD_TEST_RUNNER: 'must-never-select-anything' } });
    expect(result.status).toBe(7); expect(result.stderr).toContain('DRY_RUN cannot produce'); expect(fs.existsSync(output)).toBe(false);
  });
  it('archives actual git objects, observes actual staged bytes, checks signature tools and reuses the original baseline unchanged', () => {
    const f = fixture(); const proof = produce(f);
    expect(proof).toBe(fs.realpathSync(completed(f))); expect(check(f)).toMatchObject({ runtime: '2.1.1', embeddedBundleSha256: sha(hbc) });
    const before = fs.readFileSync(proof);
    write(path.join(f.root, 'dirty-and-untracked.ts'), 'must not become input');
    fs.appendFileSync(path.join(f.root, 'src/sync/progressSync.ts'), '\n// caller changed during/after freeze');
    expect(check(f)).toMatchObject({ runtime: '2.1.1' });
    expect(fs.readFileSync(proof)).toEqual(before);
    expect(fs.existsSync(path.join(f.output, 'build/mobile/dirty-and-untracked.ts'))).toBe(false);
    f.repoGit(['add', '.']); f.repoGit(['-c', 'user.name=STUB', '-c', 'user.email=stub@example.invalid', 'commit', '-qm', 'compatible descendant']);
    expect(check(f)).toMatchObject({ runtime: '2.1.1' });
    expect(fs.readFileSync(proof)).toEqual(before);
  });
  it('retains unrelated tracked environment fixtures in the full repository archive', () => {
    const f = fixture();
    write(path.join(f.root, '../frontend/.env.production'), 'PUBLIC_FIXTURE=unrelated');
    write(path.join(f.root, '../integrations/n8n/.env.example'), 'EXAMPLE_ONLY=unrelated');
    f.repoGit(['add', '.']);
    f.repoGit(['-c', 'user.name=STUB', '-c', 'user.email=stub@example.invalid', 'commit', '-qm', 'unrelated public env fixtures']);
    const next = { ...f, commit: f.repoGit(['rev-parse', 'HEAD']) };
    produce(next, c => {
      expect(fs.readFileSync(path.join(c.buildTree, 'frontend/.env.production'), 'utf8')).toBe('PUBLIC_FIXTURE=unrelated');
    });
    expect(check(next).runtime).toBe('2.1.1');
  });
  it('excludes dirty and untracked caller source/config/node_modules, even while the checkout changes', () => {
    const f = fixture(); write(path.join(f.root, 'node_modules/untrusted.js'), 'untrusted');
    const original = fs.readFileSync(path.join(f.root, 'app.json'));
    write(path.join(f.root, 'app.json'), 'invalid dirty config');
    produce(f, c => {
      expect(fs.readFileSync(path.join(c.buildTree, 'mobile/app.json'))).toEqual(original);
      expect(fs.existsSync(path.join(c.buildTree, 'mobile/node_modules/untrusted.js'))).toBe(false);
      write(path.join(f.root, 'app.json'), 'another unrelated caller change');
    });
    // checkRuntime intentionally validates the OTA target checkout, so restore
    // this fixture's target config before read-only verification.
    write(path.join(f.root, 'app.json'), original); expect(check(f).runtime).toBe('2.1.1');
  });
  it.each(['old-ipa', 'new-native-stale-js', 'missing-stage', 'receipt', 'source', 'overlay', 'archive', 'interrupted', 'no-output', 'symlink-output', 'mutated-stage'])('refuses %s without publishing completion', fault => {
    const f = fixture();
    expect(() => produce(f, c => {
      if (fault === 'old-ipa') writeIpa(c.output, f.app, { ...producer.signedContext(c), buildNonce: '0'.repeat(64) });
      if (fault === 'new-native-stale-js') writeIpa(c.output, f.app, producer.signedContext(c), Buffer.concat([hbc, Buffer.from('wrong reader slice regression')]));
      if (fault === 'missing-stage') fs.rmSync(path.join(c.runDir, 'bundle-stage.json'));
      if (fault === 'receipt') fs.appendFileSync(path.join(c.runDir, 'prepared.json'), ' ');
      if (fault === 'source') write(path.join(c.runDir, 'source/mobile/app.json'), 'mutated');
      if (fault === 'overlay') fs.appendFileSync(path.join(c.buildTree, 'mobile/.ownership-build.json'), ' ');
      if (fault === 'archive') fs.appendFileSync(path.join(c.runDir, 'source.tar'), ' ');
      if (fault === 'interrupted') { writeIpa(c.output, f.app, producer.signedContext(c)); throw new Error('STUB nonzero build with stale output'); }
      if (fault === 'no-output') throw new Error('STUB success without output');
      if (fault === 'symlink-output') { const target = path.join(c.runDir, 'untrusted.ipa'); writeIpa(target, f.app, producer.signedContext(c)); fs.symlinkSync(target, c.output); }
      if (fault === 'mutated-stage') fs.appendFileSync(path.join(c.runDir, 'observed-main.jsbundle'), 'changed');
    })).toThrow();
    expect(fs.existsSync(completed(f))).toBe(false);
    expect(() => produce(f)).toThrow();
  });
  it.each(['success', 'pod-failure', 'native-lock-change', 'unexpected-source'])('executes the fixed local producer with external tools stubbed: %s', fault => {
    const f = fixture(); const calls: string[][] = [];
    const callerHome = path.join(f.dir, 'untrusted-caller-home');
    vi.stubEnv('HOME', callerHome);
    let prebuildEnvironment: Record<string, string> | undefined;
    const publicEnvironment = Object.fromEntries(['EXPO_PUBLIC_API_BASE', 'EXPO_PUBLIC_AWS_REGION', 'EXPO_PUBLIC_COGNITO_USER_POOL_ID',
      'EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID', 'EXPO_PUBLIC_RC_IOS_API_KEY', 'EXPO_PUBLIC_SENTRY_DSN', 'SENTRY_AUTH_TOKEN'].map(k => [k, `STUB_${k}`]));
    const operation = () => producer.produce(f.root, f.commit, f.output, { inspect, build: (c: any) => {
      const root = path.join(c.buildTree, 'mobile');
      const tool = (command: string, args: string[], opts: any) => {
        calls.push([command, ...args]);
        expect(opts.cwd).toBe(root); expect(opts.env.EXPO_NO_DOTENV).toBe('1');
        const signingXcode = command === '/usr/bin/xcodebuild' && (args.includes('archive') || args.includes('-exportArchive'));
        expect(opts.maxBuffer).toBe(8 * 1024 * 1024);
        if (signingXcode) expect(args).toContain('-quiet');
        expect(opts.env.HOME).toBe(signingXcode ? os.userInfo().homedir : path.join(c.runDir, 'home'));
        expect(opts.env.HOME).not.toBe(callerHome);
        expect(opts.env.TMPDIR).toBe(path.join(c.runDir, 'tmp'));
        expect(opts.env.npm_config_cache).toBe(path.join(c.runDir, 'npm-cache'));
        expect(opts.env.LANG).toBe('en_US.UTF-8');
        for (const key of ['LC_ALL', 'LC_CTYPE', 'RUBYOPT', 'NODE_OPTIONS', 'BUNDLE_CONFIG', 'EAS_BUILD_PROFILE']) expect(opts.env[key]).toBeUndefined();
        if (signingXcode) expect(opts.env).toEqual({ ...prebuildEnvironment, HOME: os.userInfo().homedir });
        if (args.includes('--version') || args[0] === '-version') return 'STUB tool version';
        if (command === 'npm') {
          expect(args).toEqual(['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--include=dev']);
          write(path.join(root, 'node_modules/react-native/package.json'), '{"version":"0.81.5"}');
          write(path.join(root, 'node_modules/react-native/scripts/react-native-xcode.sh'), '# STUB RN script');
          write(path.join(root, 'node_modules/@expo/cli/package.json'), '{"main":"cli.js"}');
          write(path.join(root, 'node_modules/@expo/cli/cli.js'), '// STUB Metro');
        } else if (args.includes('prebuild')) {
          prebuildEnvironment = { ...opts.env };
          expect(args).toEqual(['node_modules/expo/bin/cli', 'prebuild', '--platform', 'ios', '--no-install']);
          fs.mkdirSync(path.join(root, 'ios/DeveloperCards.xcworkspace'), { recursive: true });
        } else if (command === 'pod') {
          expect(args).toEqual(['install', '--deployment', '--project-directory=ios']);
          expect(opts.env.CP_HOME_DIR).toBe(path.join(c.runDir, 'pod-cache'));
          write(path.join(root, 'ios/Pods/hermes-engine/destroot/bin/hermesc'), 'STUB Hermes compiler');
          write(path.join(root, colorTarget), fault === 'unexpected-source' ? Buffer.concat([originalColor, Buffer.from(' ')]) : originalColor);
          if (fault === 'pod-failure') throw new Error('STUB pod failure');
          if (fault === 'native-lock-change') fs.appendFileSync(path.join(root, 'ios/Podfile.lock'), 'changed');
        } else if (args.includes('archive')) {
          expect(fs.readFileSync(path.join(root, colorTarget))).toEqual(fixedColor);
          const nativeInput = JSON.parse(fs.readFileSync(path.join(c.runDir, 'native-input.json'), 'utf8'));
          expect(nativeInput[colorTarget.replace('ios/', '')].sha256).toBe(sha(fixedColor));
          expect(args).toContain('Release'); expect(args).toContain(`DEVELOPMENT_TEAM=${c.team}`);
          expect(args[args.indexOf('-derivedDataPath') + 1]).toBe(path.join(c.runDir, 'derived-data'));
          expect(args[args.indexOf('-archivePath') + 1]).toBe(path.join(c.runDir, 'native.xcarchive'));
          const staged = path.join(c.runDir, 'derived-data/Build/Products/Release-iphoneos');
          fs.mkdirSync(staged, { recursive: true });
          observer.observe(root, { CONFIGURATION: 'Release', PLATFORM_NAME: 'iphoneos', CONFIGURATION_BUILD_DIR: staged,
            UNLOCALIZED_RESOURCES_FOLDER_PATH: 'STUB.app', PODS_ROOT: path.join(root, 'ios/Pods') }, () => {
            write(path.join(staged, 'STUB.app/main.jsbundle'), hbc);
          });
        } else if (args.includes('-exportArchive')) {
          expect(args[args.indexOf('-archivePath') + 1]).toBe(path.join(c.runDir, 'native.xcarchive'));
          expect(args[args.indexOf('-exportOptionsPlist') + 1]).toBe(path.join(c.runDir, 'ExportOptions.plist'));
          expect(args[args.indexOf('-exportPath') + 1]).toBe(path.join(c.runDir, 'export'));
          const exported = path.join(c.runDir, 'export/STUB.ipa'); fs.mkdirSync(path.dirname(exported));
          writeIpa(exported, f.app, producer.signedContext(c));
        } else throw new Error(`unexpected tool ${command}`);
        return Buffer.from('STUB local tool success');
      };
      return producer.localBuild(c, tool, { platform: 'darwin', environment: { ...publicEnvironment, HOME: callerHome,
        LANG: 'C', LC_ALL: 'C', LC_CTYPE: 'C', RUBYOPT: '-EUS-ASCII', NODE_OPTIONS: '--require malicious',
        BUNDLE_CONFIG: '/untrusted/metro.config.js', EAS_BUILD_PROFILE: 'evil' }, cache: null });
    } });
    if (fault !== 'success') {
      expect(operation).toThrow(fault === 'pod-failure' ? 'tool failed: pod' : fault === 'native-lock-change' ? 'native dependency lock changed' : 'original source mismatch');
      expect(fs.existsSync(completed(f))).toBe(false);
      expect(fs.existsSync(path.join(f.output, 'native-input.json'))).toBe(false);
      expect(calls.some(call => call.includes('archive'))).toBe(false);
      expect(fs.readFileSync(path.join(f.output, 'build/mobile', colorTarget))).toEqual(fault === 'unexpected-source' ? Buffer.concat([originalColor, Buffer.from(' ')]) : originalColor);
      return;
    }
    operation();
    expect(check(f).embeddedBundleSha256).toBe(sha(hbc));
    expect(calls.some(call => call.includes('-exportArchive'))).toBe(true);
    expect(calls.some(call => call[0] === 'eas')).toBe(false);
    expect(calls.flat()).not.toContain('-allowProvisioningUpdates');
    const receipt = fs.readFileSync(completed(f), 'utf8');
    expect(receipt).not.toContain(publicEnvironment.SENTRY_AUTH_TOKEN);
    expect(receipt).not.toContain(sha(publicEnvironment.SENTRY_AUTH_TOKEN));
  });
  it.each(['safe-metadata', 'untrusted-metadata'])('withholds all tool output and error messages: %s', fault => {
    const f = fixture(); const secret = 'STUB_PRIVATE_AUTHORIZATION_SENTINEL';
    const error = Object.assign(new Error(secret), { stdout: Buffer.from(secret), stderr: secret,
      code: fault === 'safe-metadata' ? 'ENOBUFS' : secret,
      status: fault === 'safe-metadata' ? 65 : secret,
      signal: fault === 'safe-metadata' ? 'SIGTERM' : secret,
      env: { SENTRY_AUTH_TOKEN: secret } });
    const env = Object.fromEntries(['EXPO_PUBLIC_API_BASE', 'EXPO_PUBLIC_AWS_REGION', 'EXPO_PUBLIC_COGNITO_USER_POOL_ID',
      'EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID', 'EXPO_PUBLIC_RC_IOS_API_KEY', 'EXPO_PUBLIC_SENTRY_DSN', 'SENTRY_AUTH_TOKEN'].map(k => [k, secret]));
    const c = { runDir: path.join(f.dir, 'failed-run'), buildTree: path.dirname(f.root), team: 'STUBTEAM01' };
    fs.mkdirSync(c.runDir);
    try {
      producer.localBuild(c, () => { throw error; }, { platform: 'darwin', cache: null, environment: env });
      throw new Error('expected tool failure');
    } catch (actual: any) {
      expect(actual.message).toBe(`local production tool failed: npm; code=${fault === 'safe-metadata' ? 'ENOBUFS' : 'unknown'}; status=${fault === 'safe-metadata' ? 65 : 'unknown'}; signal=${fault === 'safe-metadata' ? 'SIGTERM' : 'none'}; tool output withheld to protect authorization`);
      expect(String(actual.stack)).not.toContain(secret);
      expect(actual.cause).toBeUndefined();
      expect(actual.stdout).toBeUndefined(); expect(actual.stderr).toBeUndefined();
    }
  });
  it.each(['omitted', 'forged', 'unpatched'])('producer rejects %s compatibility evidence despite matching native manifest', fault => {
    const f = fixture();
    expect(() => producer.produce(f.root, f.commit, f.output, { inspect, build: (c: any) => {
      const tools = fakeBuild(f.app)(c);
      if (fault === 'omitted') delete tools.revenueCatCompatibility;
      if (fault === 'forged') tools.revenueCatCompatibility.beforeSha256 = '0'.repeat(64);
      if (fault === 'unpatched') {
        write(path.join(c.buildTree, 'mobile', colorTarget), originalColor);
        write(path.join(c.runDir, 'native-input.json'), producer.encode(producer.manifest(path.join(c.buildTree, 'mobile/ios'), false, c.buildTree)));
        tools.nativeInputSha256 = sha(fs.readFileSync(path.join(c.runDir, 'native-input.json')));
      }
      return tools;
    } })).toThrow(fault === 'unpatched' ? 'native source mismatch' : 'compatibility evidence mismatch');
    expect(fs.existsSync(completed(f))).toBe(false);
  });
  it.each(['omitted', 'forged', 'unpatched'])('checker rejects %s compatibility evidence even when native manifest is rehashed', fault => {
    const f = fixture(); produce(f);
    const proof = JSON.parse(fs.readFileSync(completed(f), 'utf8'));
    if (fault === 'omitted') delete proof.tools.revenueCatCompatibility;
    if (fault === 'forged') proof.tools.revenueCatCompatibility.officialCommit = '0'.repeat(40);
    if (fault === 'unpatched') {
      write(path.join(f.output, 'build/mobile', colorTarget), originalColor);
      write(path.join(f.output, 'native-input.json'), producer.encode(producer.manifest(path.join(f.output, 'build/mobile/ios'), false, path.join(f.output, 'build'))));
      proof.tools.nativeInputSha256 = sha(fs.readFileSync(path.join(f.output, 'native-input.json')));
    }
    write(completed(f), JSON.stringify(proof)); const before = fs.readFileSync(completed(f));
    expect(() => check(f)).toThrow(fault === 'unpatched' ? 'native source mismatch' : 'compatibility evidence mismatch');
    expect(fs.readFileSync(completed(f))).toEqual(before);
  });
  it('refuses unavailable locked native inputs before any external build command', () => {
    const f = fixture();
    expect(() => producer.localBuild({ runDir: f.dir, buildTree: path.join(f.dir, 'absent'), team: 'STUBTEAM01' }, () => { throw new Error('external call must not run'); })).toThrow('Podfile.lock unavailable');
  });
  it('rejects real success-without-output and simultaneous/reused destination', () => {
    const f = fixture();
    expect(() => producer.produce(f.root, f.commit, f.output, { inspect, build: () => ({}) })).toThrow();
    expect(fs.existsSync(completed(f))).toBe(false);
    const second = fixture();
    produce(second, () => expect(() => produce(second)).toThrow());
    expect(check(second).runtime).toBe('2.1.1');
  });
  it('refuses a baseline snapshot path swap during inspection', () => {
    const f = fixture();
    expect(() => producer.produce(f.root, f.commit, f.output, { build: fakeBuild(f.app), inspect: (ipa: string, app: any) => {
      const actual = inspect(ipa, app); const replacement = `${ipa}.swapped`;
      write(replacement, 'wrong bytes'); fs.renameSync(replacement, ipa); return actual;
    } })).toThrow('snapshot changed');
    expect(fs.existsSync(completed(f))).toBe(false);
  });
  it('rejects an unknown expected team and corrupt/incomplete tool fields', () => {
    const f = fixture(); produce(f);
    const app = JSON.parse(fs.readFileSync(path.join(f.root, 'app.json'), 'utf8'));
    app.expo.ios.appleTeamId = 'OTHERTEAM1'; write(path.join(f.root, 'app.json'), JSON.stringify(app));
    expect(() => check(f)).toThrow('unknown Apple team');
    app.expo.ios.appleTeamId = 'STUBTEAM01'; write(path.join(f.root, 'app.json'), JSON.stringify(app));
    const p = JSON.parse(fs.readFileSync(completed(f), 'utf8')); delete p.tools.xcode; write(completed(f), JSON.stringify(p));
    expect(() => check(f)).toThrow('incomplete tool');
  });
  it('rejects an earlier successful run IPA replay under a fresh nonce', () => {
    const f = fixture(); produce(f); const old = fs.readFileSync(path.join(f.output, 'baseline.ipa'));
    const next = { ...f, output: path.join(f.dir, 'second-run') };
    expect(() => produce(next, c => write(c.output, old))).toThrow('nonce mismatch');
    expect(fs.existsSync(completed(next))).toBe(false);
  });
  it.each(['ipa', 'completed', 'prepared', 'stage', 'input', 'source', 'native-input', 'native-lock'])('read-only checker detects modified %s evidence', fault => {
    const f = fixture(); produce(f);
    const file: Record<string, string> = { ipa: 'baseline.ipa', completed: 'completed.json', prepared: 'prepared.json', stage: 'observed-main.jsbundle',
      input: 'input-manifest.json', source: 'source/mobile/app.json', 'native-input': 'native-input.json', 'native-lock': 'source/mobile/native-build-inputs/Podfile.lock' };
    if (fault === 'completed') {
      const p = JSON.parse(fs.readFileSync(completed(f), 'utf8')); p.provenance.buildNonce = '0'.repeat(64); write(completed(f), JSON.stringify(p));
    } else fs.appendFileSync(path.join(f.output, file[fault]), 'tamper');
    const before = fs.readFileSync(completed(f)); expect(() => check(f)).toThrow(); expect(fs.readFileSync(completed(f))).toEqual(before);
  });
  it('rejects cross-run stage/prebuild/IPA mixing', () => {
    const a = fixture(); produce(a);
    for (const name of ['bundle-stage.json', 'prepared.json', 'baseline.ipa']) {
      const b = fixture(); produce(b); fs.copyFileSync(path.join(a.output, name), path.join(b.output, name));
      expect(() => check(b)).toThrow();
    }
  });
  it.each(['symlink', 'submodule', 'lfs', 'archive-filter', 'old-producer', 'mobile-dotenv'])('rejects unsupported source input %s', fault => {
    const f = fixture();
    if (fault === 'symlink') fs.symlinkSync('/tmp/escape', path.join(f.root, 'outside'));
    if (fault === 'mobile-dotenv') write(path.join(f.root, '.env.production'), 'BUILD_INPUT=untrusted');
    if (fault === 'lfs') write(path.join(f.root, 'large-asset'), 'version https://git-lfs.github.com/spec/v1\n');
    if (fault === 'archive-filter') write(path.join(f.root, '.gitattributes'), '* export-subst');
    if (fault === 'old-producer') fs.appendFileSync(path.join(f.root, 'plugins/withBuildProvenance.js'), '\n// stale producer');
    f.repoGit(['add', '.']);
    if (fault === 'submodule') f.repoGit(['update-index', '--add', '--cacheinfo', `160000,${f.commit},external`]);
    f.repoGit(['-c', 'user.name=STUB', '-c', 'user.email=stub@example.invalid', 'commit', '-qm', 'unsupported fixture']);
    const next = { ...f, commit: f.repoGit(['rev-parse', 'HEAD']) };
    if (fault === 'old-producer') write(path.join(f.root, 'plugins/withBuildProvenance.js'), fs.readFileSync(path.join(mobile, 'plugins/withBuildProvenance.js')));
    expect(() => produce(next)).toThrow(); expect(fs.existsSync(completed(next))).toBe(false);
  });
});

describe('Xcode final-bundle observer and config preservation', () => {
  it.each(['skip', 'debug', 'simulator', 'outside', 'stale', 'no-hermes', 'failed-process', 'missing-output', 'text-bundle', 'override'])('fails closed for %s bundling', fault => {
    const dir = temp(); const root = path.join(dir, 'mobile');
    const c = { schema: 2, sourceCommit: 'a'.repeat(40), sourceArchiveSha256: 'b'.repeat(64), buildNonce: 'c'.repeat(64), runDir: dir };
    write(path.join(root, '.ownership-build.json'), JSON.stringify(c));
    const build = path.join(dir, 'derived-data/Release'); fs.mkdirSync(build, { recursive: true });
    const env: any = { CONFIGURATION: 'Release', PLATFORM_NAME: 'iphoneos', CONFIGURATION_BUILD_DIR: build, UNLOCALIZED_RESOURCES_FOLDER_PATH: 'STUB.app', PODS_ROOT: path.join(root, 'ios/Pods') };
    write(path.join(root, 'node_modules/react-native/package.json'), '{"version":"0.81.5"}');
    write(path.join(root, 'node_modules/@expo/cli/package.json'), '{"main":"cli.js"}');
    write(path.join(root, 'node_modules/@expo/cli/cli.js'), '// STUB Metro');
    write(path.join(root, 'node_modules/react-native/scripts/react-native-xcode.sh'), '# STUB RN');
    write(path.join(env.PODS_ROOT, 'hermes-engine/destroot/bin/hermesc'), 'STUB Hermes');
    if (fault === 'skip') env.SKIP_BUNDLING = '1';
    if (fault === 'debug') env.CONFIGURATION = 'Debug';
    if (fault === 'simulator') env.PLATFORM_NAME = 'iphonesimulator';
    if (fault === 'outside') env.CONFIGURATION_BUILD_DIR = dir;
    if (fault === 'stale') write(path.join(build, 'STUB.app/main.jsbundle'), hbc);
    if (fault === 'no-hermes') env.USE_HERMES = 'false';
    if (fault === 'override') env.EXTRA_PACKAGER_ARGS = '--config /untrusted';
    expect(() => observer.observe(root, env, () => {
      if (fault === 'failed-process') throw new Error('STUB process nonzero');
      if (fault !== 'missing-output') write(path.join(build, 'STUB.app/main.jsbundle'), fault === 'text-bundle' ? 'old JS text' : hbc);
    })).toThrow();
    expect(fs.existsSync(path.join(dir, 'bundle-stage.json'))).toBe(false);
  });
  it('preserves resolved app config without context; merges only provenance/plugin with complete context', () => {
    const dir = temp(); const root = path.join(dir, 'mobile');
    for (const name of producer.PRODUCER_FILES) write(path.join(root, name), fs.readFileSync(path.join(mobile, name)));
    const config = JSON.parse(fs.readFileSync(path.join(mobile, 'app.json'), 'utf8')).expo;
    config.updates.requestHeaders = { 'x-fixture': 'public-config' };
    const resolve = require(path.join(root, 'app.config.js'));
    expect(resolve({ config })).toBe(config);
    write(path.join(root, '.ownership-build.json'), '{}'); expect(() => resolve({ config })).toThrow('partial');
    const c = { schema: 2, sourceCommit: 'a'.repeat(40), sourceArchiveSha256: 'b'.repeat(64), buildNonce: 'c'.repeat(64), runDir: dir };
    write(path.join(root, '.ownership-build.json'), JSON.stringify(c));
    const built = resolve({ config });
    expect(built.updates).toEqual({ ...config.updates, requestHeaders: { ...config.updates.requestHeaders, 'expo-channel-name': 'production' } });
    expect(built.extra).toEqual(config.extra); expect(built.plugins[0]).toBe('./plugins/withBuildProvenance');
    expect(built.plugins.slice(1)).toEqual(config.plugins);
    expect(built.ios.infoPlist).toEqual({ ...config.ios.infoPlist, RecallSmithBuildProvenance: producer.signedContext(c) });
    expect({ ...built, plugins: config.plugins, ios: config.ios, updates: config.updates }).toEqual(config);
    config.updates.requestHeaders['expo-channel-name'] = 'preview';
    expect(() => resolve({ config })).toThrow('production update channel conflicts');
  });
  it('patches the known RN invocation within Sentry and rejects unknown/repeated hooks', () => {
    const { patchPhase } = require(path.join(mobile, 'plugins/withBuildProvenance.js'));
    const call = '`"$NODE_BINARY" --print "require(\'path\').dirname(require.resolve(\'react-native/package.json\')) + \'/scripts/react-native-xcode.sh\'"`';
    expect(patchPhase(`SENTRY_WRAPPER ${call}`)).toContain('$PROJECT_DIR/../scripts/release/observeNativeBundle.cjs');
    expect(() => patchPhase('unsupported bundler')).toThrow('unsupported');
    expect(() => patchPhase(`${call} ${call}`)).toThrow('unsupported');
  });
  it('matches the locally installed Expo template invocation, not only a handwritten fixture', () => {
    const { patchPhase } = require(path.join(mobile, 'plugins/withBuildProvenance.js'));
    const project = execFileSync('tar', ['-xOf', path.join(mobile, 'node_modules/expo/template.tgz'), 'package/ios/HelloWorld.xcodeproj/project.pbxproj'], { encoding: 'utf8' });
    const phase = project.match(/name = "Bundle React Native code and images";[\s\S]*?shellScript = ("[^\n]*");/)!;
    expect(phase).toBeTruthy(); expect(patchPhase(JSON.parse(phase[1]))).toContain('observeNativeBundle.cjs');
  });
  it('does not allow build-affecting caller env hooks or record authorization secrets', () => {
    const inherited = Object.fromEntries(['EXPO_PUBLIC_API_BASE', 'EXPO_PUBLIC_AWS_REGION', 'EXPO_PUBLIC_COGNITO_USER_POOL_ID',
      'EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID', 'EXPO_PUBLIC_RC_IOS_API_KEY', 'EXPO_PUBLIC_SENTRY_DSN', 'SENTRY_AUTH_TOKEN'].map(k => [k, `STUB_${k}`]));
    const env = producer.buildEnvironment('/STUB/private', 'STUBTEAM01', { ...inherited, NODE_OPTIONS: '--require malicious', EAS_BUILD_PROFILE: 'evil', SKIP_BUNDLING: '1' });
    expect(env.NODE_OPTIONS).toBeUndefined(); expect(env.EAS_BUILD_PROFILE).toBeUndefined(); expect(env.SKIP_BUNDLING).toBeUndefined();
    expect(env.EXPO_NO_DOTENV).toBe('1');
  });
  it('pins CocoaPods UTF-8 encoding without inheriting caller locale overrides', () => {
    const inherited = Object.fromEntries(['EXPO_PUBLIC_API_BASE', 'EXPO_PUBLIC_AWS_REGION', 'EXPO_PUBLIC_COGNITO_USER_POOL_ID',
      'EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID', 'EXPO_PUBLIC_RC_IOS_API_KEY', 'EXPO_PUBLIC_SENTRY_DSN', 'SENTRY_AUTH_TOKEN'].map(k => [k, `STUB_${k}`]));
    const env = producer.buildEnvironment('/STUB/private', 'STUBTEAM01', {
      ...inherited, LANG: 'C', LC_ALL: 'C', LC_CTYPE: 'C', RUBYOPT: '-EUS-ASCII',
    });
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env.LC_ALL).toBeUndefined(); expect(env.LC_CTYPE).toBeUndefined(); expect(env.RUBYOPT).toBeUndefined();
  });
});
