// src/pages/DeckImportPage.tsx
//
// Batch import for one deck: paste or pick a file, preview the
// reconciliation, then apply it in transactional batches, with a cancel button
// and a leave guard while a run is in progress.
//
// The page is deliberately thin. Parsing, validation and the create/update/
// unchanged decision live in lib/deckImport.ts, and the write loop lives in
// lib/deckImportRunner.ts, both covered by tests that need no DOM. What is
// left here is layout, the step machine, and reading a file.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { fetchCardsByDeck, fetchDeckById, fetchPublishJob, fetchReviewedPublishBaseline, findReviewedPublish, importCardsBatch, lookupImportReceipt, publishReviewedImport, type ReviewedPublishBaseline, type SavedReviewedPublish } from '../api/authoring';
import { getSessionGeneration, subscribeSessionChanges } from '../auth/tokenStore';
import { readSessionUser } from '../auth/sessionUser';
import { createImportJournal, readImportJournal, saveImportJournal, hasPendingImport, withImportJournalLock, type ImportJournal } from '../lib/deckImportJournal';
import { QueryKeys, useAppQueryClient } from '../api/queryClient';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { DeckWorkspaceHeader } from '../components/console/DeckWorkspaceHeader';
import { hasReviewedDeckRelease } from '../lib/deckWorkspace';
import { cardListHref } from '../lib/cardListLocation';
import { RarityDistribution } from '../components/RarityDistribution';
import {
  formatIssue,
  parseDeckMarkdown,
  planImport,
  translationPlanWarnings,
  type ImportPlan,
  type ParsedCard,
  type ParsedDeck,
} from '../lib/deckImport';
import {
  describeFailure,
  resumeImport,
  type ImportAction,
  type ImportRunResult,
} from '../lib/deckImportRunner';
import { planReviewedDeckBatch, readReviewedDeckBatch } from '../lib/reviewedDeckBatch';
import { formatWarning, sortWarnings, type ImportWarning } from '../lib/mcqWarnings';
import { markEnd, markStart } from '../perf/journey';
import { CONSOLE_NAME } from '../lib/brand';
import { ConsoleShell } from '../components/console/ConsoleShell';
import { consoleNav } from '../components/console/consoleNav';
import type { Card } from '../types/card';
import type { Deck } from '../types/deck';

const LEAVE_IMPORT = {
  title: 'Leave this import?',
  body: 'Committed batches stay saved. Reopen this import to recover the remaining batches.',
  destructive: true,
  confirmLabel: 'Leave import',
};

type Step = 'input' | 'preview' | 'result';

interface DeckState {
  loading: boolean;
  deck: Deck | null;
  error: string | null;
}

interface PreviewState {
  reviewed: boolean;
  publishBaseline: ReviewedPublishBaseline | null;
  parsed: ParsedDeck;
  plan: ImportPlan;
  /** Set when the document header names a different deck than the target. */
  slugMismatch: string | null;
  /** The server rows the plan was built from, kept so the clear-translations opt-in can re-plan without a refetch. */
  existing: Card[];
  /** The operator's explicit opt-in to delete stored translations the file leaves out. Reset by every preview. */
  clearTranslations: boolean;
}

const ACCEPTED_EXTENSIONS = ['.md', '.txt', '.json'];

function truncate(text: string, max = 90): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function groupWarnings(warnings: readonly ImportWarning[]): Array<[ImportWarning['code'], ImportWarning[]]> {
  const groups = new Map<ImportWarning['code'], ImportWarning[]>();
  for (const warning of warnings) {
    const bucket = groups.get(warning.code);
    if (bucket) bucket.push(warning);
    else groups.set(warning.code, [warning]);
  }
  return [...groups.entries()];
}

const ACTION_CLASSES: Record<string, string> = {
  create: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  update: 'bg-amber-50 text-amber-700 border-amber-200',
  unchanged: 'bg-slate-50 text-slate-500 border-slate-200',
  conflict: 'bg-red-50 text-red-700 border-red-200',
};

interface PreviewRow {
  card: ParsedCard;
  kind: 'create' | 'update' | 'unchanged' | 'conflict';
  detail: string;
}

/** One row per card, in document order, so the table reads like the file. */
function toRows(plan: ImportPlan): PreviewRow[] {
  const rows: PreviewRow[] = [
    ...plan.creates.map((c): PreviewRow => ({ card: c.card, kind: 'create', detail: 'new card' })),
    ...plan.updates.map((u): PreviewRow => ({
      card: u.card,
      kind: 'update',
      detail: u.changedFields.join(', '),
    })),
    ...plan.unchanged.map((u): PreviewRow => ({
      card: u.card,
      kind: 'unchanged',
      detail: 'identical to server',
    })),
    ...plan.conflicts.map((c): PreviewRow => ({
      card: c.card,
      kind: 'conflict',
      detail: c.message,
    })),
  ];
  return rows.sort((a, b) => a.card.sourceLine - b.card.sourceLine);
}

function Badge({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs ${tone}`}>
      <span className="font-semibold">{count}</span>
      <span>{label}</span>
    </span>
  );
}

export function DeckImportPage() {
  const [searchParams] = useSearchParams();
  const deckId = Number(searchParams.get('deckId'));
  return <DeckImportWorkspace key={deckId} deckId={deckId} />;
}

function DeckImportWorkspace({ deckId }: { deckId: number }) {
  // The one place this page touches the shared cache: after a run, the card list
  // and the deck row it just changed are invalidated (see execute's finally).
  const queryClient = useAppQueryClient();

  const invalidDeckId = !deckId || Number.isNaN(deckId) || deckId <= 0;

  const [deckState, setDeckState] = useState<DeckState>({
    loading: !invalidDeckId,
    deck: null,
    error: invalidDeckId ? 'Missing or invalid deckId.' : null,
  });

  const [step, setStep] = useState<Step>('input');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [baselineMessage, setBaselineMessage] = useState('');

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const { state: origin } = useLocation();
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [runResult, setRunResult] = useState<ImportRunResult | null>(null);
  const [sessionGeneration, setSessionGeneration] = useState(getSessionGeneration);
  const [recovery, setRecovery] = useState<ImportJournal | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryLoading, setRecoveryLoading] = useState(true);
  const account = readSessionUser()?.sub;
  const [savedPublish, setSavedPublish] = useState<SavedReviewedPublish | null>(null);
  const [savedPublishMessage, setSavedPublishMessage] = useState('');
  const [findingPublish, setFindingPublish] = useState(false);
  const [publishResult, setPublishResult] = useState<ImportJournal['reviewedPublish']>();
  const jobId = publishResult?.jobId;
  const publication = useQuery({
    queryKey: ['reviewed-batch-publication', sessionGeneration, deckId, jobId],
    enabled: Boolean(jobId),
    queryFn: async () => {
      const result = await fetchPublishJob(jobId!);
      if (!result.success || result.data?.jobId !== jobId || result.data?.deckId !== deckId) throw new Error('Could not load the publish job.');
      return result.data;
    },
    refetchInterval: query => {
      const job = query.state.data;
      return query.state.status === 'error' || job?.status === 'FAILED' ||
        job?.dispatchExhausted || job?.manifestState === 'needs_attention' ||
        job?.cdnVerificationState === 'needs_attention' || (job?.cdnVerificationState === 'verified' && job.manifestState === 'delivered') ||
        (job?.status === 'SUCCESS' && job.buildIsLive === false) ? false : 5_000;
    },
  }, queryClient);


  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // The controller for the batch run in flight, so the Cancel button can abort
  // it. Held in a ref rather than state because pressing Cancel must not depend
  // on a re-render having landed first.
  const abortRef = useRef<AbortController | null>(null);
  const abortRun = useCallback(() => abortRef.current?.abort(), []);
  useUnsavedChangesGuard(running, LEAVE_IMPORT, abortRun);

  useEffect(() => subscribeSessionChanges(() => {
    abortRef.current?.abort();
    setSessionGeneration(getSessionGeneration());
    setRecovery(null); setPublishResult(undefined); setSavedPublish(null); setSavedPublishMessage(''); setFindingPublish(false); setRunResult(null); setPreview(null); setText(''); setBaselineMessage(''); setStep('input'); setRunning(false);
  }), []);

  useEffect(() => {
    let current = true;
    setRecoveryLoading(true); setRecovery(null); setRecoveryError(null);
    if (!account || invalidDeckId) { setRecoveryLoading(false); return; }
    void readImportJournal(account, deckId).then(journal => {
      if (current) {
        setRecovery(journal && hasPendingImport(journal) ? journal : null);
        setPublishResult(journal?.reviewedPublish);
      }
    }).catch(error => {
      if (current) setRecoveryError(`Recovery storage failed: ${error instanceof Error ? error.message : 'Cannot read saved import.'}`);
    }).finally(() => { if (current) setRecoveryLoading(false); });
    return () => { current = false; };
  }, [account, deckId, invalidDeckId, sessionGeneration]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const job = publication.data;
    const finished = job && (job.status === 'FAILED' || job.dispatchExhausted ||
      job.manifestState === 'needs_attention' || job.cdnVerificationState === 'needs_attention' ||
      (job.status === 'SUCCESS' && (job.buildIsLive === false ||
        (job.manifestState === 'delivered' && job.cdnVerificationState === 'verified'))));
    if (!account || !jobId || !finished || publishResult?.finished) return;
    let current = true;
    void withImportJournalLock(account, deckId, async () => {
      if (!current || sessionGeneration !== getSessionGeneration()) return;
      const journal = await readImportJournal(account, deckId);
      if (!journal?.reviewedPublish || journal.reviewedPublish.jobId !== jobId) return;
      journal.reviewedPublish.finished = true;
      saveImportJournal(journal);
      setPublishResult(journal.reviewedPublish);
      setRecovery(null);
    }).catch(error => {
      if (current) setRecoveryError(error instanceof Error ? error.message : 'Could not save publication status.');
    });
    return () => { current = false; };
  }, [account, deckId, jobId, publication.data, publishResult?.finished, sessionGeneration]);

  useEffect(() => {
    if (invalidDeckId) return;

    let cancelled = false;

    (async () => {
      try {
        const result = await fetchDeckById(deckId);
        if (cancelled) return;

        if (!result.success || !result.data) {
          setDeckState({ loading: false, deck: null, error: result.error?.message ?? 'Deck not found.' });
          return;
        }
        setDeckState({ loading: false, deck: result.data, error: null });
      } catch (err: unknown) {
        if (cancelled) return;
        setDeckState({
          loading: false,
          deck: null,
          error: err instanceof Error ? err.message : 'Network error.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [deckId, invalidDeckId]);

  const deck = deckState.deck;

  async function copyCardVersions() {
    if (!deck) return;
    const generation = getSessionGeneration();
    setBaselineMessage('Loading card versions…');
    try {
      const result = await fetchCardsByDeck(deck.id);
      if (generation !== getSessionGeneration()) return;
      if (!result.success || !result.data) throw new Error('Could not load card versions.');
      const cards = result.data.map(({ stableUid, version, orderInDeck }) => ({ stableUid, version, orderInDeck }));
      await navigator.clipboard.writeText(JSON.stringify({ deckId: deck.id, deckSlug: deck.slug, cards }, null, 2));
      if (generation === getSessionGeneration()) setBaselineMessage('Card versions copied.');
    } catch (error) {
      if (generation === getSessionGeneration()) setBaselineMessage(error instanceof Error ? error.message : 'Could not copy card versions.');
    }
  }

  function handleFile(file: File | null) {
    setFileError(null);
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      setFileError(`Only .md, .txt, or .json files are accepted.`);
      // Clear the picker so choosing the same wrong file again still fires a
      // change event and re-shows the message.
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => setFileError('Could not read that file.');
    reader.onload = () => {
      setText(typeof reader.result === 'string' ? reader.result : '');
      setFileName(file.name);
    };
    reader.readAsText(file);
  }

  /**
   * Re-reads the deck from the server every time. The plan carries the row
   * versions it saw, so a preview built on a stale card list would hand the
   * runner an expectedVersion that is already wrong.
   */
  const buildPreview = useCallback(async () => {
    if (!deck || recovery || recoveryError || recoveryLoading) return;

    const generation = getSessionGeneration();
    setPreviewing(true);
    setPreviewError(null);
    setRunResult(null);

    try {
      markStart('import:preview');
      const reviewed = text.trimStart().startsWith('{') ? await readReviewedDeckBatch(text.trim()) : null;
      const parsed = reviewed?.parsed ?? parseDeckMarkdown(text);
      const publicationPreview = reviewed && readSessionUser()?.groups.includes('super_admin')
        ? await fetchReviewedPublishBaseline(deck.id) : null;
      const cardsResult = await fetchCardsByDeck(deck.id);
      if (generation !== getSessionGeneration()) return;

      if (!cardsResult.success) {
        setPreviewError(cardsResult.error?.message ?? 'Failed to load the current deck contents.');
        return;
      }

      const existing = cardsResult.data ?? [];
      const plan = reviewed
        ? planReviewedDeckBatch(reviewed, deck, existing)
        : planImport(parsed, existing, { deckLocale: deck.locale });
      const slugMismatch =
        parsed.deckSlug && deck.slug && parsed.deckSlug !== deck.slug ? parsed.deckSlug : null;

      setPreview({ reviewed: reviewed !== null, publishBaseline: publicationPreview?.data?.baseline ?? null,
        parsed, plan, slugMismatch, existing, clearTranslations: false });
      setStep('preview');
      markEnd('import:preview');
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPreviewing(false);
    }
  }, [deck, text, recovery, recoveryError, recoveryLoading]);

  const actions = useMemo<ImportAction[]>(() => {
    if (!preview) return [];
    return [...preview.plan.creates, ...preview.plan.updates];
  }, [preview]);

  // Parse-time suggestions plus the plan-time ZH_WARN_MAYBE_STALE and
  // ZH_WARN_STALE_MARKED_CURRENT, in one list.
  const warnings = useMemo<ImportWarning[]>(() => {
    if (!preview) return [];
    const planWarnings = translationPlanWarnings(preview.plan);
    return planWarnings.length === 0 ? preview.parsed.warnings : sortWarnings([...preview.parsed.warnings, ...planWarnings]);
  }, [preview]);

  // Cards whose stored translation this import would delete: still conflicts
  // before the opt-in, marked updates after it.
  const translationClears = preview
    ? preview.clearTranslations
      ? preview.plan.updates.filter((u) => u.clearsTranslations === true).length
      : preview.plan.conflicts.filter((c) => c.reason === 'TRANSLATIONS_WOULD_BE_CLEARED').length
    : 0;

  function setClearTranslations(clearTranslations: boolean) {
    if (!preview || !deck || preview.reviewed) return;
    setPreview({
      ...preview,
      clearTranslations,
      plan: planImport(preview.parsed, preview.existing, {
        deckLocale: deck.locale,
        allowClearTranslations: clearTranslations,
      }),
    });
  }

  const blocked = useMemo(() => {
    if (!preview || recoveryLoading || recovery || recoveryError) return true;
    if (preview.parsed.errors.length > 0) return true;
    if (preview.plan.conflicts.length > 0) return true;
    if (preview.slugMismatch) return true;
    return false;
  }, [preview, recoveryLoading, recovery, recoveryError]);

  async function execute(toRun: readonly ImportAction[], saved?: ImportJournal, publishBaseline?: ReviewedPublishBaseline) {
    if (!deck || (!saved && toRun.length === 0) || running || recoveryError || recoveryLoading) return;
    const owner = readSessionUser()?.sub;
    if (!owner) { setRecoveryError("Sign in again before importing."); return; }
    const session = getSessionGeneration();
    const isCurrent = () => session === getSessionGeneration() && readSessionUser()?.sub === owner;

    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setCancelling(false);
    setProgress({ done: 0, total: toRun.length });
    setStep('result');

    try {
      await withImportJournalLock(owner, deck.id, async () => {
        if (!isCurrent()) return;
        const journal = saved ? await readImportJournal(owner, deck.id) : await createImportJournal(owner, deck.id, toRun, undefined, preview?.reviewed ? deck.slug : undefined, publishBaseline);
        if (!journal || (saved && saved.runId !== journal.runId)) throw new Error('Saved import changed. Reload this page before continuing.');
        if (!isCurrent()) return;
        setRecovery(journal);
        const result = await resumeImport(
          journal,
          { importCards: importCardsBatch, lookupReceipt: lookupImportReceipt },
          {
            signal: controller.signal,
            isCurrent,
            onProgress: (p) => setProgress({ done: p.done, total: p.total }),
          },
        );
        if (!isCurrent()) return;
        setRunResult(result);
        const publish = journal.reviewedPublish;
        if (publish && !publish.jobId && !publish.refusal && journal.batches[0].state === 'committed' && !controller.signal.aborted) {
          const operationId = result.batches[0].operationId;
          const published = await publishReviewedImport(deck.id, operationId, controller.signal);
          if (!isCurrent()) return;
          if (published.success && published.data?.jobId) publish.jobId = published.data.jobId;
          else if (published.error && (published.error.httpStatus ?? 0) >= 400 && (published.error.httpStatus ?? 0) < 500 &&
              published.error.httpStatus !== 429 && !['PUBLISH_IN_PROGRESS', 'AI_QA_REQUIRED', 'AI_QA_BLOCKED'].includes(published.error.code)) {
            publish.refusal = published.error.message;
          }
          publish.notice = publish.jobId || publish.refusal ? undefined : published.error?.message;
          saveImportJournal(journal);
        }
        setPublishResult(publish);
        setRecovery(hasPendingImport(journal) ? journal : null);
      });
    } catch (error) {
      if (isCurrent()) setRecoveryError(`Import stopped: ${error instanceof Error ? error.message : 'Recovery storage is unavailable.'} Reload this page to recover safely.`);
    } finally {
      if (isCurrent()) {
        abortRef.current = null;
        setRunning(false);
        setCancelling(false);
      // The run wrote cards and moved the deck's totals, so both cached views are
      // now behind the server. Without this the card list would keep showing the
      // pre-import rows for up to the staleTime window.
        void queryClient.invalidateQueries({ queryKey: QueryKeys.cards(deck.id) });
        void queryClient.invalidateQueries({ queryKey: QueryKeys.deck(deck.id) });
      }
    }
  }

  async function recoverRemotePublish(operation?: SavedReviewedPublish) {
    if (running || findingPublish || (operation && !operation.canResume)) return;
    const generation = getSessionGeneration();
    if (!readSessionUser()?.groups.includes('super_admin')) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const current = () => !controller.signal.aborted && generation === getSessionGeneration();
    setFindingPublish(true);
    setSavedPublishMessage('');
    try {
      if (!operation) {
        const result = await findReviewedPublish(deckId);
        if (!current()) return;
        if (!result.success) throw new Error(result.error?.message ?? 'Could not find a saved publication.');
        const batch = result.data?.batch ?? null;
        setSavedPublish(batch);
        if (batch?.jobId) {
          setPublishResult({ jobId: batch.jobId });
          if (batch.canResume) setSavedPublishMessage('The publish job exists. Resume delivery of the same job.');
        }
        else setSavedPublishMessage(!batch ? 'No saved reviewed publication for this account and deck.' :
          batch.canResume ? 'Import confirmed. Resume publishing this reviewed batch.' :
            'The deck changed after import. Review the current contents before publishing.');
      } else {
        const result = await publishReviewedImport(deckId, operation.operationId, controller.signal);
        if (!current()) return;
        if (!result.success || !result.data?.jobId) throw new Error(result.error?.message ?? 'Publication was not confirmed. Check the saved publication again.');
        setPublishResult({ jobId: result.data.jobId });
        setSavedPublish(null);
      }
    } catch (error) {
      if (current()) setSavedPublishMessage(error instanceof Error ? error.message : 'Publication recovery failed.');
    } finally {
      if (current()) {
        setFindingPublish(false);
        abortRef.current = null;
      }
    }
  }

  function restart() {
    setStep('input');
    setPreview(null);
    setPreviewError(null);
    setRunResult(null);
    setProgress({ done: 0, total: 0 });
  }

  const unconfirmedCards = runResult?.batches.filter(batch => batch.state === 'unknown').reduce((count, batch) => count + batch.cards, 0) ?? 0;
  const failedCards = runResult?.batches.filter(batch => batch.state === 'failed').reduce((count, batch) => count + batch.cards, 0) ?? 0;

  const backLink = invalidDeckId ? '/' : cardListHref(deckId, origin);

  if (deckState.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-600 text-lg">Loading deck...</div>
      </div>
    );
  }

  if (deckState.error || !deck) {
    return (
      <ConsoleShell
        title={CONSOLE_NAME}
        subtitle="Authoring · Import"
        {...consoleNav()}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-slate-800">Import cards</h1>
          <Link to="/" className="text-sm text-indigo-600 hover:text-indigo-800">
            ← Back to Decks
          </Link>
        </div>
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
            <div className="font-semibold mb-1">Failed to load deck</div>
            <div className="text-sm">{deckState.error ?? 'Unknown error'}</div>
          </div>
        </div>
      </ConsoleShell>
    );
  }

  return (
    <ConsoleShell
      title={CONSOLE_NAME}
      subtitle="Authoring · Import"
      {...consoleNav()}
    >
      <DeckWorkspaceHeader deck={deck} view="cards" cardListSearch={origin?.cardListSearch} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">
            Import cards · <span className="font-mono text-base">{deck.slug}</span>
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Step {step === 'input' ? '1 of 3 · source' : step === 'preview' ? '2 of 3 · preview' : '3 of 3 · execute'}
          </p>
        </div>
        {running ? (
          <span aria-disabled="true" className="text-sm text-slate-400">
            ← Back to Cards
          </span>
        ) : (
          <Link to={backLink} className="text-sm text-indigo-600 hover:text-indigo-800">
            ← Back to Cards
          </Link>
        )}
      </div>

      <div className="max-w-4xl space-y-4">
        {(jobId || publishResult?.refusal) && (
          <div role="status" className="rounded border border-slate-200 bg-white px-4 py-3 text-sm">
            {publishResult?.refusal ?? (
              publication.isError ? 'Could not check the publish job.' :
              publication.data?.status === 'FAILED' ? (publication.data.errorMessage ?? 'Publish failed.') :
              publication.data?.status === 'SUCCESS' && publication.data.cdnVerificationState === 'verified' && publication.data.buildIsLive && publication.data.manifestState === 'delivered' ? 'Published and verified on the CDN.' :
              publication.data?.cdnVerificationState === 'needs_attention' || publication.data?.manifestState === 'needs_attention' || publication.data?.dispatchExhausted
                ? 'Publication needs attention. Check the job status.'
                : publication.data?.status === 'SUCCESS' && publication.data.buildIsLive === false ? 'This build is no longer live.'
                : 'Publishing and verifying the card pack.'
            )}
            {jobId && <span className="ml-2 break-all">Job {jobId}</span>}
            {publication.isError && <button type="button" className="ml-2 text-indigo-600"
              disabled={publication.isFetching} onClick={() => void publication.refetch()}>Check status again</button>}
          </div>
        )}
        {recoveryError ? <div role="alert" className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded text-sm">{recoveryError}</div> : null}
        {recovery && !recovery.reviewedPublish?.jobId ? (
          <section aria-label="Saved import recovery" className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded space-y-3">
            <p className="text-sm" role="status">{recovery.reviewedPublish ? 'A reviewed batch needs recovery. The original import and publish identity will be reused.' : 'A saved import needs recovery. Committed batches will be kept. Unconfirmed batches are checked before any resend.'}</p>
            {recovery.reviewedPublish?.notice && <p className="text-sm">{recovery.reviewedPublish.notice}</p>}
            <button type="button" disabled={running || recoveryLoading || !!recoveryError}
              className="px-3 py-2 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              onClick={() => void execute([], recovery)}>{running ? 'Checking saved import...' : 'Recover saved import'}</button>
          </section>
        ) : null}

        {step === 'input' ? (
          <section className="bg-white rounded-lg shadow-sm border border-slate-200">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-800">1 · Source</h2>
              <p className="text-xs text-slate-500 mt-1">
                Paste or load a Deck Markdown file, or load a reviewed JSON batch.
                The preview matches cards by stable UID and checks reviewed versions before import.
              </p>
            </div>

            <div className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.txt,.json,text/markdown,text/plain,application/json"
                  className="text-sm text-slate-600"
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                />
                {!hasReviewedDeckRelease(deck) && (
                  <button type="button" className="text-sm text-indigo-600 hover:text-indigo-800"
                    onClick={() => void copyCardVersions()}>
                    Copy card versions
                  </button>
                )}
                {readSessionUser()?.groups.includes('super_admin') && !hasReviewedDeckRelease(deck) && (
                  <button type="button" className="text-sm text-indigo-600 hover:text-indigo-800"
                    disabled={findingPublish || running || recoveryLoading || Boolean(recovery)}
                    onClick={() => void recoverRemotePublish()}>Find saved publication</button>
                )}
                {fileName ? (
                  <span className="text-xs text-slate-500 font-mono">{fileName}</span>
                ) : null}
              </div>

              {savedPublishMessage && <p role="status" className="text-sm text-slate-600">{savedPublishMessage}</p>}
              {savedPublish?.canResume && (
                <button type="button" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:bg-slate-300"
                  disabled={findingPublish || running || Boolean(recovery)} onClick={() => void recoverRemotePublish(savedPublish)}>
                  Resume saved publication
                </button>
              )}
              {baselineMessage && <p role="status" className="text-sm text-slate-600">{baselineMessage}</p>}

              {fileError ? (
                <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">
                  {fileError}
                </div>
              ) : null}

              <textarea
                aria-label="Deck Markdown"
                className="w-full h-80 font-mono text-xs border border-slate-300 rounded-md px-3 py-2
                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
                spellCheck={false}
                placeholder={'# deck: your-deck-slug\n\n## card-uid-001 | d2\nQ:\nQuestion text\nA:\nAnswer text'}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setFileName(null);
                }}
              />

              {previewError ? (
                <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">
                  {previewError}
                </div>
              ) : null}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={previewing || !text.trim() || recoveryLoading || !!recovery || !!recoveryError}
                  className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium
                             bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800
                             disabled:bg-slate-300 disabled:cursor-not-allowed
                             focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  onClick={() => void buildPreview()}
                >
                  {previewing ? 'Reading deck...' : 'Preview import'}
                </button>
                <span className="text-xs text-slate-500">
                  Nothing is written until you confirm on the next step.
                </span>
              </div>
            </div>
          </section>
        ) : null}

        {step === 'preview' && preview ? (
          <>
            <section className="bg-white rounded-lg shadow-sm border border-slate-200">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-800">2 · Preview</h2>
                <button
                  type="button"
                  className="text-sm px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
                  onClick={() => setStep('input')}
                >
                  ← Edit source
                </button>
              </div>

              <div className="p-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge label="create" count={preview.plan.creates.length} tone={ACTION_CLASSES.create} />
                  <Badge label="update" count={preview.plan.updates.length} tone={ACTION_CLASSES.update} />
                  <Badge label="unchanged" count={preview.plan.unchanged.length} tone={ACTION_CLASSES.unchanged} />
                  <Badge label="conflict" count={preview.plan.conflicts.length} tone={ACTION_CLASSES.conflict} />
                  <Badge label="parse errors" count={preview.parsed.errors.length} tone={ACTION_CLASSES.conflict} />
                </div>

                {preview.slugMismatch ? (
                  <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">
                    This document targets deck{' '}
                    <span className="font-mono">{preview.slugMismatch}</span>, but you are importing
                    into <span className="font-mono">{deck.slug}</span>. Fix the{' '}
                    <span className="font-mono"># deck:</span> header or open the right deck.
                  </div>
                ) : null}

                {preview.parsed.errors.length > 0 ? (
                  <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded">
                    <div className="font-semibold text-sm mb-1">
                      {preview.parsed.errors.length} problem
                      {preview.parsed.errors.length === 1 ? '' : 's'} in the document
                    </div>
                    <ul className="text-xs font-mono space-y-1 max-h-64 overflow-y-auto">
                      {preview.parsed.errors.map((issue, i) => (
                        <li key={`${issue.code}-${issue.line}-${i}`}>{formatIssue(issue)}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {translationClears > 0 ? (
                  <div
                    data-testid="import-translation-clears"
                    className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm"
                  >
                    <div className="font-semibold">
                      {translationClears} card{translationClears === 1 ? ' has' : 's have'} a Chinese translation on the
                      server that this document leaves out.
                    </div>
                    <p className="mt-1 text-xs">
                      The import writes whole cards, so importing them deletes those translations. Add their{' '}
                      <span className="font-mono">_ZH</span> sections to the document, or confirm below.
                    </p>
                    <label className="mt-2 flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={preview.clearTranslations}
                        onChange={(e) => setClearTranslations(e.target.checked)}
                      />
                      Delete the Chinese translation of {translationClears === 1 ? 'this card' : `these ${translationClears} cards`}
                    </label>
                  </div>
                ) : null}

                {warnings.length > 0 ? (
                  <div data-testid="import-warnings" className="bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 rounded">
                    <div className="font-semibold text-sm mb-1">
                      {warnings.length} suggestion
                      {warnings.length === 1 ? '' : 's'} — not blocking
                    </div>
                    {groupWarnings(warnings).map(([code, items]) => (
                      <div key={code} className="mt-1">
                        <div className="text-xs font-semibold">{code} ({items.length})</div>
                        <ul className="text-xs font-mono space-y-1 max-h-64 overflow-y-auto">
                          {items.map((warning, i) => (
                            <li key={`${warning.stableUid}-${warning.line}-${i}`}>{formatWarning(warning)}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </section>

            {preview.parsed.cards.length > 0 ? (
              <RarityDistribution cards={preview.parsed.cards} />
            ) : null}

            <section className="bg-white rounded-lg shadow-sm border border-slate-200">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">Cards in this document</h3>
                <span className="text-xs text-slate-500">{preview.parsed.cards.length} parsed</span>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Line</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">StableUid</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Diff</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Question</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Action</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {toRows(preview.plan).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-slate-500 text-sm">
                          No cards parsed from this document.
                        </td>
                      </tr>
                    ) : (
                      toRows(preview.plan).map((row) => (
                        <tr
                          key={`${row.card.stableUid}-${row.card.sourceLine}`}
                          className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-3 py-2 text-slate-500 font-mono text-xs">{row.card.sourceLine}</td>
                          <td className="px-3 py-2 text-slate-700 font-mono text-xs">{row.card.stableUid}</td>
                          <td className="px-3 py-2 text-slate-700">d{row.card.difficulty}</td>
                          <td className="px-3 py-2 text-slate-800">{truncate(row.card.question)}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-block px-2 py-0.5 rounded border text-xs ${ACTION_CLASSES[row.kind]}`}>
                              {row.kind}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{row.detail}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-3">
                <button
                  type="button"
                  disabled={blocked || actions.length === 0 || running}
                  className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium
                             bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800
                             disabled:bg-slate-300 disabled:cursor-not-allowed
                             focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  onClick={() => void execute(actions)}
                >
                  {preview.publishBaseline ? 'Import only' : `Import ${actions.length} card${actions.length === 1 ? '' : 's'}`}
                </button>
                {preview.publishBaseline && (
                  <button
                    type="button"
                    disabled={blocked || actions.length === 0 || running || previewing}
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-slate-300"
                    onClick={() => void execute(actions, undefined, preview.publishBaseline ?? undefined)}
                  >
                    Import and publish {actions.length} card{actions.length === 1 ? '' : 's'}
                  </button>
                )}

                <button
                  type="button"
                  className="text-sm px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
                  disabled={previewing}
                  onClick={() => void buildPreview()}
                >
                  Refresh reconciliation
                </button>

                <span className="text-xs text-slate-500">
                  {blocked
                    ? 'Fix the problems above before importing.'
                    : actions.length === 0
                      ? 'Everything in this document already matches the deck.'
                      : `${preview.plan.unchanged.length} card(s) will be left alone.`}
                </span>
              </div>
            </section>
          </>
        ) : null}

        {step === 'result' ? (
          <section className="bg-white rounded-lg shadow-sm border border-slate-200">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-800">3 · Execute</h2>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <div className="flex items-center justify-between text-sm text-slate-600 mb-1">
                  <span>{running ? 'Writing cards...' : unconfirmedCards > 0 ? 'Needs confirmation' : 'Finished'}</span>
                  <span className="font-mono text-xs">
                    {progress.done} / {progress.total}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div
                    className="flex-1 h-2 bg-slate-100 rounded overflow-hidden"
                    role="progressbar"
                    aria-label="Import progress"
                    aria-valuemin={0}
                    aria-valuemax={progress.total}
                    aria-valuenow={progress.done}
                  >
                    <div
                      className="h-full bg-indigo-600 transition-all"
                      style={{
                        width: `${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}%`,
                      }}
                    />
                  </div>
                  {running ? (
                    <button
                      type="button"
                      disabled={cancelling}
                      className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium
                                 border border-slate-300 text-slate-700 hover:bg-slate-50
                                 disabled:cursor-not-allowed disabled:text-slate-400"
                      onClick={() => {
                        abortRef.current?.abort();
                        setCancelling(true);
                      }}
                    >
                      {cancelling ? 'Cancelling...' : 'Cancel import'}
                    </button>
                  ) : null}
                </div>
              </div>

              {runResult ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Badge label="created" count={runResult.created} tone={ACTION_CLASSES.create} />
                    <Badge label="updated" count={runResult.updated} tone={ACTION_CLASSES.update} />
                    <Badge label="failed" count={failedCards} tone={ACTION_CLASSES.conflict} />
                    <Badge label="unconfirmed" count={unconfirmedCards} tone={ACTION_CLASSES.conflict} />
                    <span className="text-xs text-slate-500 self-center">
                      counts describe the most recent run
                    </span>
                  </div>

                  {runResult.cancelled ? (
                    <div className="bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 rounded text-sm">
                      Import cancelled. {runResult.created} created and {runResult.updated} updated
                      before it stopped; {runResult.notRun} not written. Re-run the preview before
                      importing again.
                    </div>
                  ) : null}

                  {runResult.failures.length > 0 ? (
                    <div className="bg-red-50 border border-red-200 rounded px-3 py-2">
                      <div className="font-semibold text-sm text-red-800 mb-1">
                        {unconfirmedCards > 0
                          ? `${unconfirmedCards} card${unconfirmedCards === 1 ? ' needs' : 's need'} confirmation`
                          : `${failedCards} card${failedCards === 1 ? '' : 's'} failed`}
                      </div>
                      <ul className="text-xs text-red-800 space-y-1 max-h-64 overflow-y-auto">
                        {runResult.failures.map((failure) => (
                          <li key={failure.stableUid}>
                            <span className="font-mono">{failure.stableUid}</span>:{' '}
                            {describeFailure(failure)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : runResult.cancelled || runResult.notRun > 0 ? (
                    <p className="text-sm text-amber-900">Import stopped before all planned writes were confirmed.</p>
                  ) : (
                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 rounded text-sm">
                      All planned writes succeeded.
                    </div>
                  )}

                  <ul className="mt-4 space-y-2 text-sm" aria-label="Import batch results">
                    {runResult.batches.map(batch => (
                      <li key={batch.operationId} className="break-words">
                        {batch.cards} cards: {batch.state === 'unknown' ? 'Result unconfirmed' : batch.state === 'committed' ? 'Committed' : 'Rejected'}.
                        {' '}Operation <code>{batch.operationId}</code>
                      </li>
                    ))}
                    {runResult.notRun > 0 ? <li>{runResult.notRun} cards were not attempted.</li> : null}
                  </ul>

                  <div className="flex items-center gap-3">
                    {runResult.failures.length > 0 || runResult.cancelled ? (
                      <button
                        type="button"
                        disabled={running || !!recovery}
                        className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium
                                   bg-indigo-600 text-white hover:bg-indigo-700
                                   disabled:bg-slate-300 disabled:cursor-not-allowed"
                        onClick={() => void buildPreview()}
                      >
                        Re-run the preview
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={!!recovery}
                        className="text-sm px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => void buildPreview()}
                      >
                        Re-run the preview
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={!!recovery}
                      className="text-sm px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={restart}
                    >
                      Start over
                    </button>

                    <Link
                      to={backLink}
                      className="text-sm text-indigo-600 hover:text-indigo-800"
                    >
                      Back to cards →
                    </Link>
                  </div>
                </>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </ConsoleShell>
  );
}
