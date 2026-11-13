// All compatible artifact/signature cases below are explicit local stubs.
// These fixtures are not signed IPA evidence and cannot authorize a real OTA.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const guard = require(path.join(mobile, 'scripts/release/queueOwnershipRollout.cjs'));
const source = fs.readFileSync(path.join(mobile, 'src/sync/progressSync.ts'));
const hash = (v: Buffer | string) => createHash('sha256').update(v).digest('hex');
const commit = 'a'.repeat(40);
const tempDirs: string[] = [];
const temp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ownership-STUB-')); tempDirs.push(dir); return dir; };
afterEach(() => tempDirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
function fixture() {
  const root = temp();
  const app = JSON.parse(fs.readFileSync(path.join(mobile, 'app.json'), 'utf8'));
  app.expo.ios.appleTeamId = 'STUBTEAM01';
  for (const name of ['app.json', 'package.json', 'package-lock.json']) {
    fs.writeFileSync(path.join(root, name), name === 'app.json' ? JSON.stringify(app) : fs.readFileSync(path.join(mobile, name)));
  }
  fs.mkdirSync(path.join(root, 'src/sync'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/sync/progressSync.ts'), source);
  const ipa = path.join(root, 'STUB.ipa');
  fs.writeFileSync(ipa, 'stubbed inspector only; not a signed IPA');
  const inspect = () => ({ runtime: '2.1.1', buildNumber: '26', bundleIdentifier: app.expo.ios.bundleIdentifier,
    appleTeamId: 'STUBTEAM01', archiveSha256: hash(fs.readFileSync(ipa)), embeddedBundleSha256: hash('STUB embedded reader') });
  const git = (_command: string, args: string[]) => {
    if (args[0] === 'rev-parse') return commit;
    if (args[0] === 'show') return args[1].endsWith('app.json') ? JSON.stringify(app) : source;
    return '';
  };
  return { root, app: app.expo, ipa, inspect, git, proof: path.join(root, 'STUB-PROOF.json') };
}

describe('ownership release gate', () => {
  it('accepts compatible 2.1.1 fallback only with artifact hashes and reviewed source commit proof (stubs)', () => {
    const f = fixture();
    const proof = guard.recordProof(f.root, f.ipa, f.proof, f.inspect, f.git);
    expect(proof.sourceCommit).toBe(commit);
    expect(proof.archiveSha256).toBe(hash(fs.readFileSync(f.ipa)));
    expect(guard.checkProof(f.root, '2.1.1', f.proof, f.inspect, f.git)).toMatchObject({ runtime: '2.1.1', buildNumber: '26' });
  });
  it.each(['2.1.0', '2.0.0', '2.1.2', '', 'unknown'])('rejects an incompatible/missing runtime %s before reading proof', runtime => {
    const f = fixture();
    expect(() => guard.checkProof(f.root, runtime, undefined)).toThrow('runtime 2.1.1');
  });
  it('rejects ownership source relabeled as old runtime and unknown runtime policy', () => {
    const f = fixture();
    const app = { expo: { ...f.app, version: '2.1.0' } };
    fs.writeFileSync(path.join(f.root, 'app.json'), JSON.stringify(app));
    expect(() => guard.checkRuntime(f.root, '2.1.0')).toThrow('runtime 2.1.1');
    app.expo.version = '2.1.1'; app.expo.runtimeVersion = { policy: 'sdkVersion' };
    fs.writeFileSync(path.join(f.root, 'app.json'), JSON.stringify(app));
    expect(() => guard.checkRuntime(f.root, '2.1.1')).toThrow('appVersion');
  });
  it('never treats missing/unrecognized source, a missing contract, or malformed configuration as legacy success', () => {
    const f = fixture();
    f.app.version = '2.1.0'; f.app.extra.progressQueueOwnershipFormat = 0;
    const reader = path.join(f.root, 'src/sync/progressSync.ts');
    fs.rmSync(reader);
    expect(() => guard.ownershipEnabled(f.root, f.app)).toThrow();
    fs.writeFileSync(reader, '');
    expect(() => guard.ownershipEnabled(f.root, f.app)).toThrow('legacy format-0 contract');
    fs.writeFileSync(reader, 'export async function recordReviewEvent() {}\nasync function enqueueProgressEvent() {}');
    expect(guard.ownershipEnabled(f.root, f.app)).toBe(false);
    delete f.app.extra.progressQueueOwnershipFormat;
    expect(guard.ownershipEnabled(f.root, f.app)).toBe(true);
    fs.writeFileSync(path.join(f.root, 'app.json'), '{invalid');
    expect(() => guard.checkProof(f.root, '2.1.0', undefined)).toThrow();
  });
  it('fails closed on missing proof and altered IPA/embedded proof bytes', () => {
    const f = fixture();
    expect(() => guard.checkProof(f.root, '2.1.1', undefined)).toThrow('embedded-baseline proof required');
    guard.recordProof(f.root, f.ipa, f.proof, f.inspect, f.git);
    fs.appendFileSync(f.ipa, 'tampered');
    expect(() => guard.checkProof(f.root, '2.1.1', f.proof, f.inspect, f.git)).toThrow('archiveSha256');
    guard.recordProof(f.root, f.ipa, f.proof, f.inspect, f.git);
    const altered = JSON.parse(fs.readFileSync(f.proof, 'utf8')); altered.embeddedBundleSha256 = '0'.repeat(64);
    fs.writeFileSync(f.proof, JSON.stringify(altered));
    expect(() => guard.checkProof(f.root, '2.1.1', f.proof, f.inspect, f.git)).toThrow('embeddedBundleSha256');
  });
  it('rejects uncommitted sources, a missing source commit, and an incompatible commit reader', () => {
    const f = fixture();
    expect(() => guard.recordProof(f.root, f.ipa, f.proof, f.inspect, (_: string, args: string[]) => {
      if (args[0] === 'diff') throw new Error('dirty source'); return f.git(_, args);
    })).toThrow('dirty source');
    expect(() => guard.verifySourceCommit(f.root, '')).toThrow('source commit required');
    expect(() => guard.verifySourceCommit(f.root, commit, (_: string, args: string[]) => args[0] === 'show' ? 'old reader' : '')).toThrow('reviewed ownership reader');
  });
  it('the actual OTA entry refuses missing proof and runtime 2.1.0 before any EAS invocation', () => {
    const dir = temp(); const log = path.join(dir, 'external-call');
    fs.writeFileSync(path.join(dir, 'eas'), `#!/bin/sh\necho called >> '${log}'\n`); fs.chmodSync(path.join(dir, 'eas'), 0o755);
    for (const runtime of ['2.1.1', '2.1.0', 'unknown']) {
      const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, OWNERSHIP_BASELINE_PROOF: path.join(dir, 'absent-proof'), OTA_RUNTIME_VERSION: runtime, DRY_RUN: '1' };
      const r = spawnSync('bash', [path.join(mobile, 'scripts/release/ota.sh'), 'STUB gate check'], { env, encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(7);
      expect(r.stderr).toContain(runtime === '2.1.1' ? 'embedded-baseline proof required' : 'runtime 2.1.1');
      expect(fs.existsSync(log)).toBe(false);
    }
  });
});

function archiveFixture(opts: { runtime?: string; id?: string; markers?: string; unsafe?: string; symlink?: boolean } = {}) {
  const f = fixture();
  const files: Record<string, string> = {
    'Payload/STUB.app/Info.plist': JSON.stringify({ CFBundleShortVersionString: '2.1.1', CFBundleVersion: '26', CFBundleIdentifier: opts.id ?? f.app.ios.bundleIdentifier }),
    'Payload/STUB.app/Expo.plist': JSON.stringify({ EXUpdatesRuntimeVersion: opts.runtime ?? '2.1.1', EXUpdatesURL: f.app.updates.url, EXUpdatesEnabled: true }),
    'Payload/STUB.app/main.jsbundle': opts.markers ?? 'STUB devcards:sync:pendingOwners:v1 PROGRESS_QUEUE_FULL',
  };
  if (opts.unsafe) files[opts.unsafe] = 'unsafe';
  execFileSync('python3', ['-c', 'import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n for k,v in json.loads(sys.argv[2]).items():\n  i=zipfile.ZipInfo(k)\n  if sys.argv[3]=="yes" and k=="link": i.external_attr=0o120777<<16\n  z.writestr(i,v)', f.ipa, JSON.stringify(files), opts.symlink ? 'yes' : 'no']);
  const calls: string[][] = [];
  const run = (command: string, args: string[], options: any) => {
    calls.push([command, ...args]);
    if (command === '/usr/bin/codesign') return Buffer.from('STUB signature accepted');
    if (command === '/usr/bin/plutil') return fs.readFileSync(args[args.length - 1], 'utf8');
    return execFileSync(command, args, options);
  };
  return { ...f, run, calls };
}
describe('bounded IPA inspection with stubbed Apple signature/plist tools', () => {
  it('reads actual archive/bundle bytes, passes Apple/team/bundle requirements, and removes extraction files', () => {
    const f = archiveFixture();
    const proof = guard.inspectIpa(f.ipa, f.app, f.run);
    expect(proof.archiveSha256).toBe(hash(fs.readFileSync(f.ipa)));
    expect(proof.embeddedBundleSha256).toBe(hash('STUB devcards:sync:pendingOwners:v1 PROGRESS_QUEUE_FULL'));
    const signature = f.calls.find(call => call[0] === '/usr/bin/codesign')!;
    expect(signature.join(' ')).toContain('anchor apple generic and certificate leaf[subject.OU] = "STUBTEAM01"');
    expect(signature.join(' ')).toContain(f.app.ios.bundleIdentifier);
    expect(fs.existsSync(signature[signature.length - 1])).toBe(false);
  });
  it.each([{ runtime: '2.1.0' }, { id: 'unknown.app' }, { markers: 'STUB old embedded bundle' }])('rejects an incompatible embedded baseline %o', opts => {
    const f = archiveFixture(opts); expect(() => guard.inspectIpa(f.ipa, f.app, f.run)).toThrow(/baseline/);
  });
  it('refuses missing/unknown team and a failed ad-hoc/unknown signature', () => {
    const f = archiveFixture();
    delete f.app.ios.appleTeamId;
    expect(() => guard.inspectIpa(f.ipa, f.app, f.run)).toThrow('known Apple Team ID');
    f.app.ios.appleTeamId = 'STUBTEAM01';
    expect(() => guard.inspectIpa(f.ipa, f.app, (command: string, args: string[], options: any) => {
      if (command === '/usr/bin/codesign') throw new Error('STUB ad-hoc/unknown signature rejected');
      return f.run(command, args, options);
    })).toThrow('signature rejected');
  });
  it.each(['../escape', '/absolute-escape', 'bad\\escape'])('rejects unsafe archive path %s before signature verification', unsafe => {
    const f = archiveFixture({ unsafe });
    expect(() => guard.inspectIpa(f.ipa, f.app, f.run)).toThrow();
    expect(f.calls.some(call => call[0] === '/usr/bin/codesign')).toBe(false);
  });
  it('refuses too many archive entries and an oversized archive before signature checks', () => {
    const f = archiveFixture();
    execFileSync('python3', ['-c', 'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n for i in range(10001): z.writestr(str(i),"")', f.ipa]);
    expect(() => guard.inspectIpa(f.ipa, f.app, f.run)).toThrow();
    expect(f.calls.some(call => call[0] === '/usr/bin/codesign')).toBe(false);
    fs.truncateSync(f.ipa, 257 * 1024 * 1024);
    expect(() => guard.inspectIpa(f.ipa, f.app, f.run)).toThrow('IPA exceeds size limit');
  });
  it('refuses symlink entries and entries over the extraction size cap', () => {
    const link = archiveFixture({ unsafe: 'link', symlink: true });
    expect(() => guard.inspectIpa(link.ipa, link.app, link.run)).toThrow();
    for (const declaredMiB of [129, 513]) {
      const big = archiveFixture(); const bytes = fs.readFileSync(big.ipa);
      const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      bytes.writeUInt32LE(declaredMiB * 1024 * 1024, central + 24); fs.writeFileSync(big.ipa, bytes);
      expect(() => guard.inspectIpa(big.ipa, big.app, big.run)).toThrow();
      expect(big.calls.some(call => call[0] === '/usr/bin/codesign')).toBe(false);
    }
  });
});
