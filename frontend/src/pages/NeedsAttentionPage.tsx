import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { fetchPublishJob, fetchPublishJobs, type PublishJob } from '../api/authoring';
import { ConsolePage, Fields } from '../components/console/OperationsViews';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { PUBLISH_JOBS_HREF, publishJobStage } from '../features/deckList/publishJobStage';
import { useConsoleIdentity } from '../hooks/useConsoleIdentity';
import { HEADING, LINK, PANEL } from '../lib/consoleOperationsView';

const INACTIVE_RELEASES = new Set(['RELEASE_SUPERSEDED', 'RELEASE_ROLLED_BACK', 'REVIEW_REVOKED']);

function recentIssues(jobs: PublishJob[]) {
  const seen = new Set<number | string>();
  return jobs.filter(job => {
    // The jobs API returns the newest attempt first. A later attempt replaces the older issue.
    const deck = job.deckId ?? job.deckSlug;
    if (seen.has(deck)) return false;
    seen.add(deck);
    return (job.status === 'FAILED' && !INACTIVE_RELEASES.has(job.errorMessage ?? '')) ||
      (job.status === 'SUCCESS' && job.manifestState === 'needs_attention');
  });
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
    <ConsolePage title="Needs attention">
      <section className={PANEL}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className={HEADING}>Publishing issues</h2>
            <p className="mt-1 text-sm text-slate-600">Failures and index delivery issues on the latest recorded attempt per deck. Check the job before taking action.</p>
          </div>
          <Button variant="outline" loading={query.isFetching} onClick={() => void query.refetch()}>Refresh</Button>
        </div>
        {query.isPending ? <p role="status" className="mt-3 text-sm">Loading publishing issues…</p>
          : query.error ? <div className="mt-3"><Callout tone="danger" role="alert">Could not load publishing issues. Try refreshing.</Callout></div>
            : query.data.length === 0 ? <p className="mt-3 text-sm text-slate-600">No issues in the latest attempts.</p>
              : <ul className="mt-3 divide-y divide-slate-200 border-t border-slate-200">
                {query.data.map(job => <li key={job.jobId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-slate-900">{job.deckSlug}</p>
                    <p className="text-slate-600">{publishJobStage(job)}</p>
                  </div>
                  <Link className={LINK} to={`/decks/publish-jobs/${encodeURIComponent(job.jobId)}`} aria-label={`View publish job for ${job.deckSlug}`}>View publish job</Link>
                </li>)}
              </ul>}
        <Link className={`mt-3 inline-block text-sm ${LINK}`} to={PUBLISH_JOBS_HREF}>All publish jobs</Link>
      </section>
    </ConsolePage>
  );
}

export function PublishJobDetailPage() {
  const { jobId } = useParams();
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

  return (
    <ConsolePage title="Publish job">
      <nav className="flex flex-wrap gap-4 text-sm" aria-label="Publish job navigation">
        <Link to={PUBLISH_JOBS_HREF} className={LINK}>All publish jobs</Link>
        <Link to="/needs-attention" className={LINK}>Publishing issues</Link>
      </nav>
      <section className={PANEL} aria-label="Publish job status">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className={HEADING}>Job status</h2>
          <Button variant="outline" loading={query.isFetching} onClick={() => void query.refetch()}>Refresh</Button>
        </div>
        {query.isPending ? <p role="status" className="text-sm">Loading publish job…</p>
          : query.error ? <Callout tone="danger" role="alert">Could not load this publish job. Check the job ID and try again.</Callout>
            : <Fields items={[
              ['Job ID', query.data.jobId],
              ['Build ID', query.data.buildId],
              ['Status', publishJobStage(query.data)],
              ...(query.data.errorMessage ? [['Error', query.data.errorMessage] as [string, string]] : []),
              ...(query.data.manifestError ? [['Index error', query.data.manifestError] as [string, string]] : []),
              ...(query.data.manifestAttempts != null ? [['Index attempts', query.data.manifestAttempts] as [string, number]] : []),
            ]} />}
        <p className="mt-3 text-sm text-slate-600">Job status describes the server build and index. Use the saved release to verify the public card pack.</p>
      </section>
    </ConsolePage>
  );
}
