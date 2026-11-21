import { useConsoleIdentity } from '../../hooks/useConsoleIdentity';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ConsoleReadError, type Operations, type SourceState } from '../../api/consoleOperations';
import { ConsoleShell } from './ConsoleShell';
import { consoleNav } from './consoleNav';
import { CONSOLE_NAME } from '../../lib/brand';
import { Callout } from '../ui/Callout';

import { formatTime as time, PANEL, HEADING, LINK } from '../../lib/consoleOperationsView';

export function ConsolePage({ title, children }: { title: string; children: ReactNode }) {
  const identity = useConsoleIdentity();
  return <ConsoleShell title={CONSOLE_NAME} subtitle={title} {...consoleNav()} superAdmin={identity.allowed}>
    <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
    {identity.allowed ? children : <Callout tone="warning" title="Super administrator access required">Sign in with an authorized console account to view this page. <Link className={LINK} to="/">Return to decks</Link></Callout>}
  </ConsoleShell>;
}
export function ReadError({ error, historical = false }: { error: unknown; historical?: boolean }) {
  const failure = error instanceof ConsoleReadError ? error : new ConsoleReadError('READ_FAILED');
  return <Callout tone="danger" role="alert" title="Could not refresh this view">
    {failure.message} {historical ? 'The previous read below is historical; current status is unknown.' : ''}
    {failure.traceId && <span className="block mt-1">Support reference: {failure.traceId}</span>}
  </Callout>;
}
export function Fields({ items }: { items: [string, ReactNode][] }) {
  return <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3 text-sm">{items.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-slate-600">{label}</dt><dd className="mt-1 text-slate-900 break-words tabular-nums">{value}</dd></div>)}</dl>;
}
export function Source({ value }: { value: SourceState }) {
  return <div className="text-sm space-y-1 text-slate-700">
    <p><strong>{value.state === 'stale' ? 'Stale — historical results' : value.state === 'unknown' ? 'Unknown — no current evidence' : 'Fresh sample'}</strong> · {value.state === 'fresh' ? value.status : 'current status unknown'}</p>
    <p className="break-words">Source: {value.source}{value.reason ? ` · Reason: ${value.reason.replaceAll('_', ' ')}` : ''}</p>
    <p>Observed: {time(value.observedAt)} · Read: {time(value.fetchedAt)} · Expires: {time(value.expiresAt)}</p>
  </div>;
}
export function SafeExternalLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href || !/^https:\/\//i.test(href)) return <span className="text-slate-600">{children}: not configured</span>;
  return <a className={LINK} href={href} target="_blank" rel="noopener noreferrer">{children} (opens new tab)</a>;
}
export function OperationsSummary({ data, historical = false }: { data: Operations; historical?: boolean }) {
  return <section className={PANEL} id="operational-sources" aria-label="Operational sources" tabIndex={-1}>
    <h2 className={HEADING}>Operational sources</h2>
    <p className="text-sm text-slate-600">Read at {time(data.fetchedAt)}. Source samples may be older than this read.</p>
    <div className="divide-y divide-slate-200">{([['Synthetic checks', data.synthetic], ['CloudWatch alarms', data.alarms], ['Database', data.database], ['Publishing', data.publishing]] as [string, SourceState][]).map(([title, source]) => <div key={title} className="py-3 space-y-1"><h3 className="font-semibold text-slate-900">{title}</h3><Source value={historical && source.state !== 'unknown' ? { ...source, state: 'stale', status: 'unknown' } : source} /></div>)}</div>
  </section>;
}
