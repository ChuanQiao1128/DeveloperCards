import { lazy, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import { fetchPublishJob, fetchPublishJobs, type PublishJob } from '../api/authoring';
import { getSessionGeneration } from '../auth/tokenStore';
import { ConsoleShell } from '../components/console/ConsoleShell';
import { consoleNav } from '../components/console/consoleNav';
import { DeckBuildsPanel } from '../components/console/DeckBuildsPanel';
import { DeckWorkspaceHeader } from '../components/console/DeckWorkspaceHeader';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { useConfirm } from '../components/ui/ConfirmDialogContext';
import { confirmDeckPublish } from '../features/deckList/confirmDeckPublish';
import { PUBLISH_JOBS_HREF, publishJobStage } from '../features/deckList/publishJobStage';
import { useConsoleIdentity } from '../hooks/useConsoleIdentity';
import { useDeck, usePublishDeck } from '../hooks/useDecks';
import { CONSOLE_NAME } from '../lib/brand';
import { formatTime, HEADING, LINK, PANEL } from '../lib/consoleOperationsView';
import { hasReviewedDeckRelease } from '../lib/deckWorkspace';
import { isQaPublishGateCode, qaPageHref } from '../lib/qaGate';
import type { ApiError } from '../types/api';
import type { Deck } from '../types/deck';

const ContentReleasePage = lazy(() => import('./ContentReleasePage').then(m => ({ default: m.ContentReleasePage })));

function isInProgress(job: Pick<PublishJob, 'status' | 'manifestState'>): boolean {
  return job.status === 'PENDING' || job.status === 'PROCESSING' || (job.status === 'SUCCESS' && job.manifestState === 'pending');
}

function jobLabel(job: Pick<PublishJob, 'status' | 'manifestState'>): string {
  if (job.status === 'PENDING') return 'Queued';
  if (job.status === 'PROCESSING') return 'Building';
  if (job.status === 'FAILED') return 'Failed';
  if (job.manifestState === 'delivered') return 'Build complete · index updated';
  const stage = publishJobStage(job);
  return stage === 'SUCCESS' ? 'Build complete' : stage;
}

function jobHref(jobId: string): string {
  return `/decks/publish-jobs/${encodeURIComponent(jobId)}`;
}

export function DeckPublicationPage({ view }: { view: 'publishing' | 'versions' }) {
  const [params] = useSearchParams();
  const identity = useConsoleIdentity();
  const deckId = Number(params.get('deckId'));
  const validId = Number.isSafeInteger(deckId) && deckId > 0;
  const reviewedEditor = view === 'publishing' && deckId === 15
    && Boolean(identity.sub && identity.user?.groups.includes('editor'));
  const canRead = identity.allowed || reviewedEditor;
  const deck = useDeck(validId && canRead ? deckId : Number.NaN);
  const reviewed = deck.data ? hasReviewedDeckRelease(deck.data) : false;
  const subtitle = view === 'versions' ? 'Published versions' : 'Publishing';
  let content;
  if (!validId) {
    content = <Callout title="Choose a deck" tone="warning"><Link className={LINK} to="/">Return to decks</Link></Callout>;
  } else if (!canRead || (deck.isSuccess && !identity.allowed && !reviewed)) {
    content = <Callout title="Super administrator access required" tone="warning"><Link className={LINK} to="/">Return to decks</Link></Callout>;
  } else if (deck.isError) {
    content = <Callout role="alert" title="Could not load this deck" tone="danger">
      <p>{deck.error.message}</p>
      <Button variant="outline" onClick={() => void deck.refetch()}>Retry</Button>
    </Callout>;
  } else if (deck.data && deck.data.id !== deckId) {
    content = <Callout role="alert" tone="danger" title="The returned deck does not match the selected deck"><Link className={LINK} to="/">Return to decks</Link></Callout>;
  } else if (!deck.data) {
    content = <p role="status">Loading deck…</p>;
  } else {
    const deckKey = `${identity.generation}:${deckId}`;
    if (view === 'publishing' && reviewed) {
      return (
        <ContentReleasePage key={deckKey} deck={deck.data}>
          {identity.allowed && <DeckPublishing deck={deck.data} generation={identity.generation} superAdmin />}
        </ContentReleasePage>
      );
    }
    content = <>
      <DeckWorkspaceHeader deck={deck.data} view={view} />
      {view === 'versions' ? (
        <DeckBuildsPanel key={deckKey} deckId={deckId} deckSlug={deck.data.slug} canRollback={!reviewed} />
      ) : (
        <DeckPublishing key={deckKey} deck={deck.data} generation={identity.generation} superAdmin={identity.allowed} />
      )}
    </>;
  }

  return <ConsoleShell title={CONSOLE_NAME} subtitle={subtitle} {...consoleNav()}>{content}</ConsoleShell>;
}

function DeckPublishing({ deck, generation, superAdmin }: { deck: Deck; generation: number; superAdmin: boolean }) {
  const reviewed = hasReviewedDeckRelease(deck);
  const confirm = useConfirm();
  const publish = usePublishDeck();
  const mounted = useRef(false);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [submittedJob, setSubmittedJob] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ApiError | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [retryActionId, setRetryActionId] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const recent = useQuery({
    queryKey: ['deck-publishing-recent', generation, deck.id],
    enabled: superAdmin,
    refetchOnMount: 'always',
    queryFn: async () => {
      const res = await fetchPublishJobs();
      if (!res.success || !res.data) throw new Error('Could not load recent publish jobs.');
      return res.data.filter(job => job.deckId == null ? job.deckSlug === deck.slug : job.deckId === deck.id).slice(0, 5);
    },
  });
  const trackedJob = reviewed ? undefined : submittedJob ?? recent.data?.[0]?.jobId;
  const olderJobs = recent.data?.filter(job => job.jobId !== trackedJob) ?? [];
  const status = useQuery({
    queryKey: ['deck-publishing-status', generation, deck.id, trackedJob],
    enabled: superAdmin && Boolean(trackedJob),
    refetchOnMount: 'always',
    queryFn: async () => {
      const res = await fetchPublishJob(trackedJob!);
      if (!res.success || !res.data || res.data.jobId !== trackedJob) throw new Error('Could not check this job.');
      return res.data;
    },
    refetchInterval: query => {
      const job = query.state.data;
      return query.state.status !== 'error' && job && isInProgress(job) ? 5_000 : false;
    },
  });
  const activeJob = status.data;
  const statusPending = Boolean(trackedJob && status.isPending);
  const mayBeRunning = activeJob ? isInProgress(activeJob) : false;
  const submittedJobAdvanced = submittedJob && activeJob && !status.isError && activeJob.status !== 'PENDING';
  const retryAction = submittedJobAdvanced ? null : retryActionId;

  async function startPublish() {
    if (!superAdmin || reviewed || submitting.current || getSessionGeneration() !== generation) return;
    const canContinue = () => mounted.current && getSessionGeneration() === generation;
    submitting.current = true;
    setBusy(true);
    try {
      if (!retryAction) {
        const proceed = await confirmDeckPublish(options => canContinue() ? confirm(options) : Promise.resolve(false), deck.slug, deck.id);
        if (!proceed || !canContinue()) return;
        setSubmittedJob(null);
      }
      const actionId = retryAction ?? crypto.randomUUID();
      setFeedback(null);
      setAccepted(false);
      let replayKey: string | null = actionId;
      let result = await publish.mutateAsync({ id: deck.id, actionId });
      if (!canContinue()) return;
      // This refusal arrives before any write on servers without recovery support.
      if (!retryAction && result.error?.code === 'PUBLISH_RECOVERY_NOT_READY') {
        replayKey = null;
        result = await publish.mutateAsync({ id: deck.id });
        if (!canContinue()) return;
      }
      const jobId = result.data?.jobId;
      if (jobId) {
        setSubmittedJob(jobId);
        if (jobId === trackedJob) void status.refetch();
      }
      void recent.refetch();
      if (!result.success) {
        const failure = result.error ?? { code: 'PUBLISH_FAILED', message: 'Could not start publishing.' };
        setFeedback(failure);
        const ambiguous = (failure.httpStatus ?? 0) >= 500
          || ['PUBLISH_DISPATCH_UNCONFIRMED', 'TIMEOUT', 'NETWORK_ERROR'].includes(failure.code);
        setRetryActionId(ambiguous ? replayKey : null);
        return;
      }
      if (!jobId) setSubmittedJob(null);
      setRetryActionId(null);
      setAccepted(true);
    } catch (error) {
      if (canContinue()) setFeedback({ code: 'PUBLISH_FAILED', message: error instanceof Error ? error.message : 'Could not start publishing.' });
    } finally {
      submitting.current = false;
      if (canContinue()) setBusy(false);
    }
  }

  return (
    <>
      {!reviewed && <section className={PANEL} aria-labelledby="publish-deck-title">
        <h2 className={HEADING} id="publish-deck-title">Publish this deck</h2>
        <p className="text-sm text-slate-600">Publish the current editing content to the app. The server checks the deck before creating a new version.</p>
        <Button className="min-h-11"
            disabled={!retryAction && (statusPending || (!!trackedJob && (status.isError || mayBeRunning)))}
            loading={busy} onClick={() => void startPublish()}>
            {busy ? 'Preparing publish…' : retryAction ? 'Retry this request' : 'Publish deck'}
        </Button>
        {feedback && !(feedback.code === 'PUBLISH_DISPATCH_UNCONFIRMED' && submittedJobAdvanced) && <Callout tone="danger" role="alert" title="Publish needs attention">
          {feedback.message}
          {feedback.qaRun?.status === 'not_started' && <p>AI QA could not start a review run. {feedback.qaRun.message ?? feedback.qaRun.code}</p>}
          {isQaPublishGateCode(feedback.code) && <p><Link className={LINK} to={qaPageHref(deck.id, feedback.runId)}>Open AI QA</Link></p>}
        </Callout>}
        {accepted && !submittedJob && <p role="status" className="text-sm text-slate-700">The server accepted the request. Check recent jobs for its status.</p>}
      </section>}

      {superAdmin && <>
        {trackedJob && <section className={PANEL} aria-labelledby="tracked-job-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className={HEADING} id="tracked-job-title">{submittedJob ? 'Your publish job' : 'Latest publish job'}</h2>
            <Button variant="outline" size="sm" loading={status.isFetching} onClick={() => void status.refetch()}>Check job status</Button>
          </div>
          {status.isError ? <Callout role="alert" tone="warning">Could not check this job. Refresh its status before starting another publish.</Callout>
            : activeJob ? <div role="status" className="space-y-1 text-sm">
              <p className="font-medium">{jobLabel(activeJob)}</p>
              {activeJob.buildId && <p className="break-all text-slate-600">Build <span className="font-mono">{activeJob.buildId}</span></p>}
              {activeJob.errorMessage && <p className="break-words text-red-700">{activeJob.errorMessage}</p>}
              {activeJob.manifestError && <p className="break-words text-slate-700">{activeJob.manifestError}</p>}
            </div> : <p role="status" className="text-sm">Checking job status…</p>}
          <Link className={`${LINK} text-sm`} to={jobHref(trackedJob)}>View job details</Link>
        </section>}

        <section className={PANEL} aria-labelledby="recent-jobs-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className={HEADING} id="recent-jobs-title">Recent jobs for this deck</h2>
            <Button variant="outline" size="sm" loading={recent.isFetching} onClick={() => void recent.refetch()}>Refresh recent jobs</Button>
          </div>
          {reviewed && <p className="text-sm text-slate-600">Refresh to check past jobs. The batch status above tracks your current release.</p>}
          {recent.isError ? <Callout role="alert" tone="warning">Could not load recent jobs.</Callout>
            : recent.isPending ? <p role="status" className="text-sm">Loading recent jobs…</p>
              : !olderJobs.length ? <p className="text-sm text-slate-600">{trackedJob ? 'No other recent jobs for this deck.' : 'No jobs for this deck in the recent publish history.'}</p>
                : <ul className="divide-y divide-slate-200">
                  {olderJobs.map(job => <li className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm" key={job.jobId}>
                    <div>
                      <p className="font-medium">{jobLabel(job)}</p>
                      <p className="text-slate-600">{formatTime(String(new Date(job.createdAt)))}</p>
                    </div>
                    <Link className={LINK} to={jobHref(job.jobId)} aria-label={`View job ${job.jobId}`}>View job</Link>
                  </li>)}
                </ul>}
          <Link className={`${LINK} text-sm`} to={PUBLISH_JOBS_HREF}>All publish jobs</Link>
        </section>
      </>}
    </>
  );
}
