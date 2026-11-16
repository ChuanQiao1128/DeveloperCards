import { Link } from 'react-router-dom';
import { useOperations } from '../hooks/useConsoleOperations';
import { ConsolePage, OperationsSummary, ReadError, SafeExternalLink } from '../components/console/OperationsViews';
import { HEADING, LINK, PANEL, formatTime as time } from '../lib/consoleOperationsView';
import { Button } from '../components/ui/Button';

export function OperationsPage() {
  const query = useOperations();
  const data = query.data;
  return <ConsolePage title="Operations">
    <div className="flex flex-wrap justify-between gap-3 items-center"><p className="text-sm text-slate-600">Sources refresh once per minute while this view is visible. All times are UTC.</p><Button variant="outline" loading={query.isFetching} onClick={() => void query.refetch()}>Refresh sources</Button></div>
    {query.isPending && <p role="status">Loading operational sources…</p>}
    {query.error && <ReadError error={query.error} historical={!!data} />}
    {data && <>
      <OperationsSummary data={data} historical={!!query.error} />
      <section className={PANEL}><h2 className={HEADING}>Synthetic checks</h2><p className="text-sm text-slate-600">API health checks liveness. Anonymous auth and sync guards check rejection; they do not establish authenticated sync health.</p>
        {data.synthetic.checks.length === 0 ? <p>No check results available; status is unknown.</p> : <ul className="divide-y divide-slate-200">{data.synthetic.checks.map(check => <li key={check.name} className="py-2 text-sm flex flex-wrap justify-between gap-2"><span className="font-medium">{check.name}{check.advisory ? ' (advisory)' : ''}</span><span>{check.status} · HTTP {check.httpStatus ?? 'unknown'} · {check.latencyMs ?? 'unknown'} ms{check.code ? ` · ${check.code}` : ''}</span></li>)}</ul>}
      </section>
      <section className={PANEL}><h2 className={HEADING}>CloudWatch alarms</h2><p className="text-sm text-slate-600">OK means the alarm is not firing. It does not prove service health or sufficient traffic.</p>{data.alarms.items.length === 0 ? <p>No alarm observations available; status is unknown.</p> : <ul className="divide-y divide-slate-200">{data.alarms.items.map(alarm => <li key={alarm.name} className="py-2 text-sm"><span className="font-medium break-words">{alarm.name}</span> · {alarm.state} · Updated: {time(alarm.stateUpdatedAt)}</li>)}</ul>}</section>
      <section className={PANEL}><h2 className={HEADING}>Recent publishing jobs</h2><p className="text-sm text-slate-600">Stored job state does not confirm delivery to a learner device.</p>{data.publishing.items.length === 0 ? <p>{data.publishing.state === 'unknown' ? 'Publishing source unavailable.' : 'No recent publishing jobs.'}</p> : <ul className="divide-y divide-slate-200">{data.publishing.items.map(job => <li key={job.jobId} className="py-3 text-sm space-y-1"><p className="break-words font-medium">{job.deckSlug ?? 'Unknown deck'} · {job.status}</p><p className="break-words">Job: {job.jobId} · Release: {job.releaseId ?? 'Unknown'} · Build: {job.buildId ?? 'Unknown'}</p><p>Updated: {time(job.updatedAt)} · Device delivery: unknown</p>{job.href && /^\/decks\/release(?:\?|$)/.test(job.href) && <Link className={LINK} to={job.href}>Inspect publishing job</Link>}</li>)}</ul>}{data.publishing.truncated && <p className="text-sm text-slate-600">Showing the most recent 20 jobs.</p>}</section>
      <div className="flex flex-wrap gap-4 text-sm"><SafeExternalLink href={data.links.cloudWatch}>CloudWatch</SafeExternalLink><SafeExternalLink href={data.links.sentry}>Sentry</SafeExternalLink></div>
    </>}
  </ConsolePage>;
}
