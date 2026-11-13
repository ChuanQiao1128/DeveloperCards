// Trusted local process evidence, not a reproducible-build attestation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const guard = require('./queueOwnershipRollout.cjs');
const { sha } = guard;
const VERSION = 2;
const CONTEXT = '.ownership-build.json';
const PRODUCER_FILES = ['app.config.js', 'plugins/withBuildProvenance.js',
  'scripts/release/nativeBuildProvenance.cjs', 'scripts/release/queueOwnershipRollout.cjs',
  'scripts/release/observeNativeBundle.cjs'];
const fail = (ok, message) => { if (!ok) throw new Error(message); };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const encode = value => `${JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v, 2)}\n`;
function regular(file, limit = 256 * 1024 * 1024) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    fail(st.isFile() && st.size <= limit, `expected bounded regular file: ${file}`);
    const bytes = fs.readFileSync(fd); const current = fs.lstatSync(file);
    fail(!current.isSymbolicLink() && current.dev === st.dev && current.ino === st.ino && bytes.length === st.size,
      `file changed while reading: ${file}`);
    return bytes;
  } finally { fs.closeSync(fd); }
}
function exclusive(file, bytes) { fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }); }
function manifest(root, generated = false, allowedLinkRoot = null) {
  const files = {};
  const excluded = new Set(['mobile/node_modules', 'mobile/ios', 'mobile/android', 'mobile/.expo']);
  function visit(dir, rel = '') {
    for (const name of fs.readdirSync(dir).sort()) {
      const key = rel ? `${rel}/${name}` : name;
      if (generated && excluded.has(key)) continue;
      const file = path.join(dir, name); const st = fs.lstatSync(file);
      if (st.isSymbolicLink()) {
        const target = fs.realpathSync(file);
        fail(allowedLinkRoot && target.startsWith(`${fs.realpathSync(allowedLinkRoot)}/`), `source symlink refused: ${key}`);
        files[key] = { link: fs.readlinkSync(file) }; continue;
      }
      if (st.isDirectory()) visit(file, key);
      else { fail(st.isFile(), `unsupported source entry: ${key}`); files[key] = { sha256: sha(regular(file)), executable: !!(st.mode & 0o111) }; }
    }
  }
  visit(root); return files;
}
function producerHashes(root) {
  return Object.fromEntries(PRODUCER_FILES.map(name => [name, sha(regular(path.join(root, name)))]));
}
const EXTRACT_SOURCE = `import pathlib,tarfile,sys
root=pathlib.Path(sys.argv[2])
with tarfile.open(sys.argv[1]) as t:
 entries=t.getmembers()
 if len(entries)>100000 or sum(e.size for e in entries)>1024*1024*1024: raise ValueError('source archive exceeds bound')
 seen=set()
 for e in entries:
  p=pathlib.PurePosixPath(e.name)
  if p.is_absolute() or '..' in p.parts or '\\\\' in e.name or not (e.isfile() or e.isdir()) or e.name in seen: raise ValueError('unsafe source archive')
  seen.add(e.name)
 for e in entries:
  dest=root.joinpath(*pathlib.PurePosixPath(e.name).parts)
  if e.isdir(): dest.mkdir(parents=True,exist_ok=True); continue
  dest.parent.mkdir(parents=True,exist_ok=True)
  with t.extractfile(e) as src, dest.open('xb') as out:
   while True:
    chunk=src.read(65536)
    if not chunk: break
    out.write(chunk)
  dest.chmod(0o755 if e.mode & 0o111 else 0o644)
`;
function validateContext(c) {
  fail(c?.schema === VERSION && /^[a-f0-9]{40}$/.test(c.sourceCommit) &&
    /^[a-f0-9]{64}$/.test(c.sourceArchiveSha256) && /^[a-f0-9]{64}$/.test(c.buildNonce) &&
    typeof c.runDir === 'string' && path.isAbsolute(c.runDir), 'invalid or partial native build provenance context');
  return c;
}
function signedContext(c) {
  validateContext(c);
  return { schema: VERSION, sourceCommit: c.sourceCommit, sourceArchiveSha256: c.sourceArchiveSha256, buildNonce: c.buildNonce };
}
function buildEnvironment(runDir, team, inherited = process.env) {
  // Only these public settings and existing signing/upload authorization cross
  // into Xcode. NODE_OPTIONS, dotenv, Metro overrides and caller caches do not.
  const env = { PATH: `${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: path.join(runDir, 'home'), TMPDIR: path.join(runDir, 'tmp'),
    CI: '1', EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1', NODE_ENV: 'production',
    EXPO_PUBLIC_ENV: 'production', RCT_NO_LAUNCH_PACKAGER: '1',
    npm_config_cache: path.join(runDir, 'npm-cache'), npm_config_update_notifier: 'false',
    OWNERSHIP_APPLE_TEAM_ID: team };
  // The cache is an input only to npm's integrity-checked offline installation.
  // It is copied, not shared with the builder or mutated in place.
  for (const key of ['EXPO_PUBLIC_API_BASE', 'EXPO_PUBLIC_AWS_REGION', 'EXPO_PUBLIC_COGNITO_USER_POOL_ID',
    'EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID', 'EXPO_PUBLIC_RC_IOS_API_KEY', 'EXPO_PUBLIC_SENTRY_DSN', 'SENTRY_AUTH_TOKEN']) {
    fail(typeof inherited[key] === 'string' && inherited[key].length > 0, `local production setting required: ${key}`);
    env[key] = inherited[key];
  }
  return env;
}
function localBuild(c, tooling, internal = {}) {
  const run = (command, args, options) => {
    try { return tooling(command, args, options); }
    catch { throw new Error(`local production tool failed: ${path.basename(command)}; tool output withheld to protect authorization`); }
  };
  const mobile = path.join(c.buildTree, 'mobile');
  const nativeLock = path.join(mobile, 'native-build-inputs/Podfile.lock');
  fail(fs.existsSync(nativeLock), 'reviewed native-build-inputs/Podfile.lock unavailable; refusing unlocked native resolution');
  fail((internal.platform ?? process.platform) === 'darwin', 'local production build requires macOS/Xcode');
  const env = buildEnvironment(c.runDir, c.team, internal.environment ?? process.env);
  for (const name of ['home', 'tmp', 'npm-cache', 'derived-data', 'pod-cache']) fs.mkdirSync(path.join(c.runDir, name));
  const cache = internal.cache === null ? null : path.join(require('node:os').homedir(), '.npm/_cacache');
  if (cache && fs.existsSync(cache)) fs.cpSync(cache, path.join(c.runDir, 'npm-cache/_cacache'), { recursive: true, dereference: false });
  const publicSettings = encode(Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('EXPO_PUBLIC_'))));
  exclusive(path.join(c.runDir, 'public-build-settings.json'), publicSettings);
  const opts = { cwd: mobile, env, stdio: 'pipe', timeout: 30 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 };
  const tool = (command, args) => String(run(command, args, { ...opts, timeout: 20000, encoding: 'utf8' })).trim();
  const versions = { publicSettingsSha256: sha(publicSettings), node: process.version, npm: tool('npm', ['--version']), xcode: tool('/usr/bin/xcodebuild', ['-version']),
    cocoapods: tool('pod', ['--version']) };
  const lock = json(path.join(mobile, 'package-lock.json'));
  fail(lock.lockfileVersion >= 3, 'lockfile v3 required');
  for (const [name, pkg] of Object.entries(lock.packages)) {
    if (pkg.link || pkg.resolved?.startsWith('file:')) {
      const relative = (pkg.resolved ?? '').replace(/^file:/, '');
      const local = path.resolve(mobile, relative);
      fail(local.startsWith(`${mobile}/`) && fs.existsSync(local), `external/unavailable local dependency: ${name}`);
    } else if (name && !/(^|\/)node_modules\//.test(name)) {
      const local = path.resolve(mobile, name);
      fail(local.startsWith(`${mobile}/`) && fs.existsSync(local) && json(path.join(local, 'package.json')).version === pkg.version, `unlocked local package: ${name}`);
    } else if (name) fail(pkg.integrity, `unlocked dependency: ${name}`);
  }
  run('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--include=dev'], opts);
  const dependencyInput = encode(manifest(path.join(mobile, 'node_modules'), false, c.buildTree));
  exclusive(path.join(c.runDir, 'dependency-input.json'), dependencyInput);
  versions.dependencyInputSha256 = sha(dependencyInput);
  versions.reactNative = json(path.join(mobile, 'node_modules/react-native/package.json')).version;
  fail(versions.reactNative === '0.81.5', 'unreviewed React Native bundling script version');
  const profile = json(path.join(mobile, 'eas.json')).build.production;
  fail(profile.distribution === 'store' && profile.channel === 'production' && profile.ios.buildConfiguration === 'Release', 'unsupported production profile');
  for (const name of ['SENTRY_ORG', 'SENTRY_PROJECT']) {
    const value = profile.ios.env[name];
    fail(typeof value === 'string' && value.length > 0 && !value.startsWith('REPLACE_ME_'), `fill ${name} in production profile`);
    env[name] = value;
  }
  // Sentry keeps its existing required upload authorization; it cannot select
  // source/config. No EAS cloud/environment API participates in this producer.
  env.SENTRY_ALLOW_FAILURE = profile.ios.env.SENTRY_ALLOW_FAILURE;
  run(process.execPath, ['node_modules/expo/bin/cli', 'prebuild', '--platform', 'ios', '--no-install'], opts);
  fs.copyFileSync(nativeLock, path.join(mobile, 'ios/Podfile.lock'));
  const nativeLockSha256 = sha(regular(nativeLock));
  run('pod', ['install', '--deployment', '--project-directory=ios'], { ...opts, env: { ...env, CP_HOME_DIR: path.join(c.runDir, 'pod-cache') } });
  fail(sha(regular(path.join(mobile, 'ios/Podfile.lock'))) === nativeLockSha256, 'native dependency lock changed');
  const workspaces = fs.readdirSync(path.join(mobile, 'ios')).filter(n => n.endsWith('.xcworkspace'));
  fail(workspaces.length === 1, 'expected one generated Xcode workspace');
  // The generated native project is a build input. Archive it before Xcode;
  // DerivedData/archive outputs live outside it and cannot hide source changes.
  const nativeBefore = encode(manifest(path.join(mobile, 'ios'), false, c.buildTree));
  exclusive(path.join(c.runDir, 'native-input.json'), nativeBefore);
  const exportOptions = path.join(c.runDir, 'ExportOptions.plist');
  exclusive(exportOptions, `<?xml version="1.0"?><plist version="1.0"><dict><key>method</key><string>app-store-connect</string><key>teamID</key><string>${c.team}</string><key>signingStyle</key><string>automatic</string></dict></plist>`);
  run('/usr/bin/xcodebuild', ['-workspace', `ios/${workspaces[0]}`, '-scheme', 'DeveloperCards', '-configuration', 'Release',
    '-sdk', 'iphoneos', '-destination', 'generic/platform=iOS', '-derivedDataPath', path.join(c.runDir, 'derived-data'),
    '-archivePath', path.join(c.runDir, 'native.xcarchive'), `DEVELOPMENT_TEAM=${c.team}`, 'archive'], opts);
  fail(encode(manifest(path.join(mobile, 'ios'), false, c.buildTree)) === nativeBefore, 'native source mutated during Xcode build');
  run('/usr/bin/xcodebuild', ['-exportArchive', '-archivePath', path.join(c.runDir, 'native.xcarchive'),
    '-exportOptionsPlist', exportOptions, '-exportPath', path.join(c.runDir, 'export')], opts);
  const ipas = fs.readdirSync(path.join(c.runDir, 'export')).filter(n => n.endsWith('.ipa'));
  fail(ipas.length === 1, 'expected one newly exported IPA');
  exclusive(c.output, regular(path.join(c.runDir, 'export', ipas[0])));
  return { ...versions, nativeLockSha256, nativeInputSha256: sha(nativeBefore) };
}
function stageEvidence(runDir, expected) {
  const stageBytes = regular(path.join(runDir, 'bundle-stage.json'), 1024 * 1024);
  const stage = JSON.parse(stageBytes);
  fail(encode(stage.provenance) === encode(signedContext(expected)) && stage.stage === 'xcode-react-native-hermes-final-v2' &&
    stage.configuration === 'Release' && stage.platform === 'iphoneos' && typeof stage.bundlePath === 'string' &&
    stage.bundlePath.startsWith(`${runDir}/derived-data/`) && stage.bundlePath.endsWith('/main.jsbundle'), 'missing, mixed or unsupported bundle-stage observation');
  fail(stage.bundleSha256 === sha(regular(path.join(runDir, 'observed-main.jsbundle'), 64 * 1024 * 1024)), 'bundle-stage bytes mismatch');
  fail(stage.bundleSha256 === sha(regular(stage.bundlePath, 64 * 1024 * 1024)), 'Xcode staged bundle changed after observation');
  fail(stage.reactNativeScriptSha256 === sha(regular(path.join(runDir, 'build/mobile/node_modules/react-native/scripts/react-native-xcode.sh'))) &&
    stage.hermesCompilerSha256 === sha(regular(path.join(runDir, 'build/mobile/ios/Pods/hermes-engine/destroot/bin/hermesc'))), 'bundler tool evidence mismatch');
  return { stage, stageSha256: sha(stageBytes) };
}
function produce(root, commit, outputDir, deps = {}) {
  fail(!process.env.DRY_RUN || process.env.DRY_RUN === '0', 'DRY_RUN cannot produce an accepted baseline proof');
  const run = deps.run ?? execFileSync;
  const inspect = deps.inspect ?? guard.inspectIpa;
  const build = deps.build ?? localBuild;
  guard.verifySourceCommit(root, commit, run);
  fail(path.isAbsolute(outputDir), 'absolute new output directory required');
  // Exclusive creation is also the concurrency/restart boundary. Never reuse a
  // half-run or accept an IPA/nonce/receipt supplied by a caller.
  fs.mkdirSync(outputDir, { mode: 0o700 });
  const runDir = fs.realpathSync(outputDir);
  const repoRoot = String(run('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', timeout: 10000 })).trim();
  const gitOpts = { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024, timeout: 60000 };
  const tree = String(run('git', ['ls-tree', '-r', commit], gitOpts));
  fail(!/^(120000|160000) /m.test(tree), 'source symlinks and submodules are unsupported');
  for (const line of tree.split('\n')) {
    if (/\t.*\.gitattributes$/.test(line)) {
      const file = line.split('\t')[1];
      const attributes = String(run('git', ['show', `${commit}:${file}`], gitOpts));
      fail(!/export-ignore|export-subst|filter\s*=\s*lfs/.test(attributes), 'archive/LFS filters are unsupported');
    }
  }
  const archive = run('git', ['archive', '--format=tar', commit], gitOpts);
  fail(archive.length > 0 && archive.length <= 256 * 1024 * 1024, 'source archive exceeds size limit');
  exclusive(path.join(runDir, 'source.tar'), archive); fs.chmodSync(path.join(runDir, 'source.tar'), 0o400);
  const baseline = path.join(runDir, 'source'); fs.mkdirSync(baseline);
  run('python3', ['-c', EXTRACT_SOURCE, path.join(runDir, 'source.tar'), baseline], { timeout: 60000, maxBuffer: 1024 * 1024 });
  const baselineMobile = path.join(baseline, 'mobile');
  const app = guard.checkRuntime(baselineMobile, '2.1.1');
  const hashes = producerHashes(root);
  fail(encode(producerHashes(baselineMobile)) === encode(hashes), 'commit uses a different producer/config/plugin schema');
  const sourceManifest = manifest(baseline);
  // The archive includes unrelated products; only repository-root/mobile dotenv
  // files can affect this build. Public frontend/integration fixtures remain
  // frozen archive inputs and EXPO_NO_DOTENV still prevents dotenv loading.
  for (const name of Object.keys(sourceManifest)) {
    fail(!/^mobile\/(node_modules|ios|android|\.expo)(\/|$)/.test(name) && !/^(?:mobile\/(?:.*\/)?)?\.env($|\.)/.test(name) &&
      name !== `mobile/${CONTEXT}`, `unsupported archived generated/environment input: ${name}`);
    fail(!regular(path.join(baseline, name)).subarray(0, 200).toString().startsWith('version https://git-lfs.github.com/spec/'), 'LFS placeholder refused');
  }
  const buildTree = path.join(runDir, 'build'); fs.cpSync(baseline, buildTree, { recursive: true });
  const c = { schema: VERSION, sourceCommit: commit, sourceArchiveSha256: sha(archive), buildNonce: crypto.randomBytes(32).toString('hex'), runDir };
  const team = process.env.OWNERSHIP_APPLE_TEAM_ID ?? app.ios.appleTeamId;
  fail(/^[A-Z0-9]{10}$/.test(team ?? ''), 'known Apple Team ID required');
  app.ios.appleTeamId = team;
  exclusive(path.join(buildTree, 'mobile', CONTEXT), encode(c));
  const input = manifest(buildTree, true);
  const pre = { schemaVersion: VERSION, state: 'prepared', provenance: signedContext(c), team,
    profile: 'production/ios/Release/local-xcode', readerSha256: guard.READER_SHA256,
    producerHashes: hashes, sourceManifestSha256: sha(encode(sourceManifest)), inputManifestSha256: sha(encode(input)),
    lockSha256: sha(regular(path.join(baselineMobile, 'package-lock.json'))) };
  const preBytes = encode(pre);
  exclusive(path.join(runDir, 'source-manifest.json'), encode(sourceManifest));
  exclusive(path.join(runDir, 'input-manifest.json'), encode(input));
  exclusive(path.join(runDir, 'prepared.json'), preBytes);
  const output = path.join(runDir, 'build-output.ipa');
  fail(!fs.existsSync(output), 'output must be new');
  const tools = build({ ...c, buildTree, output, team }, run);
  const artifactBytes = regular(output);
  // Inspect and retain exactly one snapshot; path swaps cannot change the
  // bytes after hashing but before extraction/signature verification.
  const ipa = path.join(runDir, 'baseline.ipa'); exclusive(ipa, artifactBytes);
  const actual = inspect(ipa, app, run);
  fail(encode(actual.signedProvenance) === encode(signedContext(c)), 'signed source/archive/nonce mismatch (old IPA replay refused)');
  const evidence = stageEvidence(runDir, c);
  fail(actual.embeddedBundleSha256 === evidence.stage.bundleSha256, 'fresh native shell contains stale/different JavaScript');
  fail(sha(artifactBytes) === actual.archiveSha256 && regular(ipa).equals(artifactBytes), 'IPA snapshot changed');
  fail(regular(path.join(runDir, 'prepared.json')).equals(Buffer.from(preBytes)), 'pre-build receipt mutated');
  fail(encode(manifest(baseline)) === encode(sourceManifest) && encode(manifest(buildTree, true)) === encode(input), 'source or overlay changed during build');
  fail(sha(regular(path.join(runDir, 'source.tar'))) === c.sourceArchiveSha256, 'source archive mutated');
  fail(encode(producerHashes(root)) === encode(hashes), 'producer changed during build');
  fail(tools.dependencyInputSha256 === sha(regular(path.join(runDir, 'dependency-input.json'))) &&
    regular(path.join(runDir, 'dependency-input.json')).equals(Buffer.from(encode(manifest(path.join(buildTree, 'mobile/node_modules'), false, buildTree)))), 'dependency input changed during build');
  fail(tools.nativeInputSha256 === sha(regular(path.join(runDir, 'native-input.json'))) &&
    regular(path.join(runDir, 'native-input.json')).equals(Buffer.from(encode(manifest(path.join(buildTree, 'mobile/ios'), false, buildTree)))), 'native input changed during build');
  fail(tools.publicSettingsSha256 === sha(regular(path.join(runDir, 'public-build-settings.json'))), 'public build settings changed');
  const completed = { ...pre, state: 'completed', preBuildSha256: sha(preBytes), ...actual,
    stageSha256: evidence.stageSha256, tools, ipa: 'baseline.ipa' };
  // Linking a fully written temporary file atomically publishes the acceptance
  // marker without overwriting an existing completion, including concurrent runs.
  const pending = path.join(runDir, 'completion.pending'); exclusive(pending, encode(completed));
  fs.linkSync(pending, path.join(runDir, 'completed.json')); fs.unlinkSync(pending);
  return path.join(runDir, 'completed.json');
}
function checkCompleted(root, proofFile, app, deps = {}) {
  const run = deps.run ?? execFileSync; const inspect = deps.inspect ?? guard.inspectIpa;
  const runDir = fs.realpathSync(path.dirname(path.resolve(proofFile)));
  fail(path.basename(proofFile) === 'completed.json', 'only a completed schema-v2 producer run is accepted');
  const proof = JSON.parse(regular(proofFile, 1024 * 1024));
  fail(proof.schemaVersion === VERSION && proof.state === 'completed' && proof.readerSha256 === guard.READER_SHA256 &&
    proof.profile === 'production/ios/Release/local-xcode' && proof.ipa === 'baseline.ipa', 'unsupported or incomplete ownership baseline proof');
  const c = { ...proof.provenance, runDir }; validateContext(c);
  guard.verifySourceCommit(root, c.sourceCommit, run);
  fail(encode(proof.producerHashes) === encode(producerHashes(root)), 'unreviewed producer schema');
  fail(sha(regular(path.join(runDir, 'source.tar'))) === c.sourceArchiveSha256, 'retained archive mismatch');
  const repoRoot = String(run('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', timeout: 10000 })).trim();
  const archive = run('git', ['archive', '--format=tar', c.sourceCommit], { cwd: repoRoot, timeout: 60000, maxBuffer: 256 * 1024 * 1024 });
  fail(sha(archive) === c.sourceArchiveSha256, 'retained archive does not match original source commit');
  const source = path.join(runDir, 'source');
  const sourceManifest = regular(path.join(runDir, 'source-manifest.json'));
  const inputManifest = regular(path.join(runDir, 'input-manifest.json'));
  fail(sha(sourceManifest) === proof.sourceManifestSha256 && sourceManifest.equals(Buffer.from(encode(manifest(source)))), 'source manifest mismatch');
  fail(sha(inputManifest) === proof.inputManifestSha256 && inputManifest.equals(Buffer.from(encode(manifest(path.join(runDir, 'build'), true)))), 'build input manifest mismatch');
  const preBytes = regular(path.join(runDir, 'prepared.json')); const pre = JSON.parse(preBytes);
  fail(sha(preBytes) === proof.preBuildSha256 && encode({ ...pre, state: 'completed' }) === encode(Object.fromEntries(Object.keys(pre).map(k => [k, proof[k]]))), 'pre-build/completed record mismatch');
  fail(proof.lockSha256 === sha(regular(path.join(source, 'mobile/package-lock.json'))), 'dependency lock mismatch');
  const { stage, stageSha256 } = stageEvidence(runDir, c);
  fail(proof.stageSha256 === stageSha256 && proof.embeddedBundleSha256 === stage.bundleSha256, 'completed stage mismatch');
  fail(proof.tools && ['node', 'npm', 'xcode', 'cocoapods', 'reactNative', 'nativeLockSha256', 'nativeInputSha256', 'dependencyInputSha256', 'publicSettingsSha256'].every(k => typeof proof.tools[k] === 'string' && proof.tools[k]), 'incomplete tool/native input evidence');
  fail(proof.tools.nativeInputSha256 === sha(regular(path.join(runDir, 'native-input.json'))) &&
    proof.tools.nativeLockSha256 === sha(regular(path.join(source, 'mobile/native-build-inputs/Podfile.lock'))), 'native input evidence mismatch');
  const dependencyInput = regular(path.join(runDir, 'dependency-input.json'));
  fail(proof.tools.dependencyInputSha256 === sha(dependencyInput) && dependencyInput.equals(Buffer.from(encode(manifest(path.join(runDir, 'build/mobile/node_modules'), false, path.join(runDir, 'build'))))), 'dependency input evidence mismatch');
  const nativeInput = regular(path.join(runDir, 'native-input.json'));
  fail(nativeInput.equals(Buffer.from(encode(manifest(path.join(runDir, 'build/mobile/ios'), false, path.join(runDir, 'build'))))), 'native input tree mismatch');
  fail(proof.tools.publicSettingsSha256 === sha(regular(path.join(runDir, 'public-build-settings.json'))), 'public build settings evidence mismatch');
  const knownTeam = process.env.OWNERSHIP_APPLE_TEAM_ID ?? app.ios.appleTeamId;
  fail(/^[A-Z0-9]{10}$/.test(knownTeam ?? '') && proof.team === knownTeam, 'baseline signed by unknown Apple team');
  app.ios.appleTeamId = knownTeam;
  regular(path.join(runDir, 'baseline.ipa'));
  const actual = inspect(path.join(runDir, 'baseline.ipa'), app, run);
  for (const key of Object.keys(actual)) fail(encode(proof[key]) === encode(actual[key]), `baseline proof/artifact mismatch: ${key}`);
  fail(encode(actual.signedProvenance) === encode(signedContext(c)), 'signed provenance mismatch');
  return actual;
}
module.exports = { produce, checkCompleted, validateContext, signedContext, manifest, encode, regular, exclusive, stageEvidence, localBuild, buildEnvironment, PRODUCER_FILES };
