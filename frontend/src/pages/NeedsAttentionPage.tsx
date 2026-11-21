import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';

import { fetchPublishJob, fetchPublishJobs, type PublishJob } from '../api/authoring';
import { ConsolePage, Fields } from '../components/console/OperationsViews';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { PUBLISH_JOBS_HREF, publishJobStage } from '../features/deckList/publishJobStage';
import { useConsoleIdentity } from '../hooks/useConsoleIdentity';
import { HEADING, LINK, PANEL } from '../lib/consoleOperationsView';
import { formatDeckTime } from '../lib/deckTime';

const INACTIVE_RELEASES = new Set(['RELEASE_SUPERSEDED', 'RELEASE_ROLLED_BACK', 'REVIEW_REVOKED']);
const ISSUE_LABELS = {
  dispatch: 'Queue delivery needs attention',
  build: 'Build failed',
  timeout: 'Job timed out',
  index: 'Index delivery needs attention',
};
type JobIssue = keyof typeof ISSUE_LABELS;
type IssueEvidence = Pick<PublishJob, 'status' | 'errorMessage' | 'manifestState' | 'dispatchExhausted' | 'buildIsLive'>;

function issueFor(job: IssueEvidence): JobIssue | null {
  if (job.status === 'FAILED' && !INACTIVE_RELEASES.has(job.errorMessage ?? '')) {
    return job.errorMessage === 'orphaned: no worker pickup' ? 'timeout' : 'build';
  }
  if (job.status === 'PENDING' && job.dispatchExhausted) return 'dispatch';
  if (job.status === 'SUCCESS' && job.manifestState === 'needs_attention' && job.buildIsLive !== false) return 'index';
  return null;
}

function recentIssues(jobs: PublishJob[]) {
  const seen = new Set<number | string>();
  return jobs.flatMap(job => {
    // The recent jobs API is newest first. A later attempt replaces an older issue.
    const deck = job.deckId ?? job.deckSlug;
    if (seen.has(deck)) return [];
    seen.add(deck);
    const issue = issueFor(job);
    return issue && job.deckAvailable !== false ? [{ job, issue }] : [];
  });
}

function issueTime(job: Partial<Pick<PublishJob, 'createdAt' | 'updatedAt'>>, issue: JobIssue | null): [string, string] {
  if (issue === 'build' || issue === 'timeout') {
    const failedAt = formatDeckTime(job.updatedAt, 'Unknown');
    if (failedAt !== 'Unknown') return ['Failed', failedAt];
  }
  // Delivery states do not have a recorded failure timestamp.
  return ['Submitted', formatDeckTime(job.createdAt, 'Unknown')];
}

function IssueBadge({ issue }: { issue: JobIssue }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${issue === 'build' || issue === 'timeout' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'}`}>
      {ISSUE_LABELS[issue]}
    </span>
  );
}

export function NeedsAttentionPage() {
  const identity = useConsoleIdentity();
  const query = useQuery({
    queryKey: ['publishing-issues', identity.sub, identity.generation],
    enabled: identity.allowed,
    retry: false,
    gcTime: 0,
    queryFn: async () => {
      const result = await fetchPublishJobs();
      if (!result.success || !result.data) throw new Error('Publishing issues unavailable');
      return recentIssues(result.data);
    },
  });

  return (
    <ConsolePage title="Publishing issues">
      <section className={PANEL} aria-label="Recent publishing issues">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">Latest attempt per deck from the 100 most recent publish jobs.</p>
          <Button variant="outline" loading={query.isFetching} onClick={() => void query.refetch()}>Refresh issues</Button>
        </div>
        {query.isPending ? <p role="status" className="text-sm">Loading publishing issues…</p>
          : query.isError ? <Callout tone="danger" role="alert">Could not load publishing issues. Refresh to try again.</Callout>
            : query.data.length === 0 ? <p className="text-sm text-slate-600">No publishing issues in the latest attempts.</p>
              : <ul className="divide-y divide-slate-200 border-t border-slate-200">
                {query.data.map(({ job, issue }) => {
                  const [timeLabel, time] = issueTime(job, issue);
                  return <li key={job.jobId} className="grid items-start gap-3 py-4 text-sm sm:grid-cols-3">
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-slate-900">{job.deckTitle || job.deckSlug}</p>
                      {job.deckTitle && job.deckTitle !== job.deckSlug && <p className="break-all font-mono text-xs text-slate-600">{job.deckSlug}</p>}
                    </div>
                    <div className="space-y-1">
                      <IssueBadge issue={issue} />
                      <p className="text-xs tabular-nums text-slate-600">{timeLabel} · {time}</p>
                    </div>
                    <div className="sm:text-right">
                      <Link className={`${LINK} inline-flex min-h-11 items-center`} to={`/decks/publish-jobs/${encodeURIComponent(job.jobId)}`}
                        aria-label={`View publish job for ${job.deckTitle || job.deckSlug}`}>View publish job</Link>
                    </div>
                  </li>;
                })}
              </ul>}
        <Link className={`${LINK} inline-block text-sm`} to={PUBLISH_JOBS_HREF}>All publish jobs</Link>
      </section>
    </ConsolePage>
  );
}

export function PublishJobDetailPage() {
  const { jobId } = useParams();
  const fromOperations = useLocation().state?.from === 'operations';
  const identity = useConsoleIdentity();
  const query = useQuery({
    queryKey: ['publish-job', identity.sub, identity.generation, jobId],
    enabled: identity.allowed && Boolean(jobId),
    retry: false,
    gcTime: 0,
    queryFn: async () => {
      const result = await fetchPublishJob(jobId!);
      if (!result.success || !result.data || result.data.jobId !== jobId) throw new Error('Publishing job unavailable');
      return result.data;
    },
  });
  const job = query.isSuccess ? query.data : null;
  const issue = job && issueFor(job);
  const historicalIndexIssue = job?.status === 'SUCCESS' && job.manifestState === 'needs_attention' && job.buildIsLive === false;
  const deckId = job?.deckId;
  const canOpenDeck = job?.deckAvailable !== false && typeof deckId === 'number' && Number.isSafeInteger(deckId) && deckId > 0;

  return (
    <ConsolePage title="Publish job">
      <nav className="flex flex-wrap gap-4 text-sm" aria-label="Publish job navigation">
        <Link to={fromOperations ? '/operations' : '/needs-attention'} className={LINK}>
          {fromOperations ? 'Back to Operations' : 'Back to publishing issues'}
        </Link>
        <Link to={PUBLISH_JOBS_HREF} className={LINK}>All publish jobs</Link>
      </nav>
      <section className={PANEL} aria-label="Publish job status">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className={`${HEADING} break-words`}>{job?.deckTitle || job?.deckSlug || 'Job status'}</h2>
            {job?.deckTitle && job.deckSlug && job.deckTitle !== job.deckSlug && <p className="break-all font-mono text-xs text-slate-600">{job.deckSlug}</p>}
          </div>
          <Button variant="outline" loading={query.isFetching} onClick={() => void query.refetch()}>Refresh status</Button>
        </div>
        {query.isPending && <p role="status" className="text-sm">Loading publish job…</p>}
        {query.isError && <Callout tone="danger" role="alert">Could not load this publish job. Check the job ID and refresh.</Callout>}
        {job && <>
          {issue ? <IssueBadge issue={issue} /> : <p className="text-sm font-medium">{historicalIndexIssue ? 'Historical index delivery failure' : publishJobStage(job)}</p>}
          <Fields items={[
            ['Job ID', job.jobId],
            ['Build ID', job.buildId],
            issueTime(job, issue),
            ...(issue === 'dispatch' && job.dispatchAttempts != null ? [['Queue attempts', job.dispatchAttempts] as [string, number]] : []),
            ...(job.manifestAttempts != null ? [['Index attempts', job.manifestAttempts] as [string, number]] : []),
          ]} />
          {job.errorMessage && <Callout tone="danger" title="Job error"><p className="break-words">{job.errorMessage}</p></Callout>}
          {job.manifestError && <Callout tone="warning" title="Index error"><p className="break-words">{job.manifestError}</p></Callout>}
          {issue === 'dispatch' && <p className="text-sm text-slate-600">Queue delivery could not be confirmed.</p>}
          {canOpenDeck && <Link className={`${LINK} inline-flex min-h-11 items-center text-sm font-medium`} to={`/decks/publish?deckId=${deckId}`}>Open deck publishing</Link>}
          {job.deckAvailable === false && <p className="text-sm text-slate-600">This deck is no longer available.</p>}
        </>}
      </section>
    </ConsolePage>
  );
}
