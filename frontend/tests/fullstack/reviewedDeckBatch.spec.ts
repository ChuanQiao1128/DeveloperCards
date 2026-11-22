import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

const card = (stableUid: string, expectedVersion: number, orderInDeck: number, question: string) => ({
  stableUid, expectedVersion, orderInDeck, question, difficulty: 1, explanation: 'Answer.\n\nReason.',
  codeSnippet: '', codeLanguage: '', realWorldUsage: '', topic: 'Basics', frontHelp: null, mcq: null,
  translations: { 'zh-CN': { v: 1, question: '这是什么意思？', explanation: '答。\n\n解释。' } },
  source: null, teaching: null, tags: null,
});

async function openDeck(page: Page, params = 'empty=1') {
  const { deckId, tokens } = await (await page.request.post('/__test/seed?' + params)).json();
  const headers = { Authorization: 'Bearer ' + tokens.owner };
  await page.context().addInitScript(token => {
    sessionStorage.setItem('devcards:tokens', JSON.stringify({
      accessToken: token, idToken: token, expiresIn: 3600, expiresAt: Date.now() + 3_600_000,
    }));
  }, tokens.owner);
  const result = await (await page.request.get('/api/v1/authoring/decks?id=' + deckId, { headers })).json();
  const deckSlug: string = result.data[0].slug;
  const open = () => page.goto('/decks/cards/import?deckId=' + deckId);
  async function preview(cards: ReturnType<typeof card>[]) {
    const draft = JSON.stringify({ deckId, deckSlug, cards });
    const batch = JSON.stringify({
      schema: 'reviewed-deck-batch-v1', draft,
      review: { draftSha256: createHash('sha256').update(draft).digest('hex'), reviewer: 'Synthetic fixture',
        cards: cards.map(({ stableUid }) => ({ stableUid, verdict: 'PASS', note: 'Synthetic review fixture.' })) },
    });
    await page.getByRole('textbox', { name: 'Deck Markdown' }).fill(batch);
    await page.getByRole('button', { name: 'Preview import' }).click();
  }
  await open();
  return { deckId, deckSlug, headers, preview, open };
}

test('uses one reviewed workflow for the first import and a mixed update', async ({ page }) => {
  const deck = await openDeck(page);
  await deck.preview([card('first-card', 0, 10, 'First paragraph.\n\nWhich service?')]);
  await page.getByRole('button', { name: 'Import 1 card', exact: true }).click();
  await expect(page.getByText('All planned writes succeeded.')).toBeVisible();

  await deck.open();
  await deck.preview([card('first-card', 1, 10, 'Updated paragraph.\n\nWhich service?'),
    card('next-card', 0, 20, 'Another question')]);
  await page.getByRole('button', { name: 'Import 2 cards', exact: true }).click();
  await expect(page.getByText('All planned writes succeeded.')).toBeVisible();
  const response = await page.request.post('/api/v1/authoring/publish?mode=preview', {
    headers: deck.headers, data: { deckId: deck.deckId },
  });
  expect(response.status()).toBe(200);
  expect((await response.json()).data.export.cards).toMatchObject([
    { stableUid: 'first-card', orderInDeck: 10, question: 'Updated paragraph.\n\nWhich service?',
      translations: { 'zh-CN': { explanation: '答。\n\n解释。' } } },
    { stableUid: 'next-card', orderInDeck: 20 },
  ]);
});

test('an occupied deleted order rejects the entire mixed batch', async ({ page }) => {
  const deck = await openDeck(page, 'deleted=1');
  await deck.preview([card('local-card', 1, 5, 'Edited question'), card('next-card', 0, 30, 'New question')]);
  await page.getByRole('button', { name: 'Import 2 cards', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Import batch results' })).toContainText('Rejected');

  const state = await (await page.request.get('/__test/state/' + deck.deckId)).json();
  expect(state.cards).toHaveLength(1);
  expect(state.cards[0]).toMatchObject({ question: 'Original question', version: 1 });
  expect(state.receipts).toHaveLength(0);
});

test('the API refuses changed deck identity and noncanonical content', async ({ page }) => {
  const deck = await openDeck(page);
  const endpoint = '/api/v1/authoring/cards/import';
  const base = card('first-card', 0, 10, 'First question');
  for (const [slug, cards, status, code] of [
    ['different-slug', [base], 409, 'DECK_SLUG_CONFLICT'],
    [deck.deckSlug, [{ ...base, frontHelp: [] }], 400, 'VALIDATION_ERROR'],
  ] as const) {
    const response = await page.request.post(endpoint, { headers: deck.headers,
      data: { deckId: deck.deckId, operationId: crypto.randomUUID(), expectedDeckSlug: slug, cards } });
    expect(response.status()).toBe(status);
    expect((await response.json()).error.code).toBe(code);
  }
  const state = await (await page.request.get('/__test/state/' + deck.deckId)).json();
  expect(state.cards).toHaveLength(0);
  expect(state.receipts).toHaveLength(0);
});
