import { Link } from 'react-router-dom';
import type { PublishJob } from '../../../api/authoring';
import { LINK, PANEL } from '../../../lib/consoleOperationsView';
import { formatDeckTime } from '../../../lib/deckTime';
import { publishJobStage } from '../publishJobStage';

export interface PublishJobsPanelProps {
  jobs: PublishJob[];
  onRefresh: () => void;
}

export function PublishJobsPanel({ jobs, onRefresh }: PublishJobsPanelProps) {
  return (
    <section className={PANEL} aria-label="Recent publish jobs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-900">Recent publish jobs</h2>
        <button type="button" onClick={onRefresh} className={`${LINK} text-sm`}>Refresh jobs</button>
      </div>
      {jobs.length === 0 ? <p className="py-4 text-sm text-slate-600">No publish jobs yet.</p> : (
        <ul className="divide-y divide-slate-200 border-t border-slate-200">
          {jobs.map(job => (
            <li key={job.jobId} className="flex flex-wrap items-start justify-between gap-3 py-4 text-sm">
              <div className="min-w-0">
                <p className="break-words font-medium text-slate-900">{job.deckTitle || job.deckSlug}</p>
                <p className="mt-1 text-xs text-slate-600">{formatDeckTime(job.createdAt)}</p>
                <p className={`mt-1 font-medium ${job.status === 'FAILED' ? 'text-red-700'
                  : job.status === 'SUCCESS' && job.manifestState === 'delivered' ? 'text-emerald-700' : 'text-slate-700'}`}>
                  {job.dispatchExhausted ? 'Queue delivery needs attention' : publishJobStage(job)}
                </p>
                {job.errorMessage && <p data-testid="publish-job-error" className="mt-1 break-words text-xs text-slate-600">{job.errorMessage}</p>}
                {job.note && <p className="mt-1 break-words text-xs text-slate-600">{job.note}</p>}
              </div>
              <Link className={`${LINK} inline-flex min-h-11 items-center`} to={`/decks/publish-jobs/${encodeURIComponent(job.jobId)}`} aria-label={`View job ${job.jobId}`}>View job</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
