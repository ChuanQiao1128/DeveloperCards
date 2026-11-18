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
    contents: `export { parseReleaseBundle } from ${JSON.stringify(resolve(frontend, 'src/lib/contentRelease.ts'))};`,
    resolveDir: frontend, loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
});
const lib = await import('data:text/javascript;base64,' + Buffer.from(code.outputFiles[0].text).toString('base64'));
if (process.argv.length !== 3) throw new Error('Usage: node validate_release_json.mjs release-bundle.json');
const raw = readFileSync(process.argv[2], 'utf8');
const expected = JSON.parse(raw);
const parsed = lib.parseReleaseBundle(raw);
assert.deepEqual(parsed, expected);
assert.deepEqual(lib.parseReleaseBundle(JSON.stringify(parsed)), parsed);
process.stdout.write(JSON.stringify({
  status: 'PASS_REAL_CONSOLE_JSON_ROUNDTRIP', totalCards: parsed.cards.length,
  bilingualParagraphBreaksExact: true, semanticReview: 'Existing bound evidence; this check performs no review',
}) + '\n');
