// Check the draft and the review with the same validators the Console uses.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const [command, draftPath, reviewPath, outputPath] = process.argv.slice(2);
const usage = 'Usage: node frontend/scripts/deck-batch.mjs draft DRAFT.json | pack DRAFT.json REVIEW.json BATCH.json';

try {
  if (!draftPath || (command === 'draft' ? process.argv.length !== 4 :
    command !== 'pack' || process.argv.length !== 6)) throw new Error(usage);
  const code = await build({
    entryPoints: [fileURLToPath(new URL('../src/lib/reviewedDeckBatch.ts', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  });
  const { deckBatchDraftHash, parseDeckBatchDraft, readReviewedDeckBatch } =
    await import('data:text/javascript;base64,' + Buffer.from(code.outputFiles[0].text).toString('base64'));
  const draft = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(draftPath));
  if (command === 'draft') {
    const { deckId, deckSlug, cards } = parseDeckBatchDraft(draft);
    console.log(JSON.stringify({
      deckId,
      deckSlug,
      draftSha256: await deckBatchDraftHash(draft),
      cards: cards.map(({ card, expectedVersion }) => ({ stableUid: card.stableUid, expectedVersion })),
    }, null, 2));
  } else {
    const review = JSON.parse(await readFile(reviewPath, 'utf8'));
    const contents = JSON.stringify({ schema: 'reviewed-deck-batch-v1', draft, review }) + '\n';
    const { deckSlug, cards } = await readReviewedDeckBatch(contents);
    await writeFile(outputPath, contents, { flag: 'wx' });
    console.log(`Prepared ${cards.length} reviewed cards for ${deckSlug}.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
