import { expect, test, type BrowserContext, type Page } from '@playwright/test';
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

async function signIn(context: BrowserContext, token: string) {
  await context.addInitScript(token => {
    sessionStorage.setItem('devcards:tokens', JSON.stringify({
      accessToken: token, idToken: token, expiresIn: 3600, expiresAt: Date.now() + 3_600_000,
    }));
  }, token);
}

async function openDeck(page: Page, params = 'empty=1', actor = 'owner') {
  const { deckId, tokens } = await (await page.request.post('/__test/seed?' + params)).json();
  const headers = { Authorization: 'Bearer ' + tokens[actor] };
  await signIn(page.context(), tokens[actor]);
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
  return { deckId, deckSlug, headers, preview, open, tokens };
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

test('recovers a confirmed import in a fresh browser and verifies the same publish job', async ({ page, browser, request }) => {
  const deck = await openDeck(page, 'empty=1', 'publisher');
  await page.route('**/api/v1/authoring/publish', route => route.abort());
  await deck.preview([card('first-card', 0, 10, 'Which service?')]);
  const imported = page.waitForResponse(response => response.url().endsWith('/api/v1/authoring/cards/import') && response.ok());
  await page.getByRole('button', { name: 'Import and publish 1 card' }).click();
  await imported;
  await expect(page.getByText('All planned writes succeeded.')).toBeVisible();
  const before = await (await request.get('/__test/state/' + deck.deckId)).json();
  expect(before.receipts).toHaveLength(1);
  expect(before.jobs).toHaveLength(0);
  await page.close();

  const lookup = '/api/v1/authoring/publish?mode=reviewed-batch-recovery';
  const foreign = await request.post(lookup, { headers: { Authorization: 'Bearer ' + deck.tokens['other-publisher'] },
    data: { deckId: deck.deckId } });
  expect((await foreign.json()).data.batch).toBeNull();
  const editor = await request.post(lookup, { headers: { Authorization: 'Bearer ' + deck.tokens.owner },
    data: { deckId: deck.deckId } });
  expect(editor.status()).toBe(403);

  const context = await browser.newContext();
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await signIn(context, deck.tokens.publisher);
  const fresh = await context.newPage();
  await fresh.goto('/decks/cards/import?deckId=' + deck.deckId);
  expect(await fresh.evaluate(() => localStorage.length)).toBe(0);
  await fresh.getByRole('button', { name: 'Find saved publication' }).click();
  await request.post('/__test/fail-next-publish-dispatch');
  const firstDispatch = fresh.waitForResponse(response => response.url().endsWith('/api/v1/authoring/publish'));
  await fresh.getByRole('button', { name: 'Resume saved publication' }).click();
  expect((await firstDispatch).status()).toBe(503);
  await fresh.reload();
  await fresh.getByRole('button', { name: 'Find saved publication' }).click();
  await expect(fresh.getByText(/Job [0-9a-f-]{36}/)).toBeVisible();
  await expect(fresh.getByRole('button', { name: 'Resume saved publication' })).toBeVisible();

  const queued = await (await request.get('/__test/state/' + deck.deckId)).json();
  expect(queued.receipts).toEqual(before.receipts);
  expect(queued.cards).toMatchObject([{ stable_uid: 'first-card', version: 1 }]);
  expect(queued.jobs).toHaveLength(1);
  const id = queued.jobs[0].job_id;
  const leased = fresh.waitForResponse(response => response.url().endsWith('/api/v1/authoring/publish'));
  await fresh.getByRole('button', { name: 'Resume saved publication' }).click();
  expect((await leased).status()).toBe(503);
  await expect(fresh.getByRole('button', { name: 'Resume saved publication' })).toBeEnabled();
  await request.post('/__test/expire-publish-lease/' + id);
  const secondDispatch = fresh.waitForResponse(response => response.url().endsWith('/api/v1/authoring/publish'));
  await fresh.getByRole('button', { name: 'Resume saved publication' }).click();
  const delivered = await secondDispatch;
  expect(delivered.status()).toBe(200);
  expect((await delivered.json()).data.jobId).toBe(id);
  const handoff = await (await request.get('/__test/state/' + deck.deckId)).json();
  expect(handoff.jobs).toEqual([{ job_id: id, status: 'PENDING', dispatched: true }]);
  const buildResponse = await request.post('/__test/build/' + id);
  expect(buildResponse.ok()).toBe(true);
  const { buildId, slug, sha256, cards, bytes } = await buildResponse.json();
  const manifest = await (await request.get('/__test/cdn/manifest.json')).json();
  const entry = manifest.decks.find((deck: { slug: string }) => deck.slug === slug);
  expect(entry).toMatchObject({ buildId, totalCards: cards, downloadMode: 'public' });
  const download = await (await request.get('/__test/cdn/' + entry.path)).body();
  expect(download).toHaveLength(bytes);
  expect(createHash('sha256').update(download).digest('hex')).toBe(sha256);
  expect(JSON.parse(download.toString()).cards).toMatchObject([{ stableUid: 'first-card', question: 'Which service?' }]);
  const receipt = await request.post('/__test/cdn-receipt/' + id, { data: { buildId, sha256 } });
  expect(await receipt.json()).toEqual({ recorded: true });
  await expect(fresh.getByText('Published and verified on the CDN.')).toBeVisible({ timeout: 12_000 });
  await fresh.reload();
  await fresh.getByRole('button', { name: 'Find saved publication' }).click();
  await expect(fresh.getByText('Published and verified on the CDN.')).toBeVisible();
  const after = await (await request.get('/__test/state/' + deck.deckId)).json();
  expect(after.receipts).toEqual(before.receipts);
  expect(after.jobs).toEqual([{ job_id: id, status: 'SUCCESS', dispatched: true }]);
  await context.close();
});
