import { Link } from 'react-router-dom';
import type { Operations } from '../api/consoleOperations';
import { ConsolePage, OperationsSummary, ReadError, SafeExternalLink } from '../components/console/OperationsViews';
import { Button } from '../components/ui/Button';
import { useOperations } from '../hooks/useConsoleOperations';
import { HEADING, LINK, PANEL, formatTime as time } from '../lib/consoleOperationsView';

const CHECKS = '#synthetic-checks';
const ALARMS = '#cloudwatch-alarms';
const SOURCES = '#operational-sources';
const checkPriority = { failed: 0, degraded: 1, unknown: 2, healthy: 3 };
const alarmPriority = { ALARM: 0, INSUFFICIENT_DATA: 1, UNKNOWN: 2, OK: 3 };
const countLabel = (count: number, singular: string, plural = singular + 's') =>
  `${count} ${count === 1 ? singular : plural}`;

function OperationsTriage({ data, historical }: { data: Operations; historical: boolean }) {
  const checks = !historical && data.synthetic.state === 'fresh' ? data.synthetic.checks : [];
  const alarms = !historical && data.alarms.state === 'fresh' ? data.alarms.items : [];
  const affectedChecks = checks.filter(check => check.status === 'failed' || check.status === 'degraded');
  const core = affectedChecks.filter(check => !check.advisory).length;
  const advisory = affectedChecks.length - core;
  const firing = alarms.filter(alarm => alarm.state === 'ALARM').length;
  const missingChecks = checks.filter(check => check.status === 'unknown').length;
  const missingAlarms = alarms.filter(alarm => alarm.state === 'INSUFFICIENT_DATA' || alarm.state === 'UNKNOWN').length;
  const hasResults = checks.some(check => check.status !== 'unknown') ||
    alarms.some(alarm => alarm.state === 'OK' || alarm.state === 'ALARM');
  const signals = [
    { count: firing, label: countLabel(firing, 'firing alarm'), href: ALARMS },
    { count: core, label: countLabel(core, 'core check with a problem', 'core checks with problems'), href: CHECKS },
    { count: advisory, label: countLabel(advisory, 'advisory check with a problem', 'advisory checks with problems'), href: CHECKS },
  ].filter(signal => signal.count > 0);
  const sources = [
    { title: 'Synthetic checks', source: data.synthetic, href: CHECKS, empty: data.synthetic.checks.length === 0 },
    { title: 'CloudWatch alarms', source: data.alarms, href: ALARMS, empty: data.alarms.items.length === 0 },
    { title: 'Database', source: data.database, href: SOURCES, empty: data.database.reachable === null },
    { title: 'Publishing', source: data.publishing, href: '#recent-publishing', empty: false },
  ];
  const gaps = sources
    .filter(({ source, empty }) => historical || source.state !== 'fresh' || empty)
    .map(({ title, source, href }) => ({
      title, href,
      detail: source.state === 'unknown' ? 'Unavailable' : historical || source.state === 'stale' ? 'Historical sample' : 'No results',
    }));

  return <section className={PANEL} aria-labelledby="triage-heading">
    <div>
      <h2 className={HEADING} id="triage-heading">Latest observations</h2>
      <p className="mt-1 text-sm text-slate-600">Read at {time(data.fetchedAt)}. Monitoring samples have their own observation times.</p>
    </div>
    <div className="grid gap-4 border-t border-slate-200 pt-3 md:grid-cols-2 md:gap-6">
      <div className="space-y-2">
        <h3 className="font-semibold text-slate-900">Signals to investigate</h3>
        {signals.length > 0 ? <ul className="space-y-1 text-sm">
          {signals.map(signal => <li key={signal.label}><a className={LINK} href={signal.href}>{signal.label}</a></li>)}
        </ul> : <p className="text-sm text-slate-700">{hasResults
          ? 'No failed or degraded checks or firing alarms in the available samples.'
          : 'Current check and alarm results are unavailable.'}</p>}
      </div>
      <div className="space-y-2 md:border-l md:border-slate-200 md:pl-6">
        <h3 className="font-semibold text-slate-900">Monitoring coverage</h3>
        {gaps.length || missingChecks || missingAlarms ? <ul className="space-y-1 text-sm text-slate-700">
          {gaps.map(gap => <li key={gap.title}><a className={LINK} href={gap.href}>{gap.title}</a> · {gap.detail}</li>)}
          {missingChecks > 0 && <li><a className={LINK} href={CHECKS}>{countLabel(missingChecks, 'check')}</a> without a result</li>}
          {missingAlarms > 0 && <li><a className={LINK} href={ALARMS}>{countLabel(missingAlarms, 'alarm')}</a> with insufficient or unknown data</li>}
        </ul> : <p className="text-sm text-slate-700">All monitored sources returned current evidence.</p>}
      </div>
    </div>
  </section>;
}

function EvidenceLabel({ state, historical }: { state: Operations['synthetic']['state']; historical: boolean }) {
  if (state === 'unknown') return <p className="text-sm font-medium text-slate-700">Current sample unavailable</p>;
  if (historical || state === 'stale') return <p className="text-sm font-medium text-amber-900">Historical sample · current status unknown</p>;
  return null;
}

export function OperationsPage() {
  const query = useOperations();
  const data = query.data;
  const historical = !!query.error;
  return <ConsolePage title="Operations">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-600">Refreshes every minute while visible. All times are UTC.</p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link className={LINK} to="/needs-attention">Publishing issues</Link>
        <Button variant="outline" loading={query.isFetching} onClick={() => void query.refetch()}>Refresh sources</Button>
      </div>
    </div>
    {query.isPending && <p role="status">Loading operational sources…</p>}
    {query.error && <ReadError error={query.error} historical={!!data} />}
    {data && <>
      <OperationsTriage data={data} historical={historical} />
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <SafeExternalLink href={data.links.cloudWatch}>CloudWatch dashboard</SafeExternalLink>
        <SafeExternalLink href={data.links.sentry}>Sentry</SafeExternalLink>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <section className={`${PANEL} min-w-0`} id="synthetic-checks" aria-labelledby="synthetic-heading" tabIndex={-1}>
          <h2 className={HEADING} id="synthetic-heading">Synthetic checks</h2>
          <EvidenceLabel state={data.synthetic.state} historical={historical} />
          <p className="text-sm text-slate-600">API health checks liveness. Anonymous auth and sync guards test whether unauthenticated requests are rejected.</p>
          {data.synthetic.checks.length === 0 ? <p className="text-sm">No check results available.</p> :
            <ul className="divide-y divide-slate-200">{[...data.synthetic.checks].sort((a, b) => checkPriority[a.status] - checkPriority[b.status]).map(check =>
              <li key={check.name} className="py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 break-words font-medium">{check.name}{check.advisory ? ' (advisory)' : ''}</span>
                  <span className="capitalize">{check.status}</span>
                </div>
                <p className="break-words text-xs text-slate-600">HTTP {check.httpStatus ?? 'unknown'} · {check.latencyMs == null ? 'Latency unknown' : `${check.latencyMs} ms`}{check.code ? ` · ${check.code}` : ''}</p>
              </li>)}</ul>}
        </section>
        <section className={`${PANEL} min-w-0`} id="cloudwatch-alarms" aria-labelledby="alarms-heading" tabIndex={-1}>
          <h2 className={HEADING} id="alarms-heading">CloudWatch alarms</h2>
          <EvidenceLabel state={data.alarms.state} historical={historical} />
          <p className="text-sm text-slate-600">OK means the alarm is not firing. Check traffic and other signals when assessing service health.</p>
          {data.alarms.items.length === 0 ? <p className="text-sm">No alarm observations available.</p> :
            <ul className="divide-y divide-slate-200">{[...data.alarms.items].sort((a, b) => alarmPriority[a.state] - alarmPriority[b.state]).map(alarm =>
              <li key={alarm.name} className="space-y-1 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 break-words font-medium">{alarm.name}</span>
                  <span className={alarm.state === 'ALARM' && data.alarms.state === 'fresh' && !historical ? 'font-medium text-red-800' : 'text-slate-700'}>{alarm.state}</span>
                </div>
                <p className="text-xs text-slate-600">State updated {time(alarm.stateUpdatedAt)}</p>
              </li>)}</ul>}
        </section>
      </div>
      <section className={PANEL} id="recent-publishing" aria-labelledby="publishing-heading" tabIndex={-1}>
        <h2 className={HEADING} id="publishing-heading">Recent publishing jobs</h2>
        <EvidenceLabel state={data.publishing.state} historical={historical} />
        {data.publishing.items.length === 0 ? <p className="text-sm">{data.publishing.state === 'unknown' ? 'Publishing source unavailable.' : 'No recent publishing jobs.'}</p> :
          <ul className="divide-y divide-slate-200">{data.publishing.items.map(job =>
            <li key={job.jobId} className="space-y-1 py-3 text-sm">
              <p className="break-words font-medium">{job.deckSlug ?? 'Unknown deck'} · {job.status}</p>
              <p className="break-words">Job {job.jobId} · Release {job.releaseId ?? 'Unknown'} · Build {job.buildId ?? 'Unknown'}</p>
              <p className="text-slate-600">Updated {time(job.updatedAt)} · Device delivery unknown</p>
              {job.jobId && <Link className={`${LINK} inline-flex min-h-11 items-center`} to={`/decks/publish-jobs/${encodeURIComponent(job.jobId)}`}
                state={{ from: 'operations' }} aria-label={`Inspect publishing job ${job.jobId}`}>Inspect publishing job</Link>}
            </li>)}</ul>}
        {data.publishing.truncated && <p className="text-sm text-slate-600">Showing the most recent 20 jobs.</p>}
      </section>
      <OperationsSummary data={data} historical={historical} />
    </>}
  </ConsolePage>;
}
