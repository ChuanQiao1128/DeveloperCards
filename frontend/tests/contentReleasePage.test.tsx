// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import * as journalStore from '../src/lib/releaseJournalStore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAt } from './support/routerProbe';
import { ok, refused } from './support/apiResult';
import { signInAsEditor, signInAsSuperAdmin, signOut, TEST_EDITOR_SUB, TEST_ADMIN_SUB } from './support/consoleSession';
import { releaseFixture } from './support/contentReleaseFixtures';
import { captureReleaseBackupInventory, prepareReleaseAction } from '../src/lib/contentRelease';
import type { ReleaseSession } from '../src/types/contentRelease';

const api = vi.hoisted(() => ({ fetchReleaseSnapshot: vi.fn(), fetchReleaseAction: vi.fn(), sendReleaseAction: vi.fn(), fetchReleaseCards: vi.fn(), verifyReleaseDelivery: vi.fn(), waitForReleasePoll: vi.fn() }));
vi.mock('../src/api/contentRelease', () => ({ fetchReleaseSnapshot: api.fetchReleaseSnapshot, fetchReleaseAction: api.fetchReleaseAction, sendReleaseAction: api.sendReleaseAction, fetchReleaseCards: api.fetchReleaseCards }));
vi.mock('../src/lib/contentReleaseDelivery', () => ({ verifyReleaseDelivery: api.verifyReleaseDelivery, waitForReleasePoll: api.waitForReleasePoll }));
const { ContentReleasePage } = await import('../src/pages/ContentReleasePage');
const key = `aws-basics-release-v1:${TEST_EDITOR_SUB}`;
function store(session: ReleaseSession) { sessionStorage.setItem(key, JSON.stringify(session)); }
function importedSession(count = 337) {
  const fixture = releaseFixture(count);
  fixture.session.actions.import = { ...prepareReleaseAction(fixture.session, 'import', 'import'), outcome: 'confirmed', reconciled: true, result: ok({ editingSnapshot: fixture.snapshot.editingSnapshot }) };
  fixture.session.verifiedSnapshot = fixture.snapshot;
  return fixture;
}
function reviewedSession(count = 337) {
  const fixture = importedSession(count);
  fixture.session.actions.review = { ...prepareReleaseAction(fixture.session, 'review', 'review'), outcome: 'confirmed', reconciled: true, result: ok({ receiptId: 'original-receipt', editingSnapshot: fixture.snapshot.editingSnapshot, publishSnapshot: fixture.snapshot.publishSnapshot }) };
  return fixture;
}
async function readSaved() { return JSON.parse((await journalStore.loadReleaseJournal(TEST_EDITOR_SUB))!.raw); }
async function mount() { const mounted = renderAt(<ContentReleasePage />, ['/decks/release?deckId=15']); await waitFor(() => expect(screen.queryByText('Loading saved release…')).toBeNull()); return mounted; }
async function reconcile(user: ReturnType<typeof userEvent.setup>, session: ReleaseSession, kinds: Array<'import' | 'review'>) {
  api.fetchReleaseAction.mockImplementation(async (_release, kind: 'import' | 'review') => ok({ action: { StatusCode: 200, Body: JSON.stringify(session.actions[kind]!.result) }, receipts: [], jobs: [], liveBuildId: 'original-live', manifestVerified: false }));
  for (const kind of kinds) { await user.click(screen.getByRole('button', { name: `Query ${kind} action` })); await screen.findByText(new RegExp(`Committed ${kind} action found`)); }
}
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); signOut(); vi.resetAllMocks(); api.waitForReleasePoll.mockResolvedValue(undefined); signInAsEditor(); });
afterEach(() => { cleanup(); signOut(); });

describe('AWS Basics release operator flow', () => {
  it('refuses a changed editing baseline without saving or importing over it', async () => {
    const { bundle, snapshot } = releaseFixture(5); const user = userEvent.setup();
    snapshot.cards[0].cardContentHash = '0'.repeat(64);
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot)); await mount();
    const file = new File([JSON.stringify(bundle)], 'reviewed.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(bundle) });
    await user.upload(screen.getByLabelText('Immutable release bundle (JSON)'), file);
    await user.click(screen.getByRole('button', { name: 'Run reviewed release' }));
    await screen.findByText(/Prepared editing baseline changed/);
    expect(api.sendReleaseAction).not.toHaveBeenCalled();
    expect(await journalStore.loadReleaseJournal(TEST_EDITOR_SUB)).toBeNull();
  });
  it('denies unsigned sessions and other decks without issuing any request', async () => {
    signOut(); await mount();
    expect(screen.getByRole('alert').textContent).toContain('requires a signed-in Console');
    expect(api.fetchReleaseSnapshot).not.toHaveBeenCalled();
    cleanup(); signInAsEditor();
    renderAt(<ContentReleasePage />, ['/decks/release?deckId=16']);
    expect(screen.queryByLabelText('Immutable release bundle (JSON)')).toBeNull();
  });
  it('captures and persists the entire editing backup before the first import request', async () => {
    const user = userEvent.setup(); const { bundle, snapshot } = releaseFixture();
    snapshot.backup.push({ ...structuredClone(snapshot.backup[0]), id: 9999, stable_uid: 'deleted-card', order_in_deck: 9999, version: 9, revision: 3, is_deleted: 1, private_column: 'preserved' });
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot));
    api.sendReleaseAction.mockImplementation(async action => {
      const saved = (await readSaved());
      expect(saved.baselineInventory.editingSnapshot).toBe(snapshot.editingSnapshot);
      expect(saved.baselineInventory.rows.at(-1)).toMatchObject({ id: 9999, stableUid: 'deleted-card', orderInDeck: 9999, version: 9, revision: 3, isDeleted: 1 });
      expect(saved.baseline.backup.at(-1)).toMatchObject({ stable_uid: 'deleted-card', private_column: 'preserved' });
      expect(saved.actions.import.payload).toBe(action.payload);
      expect(saved.actions.import.outcome).toBe('unknown');
      return ok({ editingSnapshot: snapshot.editingSnapshot });
    });
    await mount();
    const file = new File([JSON.stringify(bundle)], 'synthetic.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(bundle) });
    await user.upload(screen.getByLabelText('Immutable release bundle (JSON)'), file);
    await user.click(screen.getByRole('button', { name: 'Capture editing backup and freeze release' }));
    await screen.findByRole('button', { name: 'Download complete editing backup' });
    expect(api.sendReleaseAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Import 337 cards' }));
    await waitFor(() => expect(api.sendReleaseAction).toHaveBeenCalledTimes(1));
  });
  it('imports, verifies and publishes 379 cards from a baseline containing only deleted old cards', async () => {
    const user = userEvent.setup(); const { bundle, snapshot, cards } = releaseFixture(379);
    const baseline = structuredClone(snapshot);
    baseline.cards = [];
    baseline.editingSnapshot = '5'.repeat(64);
    baseline.publishSnapshot = '6'.repeat(64);
    baseline.deck.total_cards = 347;
    baseline.backup = baseline.backup.slice(0, 347).map((row, index) => ({ ...row, id: index + 1001, stable_uid: `old-card-${index + 1}`, order_in_deck: index + 1001, is_deleted: 1 }));
    bundle.expectedBaseline!.cards = [];
    snapshot.backup.push(...structuredClone(baseline.backup));
    api.fetchReleaseSnapshot.mockResolvedValueOnce(ok(baseline)).mockResolvedValueOnce(ok(baseline)).mockResolvedValue(ok(snapshot));
    api.fetchReleaseCards.mockResolvedValue(ok(cards));
    api.sendReleaseAction
      .mockResolvedValueOnce(ok({ editingSnapshot: snapshot.editingSnapshot }))
      .mockResolvedValueOnce(ok({ receiptId: 'receipt-379', editingSnapshot: snapshot.editingSnapshot, publishSnapshot: snapshot.publishSnapshot }))
      .mockResolvedValueOnce(ok({ jobId: 'job-379', buildId: 'build-379', outcome: 'committed', manifestVerified: false, snapshotSha256: snapshot.publishSnapshot }));
    await mount();
    const file = new File([JSON.stringify(bundle)], 'synthetic-379.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(bundle) });
    await user.upload(screen.getByLabelText('Immutable release bundle (JSON)'), file);
    await screen.findByRole('heading', { name: 'AWS Basics release · 379 cards' });
    await user.click(screen.getByRole('button', { name: 'Capture editing backup and freeze release' }));
    await screen.findByRole('button', { name: 'Import 379 cards' });
    expect(api.sendReleaseAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Import 379 cards' }));
    await screen.findByText(/import: server returned committed/);
    const imported = JSON.parse(api.sendReleaseAction.mock.calls[0][0].payload);
    expect(imported).toMatchObject({ expectedEditingSnapshot: baseline.editingSnapshot, expectedLive: 'original-live', idempotencyKey: 'import' });
    expect(imported.cards).toHaveLength(379);
    expect((await readSaved()).baseline.backup).toHaveLength(347);
    await user.click(screen.getByRole('button', { name: 'Verify current editing readback' }));
    await screen.findByText(/Exact 379-card readback/);
    await user.click(screen.getByRole('button', { name: 'Verify and register model review' }));
    await screen.findByText(/review: server returned committed/);
    const reviewed = JSON.parse(api.sendReleaseAction.mock.calls[1][0].payload);
    expect(reviewed.cards).toHaveLength(379);
    expect(reviewed).toMatchObject({ expectedEditingSnapshot: snapshot.editingSnapshot, humanPerCardReview: false, reviewedBy: 'codex' });
    await user.click(screen.getByRole('button', { name: 'Publish reviewed release' }));
    await screen.findByText(/publish: server returned committed/);
    expect(JSON.parse(api.sendReleaseAction.mock.calls[2][0].payload)).toMatchObject({ expectedLive: 'original-live', expectedEditingSnapshot: snapshot.editingSnapshot, receiptId: 'receipt-379' });
  });
  it('requires query before replaying an unknown import and preserves exact bytes across reload', async () => {
    const user = userEvent.setup(); const { session, snapshot } = releaseFixture(); store(session);
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot));
    api.sendReleaseAction.mockResolvedValue(refused('TIMEOUT', 'Timed out; commit unknown.'));
    api.fetchReleaseAction.mockResolvedValue(refused('ACTION_NOT_FOUND', 'Action has not committed'));
    const mounted = await mount();
    await user.click(screen.getByRole('button', { name: 'Import 337 cards' }));
    await screen.findByText(/TIMEOUT: Timed out/);
    const first = api.sendReleaseAction.mock.calls[0][0];
    expect(screen.getByRole('button', { name: 'Retry identical import request' }).hasAttribute('disabled')).toBe(true);
    mounted.unmount(); await mount();
    await user.click(screen.getByRole('button', { name: 'Query import action' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry identical import request' }).hasAttribute('disabled')).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Retry identical import request' }));
    await waitFor(() => expect(api.sendReleaseAction).toHaveBeenCalledTimes(2));
    expect(api.fetchReleaseAction).toHaveBeenCalledWith(session.bundle.releaseId, 'import', TEST_EDITOR_SUB);
    expect(api.sendReleaseAction.mock.calls[1][0].payload).toBe(first.payload);
    expect(api.sendReleaseAction.mock.calls[1][0].actionId).toBe(first.actionId);
  });
  it('refuses receipt registration after a bilingual readback mismatch', async () => {
    const user = userEvent.setup(); const { session, snapshot, cards } = importedSession(); store(session);
    cards[0].translations = null;
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot)); api.fetchReleaseCards.mockResolvedValue(ok(cards));
    await mount(); await reconcile(user, session, ['import']); await user.click(screen.getByRole('button', { name: 'Verify and register model review' }));
    await screen.findByText(/Readback content differs/);
    expect(api.sendReleaseAction).not.toHaveBeenCalled();
  });
  it('queries a committed but unconfirmed publish, shows actual pending job/live, and replays the original action', async () => {
    const user = userEvent.setup(); const { session, snapshot, cards } = reviewedSession(); store(session);
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot)); api.fetchReleaseCards.mockResolvedValue(ok(cards));
    api.sendReleaseAction.mockResolvedValue(refused('PUBLISH_DISPATCH_UNCONFIRMED', 'Publish job committed; delivery unconfirmed.'));
    const committed = ok({ jobId: 'same-job', buildId: 'same-build', outcome: 'committed', manifestVerified: false, snapshotSha256: snapshot.publishSnapshot });

    await mount(); await reconcile(user, session, ['import', 'review']); await user.click(screen.getByRole('button', { name: 'Publish reviewed release' }));
    await screen.findByText(/PUBLISH_DISPATCH_UNCONFIRMED:/);
    const first = api.sendReleaseAction.mock.calls[0][0];
    expect(JSON.parse(first.payload)).toMatchObject({ actionId: 'publish', expectedLive: 'original-live', receiptId: 'original-receipt' });
    expect(screen.queryByRole('button', { name: 'Continue queue delivery' })).toBeNull();
    api.fetchReleaseAction.mockImplementation(async (_release, kind) => ok({ action: { StatusCode: 200, Body: JSON.stringify(kind === 'publish' ? committed : session.actions[kind as 'import' | 'review']!.result) }, receipts: [], jobs: [{ job_id: 'same-job', build_id: 'same-build', status: 'PENDING', content_sha256: null, error_message: null }], liveBuildId: 'original-live', manifestVerified: false }));
    await user.click(screen.getByRole('button', { name: 'Check publication status' }));
    await screen.findByText(/Committed publish action found/);
    expect(screen.getByText(/"PENDING"/, { exact: false }).textContent).toContain('same-job');
    await user.click(screen.getByRole('button', { name: 'Continue queue delivery' }));
    await waitFor(() => expect(api.sendReleaseAction).toHaveBeenCalledTimes(2));
    expect(api.sendReleaseAction.mock.calls[1][0].payload).toBe(first.payload);
    expect(api.fetchReleaseSnapshot).not.toHaveBeenCalled();
  });
  it('blocks a new publish after a concurrent live change without rebasing its initial baseline', async () => {
    const user = userEvent.setup(); const { session, snapshot, cards } = reviewedSession(); store(session);
    api.fetchReleaseSnapshot.mockResolvedValue(ok({ ...snapshot, deck: { ...snapshot.deck, live_build_id: 'concurrent-live' } })); api.fetchReleaseCards.mockResolvedValue(ok(cards));
    api.sendReleaseAction.mockResolvedValue(refused('LIVE_BUILD_CONFLICT', 'Live build changed; this release cannot rebase.'));
    await mount(); await reconcile(user, session, ['import', 'review']); await user.click(screen.getByRole('button', { name: 'Publish reviewed release' }));
    await screen.findByText(/cannot rebase/);
    expect(api.sendReleaseAction).toHaveBeenCalledTimes(1);
    expect(JSON.parse(api.sendReleaseAction.mock.calls[0][0].payload).expectedLive).toBe('original-live');
    expect((await readSaved()).baseline.deck.live_build_id).toBe('original-live');
  });
});

describe('recovery reconciliation and ownership regressions', () => {
  it('restores a newer journal even when an incomplete release is already loaded', async () => {
    const old = importedSession(5); store(old.session); const newer = reviewedSession(5); const user = userEvent.setup(); await mount();
    const file = new File([JSON.stringify(newer.session)], 'newer-recovery.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(newer.session) });
    await user.upload(screen.getByLabelText('Or restore a downloaded Console recovery journal'), file);
    await screen.findByText(/Original backup, frozen requests and action keys restored/);
    expect((await readSaved()).actions.review.payload).toBe(newer.session.actions.review!.payload);
    expect(api.sendReleaseAction).not.toHaveBeenCalled();
  });
  it.each([false, true])('recovers a malformed saved journal while retaining stale-tab protection (%s)', async concurrentWrite => {
    await journalStore.saveReleaseJournal(TEST_EDITOR_SUB, 'invalid journal JSON', 0, () => {});
    const { session } = releaseFixture(5); const user = userEvent.setup(); await mount();
    await screen.findByText(/Saved release session could not be read/);
    if (concurrentWrite) await journalStore.saveReleaseJournal(TEST_EDITOR_SUB, 'another tab recovered first', 1, () => {});
    const file = new File([JSON.stringify(session)], 'recovery.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(session) });
    await user.upload(screen.getByLabelText('Or restore a downloaded Console recovery journal'), file);
    if (concurrentWrite) {
      await screen.findByText(/Release journal changed in another tab/);
      expect((await journalStore.loadReleaseJournal(TEST_EDITOR_SUB))!.raw).toBe('another tab recovered first');
    } else {
      await screen.findByRole('button', { name: 'Import 5 cards' });
      expect((await readSaved()).bundle.releaseId).toBe(session.bundle.releaseId);
    }
    expect(api.sendReleaseAction).not.toHaveBeenCalled();
  });
  it.each(['reload', 'upload'] as const)('requires actual queries after %s of confirmed import/review before dependent writes', async mode => {
    const user = userEvent.setup(); const { session, snapshot, cards } = reviewedSession();
    if (mode === 'reload') store(session);
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot)); api.fetchReleaseCards.mockResolvedValue(ok(cards));
    await mount();
    if (mode === 'upload') {
      const file = new File([JSON.stringify(session)], 'recovery.json', { type: 'application/json' });
      Object.defineProperty(file, 'text', { value: async () => JSON.stringify(session) });
      await user.upload(screen.getByLabelText('Or restore a downloaded Console recovery journal'), file);
    }
    await screen.findByRole('button', { name: 'Publish reviewed release' });
    expect(screen.getByRole('button', { name: 'Publish reviewed release' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Verify current editing readback' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText(/Commit confirmed/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Publish reviewed release' }));
    expect(api.sendReleaseAction).not.toHaveBeenCalled(); expect(api.fetchReleaseSnapshot).not.toHaveBeenCalled();
    await reconcile(user, session, ['import']);
    expect(screen.getByRole('button', { name: 'Publish reviewed release' }).hasAttribute('disabled')).toBe(true);
    await reconcile(user, session, ['review']);
    expect(screen.getByRole('button', { name: 'Publish reviewed release' }).hasAttribute('disabled')).toBe(false);
  });
  it('ACTION_NOT_FOUND clears historical confirmation/result/query but retains exact key and bytes', async () => {
    const user = userEvent.setup(); const { session } = importedSession(); store(session);
    api.fetchReleaseAction.mockResolvedValue(refused('ACTION_NOT_FOUND', 'Not committed'));
    await mount(); await user.click(screen.getByRole('button', { name: 'Query import action' }));
    await screen.findByText(/has not committed/);
    const action = (await readSaved()).actions.import;
    expect(action).toMatchObject({ actionId: 'import', payload: session.actions.import!.payload, outcome: 'unknown', queried: true, reconciled: true });
    expect(action.result).toBeUndefined(); expect(action.query).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Verify and register model review' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Retry identical import request' }).hasAttribute('disabled')).toBe(false);
  });
  it('blocks a mounted journal after the account changes before capture/query/write', async () => {
    const user = userEvent.setup(); const { session } = releaseFixture(); store(session); await mount();
    signInAsSuperAdmin(); await user.click(screen.getByRole('button', { name: 'Import 337 cards' }));
    await screen.findByText(/Signed-in subject changed/);
    expect(api.fetchReleaseSnapshot).not.toHaveBeenCalled(); expect(api.sendReleaseAction).not.toHaveBeenCalled();
    expect((await readSaved()).actions).toEqual({});
    expect(sessionStorage.getItem(`aws-basics-release-v1:${TEST_ADMIN_SUB}`)).toBeNull();
  });
  it.each(['preflight', 'write', 'query', 'readback'] as const)('discards %s results after an identity transition and performs no subsequent save/write', async step => {
    const user = userEvent.setup(); const fixture = step === 'query' || step === 'readback' ? importedSession() : releaseFixture();
    const { session, snapshot, cards } = fixture; store(session);
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot)); api.fetchReleaseCards.mockResolvedValue(ok(cards));
    api.sendReleaseAction.mockResolvedValue(ok({ editingSnapshot: snapshot.editingSnapshot }));
    await mount();
    if (step === 'readback') await reconcile(user, session, ['import']);
    let resolve!: (value: unknown) => void;
    const pending = new Promise(resolvePromise => { resolve = resolvePromise; });
    if (step === 'preflight') api.fetchReleaseSnapshot.mockReturnValue(pending);
    if (step === 'write') api.sendReleaseAction.mockReturnValue(pending);
    if (step === 'query') api.fetchReleaseAction.mockReturnValue(pending);
    if (step === 'readback') api.fetchReleaseCards.mockReturnValue(pending);
    await user.click(screen.getByRole('button', { name: step === 'query' ? 'Query import action' : step === 'readback' ? 'Verify and register model review' : 'Import 337 cards' }));
    if (step === 'write') await waitFor(() => expect(api.sendReleaseAction).toHaveBeenCalledTimes(1));
    if (step === 'readback') await waitFor(() => expect(api.fetchReleaseCards).toHaveBeenCalledTimes(1));
    const priorJournal = (await journalStore.loadReleaseJournal(TEST_EDITOR_SUB))!.raw;
    signInAsSuperAdmin();
    resolve(step === 'query' ? refused('ACTION_NOT_FOUND', 'Not committed') : step === 'readback' ? ok(cards) : ok(step === 'write' ? { editingSnapshot: snapshot.editingSnapshot } : snapshot));
    await screen.findByText(/Signed-in subject changed/);
    expect((await journalStore.loadReleaseJournal(TEST_EDITOR_SUB))!.raw).toBe(priorJournal);
    expect(api.sendReleaseAction).toHaveBeenCalledTimes(step === 'write' ? 1 : 0);
    if (step === 'readback') expect(api.fetchReleaseSnapshot).not.toHaveBeenCalled();
  });
  it('rejects a foreign uploaded journal without saving it', async () => {
    const user = userEvent.setup(); const { session } = releaseFixture(); session.ownerSubject = TEST_ADMIN_SUB; await mount();
    const file = new File([JSON.stringify(session)], 'foreign.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(session) });
    await user.upload(screen.getByLabelText('Or restore a downloaded Console recovery journal'), file);
    await screen.findByText(/another signed-in subject/); expect(sessionStorage.getItem(key)).toBeNull();
  });
  it('blocks import when journal storage fails (original independent positive control)', async () => {
    const user = userEvent.setup(); const { session, snapshot } = releaseFixture(); store(session); await mount();
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot));
    const spy = vi.spyOn(journalStore, 'saveReleaseJournal').mockRejectedValue(new Error('Synthetic quota exceeded'));
    try { await user.click(screen.getByRole('button', { name: 'Import 337 cards' })); await screen.findByText('Synthetic quota exceeded'); expect(api.sendReleaseAction).not.toHaveBeenCalled(); }
    finally { spy.mockRestore(); }
  });
});

describe('reconciled receipt binds the original publish bytes', () => {
  it('refuses a recovered publish replay if the actual queried review receipt differs', async () => {
    const user = userEvent.setup(); const { session, snapshot } = reviewedSession();
    const publish = prepareReleaseAction(session, 'publish', 'publish'); session.actions.publish = publish; store(session);
    const originalBytes = publish.payload;
    session.actions.review!.result!.data!.receiptId = 'actual-different-receipt';
    await mount(); await reconcile(user, session, ['import', 'review']);
    api.fetchReleaseAction.mockResolvedValue(ok({ action: { StatusCode: 200, Body: JSON.stringify(ok({ jobId: 'same-job', buildId: 'same-build', outcome: 'committed', manifestVerified: false, snapshotSha256: snapshot.publishSnapshot })) }, receipts: [], jobs: [], liveBuildId: 'original-live', manifestVerified: false }));
    await user.click(screen.getByRole('button', { name: 'Check publication status' })); await screen.findByText(/differs from its frozen/);
    expect(screen.queryByRole('button', { name: 'Continue queue delivery' })).toBeNull();
    expect(api.sendReleaseAction).not.toHaveBeenCalled();
    expect((await readSaved()).actions.publish.payload).toBe(originalBytes);
    expect(api.fetchReleaseSnapshot).not.toHaveBeenCalled();
  });
});

describe('automatic reviewed release completion', () => {
  function publishingApi(fixture: ReturnType<typeof releaseFixture>, options: { pendingIndex?: boolean; unknownImport?: boolean; attention?: boolean; failedBuild?: boolean; queueAttention?: boolean } = {}) {
    const { session, snapshot, cards } = fixture;
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot)); api.fetchReleaseCards.mockResolvedValue(ok(cards));
    const published = ok({ jobId: 'same-job', buildId: 'same-build', outcome: 'queued', manifestVerified: false, snapshotSha256: snapshot.publishSnapshot });
    let publishCalls = 0;
    api.sendReleaseAction.mockImplementation(async action => {
      if (action.kind === 'import') return options.unknownImport ? refused('TIMEOUT', 'Response lost') : ok({ editingSnapshot: snapshot.editingSnapshot });
      if (action.kind === 'review') return ok({ receiptId: 'same-receipt', editingSnapshot: snapshot.editingSnapshot, publishSnapshot: snapshot.publishSnapshot });
      publishCalls++; return published;
    });
    api.fetchReleaseAction.mockImplementation(async (_release, kind) => ok({
      action: { StatusCode: 200, Body: JSON.stringify(kind === 'import' ? ok({ editingSnapshot: snapshot.editingSnapshot }) : kind === 'review' ? session.actions.review?.result : published) },
      receipts: [], jobs: [{ job_id: 'same-job', build_id: 'same-build', status: options.failedBuild ? 'FAILED' : options.queueAttention ? 'PENDING' : 'SUCCESS', content_sha256: 'a'.repeat(64), error_message: options.failedBuild ? 'Synthetic build validation failed.' : null,
        dispatchState: options.queueAttention ? 'needs_attention' : 'closed',
        manifestState: options.attention ? 'needs_attention' : options.pendingIndex && publishCalls < 2 ? 'pending' : 'delivered', manifestNextAttemptAt: '2020-01-01T00:00:00Z' }],
      liveBuildId: 'same-build', manifestVerified: false,
    }));
    api.verifyReleaseDelivery.mockResolvedValue({ jobId: 'same-job', buildId: 'same-build', sha256: 'a'.repeat(64), cards: session.bundle.cards.length, verifiedAt: new Date().toISOString() });
  }
  it('runs capture/import/review/publish/CDN verification from one reviewed bundle', async () => {
    const fixture = releaseFixture(5); const user = userEvent.setup(); publishingApi(fixture); await mount();
    const file = new File([JSON.stringify(fixture.bundle)], 'reviewed.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(fixture.bundle) });
    await user.upload(screen.getByLabelText('Immutable release bundle (JSON)'), file);
    await user.click(screen.getByRole('button', { name: 'Run reviewed release' }));
    await screen.findByText(/Published and verified 5 bilingual cards/);
    expect(api.sendReleaseAction.mock.calls.map(call => call[0].kind)).toEqual(['import', 'review', 'publish']);
    expect(api.fetchReleaseCards).toHaveBeenCalledTimes(1);
    expect(api.fetchReleaseSnapshot).toHaveBeenCalledTimes(3);
    expect((await readSaved()).delivery).toMatchObject({ jobId: 'same-job', buildId: 'same-build', cards: 5 });
    expect(screen.getByText(/manifestVerified=true/)).toBeTruthy();
  });
  it('queries a lost import response and continues without importing again', async () => {
    const fixture = releaseFixture(5); store(fixture.session); publishingApi(fixture, { unknownImport: true }); const user = userEvent.setup(); await mount();
    await user.click(screen.getByRole('button', { name: 'Run reviewed release' })); await screen.findByText(/Published and verified 5 bilingual cards/);
    expect(api.sendReleaseAction.mock.calls.filter(call => call[0].kind === 'import')).toHaveLength(1);
  });
  it('clears the previous CDN proof when restoring a different incomplete release', async () => {
    const fixture = releaseFixture(5); store(fixture.session); publishingApi(fixture); const user = userEvent.setup(); await mount();
    await user.click(screen.getByRole('button', { name: 'Run reviewed release' })); await screen.findByText(/Published and verified 5 bilingual cards/);
    const next = releaseFixture(3).session; next.bundle.releaseId = 'next-reviewed-release';
    const file = new File([JSON.stringify(next)], 'next-recovery.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(next) });
    const writes = api.sendReleaseAction.mock.calls.length;
    await user.upload(screen.getByLabelText('Or restore a downloaded Console recovery journal'), file);
    await screen.findByText(/Original backup, frozen requests and action keys restored/);
    expect(screen.queryByText(/manifestVerified=true/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start another release' })).toBeNull();
    expect((await readSaved()).bundle.releaseId).toBe('next-reviewed-release');
    expect(api.sendReleaseAction).toHaveBeenCalledTimes(writes);
  });
  it('migrates a legacy 770-row backup and completes a journal beyond the old browser quota', async () => {
    const fixture = releaseFixture(379);
    for (let i = 0; i < 391; i++) fixture.snapshot.backup.push({ ...structuredClone(fixture.snapshot.backup[0]), id: 10_000 + i, stable_uid: `deleted-${i}`, order_in_deck: 10_000 + i, is_deleted: 1, private_evidence: 'x'.repeat(6000) });
    fixture.session.baseline = structuredClone(fixture.snapshot);
    fixture.session.baselineInventory = captureReleaseBackupInventory(fixture.snapshot);
    expect(JSON.stringify(fixture.session).length).toBeLessThan(5_000_000);
    store(fixture.session); publishingApi(fixture); const user = userEvent.setup(); await mount();
    expect(sessionStorage.getItem(key)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Run reviewed release' })); await screen.findByText(/Published and verified 379 bilingual cards/, {}, { timeout: 10_000 });
    const persisted = (await journalStore.loadReleaseJournal(TEST_EDITOR_SUB))!;
    expect(persisted.raw.length).toBeGreaterThan(5_000_000);
    expect(JSON.parse(persisted.raw).baseline.backup).toHaveLength(770);
    await user.click(screen.getByRole('button', { name: 'Start another release' }));
    await screen.findByLabelText('Immutable release bundle (JSON)');
    expect((await journalStore.loadReleaseJournal(TEST_EDITOR_SUB))!.raw).toBe('');
  }, 15_000);
  it('recovers a pending index with identical publish bytes and waits for CDN verification', async () => {
    const fixture = releaseFixture(5); store(fixture.session); publishingApi(fixture, { pendingIndex: true }); const user = userEvent.setup(); await mount();
    api.verifyReleaseDelivery.mockResolvedValueOnce(null).mockResolvedValueOnce({ jobId: 'same-job', buildId: 'same-build', sha256: 'a'.repeat(64), cards: 5 });
    await user.click(screen.getByRole('button', { name: 'Run reviewed release' })); await screen.findByText(/Published and verified 5 bilingual cards/);
    const calls = api.sendReleaseAction.mock.calls.filter(call => call[0].kind === 'publish');
    expect(calls).toHaveLength(2); expect(calls[1][0].payload).toBe(calls[0][0].payload);
    expect(api.verifyReleaseDelivery).toHaveBeenCalledTimes(2);
  });
  it('stops on exhausted index retries with the original job and journal retained', async () => {
    const fixture = releaseFixture(5); store(fixture.session); publishingApi(fixture, { attention: true }); const user = userEvent.setup(); await mount();
    await user.click(screen.getByRole('button', { name: 'Run reviewed release' })); await screen.findByText(/Index delivery needs attention/);
    expect(api.verifyReleaseDelivery).not.toHaveBeenCalled();
    expect(api.sendReleaseAction.mock.calls.filter(call => call[0].kind === 'publish')).toHaveLength(1);
    expect((await readSaved()).actions.publish.result.data.jobId).toBe('same-job');
  });
  it('never records CDN success after an account transition during verification', async () => {
    const fixture = releaseFixture(5); store(fixture.session); publishingApi(fixture); const user = userEvent.setup(); await mount();
    api.verifyReleaseDelivery.mockImplementation(async () => { signInAsSuperAdmin(); return { cards: 5 }; });
    await user.click(screen.getByRole('button', { name: 'Run reviewed release' })); await screen.findByText(/Signed-in subject changed/);
    expect(screen.queryByText(/manifestVerified=true/)).toBeNull();
  });
  it('shows terminal build failure without a retry or run button and status checks never restart it', async () => {
    const fixture = releaseFixture(5); store(fixture.session); publishingApi(fixture, { failedBuild: true }); const user = userEvent.setup(); await mount();
    await user.click(screen.getByRole('button', { name: 'Run reviewed release' }));
    await screen.findByText('Publication failed');
    expect(screen.queryByRole('button', { name: 'Continue queue delivery' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run reviewed release' })).toBeNull();
    const writes = api.sendReleaseAction.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Check publication status' }));
    expect(api.sendReleaseAction).toHaveBeenCalledTimes(writes);
    expect((await readSaved()).actions.publish.result.data.jobId).toBe('same-job');
  });
  it('shows exhausted queue delivery as needing attention without offering another publish', async () => {
    const fixture = releaseFixture(5); store(fixture.session); publishingApi(fixture, { queueAttention: true }); const user = userEvent.setup(); await mount();
    await user.click(screen.getByRole('button', { name: 'Run reviewed release' }));
    await screen.findByText('Queue delivery needs attention');
    expect(screen.queryByRole('button', { name: 'Continue queue delivery' })).toBeNull();
    expect(api.sendReleaseAction.mock.calls.filter(call => call[0].kind === 'publish')).toHaveLength(1);
  });
  it('rechecks public verification without importing, reviewing or publishing again', async () => {
    const fixture = releaseFixture(5); store(fixture.session); publishingApi(fixture); const user = userEvent.setup(); await mount();
    api.verifyReleaseDelivery.mockRejectedValueOnce(new Error('Synthetic public download unavailable.'));
    await user.click(screen.getByRole('button', { name: 'Run reviewed release' }));
    await screen.findByText('Public verification incomplete');
    const writes = api.sendReleaseAction.mock.calls.length;
    const snapshots = api.fetchReleaseSnapshot.mock.calls.length;
    const readbacks = api.fetchReleaseCards.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Verify public cards' }));
    await screen.findByText('Published and verified');
    expect(api.sendReleaseAction).toHaveBeenCalledTimes(writes);
    expect(api.fetchReleaseSnapshot).toHaveBeenCalledTimes(snapshots);
    expect(api.fetchReleaseCards).toHaveBeenCalledTimes(readbacks);
  });
  it.each(['timeout', 'missing jobs', 'null job'] as const)('clears current success and forbids writes after a %s status reply', async failure => {
    const fixture = releaseFixture(5); store(fixture.session); publishingApi(fixture); const user = userEvent.setup(); await mount();
    await user.click(screen.getByRole('button', { name: 'Run reviewed release' }));
    await screen.findByText('Published and verified');
    const raw = (await journalStore.loadReleaseJournal(TEST_EDITOR_SUB))!.raw;
    const writes = api.sendReleaseAction.mock.calls.length;
    const action = JSON.parse(raw).actions.publish;
    api.fetchReleaseAction.mockResolvedValue(failure === 'timeout' ? refused('TIMEOUT', 'Status check timed out.')
      : ok({ ...action.query, jobs: failure === 'null job' ? [null] : undefined }));
    await user.click(screen.getByRole('button', { name: 'Check publication status' }));
    await screen.findByText('Publication result not confirmed');
    expect(screen.queryByText('Published and verified')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start another release' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verify public cards' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue queue delivery' })).toBeNull();
    expect(api.sendReleaseAction).toHaveBeenCalledTimes(writes);
    expect((await journalStore.loadReleaseJournal(TEST_EDITOR_SUB))!.raw).toBe(raw);
  });

});
