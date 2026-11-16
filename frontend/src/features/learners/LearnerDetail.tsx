import { useId, useState, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ConsoleReadError } from '../../api/consoleOperations';
import { useConsoleIdentity } from '../../hooks/useConsoleIdentity';
import { useLearner } from '../../hooks/useConsoleOperations';
import { ConsolePage, Fields } from '../../components/console/OperationsViews';
import { CopyUserId, LearnerLoading, LearnerReadError, MembershipBadge } from '../../components/console/LearnerViews';
import { downloadDecision, entitlementSource, learnerNumber as number, learnerTime as time } from '../../lib/learnerView';
import { HEADING, LINK, PANEL } from '../../lib/consoleOperationsView';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';

const TABS = ['Account', 'Membership', 'Learning'] as const;

export function LearnerDetailPage() {
  const identity = useConsoleIdentity();
  const { sub = '' } = useParams();
  return <LearnerProfile key={`${identity.generation}:${sub}`} sub={sub} />;
}

function LearnerProfile({ sub }: { sub: string }) {
  const [tab, setTab] = useState(0);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const tabId = useId();
  const query = useLearner(sub, cursors.at(-1));
  const data = query.error instanceof ConsoleReadError && ['NOT_FOUND', 'FORBIDDEN'].includes(query.error.code) ? undefined : query.data;
  const effective = data?.entitlements.effective;
  const rc = data?.entitlements.revenueCat;

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); setTab(next);
    document.getElementById(`${tabId}-tab-${next}`)?.focus();
  }

  return <ConsolePage title="User profile">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link className={LINK} to="/learners">Back to users</Link><Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? 'Refreshing…' : 'Refresh profile'}</Button></div>
    {query.isPending && <LearnerLoading />}
    {query.error && <div className="space-y-3"><LearnerReadError error={query.error} historical={!!data} /><Button variant="outline" onClick={() => void query.refetch()}>Try again</Button></div>}
    {data && effective && rc && <>
      <section className="rounded-lg border border-slate-200 bg-white p-4 learner-panel-padding space-y-4" aria-label="User summary">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="min-w-0 break-all text-xl font-semibold text-slate-900">{data.learner.email ?? 'Email not recorded'}</h2><MembershipBadge entitlements={data.entitlements} /></div>
        <CopyUserId sub={data.learner.sub} />
        <div className="border-t border-slate-100 pt-4"><Fields items={[
          ['First connected', time(data.learner.firstObservedAt)], ['Last connected', time(data.learner.lastServerActivityAt)], ['Profile read at', time(data.fetchedAt)],
        ]} /></div>
      </section>
      <div role="tablist" aria-label="User profile sections" className="flex gap-2 border-b border-slate-200">
        {TABS.map((label, index) => <button key={label} type="button" role="tab" id={`${tabId}-tab-${index}`} aria-selected={tab === index} aria-controls={tab === index ? `${tabId}-panel` : undefined} tabIndex={tab === index ? 0 : -1} onClick={() => setTab(index)} onKeyDown={event => moveTab(event, index)} className={`rounded px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${tab === index ? 'learner-tab-selected text-indigo-800 bg-indigo-50' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}
      </div>
      <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-tab-${tab}`} tabIndex={0} className="space-y-4 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
        {tab === 0 && <>
          <section className={PANEL}><h2 className={HEADING}>Account details</h2><Fields items={[
            ['Email', data.learner.email ?? 'Email not recorded'], ['Last reported platform', data.learner.lastReportedPlatform ?? 'Not reported'], ['Last reported App version', data.learner.lastReportedVersion ?? 'Not reported'],
          ]} /><p className="text-sm learner-copy text-slate-600">These are the latest details reported by the App. Login status, email verification and current device versions are not collected by this view.</p></section>
          <section className={PANEL}><h2 className={HEADING}>Current access</h2><MembershipBadge entitlements={data.entitlements} /><p className="text-sm text-slate-700">{downloadDecision(effective.downloadReason)}</p><p className="text-sm text-slate-600">Access source: {entitlementSource(effective.entitlementsSource)}</p><Button variant="outline" size="sm" onClick={() => { setTab(1); document.getElementById(`${tabId}-tab-1`)?.focus(); }}>View membership</Button></section>
          <p className="max-w-prose text-sm learner-copy text-slate-600">First connected is the backend record creation time. Last connected is server activity. These are not signup, login or complete sync times. All times are UTC.</p>
        </>}
        {tab === 1 && <>
          {data.entitlements.state !== 'known' && <Callout tone="warning" title="Some membership sources are unavailable">Some sources are unavailable. Unknown access is not treated as free or absent.</Callout>}
          <section className={PANEL}><h2 className={HEADING}>Membership</h2><MembershipBadge entitlements={data.entitlements} /><Fields items={[
            ['Access source', entitlementSource(effective.entitlementsSource)], ['Premium downloads', effective.premiumDownloadEligible === null ? 'Unknown' : effective.premiumDownloadEligible ? 'Allowed' : 'Not allowed'], ['Access evaluated', time(data.entitlements.evaluatedAt)],
          ]} /><p className="text-sm learner-copy text-slate-700">{downloadDecision(effective.downloadReason)}</p><p className="text-sm learner-copy text-slate-600">Membership access and premium downloads are evaluated separately. Legacy grants may provide Premium access, while downloads require an eligible subscription. These records do not verify payment.</p></section>
          <section className={PANEL}><h2 className={HEADING}>Subscription record</h2>{rc.state === 'absent' ? <p className="text-sm text-slate-600">No subscription service record.</p> : rc.state === 'unknown' ? <p className="text-sm text-slate-600">Subscription service records are unavailable.</p> : <Fields items={[
            ['Source', 'RevenueCat'], ['Environment', rc.environment === 'production' ? 'Production' : rc.environment === 'sandbox' ? 'Sandbox' : 'Not recorded'], ['Product', rc.productId ?? 'Not recorded'], ['Subscription expiry', rc.expiresAtMs === null ? 'Expiry not provided' : time(new Date(rc.expiresAtMs).toISOString())], ['Record updated', time(rc.updatedAt)], ['Last subscription event', rc.lastEventAtMs === null ? 'No record' : time(new Date(rc.lastEventAtMs).toISOString())],
          ]} />}</section>
          <details className={PANEL}><summary className="cursor-pointer rounded font-medium text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Troubleshooting: subscription and legacy records</summary><Fields items={[
            ['Raw subscription active flag', rc.premiumActiveRaw === null ? 'Unknown' : rc.premiumActiveRaw ? 'Yes' : 'No'], ['Sandbox downloads blocked', effective.disallowSandboxPremium ? 'Yes' : 'No'], ['Development bypass', 'Not evaluated'],
          ]} /><p className="text-sm text-slate-600">The raw active flag must be evaluated with expiry and sandbox restrictions.</p><h3 className="font-medium text-slate-900">Legacy grants</h3>
            {data.entitlements.legacy.state === 'unknown' ? <p className="text-sm text-slate-600">Legacy source unavailable.</p> : data.entitlements.legacy.items.length === 0 ? <p className="text-sm text-slate-600">No legacy grants.</p> : <ul className="divide-y divide-slate-200">{data.entitlements.legacy.items.map((grant, index) => <li key={`${grant.key}:${index}`} className="py-3 text-sm space-y-1 break-words"><p className="font-medium">{grant.key} · {grant.tier}</p><p>Source: {grant.source} · Expires: {grant.expiresAt ? time(grant.expiresAt) : 'Not set'}</p><p className="text-slate-600">Updated: {time(grant.updatedAt)}</p></li>)}</ul>}
            {data.entitlements.legacy.truncated && <p className="text-sm text-slate-600">Only the first 100 legacy records are displayed. Effective access is evaluated separately against all records.</p>}
          </details>
        </>}
        {tab === 2 && <>
          <section className={PANEL}><h2 className={HEADING}>Received learning records</h2>{data.progress.state === 'unknown' && <Callout tone="warning" title="Learning data unavailable">Refresh later. Learning activity cannot be established while this source is unavailable.</Callout>}<Fields items={[
            ['Cards with progress', number(data.progress.projectedCardCount)], ['Total reviews', number(data.progress.projectedReviewCount)], ['Last learning record received', time(data.progress.latestReceivedAt)],
          ]} /><p className="text-sm learner-copy text-slate-600">Only records received by the server are shown. Offline learning may not be included, and review counts do not establish mastery.</p></section>
          <section className={PANEL}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className={HEADING}>Learning by deck</h2><span className="text-sm text-slate-600">Page {cursors.length}</span></div>
            {data.progress.decks.length === 0 ? <div className="py-6 text-center text-sm text-slate-600">{data.progress.state === 'unknown' ? 'Deck progress is unavailable.' : 'No received deck progress yet.'}</div> : <ul className="divide-y divide-slate-200">{data.progress.decks.map(deck => <li className="py-4 space-y-3" key={deck.deckSlug}><h3 className="break-words font-medium text-slate-900">{deck.deckSlug}</h3><Fields items={[
              ['Cards with progress', number(deck.projectedCardCount)], ['Total reviews', number(deck.projectedReviewCount)], ['Last record received', time(deck.latestReceivedAt)],
            ]} /></li>)}</ul>}
            <div className="flex flex-wrap gap-3"><Button size="sm" variant="outline" disabled={cursors.length === 1 || query.isFetching} onClick={() => setCursors(current => current.slice(0, -1))}>Previous decks</Button><Button size="sm" variant="outline" disabled={!data.progress.nextDeckCursor || query.isFetching} onClick={() => setCursors(current => [...current, data.progress.nextDeckCursor!])}>Next decks</Button></div>
          </section>
          <details className={PANEL}><summary className="cursor-pointer rounded font-medium text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Troubleshooting: sync and device state</summary><Fields items={[
            ['Unique received events', number(data.progress.uniqueReceivedEventCount)], ['Latest client event time', time(data.progress.latestEventAt)], ['Latest server receipt', time(data.progress.latestReceivedAt)], ['Device queue', 'Not collected'], ['Pending device events', 'Not collected'], ['Last complete sync', 'Not collected'], ['Running device OTA', 'Not collected'],
          ]} /><p className="text-sm learner-copy text-slate-600">Events are deduplicated by ID and counted separately from reviews. Receipt does not establish complete device sync.</p></details>
        </>}
      </div>
    </>}
  </ConsolePage>;
}
