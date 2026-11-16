import { lazy, useState, type FormEvent } from 'react';
import { Link, Route, Routes, useOutletContext } from 'react-router-dom';
import { useLearners } from '../hooks/useConsoleOperations';
import { ConsolePage } from '../components/console/OperationsViews';
import { LearnerLoading, LearnerReadError } from '../components/console/LearnerViews';
import { learnerTime as time } from '../lib/learnerView';
import { INPUT, LINK } from '../lib/consoleOperationsView';
import { Button } from '../components/ui/Button';
import { LearnerWorkspace, type DirectoryContext } from './LearnerWorkspace';
import '../styles/learners.css';

const LearnerDetailPage = lazy(() => import('./LearnerDetailPage').then(module => ({ default: module.LearnerDetailPage })));

export function LearnersPage() {
  return <Routes><Route element={<LearnerWorkspace />}><Route index element={<LearnerDirectory />} /><Route path=":sub" element={<LearnerDetailPage />} /></Route></Routes>;
}

function LearnerDirectory() {
  const { directory, setDirectory } = useOutletContext<DirectoryContext>();
  const [validation, setValidation] = useState<string | null>(null);
  const query = useLearners(directory.query, directory.cursors.at(-1));
  const data = query.data;

  function search(event: FormEvent) {
    event.preventDefault();
    const value = directory.draft.trim();
    if (value.length > 128 || Array.from(directory.draft).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      setValidation('Use at most 128 characters without control characters.');
      return;
    }
    setValidation(null);
    if (value === directory.query && directory.cursors.length === 1) void query.refetch();
    else setDirectory(current => ({ ...current, query: value, cursors: [undefined] }));
  }

  return <ConsolePage title="User management">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <p className="max-w-prose text-sm learner-copy text-slate-600">Find an App user and review their account, membership access and received learning records.</p>
      <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? 'Refreshing…' : 'Refresh list'}</Button>
    </div>

    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label="User directory">
      <form onSubmit={search} className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4 learner-panel-padding">
        <div className="w-full sm:max-w-md">
          <label htmlFor="learner-search" className="mb-2 block text-sm font-medium text-slate-900">Search users</label>
          <input id="learner-search" type="search" className={INPUT} value={directory.draft} placeholder="Email or user ID" onChange={event => setDirectory(current => ({ ...current, draft: event.target.value }))} aria-invalid={!!validation} aria-describedby={validation ? 'learner-search-error' : undefined} autoComplete="off" spellCheck={false} />
          {validation && <p id="learner-search-error" role="alert" className="mt-2 text-sm text-red-700">{validation}</p>}
        </div>
        <Button type="submit" disabled={query.isFetching}>Search</Button>
        {(directory.draft || directory.query) && <Button variant="ghost" disabled={query.isFetching} onClick={() => { setValidation(null); setDirectory({ draft: '', query: '', cursors: [undefined] }); }}>Clear search</Button>}
      </form>

      {query.isPending && <LearnerLoading />}
      {query.error && <div className="p-6 space-y-3"><LearnerReadError error={query.error} /><Button variant="outline" onClick={() => void query.refetch()}>Try again</Button></div>}
      {data && !query.error && <>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 learner-cell-padding text-sm text-slate-600" aria-live="polite"><p>{data.items.length} users on this page{directory.query ? ' · Search applied' : ''}</p><p>Page {directory.cursors.length}</p></div>
        {data.items.length === 0 ? <div className="space-y-2 px-6 py-12 text-center"><h2 className="font-semibold text-slate-900">{directory.query ? 'No users match this search' : directory.cursors.length > 1 ? 'No users on this page' : 'No connected users yet'}</h2><p className="text-sm text-slate-600">{directory.query ? 'Check the email or user ID, or clear the search to try again.' : directory.cursors.length > 1 ? 'Records may have changed. Try the previous page or refresh the list.' : 'Users appear here after their App account connects to the backend.'}</p></div>
          : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <caption className="sr-only">Backend-observed App users, sorted by user ID</caption>
            <thead className="bg-slate-50 text-slate-600"><tr><th scope="col" className="px-4 py-3 learner-cell-padding font-medium">User</th><th scope="col" className="hidden px-4 py-3 font-medium learner-first-connected">First connected</th><th scope="col" className="hidden px-4 py-3 font-medium learner-last-connected">Last connected</th><th scope="col" className="hidden px-4 py-3 font-medium learner-app">Last reported App</th><th scope="col" className="px-4 py-3 learner-cell-padding font-medium learner-actions">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{data.items.map(learner => <tr key={learner.sub} className="align-top hover:bg-slate-50">
              <td className="max-w-xs px-4 py-4 learner-cell-padding"><Link className={`${LINK} break-all font-medium`} to={`/learners/${encodeURIComponent(learner.sub)}`}>{learner.email ?? 'Email not recorded'}</Link><p className="mt-1 break-all font-mono text-xs text-slate-500">{learner.sub}</p><p className="mt-2 text-xs text-slate-600 learner-last-mobile">Last connected: {time(learner.lastServerActivityAt)}</p></td>
              <td className="hidden px-4 py-4 text-slate-600 tabular-nums learner-first-connected">{time(learner.firstObservedAt)}</td>
              <td className="hidden px-4 py-4 text-slate-600 tabular-nums learner-last-connected">{time(learner.lastServerActivityAt)}</td>
              <td className="hidden px-4 py-4 text-slate-600 learner-app">{learner.lastReportedPlatform ?? 'Not reported'}<span className="mt-1 block text-xs">{learner.lastReportedVersion ?? 'Version not reported'}</span></td>
              <td className="px-4 py-4 learner-cell-padding learner-actions"><Link className={`${LINK} inline-block whitespace-nowrap py-1`} aria-label={`View ${learner.email ?? learner.sub} profile`} to={`/learners/${encodeURIComponent(learner.sub)}`}>View profile</Link></td>
            </tr>)}</tbody>
          </table></div>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-4 learner-cell-padding">
          <p className="text-xs text-slate-600">Up to 25 users per page · Sorted by user ID</p>
          <div className="flex gap-3"><Button size="sm" variant="outline" disabled={directory.cursors.length === 1 || query.isFetching} onClick={() => setDirectory(current => ({ ...current, cursors: current.cursors.slice(0, -1) }))}>Previous page</Button><Button size="sm" variant="outline" disabled={!data.nextCursor || query.isFetching} onClick={() => setDirectory(current => ({ ...current, cursors: [...current.cursors, data.nextCursor!] }))}>Next page</Button></div>
        </div>
      </>}
    </section>
    <details className="text-sm text-slate-600"><summary className="cursor-pointer rounded py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Directory scope and time definitions</summary><p className="mt-2 max-w-prose learner-copy">This directory contains backend-observed accounts, not all registrations. First connected is the backend record creation time. Last connected is server activity, not a login or a completed sync. All times are UTC.</p>{data && <p className="mt-2">Read at: {time(data.fetchedAt)} · Paging cutoff: {time(data.asOf)}. New accounts after this cutoff are excluded. Profile changes and deletions may still affect the results.</p>}</details>
  </ConsolePage>;
}
