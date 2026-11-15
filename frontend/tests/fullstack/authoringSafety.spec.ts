import { expect, test, type BrowserContext, type Page } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return host === '127.0.0.1' ? route.continue() : route.abort();
  });
});

type Seed = { deckId: number; cardId: number; tokens: Record<'owner' | 'reader' | 'outsider', string> };

async function signIn(context: BrowserContext, token: string) {
  await context.addInitScript(token => {
    sessionStorage.setItem('devcards:tokens', JSON.stringify({
      accessToken: token, idToken: token, expiresIn: 3600, expiresAt: Date.now() + 3_600_000,
    }));
  }, token);
}

async function preview(page: Page, seed: Seed, question: string) {
  const response = await page.request.get(`/api/v1/authoring/decks?id=${seed.deckId}`, { headers: { Authorization: `Bearer ${seed.tokens.owner}` } });
  const envelope = await response.json();
  const slug = envelope.data[0].slug;
  await page.goto(`/decks/cards/import?deckId=${seed.deckId}`);
  await page.getByRole('textbox', { name: 'Deck Markdown' }).fill(`# deck: ${slug}\n\n## local-card | d2\nQ:\n${question}\nA:\nOriginal answer\n\n## added-card | d2\nQ:\nNew question\nA:\nNew answer`);
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByRole('button', { name: 'Import 2 cards', exact: true })).toBeEnabled();
}

test('two real editors preserve drafts and reject a second concurrent change', async ({ browser, request }, info) => {
  const seed: Seed = await (await request.post('/__test/seed')).json();
  const a = await browser.newContext();
  const b = await browser.newContext();
  await signIn(a, seed.tokens.owner); await signIn(b, seed.tokens.owner);
  const left = await a.newPage(); const right = await b.newPage();
  const url = `/decks/cards/edit?deckId=${seed.deckId}&cardId=${seed.cardId}`;
  await Promise.all([left.goto(url), right.goto(url)]);
  await left.getByRole('textbox', { name: /^Question/ }).fill('Preserved local draft');
  await right.getByRole('textbox', { name: /^Question/ }).fill('Other editor saved first');
  await right.getByRole('button', { name: /^Save changes$/i }).click();
  await expect(right).toHaveURL(/\/decks\/cards\?deckId=/);
  await left.getByRole('button', { name: /^Save changes$/i }).click();
  await expect(left.getByRole('region', { name: 'Current server copy' })).toContainText('Other editor saved first');
  const edit = await request.put('/api/v1/authoring/cards', { headers: { Authorization: `Bearer ${seed.tokens.owner}` }, data: { id: seed.cardId, expectedVersion: 2, question: 'Changed during conflict confirmation' } });
  expect(edit.status()).toBe(200);
  await left.getByRole('button', { name: 'Retry with latest version', exact: true }).click();
  await expect(left.getByRole('region', { name: 'Current server copy' })).toContainText('Changed during conflict confirmation');
  await expect(left.getByRole('textbox', { name: /^Question/ })).toHaveValue('Preserved local draft');
  await left.setViewportSize({ width: 390, height: 844 });
  expect(await left.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await left.screenshot({ path: info.outputPath('conflict-mobile.png'), fullPage: true });
  await left.setViewportSize({ width: 1280, height: 900 });
  await left.screenshot({ path: info.outputPath('conflict-desktop.png'), fullPage: true });
  await left.getByRole('button', { name: 'Retry with latest version', exact: true }).click();
  await expect(left).toHaveURL(/\/decks\/cards\?deckId=/);
  const state = await (await request.get(`/__test/state/${seed.deckId}`)).json();
  await test.info().attach('final-database-state', { body: JSON.stringify({ deckId: seed.deckId, ...state }, null, 2), contentType: 'application/json' });
  expect(state.cards).toMatchObject([{ question: 'Preserved local draft', version: 4 }]);
  await a.close(); await b.close();
});

test('stale import rejects the whole batch against real PostgreSQL', async ({ page, context, request }) => {
  const seed: Seed = await (await request.post('/__test/seed')).json();
  await signIn(context, seed.tokens.owner);
  await preview(page, seed, 'Import would overwrite this');
  const changed = await request.put('/api/v1/authoring/cards', { headers: { Authorization: `Bearer ${seed.tokens.owner}` }, data: { id: seed.cardId, expectedVersion: 1, question: 'Saved after preview' } });
  expect(changed.status()).toBe(200);
  await page.getByRole('button', { name: 'Import 2 cards', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Import batch results' })).toContainText('Rejected');
  const state = await (await request.get(`/__test/state/${seed.deckId}`)).json();
  await test.info().attach('final-database-state', { body: JSON.stringify({ deckId: seed.deckId, ...state }, null, 2), contentType: 'application/json' });
  expect(state.cards).toMatchObject([{ question: 'Saved after preview', version: 2 }]);
  await test.info().attach('final-database-state', { body: JSON.stringify({ deckId: seed.deckId, ...state }, null, 2), contentType: 'application/json' });
  expect(state.cards).toHaveLength(1);
  expect(state.receipts).toHaveLength(0);
});

test('lost import response replays its receipt without overwriting a later real edit', async ({ page, context, request }) => {
  const seed: Seed = await (await request.post('/__test/seed')).json();
  await signIn(context, seed.tokens.owner);
  await preview(page, seed, 'Imported value');
  await request.post('/__test/drop-next-import?edit=1');
  await page.getByRole('button', { name: 'Import 2 cards', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Import batch results' })).toContainText('Committed');
  const state = await (await request.get(`/__test/state/${seed.deckId}`)).json();
  await test.info().attach('final-database-state', { body: JSON.stringify({ deckId: seed.deckId, ...state }, null, 2), contentType: 'application/json' });
  expect(state.cards).toHaveLength(2);
  expect(state.cards[0]).toMatchObject({ question: 'Edit after import commit', version: 3 });
  expect(state.receipts).toHaveLength(1);
});

test('read-only and unrelated accounts cannot bypass API write permissions', async ({ request }) => {
  const seed: Seed = await (await request.post('/__test/seed')).json();
  for (const who of ['reader', 'outsider'] as const) {
    const headers = { Authorization: `Bearer ${seed.tokens[who]}` };
    expect((await request.put('/api/v1/authoring/cards', { headers, data: { id: seed.cardId, deckId: seed.deckId, expectedVersion: 1, question: 'Forbidden edit' } })).status()).toBe(403);
    expect((await request.post('/api/v1/authoring/cards/import', { headers, data: { deckId: seed.deckId, operationId: crypto.randomUUID(), cards: [{ stableUid: 'local-card', expectedVersion: 1, question: 'Forbidden import', orderInDeck: 5 }] } })).status()).toBe(403);
  }
  const state = await (await request.get(`/__test/state/${seed.deckId}`)).json();
  await test.info().attach('final-database-state', { body: JSON.stringify({ deckId: seed.deckId, ...state }, null, 2), contentType: 'application/json' });
  expect(state.cards).toMatchObject([{ question: 'Original question', version: 1 }]);
  expect(state.receipts).toHaveLength(0);
});
