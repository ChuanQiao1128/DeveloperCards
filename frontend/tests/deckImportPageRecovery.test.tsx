// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAt } from './support/routerProbe';
import { signInAsSuperAdmin, signInAsEditor, signOut } from './support/consoleSession';
import { ok, refused } from './support/apiResult';
import { createImportJournal, readImportJournal } from '../src/lib/deckImportJournal';
import { planImport, parseDeckMarkdown } from '../src/lib/deckImport';
import { TEST_ADMIN_SUB } from './support/consoleSession';

const api = vi.hoisted(() => ({ fetchDeckById: vi.fn(), fetchCardsByDeck: vi.fn(), importCardsBatch: vi.fn(), lookupImportReceipt: vi.fn() }));
vi.mock('../src/api/authoring', async original => ({ ...await original<typeof import('../src/api/authoring')>(), ...api }));
const { DeckImportPage } = await import('../src/pages/DeckImportPage');
const source = '# deck: test\n\n## uid-a | d2\nQ:\nQuestion\nA:\nAnswer';
const mount = () => renderAt(<DeckImportPage />, ['/decks/import?deckId=7']);
beforeEach(() => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_name: string, _options: unknown, action: () => Promise<unknown>) => action() } });
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
  expect(screen.getByRole('list', { name: 'Import batch results' }).textContent).toContain(api.importCardsBatch.mock.calls[0][0].operationId);

  expect(api.lookupImportReceipt).toHaveBeenCalledTimes(1);
  const sent = api.importCardsBatch.mock.calls[0][0];
  page.unmount();
  api.lookupImportReceipt.mockResolvedValue(ok({ found: true, result: { created: 1, updated: 0, unchanged: 0 } }));
  mount();
  await user.click(await screen.findByRole('button', { name: 'Recover saved import' }));
  await screen.findByText('All planned writes succeeded.');
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
