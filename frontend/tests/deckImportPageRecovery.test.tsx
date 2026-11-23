// @vitest-environment jsdom
import { createHash, webcrypto } from 'node:crypto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAt } from './support/routerProbe';
import { signInAsSuperAdmin, signInAsEditor, signOut } from './support/consoleSession';
import { ok, refused } from './support/apiResult';
import { createImportJournal, hasPendingImport, readImportJournal, saveImportJournal } from '../src/lib/deckImportJournal';
import { planImport, parseDeckMarkdown } from '../src/lib/deckImport';
import { TEST_ADMIN_SUB } from './support/consoleSession';

const api = vi.hoisted(() => ({ fetchDeckById: vi.fn(), fetchCardsByDeck: vi.fn(), importCardsBatch: vi.fn(), lookupImportReceipt: vi.fn(), fetchReviewedPublishBaseline: vi.fn(), publishReviewedImport: vi.fn(), fetchPublishJob: vi.fn() }));
vi.mock('../src/api/authoring', async original => ({ ...await original<typeof import('../src/api/authoring')>(), ...api }));
const { DeckImportPage } = await import('../src/pages/DeckImportPage');
const source = '# deck: test\n\n## uid-a | d2\nQ:\nQuestion\nA:\nAnswer';
const mount = () => renderAt(<DeckImportPage />, ['/decks/import?deckId=7']);
beforeEach(() => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_name: string, _options: unknown, action: () => Promise<unknown>) => action() } });
  localStorage.clear();
  signOut(); signInAsSuperAdmin(); vi.stubGlobal('crypto', webcrypto);
  api.fetchDeckById.mockResolvedValue(ok({ id: 7, slug: 'test', title: 'Test deck', locale: 'en-US' }));
  api.fetchCardsByDeck.mockResolvedValue(ok([]));
});
afterEach(() => { cleanup(); signOut(); vi.clearAllMocks(); vi.restoreAllMocks(); });

it('recovers after a lost response and reload using the saved identity without a second write', async () => {
  const user = userEvent.setup();
  api.importCardsBatch.mockResolvedValue(refused('TIMEOUT', 'Response lost'));
  api.lookupImportReceipt.mockResolvedValue(refused('NETWORK_ERROR', 'Offline'));
  const page = mount();
  const input = await screen.findByRole('textbox', { name: 'Deck Markdown' });
  fireEvent.change(input, { target: { value: source } });
  await user.click(screen.getByRole('button', { name: 'Preview import' }));
  await user.click(await screen.findByRole('button', { name: 'Import 1 card' }));
  await screen.findByText('Result unconfirmed', { exact: false });
  expect(screen.getByText('Needs confirmation')).not.toBeNull();
  expect(screen.queryByText('Finished')).toBeNull();
  expect(screen.getByText('failed', { exact: true }).parentElement?.textContent).toBe('0failed');
  expect(screen.getByText('unconfirmed', { exact: true }).parentElement?.textContent).toBe('1unconfirmed');
  expect(screen.getByText('1 card needs confirmation')).not.toBeNull();
  expect((screen.getByRole('button', { name: 'Re-run the preview' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Start over' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Recover saved import' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole('link', { name: 'Back to cards →' }).getAttribute('href')).toBe('/decks/cards?deckId=7');

  expect(screen.getByRole('list', { name: 'Import batch results' }).textContent).toContain(api.importCardsBatch.mock.calls[0][0].operationId);

  expect(api.lookupImportReceipt).toHaveBeenCalledTimes(1);
  const sent = api.importCardsBatch.mock.calls[0][0];
  page.unmount();
  api.lookupImportReceipt.mockResolvedValue(ok({ found: true, result: { created: 1, updated: 0, unchanged: 0 } }));
  mount();
  await user.click(await screen.findByRole('button', { name: 'Recover saved import' }));
  await screen.findByText('All planned writes succeeded.');
  expect((screen.getByRole('button', { name: 'Re-run the preview' }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole('button', { name: 'Start over' }) as HTMLButtonElement).disabled).toBe(false);

  expect(api.importCardsBatch).toHaveBeenCalledTimes(1);
  expect(api.lookupImportReceipt.mock.calls[1][0].serializedBody).toBe(sent.serializedBody);
  expect(screen.queryByRole('button', { name: 'Recover saved import' })).toBeNull();
});

it('blocks the actual import request when durable storage fails', async () => {
  const user = userEvent.setup(); mount();
  fireEvent.change(await screen.findByRole('textbox', { name: 'Deck Markdown' }), { target: { value: source } });
  await user.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByRole('button', { name: 'Import 1 card' });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Storage quota exceeded'); });
  await user.click(screen.getByRole('button', { name: 'Import 1 card' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Storage quota exceeded');
  expect(api.importCardsBatch).not.toHaveBeenCalled();
});

it('clears the visible recovery identity when the session changes and cannot send the previous account run', async () => {
  await createImportJournal(TEST_ADMIN_SUB, 7, planImport(parseDeckMarkdown(source), []).creates);
  mount(); await screen.findByRole('button', { name: 'Recover saved import' });
  signInAsEditor();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Recover saved import' })).toBeNull());
  expect(api.importCardsBatch).not.toHaveBeenCalled();
  expect(api.lookupImportReceipt).not.toHaveBeenCalled();
  expect(await readImportJournal(TEST_ADMIN_SUB, 7)).not.toBeNull();
});

it('resumes a reviewed publish after QA without importing the cards again', async () => {
  api.fetchReviewedPublishBaseline.mockResolvedValue(ok({ baseline: { editingSnapshot: 'a'.repeat(64), liveBuildId: null } }));
  api.importCardsBatch.mockResolvedValue(ok({ created: 1, updated: 0, unchanged: 0 }));
  api.publishReviewedImport.mockResolvedValueOnce({
    success: false, data: null, traceId: '', error: { code: 'AI_QA_REQUIRED', httpStatus: 409, message: 'QA is still required.' },
  }).mockResolvedValueOnce(ok({ jobId: 'reviewed-job' }));
  api.fetchPublishJob.mockResolvedValueOnce(refused('NETWORK_ERROR', 'Temporary status failure'))
    .mockResolvedValue(ok({ jobId: 'reviewed-job', deckId: 7, status: 'SUCCESS',
    buildIsLive: true, manifestState: 'delivered', cdnVerificationState: 'verified' }));
  const draft = JSON.stringify({ deckId: 7, deckSlug: 'test', cards: [{
    stableUid: 'first-card', expectedVersion: 0, orderInDeck: 1, difficulty: 2, question: 'Question', explanation: 'Answer',
    codeSnippet: '', codeLanguage: '', realWorldUsage: '', topic: '', mcq: null, source: null, translations: null,
    frontHelp: null, teaching: null, tags: null,
  }] });
  const reviewed = JSON.stringify({ schema: 'reviewed-deck-batch-v1', draft,
    review: { draftSha256: createHash('sha256').update(draft).digest('hex'), reviewer: 'Test fixture',
      cards: [{ stableUid: 'first-card', verdict: 'PASS', note: 'Synthetic review.' }] } });
  const user = userEvent.setup();
  const page = mount();
  fireEvent.change(await screen.findByRole('textbox', { name: 'Deck Markdown' }), { target: { value: reviewed } });
  await user.click(screen.getByRole('button', { name: 'Preview import' }));
  await user.click(await screen.findByRole('button', { name: 'Import and publish 1 card' }));
  await screen.findByText('QA is still required.');
  page.unmount();
  mount();
  await user.click(await screen.findByRole('button', { name: 'Recover saved import' }));
  await user.click(await screen.findByRole('button', { name: 'Check status again' }));
  await screen.findByText('Published and verified on the CDN.');
  expect(api.importCardsBatch).toHaveBeenCalledTimes(1);
  expect(api.publishReviewedImport).toHaveBeenCalledTimes(2);
  const operation = api.importCardsBatch.mock.calls[0][0].operationId;
  expect(api.publishReviewedImport.mock.calls.map(call => call.slice(0, 2))).toEqual([[7, operation], [7, operation]]);
  await waitFor(async () => expect((await readImportJournal(TEST_ADMIN_SUB, 7))?.reviewedPublish?.finished).toBe(true));
});

it('keeps an aged reviewed batch awaiting publish when a different deck imports', async () => {
  const actions = planImport(parseDeckMarkdown(source), []).creates;
  const journal = await createImportJournal(TEST_ADMIN_SUB, 7, actions, localStorage, 'test',
    { editingSnapshot: 'a'.repeat(64), liveBuildId: null });
  journal.createdAt -= 8 * 24 * 60 * 60 * 1000;
  journal.batches[0].state = 'committed';
  journal.batches[0].result = { created: 1, updated: 0, unchanged: 0 };
  saveImportJournal(journal);
  await createImportJournal(TEST_ADMIN_SUB, 8, actions);
  const restored = await readImportJournal(TEST_ADMIN_SUB, 7);
  expect(restored?.runId).toBe(journal.runId);
  expect(hasPendingImport(restored!)).toBe(true);
});
