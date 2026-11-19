import { lazy, useState, type FormEvent } from 'react';
import { Link, Route, Routes, useOutletContext } from 'react-router-dom';
import { DEFAULT_MEMBERSHIP_FILTERS, type MembershipFilters } from '../api/consoleOperations';
import { useLearners } from '../hooks/useConsoleOperations';
import { ConsolePage } from '../components/console/OperationsViews';
import { DirectoryMembership, LearnerLoading, LearnerReadError } from '../components/console/LearnerViews';
import { learnerTime as time } from '../lib/learnerView';
import { INPUT, LINK } from '../lib/consoleOperationsView';
import { Button } from '../components/ui/Button';
import { LearnerWorkspace, type DirectoryContext } from '../features/learners/LearnerWorkspace';
import '../styles/learners.css';

const LearnerDetailPage = lazy(() => import('../features/learners/LearnerDetail').then(module => ({ default: module.LearnerDetailPage })));

export function LearnersPage() {
  return <Routes><Route element={<LearnerWorkspace />}><Route index element={<LearnerDirectory />} /><Route path=":sub" element={<LearnerDetailPage />} /></Route></Routes>;
}

function LearnerDirectory() {
  const { directory, setDirectory } = useOutletContext<DirectoryContext>();
  const [validation, setValidation] = useState<string | null>(null);
  const query = useLearners(directory.query, directory.cursors.at(-1), directory.filters);
  const data = query.data;
  const filtered = Object.values(directory.filters).some(value => value !== 'all');
  function setFilter<K extends keyof MembershipFilters>(key: K, value: MembershipFilters[K]) {
    setDirectory(current => ({ ...current, filters: { ...current.filters, [key]: value }, cursors: [undefined] }));
  }

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

  return <ConsolePage title="App users">
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
        {(directory.draft || directory.query) && <Button variant="ghost" disabled={query.isFetching} onClick={() => { setValidation(null); setDirectory(current => ({ ...current, draft: '', query: '', cursors: [undefined] })); }}>Clear search</Button>}
        <fieldset className="w-full space-y-3"><legend className="sr-only">Membership filters</legend><div className="learner-filters">
          <label className="learner-filter text-sm font-medium text-slate-900">Membership<select aria-label="Membership filter" className={`${INPUT} mt-2`} value={directory.filters.membership} disabled={query.isFetching} onChange={event => setFilter('membership', event.target.value as MembershipFilters['membership'])}><option value="all">All users</option><option value="premium">Premium access</option><option value="free">No active premium access</option><option value="unknown">Unknown access</option></select></label>
          <label className="learner-filter text-sm font-medium text-slate-900">Source<select aria-label="Membership source" className={`${INPUT} mt-2`} value={directory.filters.source} disabled={query.isFetching} onChange={event => setFilter('source', event.target.value as MembershipFilters['source'])}><option value="all">All sources</option><option value="production">Production subscription</option><option value="sandbox">Sandbox subscription</option><option value="legacy">Manual or legacy grant</option><option value="none">No premium record</option><option value="unknown">Unknown source</option></select></label>
          <label className="learner-filter text-sm font-medium text-slate-900">Access expiry<select aria-label="Access expiry" className={`${INPUT} mt-2`} value={directory.filters.expiry} disabled={query.isFetching} onChange={event => setFilter('expiry', event.target.value as MembershipFilters['expiry'])}><option value="all">Any expiry</option><option value="next7">Ends in 7 days</option><option value="next30">Ends in 30 days</option><option value="expired">Expired access</option></select></label>
        </div>{filtered && <Button variant="ghost" size="sm" disabled={query.isFetching} onClick={() => setDirectory(current => ({ ...current, filters: DEFAULT_MEMBERSHIP_FILTERS, cursors: [undefined] }))}>Reset filters</Button>}</fieldset>
      </form>

      {query.isPending && <LearnerLoading />}
      {query.error && <div className="p-6 space-y-3"><LearnerReadError error={query.error} /><Button variant="outline" onClick={() => void query.refetch()}>Try again</Button></div>}
      {data && !query.error && <>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 learner-cell-padding text-sm text-slate-600" aria-live="polite"><p>{data.items.length} users on this page{directory.query || filtered ? ' · Filters applied' : ''}</p><p>Page {directory.cursors.length}</p></div>
        {data.items.length === 0 ? <div className="space-y-2 px-6 py-12 text-center"><h2 className="font-semibold text-slate-900">{directory.query ? 'No users match this search' : filtered ? 'No users match these filters' : directory.cursors.length > 1 ? 'No users on this page' : 'No connected users yet'}</h2><p className="text-sm text-slate-600">{directory.query ? 'Check the email or user ID, or clear the search to try again.' : filtered ? 'Try a different membership, source or expiry filter.' : directory.cursors.length > 1 ? 'Records may have changed. Try the previous page or refresh the list.' : 'Users appear here after their App account connects to the backend.'}</p></div>
          : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <caption className="sr-only">Backend-observed App users, sorted by user ID</caption>
            <thead className="bg-slate-50 text-slate-600"><tr><th scope="col" className="px-4 py-3 learner-cell-padding font-medium">User</th><th scope="col" className="hidden px-4 py-3 font-medium learner-last-connected">Membership</th><th scope="col" className="hidden px-4 py-3 font-medium learner-last-connected">Access ends</th><th scope="col" className="hidden px-4 py-3 font-medium learner-app">Last connected</th><th scope="col" className="px-4 py-3 learner-cell-padding font-medium learner-actions">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{data.items.map(learner => <tr key={learner.sub} className="align-top hover:bg-slate-50">
              <td className="max-w-xs px-4 py-4 learner-cell-padding"><Link className={`${LINK} break-all font-medium`} to={`/learners/${encodeURIComponent(learner.sub)}`}>{learner.email ?? 'Email not recorded'}</Link><p className="mt-1 break-all font-mono text-xs text-slate-500">{learner.sub}</p><div className="mt-2 learner-last-mobile"><DirectoryMembership membership={learner.membership} /><p className="mt-2 text-xs text-slate-600">Access ends: {learner.membership?.expiresAt ? time(learner.membership.expiresAt) : 'Not provided'}</p><p className="mt-2 text-xs text-slate-600">Last connected: {time(learner.lastServerActivityAt)}</p></div></td>
              <td className="hidden px-4 py-4 learner-last-connected"><DirectoryMembership membership={learner.membership} /></td><td className="hidden px-4 py-4 text-slate-600 tabular-nums learner-last-connected">{learner.membership?.expiresAt ? time(learner.membership.expiresAt) : learner.membership?.source === 'none' ? '—' : 'Not provided'}</td>
              <td className="hidden px-4 py-4 text-slate-600 tabular-nums learner-app">{time(learner.lastServerActivityAt)}</td>
              <td className="px-4 py-4 learner-cell-padding learner-actions"><Link className={`${LINK} inline-block whitespace-nowrap py-1`} aria-label={`View ${learner.email ?? learner.sub} profile`} to={`/learners/${encodeURIComponent(learner.sub)}`}>View profile</Link></td>
            </tr>)}</tbody>
          </table></div>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-4 learner-cell-padding">
          <p className="text-xs text-slate-600">Up to 25 users per page · Sorted by user ID</p>
          <div className="flex gap-3"><Button size="sm" variant="outline" disabled={directory.cursors.length === 1 || query.isFetching} onClick={() => setDirectory(current => ({ ...current, cursors: current.cursors.slice(0, -1) }))}>Previous page</Button><Button size="sm" variant="outline" disabled={!data.nextCursor || query.isFetching} onClick={() => setDirectory(current => ({ ...current, cursors: [...current.cursors, data.nextCursor!] }))}>Next page</Button></div>
        </div>
      </>}
    </section>
    <details className="text-sm text-slate-600"><summary className="cursor-pointer rounded py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Directory scope and time definitions</summary><p className="mt-2 max-w-prose learner-copy">This directory contains backend-observed accounts, not all registrations. Last connected is server activity, not a login or a completed sync. Access expiry is evaluated at the paging cutoff; selected-deck grants can have different expiry dates. Membership access and premium download permission are separate. Missing membership data remains unknown. All times are UTC.</p>{data && <p className="mt-2">Read at: {time(data.fetchedAt)} · Paging cutoff: {time(data.asOf)}. New accounts after this cutoff are excluded. Profile changes and deletions may still affect the results.</p>}</details>
  </ConsolePage>;
}
