import { expect, it } from 'vitest';
import { deckBatchDraftHash, parseDeckBatchDraft, planReviewedDeckBatch, readReviewedDeckBatch } from '../src/lib/reviewedDeckBatch';
import type { Card } from '../src/types/card';

const deck = { id: 21, slug: 'qa--lab-', locale: 'en-US' };
const card = {
  stableUid: 'new-card', question: 'What is it?', explanation: 'Answer.\n\nReason.',
  codeSnippet: '', codeLanguage: '', realWorldUsage: '', topic: '', expectedVersion: 0, orderInDeck: 10,
  difficulty: 1, mcq: null, translations: null, frontHelp: null, source: null, teaching: null, tags: null,
};
const draft = (updates = {}) => JSON.stringify({ deckId: deck.id, deckSlug: deck.slug, cards: [{ ...card, ...updates }] });

it('binds every review to one exact draft', async () => {
  const raw = draft();
  const review = { reviewer: 'Test reviewer', draftSha256: await deckBatchDraftHash(raw),
    cards: [{ stableUid: card.stableUid, verdict: 'PASS', note: 'Fixture review.' }] };
  const pack = (body: string, report = review) => JSON.stringify({ schema: 'reviewed-deck-batch-v1', draft: body, review: report });
  const batch = await readReviewedDeckBatch(pack(raw));
  expect(planReviewedDeckBatch(batch, deck, []).creates[0].card.explanation).toBe(card.explanation);
  await expect(readReviewedDeckBatch(pack(draft({ question: 'Changed after review' })))).rejects.toThrow('different draft');
  await expect(readReviewedDeckBatch(pack(raw, { ...review, cards: [] }))).rejects.toThrow('cover every card');
});

it('refuses to rebase, edit another deck, or import noncanonical card data', () => {
  const parsed = parseDeckBatchDraft(draft({ expectedVersion: 1 }));
  const inventory: Card[] = [{ id: 1, deckId: deck.id, ...card, question: 'Original', version: 2, createdAt: '', updatedAt: '' }];
  expect(() => planReviewedDeckBatch(parsed, deck, inventory)).toThrow('version changed');
  expect(() => planReviewedDeckBatch(parsed, { ...deck, id: 22 }, inventory)).toThrow('different deck');
  expect(() => parseDeckBatchDraft(draft({ topic: 'x'.repeat(81) }))).toThrow('topic');
  expect(() => parseDeckBatchDraft(draft({ teaching: { invalid: 'data' } }))).toThrow('teaching');
  expect(() => parseDeckBatchDraft(draft({ frontHelp: [{ term: ' Term ', definition: 'Meaning' }] }))).toThrow('frontHelp');
});
