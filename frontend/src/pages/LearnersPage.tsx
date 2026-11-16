import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useConsoleIdentity } from '../hooks/useConsoleIdentity';
import { useLearners } from '../hooks/useConsoleOperations';
import { ConsolePage, ReadError } from '../components/console/OperationsViews';
import { INPUT, LINK, PANEL, formatTime as time } from '../lib/consoleOperationsView';
import { Button } from '../components/ui/Button';

export function LearnersPage() {
  const identity = useConsoleIdentity();
  return <LearnerDirectory key={identity.generation} />;
}
function LearnerDirectory() {
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState({ query: '', cursors: [undefined] as (string | undefined)[] });
  const [validation, setValidation] = useState<string | null>(null);
  const cursor = search.cursors.at(-1);
  const query = useLearners(search.query, cursor);
  const data = query.data;
  return <ConsolePage title="Learners">
    <p className="text-sm text-slate-600 max-w-prose">This directory contains accounts observed by the backend, not all Cognito registrations. First observed is the database record creation time; server activity is not a login or a completed sync.</p>
    <form className="flex flex-wrap gap-3 items-end" onSubmit={event => { event.preventDefault(); const value = draft.trim(); if (value.length > 128 || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) { setValidation('Use at most 128 characters without control characters.'); return; } setValidation(null); if (value === search.query && search.cursors.length === 1) void query.refetch(); else setSearch({ query: value, cursors: [undefined] }); }}>
      <div className="w-full sm:max-w-md"><label htmlFor="learner-search" className="block text-sm font-medium text-slate-900 mb-1">Search email or subject</label><input id="learner-search" className={INPUT} value={draft} onChange={event => setDraft(event.target.value)} aria-invalid={!!validation} aria-describedby="learner-search-help" autoComplete="off" /><p id="learner-search-help" className="mt-1 text-sm text-slate-600">Literal contains search. Search stays in this page’s memory.</p>{validation && <p role="alert" className="text-sm text-red-700">{validation}</p>}</div>
      <Button type="submit" loading={query.isFetching}>Search</Button><Button variant="outline" loading={query.isFetching} onClick={() => void query.refetch()}>Refresh page</Button>
    </form>
    {query.isPending && <p role="status">Loading observed learners…</p>}
    {query.error && <ReadError error={query.error} />}
    {data && !query.error && <section className={PANEL} aria-label="Observed learners">
      <p className="text-sm text-slate-600">Read: {time(data.fetchedAt)} · Paging cutoff: {time(data.asOf)} · Page {search.cursors.length}</p>
      <p className="text-sm text-slate-600">New records after the cutoff are excluded. Deletions and changes to email or activity may appear during paging; this is a live read.</p>
      {data.items.length === 0 ? <p>No observed learners match this search.</p> : <ul className="divide-y divide-slate-200">{data.items.map(learner => <li key={learner.sub} className="py-4 space-y-2"><Link className={`${LINK} break-all font-medium`} to={`/learners/${encodeURIComponent(learner.sub)}`}>{learner.email ?? learner.sub}</Link><p className="break-all text-sm text-slate-600">Subject: {learner.sub}</p><div className="grid gap-2 md:grid-cols-3 text-sm text-slate-700"><p>First observed: {time(learner.firstObservedAt)}</p><p>Last server activity: {time(learner.lastServerActivityAt)}</p><p>Last reported app: {learner.lastReportedPlatform ?? 'Unknown'} / {learner.lastReportedVersion ?? 'Unknown'}</p></div></li>)}</ul>}
      <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={search.cursors.length === 1 || query.isFetching} onClick={() => setSearch(current => ({ ...current, cursors: current.cursors.slice(0, -1) }))}>Previous page</Button><Button variant="outline" disabled={!data.nextCursor || query.isFetching} onClick={() => setSearch(current => ({ ...current, cursors: [...current.cursors, data.nextCursor!] }))}>Next page</Button></div>
    </section>}
  </ConsolePage>;
}
