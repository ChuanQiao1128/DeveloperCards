// Structural/content preservation only; never creates or substitutes model review evidence.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const frontend = resolve(root, 'frontend');
const { build } = createRequire(resolve(frontend, 'package.json'))('esbuild');
const code = await build({
  stdin: {
    contents: `export { parseReleaseBundle, parseReleaseSession } from ${JSON.stringify(resolve(frontend, 'src/lib/contentRelease.ts'))};`,
    resolveDir: frontend, loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
});
const lib = await import('data:text/javascript;base64,' + Buffer.from(code.outputFiles[0].text).toString('base64'));
if (![3, 4].includes(process.argv.length)) throw new Error('Usage: node validate_release_json.mjs release-bundle.json [completed-console-journal.json]');
const journalPath = process.argv[3];
const raw = readFileSync(process.argv[2], 'utf8');
const expected = JSON.parse(raw);
const parsed = lib.parseReleaseBundle(raw, Date.now(), !journalPath);
assert.deepEqual(parsed, expected);
assert.deepEqual(lib.parseReleaseBundle(JSON.stringify(parsed), Date.now(), !journalPath), parsed);
if (journalPath) {
  const rawJournal = readFileSync(journalPath, 'utf8');
  const recorded = JSON.parse(rawJournal);
  const session = lib.parseReleaseSession(rawJournal);
  assert.deepEqual(session.bundle, parsed);
  assert.ok(recorded.delivery);
  for (const kind of ['import', 'review', 'publish']) {
    assert.equal(recorded.actions[kind].outcome, 'confirmed');
    assert.equal(recorded.actions[kind].reconciled, true);
  }
  const proof = recorded.delivery;
  const query = recorded.actions.publish.query;
  assert.equal(query.liveBuildId, proof.buildId);
  assert.ok(query.jobs.some(job => job.job_id === proof.jobId && job.build_id === proof.buildId &&
    job.status === 'SUCCESS' && job.manifestState === 'delivered' && job.content_sha256 === proof.sha256));
}
process.stdout.write(JSON.stringify({
  status: journalPath ? 'PASS_RELEASE_CLOSEOUT_JOURNAL' : 'PASS_REAL_CONSOLE_JSON_ROUNDTRIP', totalCards: parsed.cards.length,
  bilingualParagraphBreaksExact: true, semanticReview: 'Existing bound evidence; this check performs no review',
}) + '\n');
