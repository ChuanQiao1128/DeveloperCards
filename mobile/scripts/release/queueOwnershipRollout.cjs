#!/usr/bin/env node
// Ownership metadata is incompatible with the 2.1.0 embedded reader. Never
// authorize an OTA using only a version string or a handwritten attestation.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const RUNTIME = '2.1.1';
const BUILD = '26';
const READER_SHA256 = 'c59b5f41f8962c6a5a9aa8dabf059dd3618d3ca9c8e1f101c9d599455a022299';
const MARKERS = ['devcards:sync:pendingOwners:v1', 'PROGRESS_QUEUE_FULL'];
const sha = value => createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };

function ownershipEnabled(root, app) {
  // An unreadable/unknown reader is never evidence for the legacy exemption.
  const source = fs.readFileSync(path.join(root, 'src/sync/progressSync.ts'), 'utf8');
  if (MARKERS.some(marker => source.includes(marker)) || app.version === RUNTIME ||
      app.extra?.progressQueueOwnershipFormat !== 0) return true;
  requireThat(/^\d+\.\d+\.\d+$/.test(app.version) && app.runtimeVersion?.policy === 'appVersion' &&
    source.includes('export async function recordReviewEvent') && source.includes('async function enqueueProgressEvent'),
    'explicit legacy format-0 contract requires a readable recognized non-ownership reader');
  return false;
}
function checkRuntime(root, targetRuntime) {
  const app = readJson(path.join(root, 'app.json')).expo;
  requireThat(ownershipEnabled(root, app), 'ownership baseline is not enabled');
  requireThat(app.version === RUNTIME && targetRuntime === RUNTIME, 'ownership updates require runtime 2.1.1; old, mismatched or unknown runtime refused');
  requireThat(app.runtimeVersion?.policy === 'appVersion', 'ownership updates require the appVersion runtime policy');
  requireThat(app.extra?.progressQueueOwnershipFormat === 1 && app.ios?.buildNumber === BUILD, 'ownership baseline requires format 1 and native build 26');
  const pkg = readJson(path.join(root, 'package.json'));
  const lock = readJson(path.join(root, 'package-lock.json'));
  requireThat(pkg.version === RUNTIME && lock.version === RUNTIME && lock.packages?.['']?.version === RUNTIME, 'app/package/lock root versions must agree');
  return app;
}

// Inventory and bound the archive before writing any entry. zipfile enforces
// declared file sizes as it reads; no symlinks or path escapes are extracted.
const EXTRACT_IPA = `import pathlib, stat, sys, zipfile
root = pathlib.Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as z:
 entries = z.infolist()
 if len(entries) > 10000 or sum(e.file_size for e in entries) > 512 * 1024 * 1024:
  raise ValueError('baseline archive exceeds entry/size limit')
 for e in entries:
  parts = pathlib.PurePosixPath(e.filename)
  if parts.is_absolute() or '..' in parts.parts or '\\\\' in e.filename or stat.S_ISLNK(e.external_attr >> 16):
   raise ValueError('unsafe baseline archive path or symlink')
  if e.file_size > 128 * 1024 * 1024: raise ValueError('baseline entry exceeds size limit')
 for e in entries:
  target = root.joinpath(*pathlib.PurePosixPath(e.filename).parts)
  if e.is_dir(): target.mkdir(parents=True, exist_ok=True); continue
  target.parent.mkdir(parents=True, exist_ok=True)
  with z.open(e) as source, target.open('wb') as dest:
   while True:
    chunk = source.read(65536)
    if not chunk: break
    dest.write(chunk)
`;
function inspectIpa(ipa, app, run = execFileSync) {
  requireThat(typeof ipa === 'string' && path.isAbsolute(ipa) && fs.statSync(ipa).isFile(), 'baseline IPA must be an absolute local file');
  requireThat(fs.statSync(ipa).size <= 256 * 1024 * 1024, 'baseline IPA exceeds size limit');
  const team = app.ios.appleTeamId;
  requireThat(typeof team === 'string' && /^[A-Z0-9]{10}$/.test(team), 'known Apple Team ID required (OWNERSHIP_APPLE_TEAM_ID)');
  requireThat(/^[A-Za-z0-9.-]+$/.test(app.ios.bundleIdentifier), 'invalid expected bundle identifier');
  const archiveSha256 = sha(fs.readFileSync(ipa));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'recallsmith-baseline-'));
  try {
    run('python3', ['-c', EXTRACT_IPA, ipa, temp], { timeout: 60000, maxBuffer: 1024 * 1024 });
    const payload = path.join(temp, 'Payload');
    const apps = fs.readdirSync(payload).filter(name => name.endsWith('.app'));
    requireThat(apps.length === 1, 'baseline must contain exactly one iOS app');
    const bundle = path.join(payload, apps[0]);
    // An Apple identity from the configured team is required; an ad-hoc
    // signature or an otherwise valid signature from an unknown team fails.
    const requirement = `anchor apple generic and certificate leaf[subject.OU] = "${team}" and identifier "${app.ios.bundleIdentifier}"`;
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', `-R=${requirement}`, bundle], { timeout: 60000, stdio: 'pipe' });
    const plist = name => JSON.parse(String(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(bundle, name)], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 })));
    const info = plist('Info.plist');
    const updates = plist('Expo.plist');
    requireThat(info.CFBundleShortVersionString === RUNTIME && info.CFBundleVersion === BUILD && info.CFBundleIdentifier === app.ios.bundleIdentifier, 'baseline native identity/version mismatch');
    requireThat(updates.EXUpdatesRuntimeVersion === RUNTIME && updates.EXUpdatesURL === app.updates.url && updates.EXUpdatesEnabled !== false, 'baseline embedded runtime/update URL mismatch');
    const embeddedPath = path.join(bundle, 'main.jsbundle');
    requireThat(fs.statSync(embeddedPath).size <= 64 * 1024 * 1024, 'embedded baseline exceeds size limit');
    const embedded = fs.readFileSync(embeddedPath);
    requireThat(MARKERS.every(marker => embedded.includes(Buffer.from(marker))), 'baseline embedded bundle lacks the ownership reader or full-queue guard');
    return { signedProvenance: info.RecallSmithBuildProvenance ?? null, runtime: RUNTIME, buildNumber: BUILD, bundleIdentifier: info.CFBundleIdentifier, appleTeamId: team, archiveSha256, embeddedBundleSha256: sha(embedded) };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
function verifySourceCommit(root, commit, run = execFileSync) {
  requireThat(typeof commit === 'string' && /^[a-f0-9]{40}$/.test(commit), 'baseline source commit required');
  const opts = { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 };
  run('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], opts);
  const source = run('git', ['show', `${commit}:mobile/src/sync/progressSync.ts`], opts);
  requireThat(sha(source) === READER_SHA256, 'baseline commit lacks the reviewed ownership reader');
  const app = JSON.parse(run('git', ['show', `${commit}:mobile/app.json`], opts)).expo;
  requireThat(app.version === RUNTIME && app.ios.buildNumber === BUILD && app.runtimeVersion?.policy === 'appVersion' && app.extra?.progressQueueOwnershipFormat === 1, 'baseline commit lacks native ownership configuration');
}
function checkProof(root, targetRuntime, proofFile, inspect = inspectIpa, run = execFileSync) {
  const app = checkRuntime(root, targetRuntime);
  requireThat(proofFile && fs.existsSync(proofFile), 'compatible embedded-baseline proof required; produce a local native baseline first');
  return require('./nativeBuildProvenance.cjs').checkCompleted(root, proofFile, app, { inspect, run });
}
module.exports = { ownershipEnabled, checkRuntime, inspectIpa, verifySourceCommit, checkProof, READER_SHA256, sha };
if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '../..');
    const [command, ...args] = process.argv.slice(2);
    const producer = () => require('./nativeBuildProvenance.cjs');
    if (command === 'produce') {
      requireThat(args.length === 4 && args[0] === '--commit' && args[2] === '--output-dir',
        'usage: queueOwnershipRollout.cjs produce --commit <full reviewed SHA> --output-dir <new directory>');
      const proof = producer().produce(root, args[1], path.resolve(args[3]));
      console.log(`OWNERSHIP_BASELINE_PROOF=${proof}`);
    } else if (command === 'inspect') {
      requireThat(args.length === 1, 'usage: queueOwnershipRollout.cjs inspect <absolute IPA>');
      const app = checkRuntime(root, RUNTIME);
      app.ios.appleTeamId = process.env.OWNERSHIP_APPLE_TEAM_ID ?? app.ios.appleTeamId;
      console.log(JSON.stringify(inspectIpa(args[0], app), null, 2));
    } else {
      requireThat(command === 'check' || command === 'check-build', 'unsupported command; use produce, check or inspect (post-hoc record is forbidden)');
      const app = readJson(path.join(root, 'app.json')).expo;
      if (ownershipEnabled(root, app)) {
        if (command === 'check-build') {
          throw new Error('ownership builds require the trusted local producer: produce --commit <full reviewed SHA> --output-dir <new directory>; LOCAL_BUILD=1 alone is insufficient');
        } else {
          requireThat(args.length === 0 || (args.length === 4 && args[0] === '--proof' && args[2] === '--runtime'), 'usage: check --proof <completed.json> --runtime 2.1.1');
          checkProof(root, args[3] ?? process.env.OTA_RUNTIME_VERSION ?? app.version, args[1] ?? process.env.OWNERSHIP_BASELINE_PROOF);
          console.log('ownership rollout: verified producer-owned signed embedded baseline 2.1.1 (26)');
        }
      }
    }
  } catch (error) {
    console.error(`ownership rollout refused: ${error.message}`);
    process.exitCode = 7;
  }
}
