import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createS3ReleaseUpload, fetchS3ReleaseBundle, fetchReleaseCards, fetchReleaseAction, fetchReleaseSnapshot, sendReleaseAction, type CloudJournalPointer } from '../api/contentRelease';
import { readSessionUser } from '../auth/sessionUser';
import { ConsoleShell } from '../components/console/ConsoleShell';
import { DeckWorkspaceHeader } from '../components/console/DeckWorkspaceHeader';
import { consoleNav } from '../components/console/consoleNav';
import { CARD_CLASS, H2_CLASS, INPUT_CLASS } from '../components/console/consoleStyles';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { CONSOLE_NAME } from '../lib/brand';
import { formatDeckTime } from '../lib/deckTime';
import { hasReviewedDeckRelease } from '../lib/deckWorkspace';
import { assertPublicationQuery, publicationStatus, type PublicationStatus } from '../lib/contentReleaseStatus';
import { loadReleaseJournal, withReleaseJournalLock } from '../lib/releaseJournalStore';
import { loadCloudReleaseJournal, saveCloudReleaseJournal } from '../lib/cloudReleaseJournal';
import { backgroundDeliveryProof, downloadVerifiedDeck, verifyReleaseDelivery, waitForReleasePoll, type ReleaseDeliveryProof } from '../lib/contentReleaseDelivery';
import { loadDeliveryArtifact, releaseArtifactDownload, saveDeliveryArtifact } from '../lib/releaseArtifacts';
import { assertExpectedReleaseBaseline, captureReleaseBackupInventory, assertActionDependencies, assertActionResult, assertFrozenAction, isConfirmedAction, assertOriginalLive, assertReleaseSnapshot, assertReplayAllowed, decodeCommittedAction, parseReleaseBundle, parseReleaseSession, prepareReleaseAction, verifyReleaseReadback } from '../lib/contentRelease';
import type { ApiResult } from '../types/api';
import type { ReleaseBundle, ReleaseKind, ReleaseSession } from '../types/contentRelease';

function dataOrThrow<T>(result: ApiResult<T>): T {
  if (!result.success || result.data === null) throw new Error(`${result.error?.code ?? 'INVALID_RESPONSE'}: ${result.error?.message ?? 'Response has no data.'}`);
  return result.data;
}
function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PublicationStatusPanel({ status, busy, blocked, onCheck, onContinue, onVerify }: {
  status: PublicationStatus; busy: boolean; blocked: boolean; onCheck: () => void; onContinue: () => void; onVerify: () => void;
}) {
  return <Callout tone={status.tone} title={status.title} role={status.tone === 'danger' ? 'alert' : 'status'}>
      <p>{status.description}</p>
      {status.nextAttemptAt && <p className="mt-2">Next retry no earlier than {formatDeckTime(status.nextAttemptAt, 'unknown')}</p>}
      {status.liveBuildId !== undefined && <p className="mt-2 break-all">Current server live build: {status.liveBuildId ?? 'none'}. Phone availability requires public verification.</p>}
      <p className="mt-2">Your frozen content and recovery journal are retained.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button variant="outline" disabled={busy} onClick={onCheck}>Check publication status</Button>
        {status.continueLabel && <Button disabled={busy || blocked} onClick={onContinue}>{status.continueLabel}</Button>}
        {status.kind === 'verification' && <Button disabled={busy || blocked} onClick={onVerify}>Verify public cards</Button>}
      </div>
    </Callout>;
}

const AWS_BASICS = { id: 15, slug: 'aws-saa-fundamentals', title: 'AWS Basics' };

export function ContentReleasePage({ deck, children }: {
  deck?: typeof AWS_BASICS;
  children?: ReactNode;
}) {
  const [params] = useSearchParams();
  const user = useMemo(() => readSessionUser(), []);
  const releaseDeckMatches = deck ? hasReviewedDeckRelease(deck) : (params.get('deckId') ?? '15') === '15';
  const allowed = Boolean(user?.sub && user.groups.some(group => group === 'editor' || group === 'super_admin')) && releaseDeckMatches;
  const storageKey = `aws-basics-release-v1:${user?.sub ?? 'no-session'}`;
  const [session, setSession] = useState<ReleaseSession | null>(null);
  const currentSession = useRef<ReleaseSession | null>(null);
  const cloudPointer = useRef<CloudJournalPointer>({ revision: null, parts: [] });
  const [cloudLoaded, setCloudLoaded] = useState(false);
  const mounted = useRef(false);
  const running = useRef<AbortController | null>(null);
  const [delivery, setDelivery] = useState<ReleaseDeliveryProof | null>(null);
  const [loading, setLoading] = useState(allowed);
  const [bundle, setBundle] = useState<ReleaseBundle | null>(null);
  const [s3Hash, setS3Hash] = useState('');
  const [s3BundleSha256, setS3BundleSha256] = useState<string>();
  const [uploadBytes, setUploadBytes] = useState('');
  const [uploadUrl, setUploadUrl] = useState('');
  const activeBundle = session?.bundle ?? bundle;
  const activeS3Hash = session ? session.s3BundleSha256 : s3BundleSha256;
  const validS3Hash = /^[0-9a-f]{64}$/.test(s3Hash);
  const [restoreBlocked, setRestoreBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [queryView, setQueryView] = useState<unknown>(null);
  const [publicationLookupFailed, setPublicationLookupFailed] = useState(false);
  const freshPublishQuery = useRef(false);
  const publication = publicationStatus(session, Boolean(delivery), publicationLookupFailed);
  const unusedRelease = Boolean(session && Object.keys(session.actions).length === 0);
  const stoppedRelease = publication?.kind === 'failed' || publication?.kind === 'superseded';

  const assertOwner = useCallback((current?: ReleaseSession | null) => {
    if (!mounted.current || running.current?.signal.aborted) throw new Error('Publication monitoring stopped.');
    const active = readSessionUser();
    if (!user?.sub || active?.sub !== user.sub || !active.groups.some(group => group === 'editor' || group === 'super_admin') || current && current.ownerSubject !== active.sub) throw new Error('Signed-in subject changed or journal belongs to another subject. Reopen this page under its owning account.');
  }, [user]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      running.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    void (async () => {
      try {
        assertOwner();
        const cloud = await loadCloudReleaseJournal(user!.sub!);
        if (cancelled) return;
        assertOwner();
        cloudPointer.current = cloud.pointer;
        setCloudLoaded(true);
        if (cloud.pointer.revision) {
          const restored = cloud.raw ? parseReleaseSession(cloud.raw, user!.sub!) : null;
          currentSession.current = restored;
          setSession(restored);
          return;
        }
        const stored = await loadReleaseJournal(user!.sub!).catch(() => null);
        if (cancelled) return;
        assertOwner();
        const legacy = stored ? null : sessionStorage.getItem(storageKey);
        const raw = stored?.raw ?? legacy;
        const recovered = raw ? parseReleaseSession(raw, user!.sub!) : null;
        if (recovered && raw) {
          cloudPointer.current = await saveCloudReleaseJournal(user!.sub!, raw, cloudPointer.current);
          if (cancelled) return;
          assertOwner(recovered);
          if (legacy) sessionStorage.removeItem(storageKey);
        }
        currentSession.current = recovered;
        setSession(recovered);
      } catch (failure) {
        if (!cancelled) {
          setRestoreBlocked(true);
          setError(`The saved release could not be loaded. Reload and reconcile it before starting a new release. ${String(failure)}`);
        }
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [allowed, assertOwner, storageKey, user]);
  async function owned<T>(work: () => Promise<T>, current = session): Promise<T> {
    assertOwner(current);
    const result = await work();
    assertOwner(current);
    return result;
  }
  function download(name: string, value: unknown) { assertOwner(); downloadJson(name, value); assertOwner(); }

  // A journal storage failure blocks dispatch. It must be recoverable after a lost HTTP response.
  async function save(next: ReleaseSession) {
    return withReleaseJournalLock(next.ownerSubject, async () => {
      assertOwner(next);
      cloudPointer.current = await saveCloudReleaseJournal(next.ownerSubject, JSON.stringify(next), cloudPointer.current);
      assertOwner(next);
      currentSession.current = next;
      setSession(next);
    });
  }
  async function run(work: () => Promise<unknown>, recovery = false) {
    if (!allowed || loading || busyRef.current || restoreBlocked && !recovery) return;
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try { assertOwner(); await owned(work); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  async function loadS3Bundle() {
    setBundle(null);
    setS3BundleSha256(undefined);
    const raw = dataOrThrow(await owned(() => fetchS3ReleaseBundle(s3Hash, user!.sub!)));
    setBundle(parseReleaseBundle(raw));
    setS3BundleSha256(s3Hash);
    setUploadUrl('');
  }
  async function capture() {
    if (!bundle || currentSession.current) return;
    if (bundle.schema !== 'aws-basics-release-bundle-v2') throw new Error('Regenerate this legacy bundle with its expected baseline before starting a new release. Existing frozen journals can still recover.');
    const baseline = dataOrThrow(await owned(() => fetchReleaseSnapshot(user!.sub!)));
    assertReleaseSnapshot(baseline);
    assertExpectedReleaseBaseline(bundle, baseline);
    await save({ schema: 'aws-basics-console-session-v1', ownerSubject: user!.sub!, baseline, baselineInventory: captureReleaseBackupInventory(baseline), bundle, s3BundleSha256, actions: {} });
    setMessage('Complete editing backup captured. The initial live build and bundle are now frozen for this release.');
  }
  async function verify(current: ReleaseSession): Promise<ReleaseSession> {
    assertOwner(current);
    if (!isConfirmedAction(current.actions.import)) throw new Error('Query and confirm import before readback.');
    const cards = dataOrThrow(await owned(() => fetchReleaseCards(user!.sub!), current));
    const snapshot = dataOrThrow(await owned(() => fetchReleaseSnapshot(user!.sub!)));
    if (current.actions.import?.result?.data?.editingSnapshot !== snapshot.editingSnapshot) throw new Error('Editing content changed since the confirmed import. The frozen release cannot adopt another editing snapshot.');
    verifyReleaseReadback(current, snapshot, cards);
    return { ...current, verifiedSnapshot: { ...snapshot, backup: undefined } };
  }
  async function dispatch(kind: ReleaseKind, replay = false) {
    const session = currentSession.current;
    if (!session) return;
    let current = session;
    assertOwner(current);
    assertActionDependencies(current, kind);
    let action = current.actions[kind];
    if (replay) {
      if (!action) throw new Error('No frozen request to replay.');
      assertReplayAllowed(action);
      if (kind === 'publish' && (!freshPublishQuery.current || !publicationStatus(current, false)?.continueLabel)) throw new Error('Check the current publication status. This job is not eligible for delivery replay.');
      assertFrozenAction(current, action);
    } else {
      if (action) throw new Error('Action is already frozen. Query it before retrying.');
      if (kind === 'import') {
        const now = dataOrThrow(await owned(() => fetchReleaseSnapshot(user!.sub!)));
        assertOriginalLive(current, now);
        assertExpectedReleaseBaseline(current.bundle, now);
        if (now.editingSnapshot !== current.baseline.editingSnapshot) throw new Error('Editing content changed since the backup. Nothing was imported.');
      } else if (kind === 'review') {
        current = await owned(() => verify(current), current);
      }
      action = prepareReleaseAction(current, kind, kind);
    }
    if (!action) return;
    if (kind === 'publish') freshPublishQuery.current = false;
    action = { ...action, outcome: 'unknown', queried: false, reconciled: false, result: undefined, query: undefined };
    current = { ...current, actions: { ...current.actions, [kind]: action }, ...(kind === 'import' ? { verifiedSnapshot: undefined } : {}) };
    await save(current);
    const frozen = action;
    const result = await owned(() => sendReleaseAction(frozen, user!.sub!), current);
    assertActionResult(current, action, result);
    // Every failure retains its key/payload. A 503 may mean a committed job with uncertain delivery.
    const next = { ...current, actions: { ...current.actions, [kind]: { ...action, outcome: result.success ? 'confirmed' as const : 'unknown' as const, reconciled: true, result } } };
    await save(next);
    if (!result.success) throw new Error(`${result.error?.code ?? 'UNKNOWN_OUTCOME'}: ${result.error?.message ?? 'No confirmed result.'} Query this action before retrying the identical request.`);
    setMessage(`${kind}: server returned ${String(result.data?.outcome ?? 'committed')}. Query the action for current job status and live build. External manifest verification is still pending.`);
    return next;
  }
  async function query(kind: ReleaseKind) {
    const session = currentSession.current;
    if (!session?.actions[kind]) return;
    const action = session.actions[kind];
    assertOwner();
    if (kind === 'publish') { setDelivery(null); setPublicationLookupFailed(true); freshPublishQuery.current = false; }
    let result;
    try {
      result = await owned(() => fetchReleaseAction(session.bundle.releaseId, action.actionId, user!.sub!));
    } catch (failure) { if (kind === 'publish') setPublicationLookupFailed(true); throw failure; }
    if (!result.success || !result.data) {
      if (result.error?.code !== 'ACTION_NOT_FOUND') dataOrThrow(result);
      await save({ ...session, actions: { ...session.actions, [kind]: { ...action, queried: true, reconciled: true, outcome: 'unknown', result: undefined, query: undefined } } });
      if (kind === 'publish') { setPublicationLookupFailed(false); freshPublishQuery.current = true; }
      setQueryView(result); setMessage('The action has not committed as of this query. Its original request and key are retained for an identical replay.'); return;
    }
    const committed = decodeCommittedAction(result.data.action);
    assertActionResult(session, action, committed);
    if (kind === 'publish') { assertPublicationQuery(result.data); assertFrozenAction(session, action); }
    const next: ReleaseSession = { ...session, actions: { ...session.actions, [kind]: { ...action, outcome: 'confirmed', queried: true, reconciled: true, result: committed, query: result.data } } };
    if (JSON.stringify(next.actions[kind]) !== JSON.stringify(action)) await save(next);
    if (kind === 'publish') { setPublicationLookupFailed(false); freshPublishQuery.current = true; }
    setQueryView(result.data);
    setMessage(`Committed ${kind} action found. Current live build: ${result.data.liveBuildId ?? 'none'}. manifestVerified=false. A PENDING publish can replay the identical action to deliver the same job.`);
    return next;
  }

  async function continuePublication() {
    for (const kind of ['import', 'review'] as const) {
      if (currentSession.current?.actions[kind] && !currentSession.current.actions[kind]!.reconciled) await query(kind);
    }
    await query('publish');
    const current = currentSession.current;
    if (!publicationStatus(current, false)?.continueLabel) return;
    await dispatch('publish', true);
    await completeRelease();
  }

  async function verifyPublicCards(current: ReleaseSession, signal: AbortSignal): Promise<boolean> {
    const action = current.actions.publish!;
    const query = action.query!;
    const job = query.jobs.find(item => item.job_id === action.result?.data?.jobId && item.build_id === action.result?.data?.buildId);
    const background = job?.cdnVerificationState ? backgroundDeliveryProof(current, query) : undefined;
    if (job?.cdnVerificationState && !background) return false;
    const proof = background ?? await owned(() => verifyReleaseDelivery(current, query, signal), current);
    if (!proof) return false;
    await save({ ...current, delivery: proof }); assertOwner(current); setDelivery(proof);
    setMessage(`Published and verified ${proof.cards} bilingual cards on the public CDN.`);
    return true;
  }

  async function loadArchiveBytes(current: ReleaseSession, signal = AbortSignal.timeout(20_000)) {
    const guard = () => assertOwner(current);
    const saved = await loadDeliveryArtifact(current, guard);
    if (saved) return saved;
    const query = current.actions.publish?.query;
    const proof = query && backgroundDeliveryProof(current, query);
    if (!proof || !current.delivery) throw new Error('Check this release’s public verification before downloading its files.');
    const bytes = await owned(() => downloadVerifiedDeck(current, proof, signal), current);
    await saveDeliveryArtifact(current, proof, bytes, guard);
    const artifact = await loadDeliveryArtifact(current, guard);
    if (!artifact) throw new Error('Could not save the verified download.');
    return artifact;
  }
  async function verifyExistingPublication(checkOnly = false) {
    const controller = new AbortController(); running.current = controller; setDelivery(null);
    try {
      const current = await query('publish');
      if (!current) return;
      const { kind } = publicationStatus(current, false) ?? {};
      if (kind === 'background_verification' || (kind === 'verification' && !checkOnly)) {
        if (!await verifyPublicCards(current, controller.signal))
          setMessage(kind === 'verification' ? 'Waiting for the public CDN index to refresh. Check again to verify this same card pack.' : '');
      }
    } finally { if (running.current === controller) running.current = null; }
  }

  async function completeRelease() {
    const controller = new AbortController(); running.current = controller; setDelivery(null);
    const timeout = setTimeout(() => controller.abort(), 240_000);
    const active = () => { if (controller.signal.aborted) throw new Error('Publication monitoring stopped.'); assertOwner(currentSession.current); };
    try {
      if (!currentSession.current) await capture();
      for (const kind of ['import', 'review', 'publish'] as const) {
        active(); if (currentSession.current?.actions[kind]) await query(kind);
      }
      for (const kind of ['import', 'review', 'publish'] as const) {
        active();
        if (isConfirmedAction(currentSession.current?.actions[kind])) continue;
        try { await dispatch(kind, Boolean(currentSession.current?.actions[kind])); }
        catch (failure) {
          active();
          if (!currentSession.current?.actions[kind]) throw failure;
          await query(kind);
          if (!isConfirmedAction(currentSession.current?.actions[kind])) throw failure;
        }
      }
      for (let attempt = 0; attempt < 36; attempt++) {
        active();
        const current = await query('publish');
        active();
        if (!current) throw new Error('Publish action was not found; its original request is retained.');
        const action = current.actions.publish!;
        const job = action.query?.jobs.find(item => item.job_id === action.result?.data?.jobId && item.build_id === action.result?.data?.buildId);
        if (job?.status === 'FAILED') { setError(job.error_message ?? 'Inspect the saved job for its failure reason.'); return; }
        if (job?.status === 'SUCCESS' && action.query?.liveBuildId !== job.build_id) throw new Error('Another release changed the live build. Publication verification stopped.');
        if (job?.status === 'PENDING' && job.dispatchState === 'needs_attention') { setError('Queue delivery retries are exhausted. The original job and journal are retained.'); return; }
        if (job?.manifestState === 'needs_attention') { setError(job.manifestError ?? 'Index delivery retry limit reached. The original job and journal are retained.'); return; }
        if (job?.manifestState === 'delivered' && job.cdnVerificationState === 'needs_attention') { setError(job.cdnVerificationError ?? 'CDN verification needs attention.'); return; }
        if (job?.status === 'SUCCESS' && job.manifestState === 'delivered') {
          if (await verifyPublicCards(current, controller.signal)) return;
          setMessage(job.cdnVerificationState ? 'The server is verifying this release on the public CDN. It will continue if you close this page.' :
            'Card build and index delivery succeeded. Waiting for the public CDN index to refresh.');
        } else {
          setMessage(job?.status === 'SUCCESS' ? 'Card build succeeded. Recovering the download index for the same job.' : 'Waiting for the published card build.');
          const manifestDue = Math.max(Date.parse(job?.manifestNextAttemptAt ?? '') || 0, Date.parse(job?.manifestLeaseUntil ?? '') || 0);
          const dispatchDue = Math.max(Date.parse(job?.dispatchNextAttemptAt ?? '') || 0, Date.parse(job?.dispatchLeaseUntil ?? '') || 0);
          if (job?.status === 'PENDING' && job.dispatchState === 'pending' && dispatchDue <= Date.now() || job?.status === 'SUCCESS' && job.manifestState === 'pending' && manifestDue <= Date.now()) await dispatch('publish', true);
        }
        await waitForReleasePoll(controller.signal);
      }
      throw new Error('Publication is still awaiting delivery verification. Run again to continue the same saved job.');
    } finally { clearTimeout(timeout); if (running.current === controller) running.current = null; }
  }

  async function startAnotherRelease() {
    const current = currentSession.current;
    if (!current) return;
    if (!delivery && Object.keys(current.actions).length !== 0) {
      const latest = await query('publish');
      const status = latest && publicationStatus(latest, false);
      if (status?.kind !== 'failed' && status?.kind !== 'superseded')
        throw new Error('Resolve the original publication before starting another release.');
    }
    await withReleaseJournalLock(user!.sub!, async () => {
      assertOwner(currentSession.current);
      cloudPointer.current = await saveCloudReleaseJournal(user!.sub!, '', cloudPointer.current);
      assertOwner(currentSession.current);
    });
    currentSession.current = null;
    setSession(null); setBundle(null); setDelivery(null); setQueryView(null);
    setPublicationLookupFailed(false); freshPublishQuery.current = false;
    setS3BundleSha256(undefined); setS3Hash(''); setUploadBytes(''); setUploadUrl('');
    setMessage('Release journal archived. Load the next reviewed bundle to begin.');
  }

  async function restoreLegacyJournal(file: File) {
    if (!cloudLoaded || cloudPointer.current.parts.length)
      throw new Error('Load the active cloud release before restoring a legacy journal.');
    if (file.size > 10_000_000) throw new Error('Recovery journal is too large.');
    const restored = parseReleaseSession(await owned(() => file.text()), user!.sub!);
    await save(restored);
    setRestoreBlocked(false); setDelivery(null); setQueryView(null); setPublicationLookupFailed(false);
    freshPublishQuery.current = false; setBundle(null);
    setMessage('Original backup, frozen requests and action keys restored. Query each existing action before continuing.');
  }

  if (!allowed) return <ConsoleShell title={CONSOLE_NAME} {...consoleNav()}><Callout tone="danger" role="alert">This release page requires a signed-in Console editor or super_admin and AWS Basics deck 15. Server authorization remains authoritative.</Callout></ConsoleShell>;
  return <ConsoleShell title={CONSOLE_NAME} subtitle="Publishing" {...consoleNav()}>
    <DeckWorkspaceHeader deck={deck ?? AWS_BASICS} view="publishing" />
    {loading ? <p role="status">Loading saved release…</p> : <>
    <section className={`${CARD_CLASS} space-y-3`} aria-labelledby="batch-heading">
      <h2 id="batch-heading" className={H2_CLASS}>Publish a batch</h2>
      {!session && <div className="space-y-2">
        <label className="block text-sm font-medium" htmlFor="s3-bundle-hash">S3 bundle SHA-256</label>
        <input id="s3-bundle-hash" className={INPUT_CLASS} type="text" autoComplete="off" spellCheck={false}
          value={s3Hash} disabled={busy || restoreBlocked} onChange={event => { setS3Hash(event.target.value.trim()); setUploadUrl(''); }} />
        <Button variant="outline" disabled={!validS3Hash || busy || restoreBlocked} onClick={() => void run(loadS3Bundle)}>Load from S3</Button>
        <details className="space-y-2">
          <summary className="cursor-pointer font-medium">Upload a bundle directly to S3</summary>
          <label className="block text-sm font-medium" htmlFor="s3-bundle-size">Bundle size in bytes</label>
          <input id="s3-bundle-size" className={INPUT_CLASS} type="number" min={1} max={3_000_000} step={1}
            value={uploadBytes} disabled={busy || restoreBlocked} onChange={event => { setUploadBytes(event.target.value); setUploadUrl(''); }} />
          <Button variant="outline" disabled={!validS3Hash || !/^[1-9][0-9]*$/.test(uploadBytes) || Number(uploadBytes) > 3_000_000 || busy || restoreBlocked}
            onClick={() => void run(async () => { setUploadUrl(dataOrThrow(await owned(() => createS3ReleaseUpload(s3Hash, uploadBytes, user!.sub!)))); })}>
            Create upload link
          </Button>
          {uploadUrl && <Button variant="outline" disabled={busy || restoreBlocked} onClick={() => void run(async () => {
            await owned(() => navigator.clipboard.writeText(uploadUrl)); setMessage('S3 upload link copied. The link expires in 10 minutes.');
          })}>Copy upload link</Button>}
        </details>
      </div>}
      {activeBundle && <div className="text-sm" role="status">
        <p className="break-all font-medium">Batch {activeBundle.releaseId}</p>
        <p className="text-slate-600">{activeBundle.cards.length} cards in the bundle</p>
        {activeS3Hash && <p className="break-all text-slate-600">S3 bundle {activeS3Hash}</p>}
      </div>}
      {!session?.actions.publish && <>
        <p className="max-w-prose text-sm text-slate-600">Publishing backs up the editing deck, registers the bundle’s existing model review, and verifies the card pack on the public CDN.</p>
        {activeBundle && <p className="max-w-prose text-sm text-slate-600">This click authorizes the whole batch. The receipt records model review only for individual cards.</p>}
        <Button className="min-h-11" disabled={!activeBundle || busy || restoreBlocked} onClick={() => void run(completeRelease)}>Publish batch</Button>
      </>}
      {delivery && <div className="flex flex-wrap gap-3">
        <Button variant="outline" disabled={busy} onClick={() => void run(startAnotherRelease)}>Start another release</Button>
        {!activeS3Hash && <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
          const current = currentSession.current!;
          const artifact = await loadArchiveBytes(current);
          download(`${current.bundle.releaseId}-verified-artifacts.json`, releaseArtifactDownload(current, artifact));
        })}>Download verified release artifacts</Button>}
      </div>}
      {!delivery && (unusedRelease || stoppedRelease) && <Button variant="outline" disabled={busy || restoreBlocked}
        onClick={() => void run(startAnotherRelease)}>
        {unusedRelease ? 'Archive unused release' : 'Archive stopped release'}
      </Button>}
    </section>
    {publication && <PublicationStatusPanel status={publication} busy={busy} blocked={restoreBlocked}
      onCheck={() => void run(() => verifyExistingPublication(true))} onContinue={() => void run(continuePublication)} onVerify={() => void run(() => verifyExistingPublication())} />}
    {error && <Callout tone={publication?.kind === 'unknown' || publication?.kind === 'verification' ? 'warning' : 'danger'} title="Action needs attention" role="alert">{error}</Callout>}
    {message && <Callout tone="info" role="status">{message}</Callout>}
    <details open={restoreBlocked || undefined} className={`${CARD_CLASS} space-y-3`}>
      <summary className="cursor-pointer rounded font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Batch details &amp; recovery</summary>
      {activeBundle && <div className="space-y-1 text-sm text-slate-600">
        <p>Review on file · {activeBundle.review.cards.length} card records</p>
        <p className="break-all">Model: {activeBundle.review.model} · Run: {activeBundle.review.runId}</p>
        <p>Console validates the bundle and compares it with the saved editing cards.</p>
      </div>}
      <p className="max-w-prose text-sm text-slate-600">
        Console saves the editing backup and release progress to private S3 before sending changes. Sign in with the same account to resume on another device.
      </p>
      {!session && bundle && <Button variant="outline" disabled={busy || restoreBlocked} onClick={() => void run(capture)}>Capture editing backup and freeze release</Button>}
      {cloudLoaded && !activeBundle && !cloudPointer.current.parts.length && <section className={`${CARD_CLASS} space-y-3`}>
        <label className="block text-sm" htmlFor="release-recovery">Or restore a downloaded Console recovery journal</label>
        <input id="release-recovery" className={INPUT_CLASS} type="file" accept="application/json,.json" disabled={busy} onChange={event => {
          const file = event.target.files?.[0];
          if (file) void run(() => restoreLegacyJournal(file), true);
        }} />
      </section>}
      {session && <>
        <section className={`${CARD_CLASS} space-y-3`} aria-labelledby="backup-heading">
          <h2 id="backup-heading" className={H2_CLASS}>1. Frozen release and initial backup</h2>
          <p className="text-sm break-all">Release: {session.bundle.releaseId} · Main: {session.bundle.review.mainSHA}<br />Initial live build: {session.baseline.deck.live_build_id ?? 'none'}<br />Initial editing snapshot: {session.baseline.editingSnapshot}</p>
          {!activeS3Hash && <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => void run(async () => download(`${session.bundle.releaseId}-editing-backup.json`, session.baseline))}>Download complete editing backup</Button><Button variant="outline" onClick={() => void run(async () => download(`${session.bundle.releaseId}-console-journal.json`, session))}>Download recovery journal</Button></div>}
          <p className="text-sm text-slate-600">The exact bundle, backup and requests are saved in private S3. Check restored actions before retrying.</p>
        </section>
        {(['import', 'review', 'publish'] as const).map((kind, index) => {
          const action = session.actions[kind];
          const reconciled = Object.values(session.actions).every(item => item.reconciled);
          const ready = reconciled && (kind === 'import' || kind === 'review' && isConfirmedAction(session.actions.import) || kind === 'publish' && isConfirmedAction(session.actions.import) && isConfirmedAction(session.actions.review));
          return <section key={kind} className={`${CARD_CLASS} space-y-3`} aria-labelledby={`${kind}-heading`}>
            <h2 id={`${kind}-heading`} className={H2_CLASS}>{index + 2}. {kind === 'import' ? 'Import frozen candidate' : kind === 'review' ? 'Verify full readback and register local model evidence' : 'Publish reviewed snapshot'}</h2>
            {action && <p className="text-sm break-all">Action: {action.actionId} · {!action.reconciled ? 'Recovery unreconciled — query before continuing' : action.outcome === 'unknown' ? 'Outcome unknown — query before retry' : 'Commit confirmed'}{action.result?.error ? ` · ${action.result.error.code}` : ''}</p>}
            <div className="flex flex-wrap gap-3">
              {!action && <Button disabled={busy || !ready} onClick={() => void run(() => dispatch(kind))}>{kind === 'import' ? `Import ${session.bundle.cards.length} cards` : kind === 'review' ? 'Verify and register model review' : 'Publish reviewed release'}</Button>}
              {action && kind !== 'publish' && <Button variant="outline" disabled={busy} onClick={() => void run(() => query(kind))}>Query {kind} action</Button>}
              {action && kind !== 'publish' && action.outcome === 'unknown' && <Button variant="outline" disabled={busy || !action.queried || !ready} onClick={() => void run(() => dispatch(kind, true))}>Retry identical {kind} request</Button>}
            </div>
            {kind === 'review' && <p className="text-sm text-slate-600">All English and Chinese fields, help, source, difficulty and order must match. Every local PASS must match the current server hash, schema and revision. Policy hashes come from the current snapshot.</p>}
            {kind === 'publish' && <p className="text-sm text-slate-600">A 503 or timeout can leave a committed publish job. Query, then replay the same action if delivery is unconfirmed. Current job and live status appear below; manifestVerified remains false until external CDN verification.</p>}
          </section>;
        })}
        <section className={`${CARD_CLASS} space-y-3`} aria-labelledby="verification-heading"><h2 id="verification-heading" className={H2_CLASS}>Readback and server status</h2><Button variant="outline" disabled={busy || !isConfirmedAction(session.actions.import) || !Object.values(session.actions).every(action => action.reconciled)} onClick={() => void run(async () => { const next = await owned(() => verify(session)); await save(next); setMessage(`Exact ${session.bundle.cards.length}-card readback and local model review bindings verified. No new model review was performed.`); })}>Verify current editing readback</Button><p className="text-sm">{delivery ? `manifestVerified=true · ${delivery.buildId} · ${delivery.cards} cards · ${delivery.sha256}` : 'manifestVerified=false · External CDN verification is pending.'}</p>
          <details><summary className="cursor-pointer text-sm">{publicationLookupFailed ? 'Previous action query (not current after a failed check)' : 'Latest action query (actual jobs and live build)'}</summary><pre className="text-xs overflow-auto max-h-96 whitespace-pre-wrap break-all">{JSON.stringify(queryView ?? Object.fromEntries(Object.entries(session.actions).map(([kind, action]) => [kind, action?.query ?? action?.result])), null, 2)}</pre></details>
          <details><summary className="cursor-pointer text-sm">Frozen complete editing backup</summary><pre className="text-xs overflow-auto max-h-96 whitespace-pre-wrap break-all">{JSON.stringify(session.baseline, null, 2)}</pre></details>
        </section>
      </>}
    </details>
    {children}
    </>}
  </ConsoleShell>;
}
