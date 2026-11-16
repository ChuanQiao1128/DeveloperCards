import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ConsoleReadError } from '../api/consoleOperations';
import { useConsoleIdentity } from '../hooks/useConsoleIdentity';
import { useLearner } from '../hooks/useConsoleOperations';
import { ConsolePage, Fields, ReadError } from '../components/console/OperationsViews';
import { HEADING, LINK, PANEL, formatCount as number, formatTime as time, formatBoolean as yesNo } from '../lib/consoleOperationsView';
import { Button } from '../components/ui/Button';

export function LearnerDetailPage() {
  const identity = useConsoleIdentity();
  const { sub = '' } = useParams();
  return <LearnerEvidence key={`${identity.generation}:${sub}`} sub={sub} />;
}
function LearnerEvidence({ sub }: { sub: string }) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const query = useLearner(sub, cursors.at(-1));
  const data = query.error instanceof ConsoleReadError && ['NOT_FOUND', 'FORBIDDEN'].includes(query.error.code) ? undefined : query.data;
  return <ConsolePage title="Learner detail">
    <Link className={LINK} to="/learners">Back to learners</Link>
    <div className="flex flex-wrap justify-between gap-3 items-center"><p className="text-sm text-slate-600">Backend-observed account. All times are UTC.</p><Button variant="outline" loading={query.isFetching} onClick={() => void query.refetch()}>Refresh learner</Button></div>
    {query.isPending && <p role="status">Loading learner evidence…</p>}
    {query.error && <ReadError error={query.error} historical={!!data} />}
    {data && <>
      <section className={PANEL}><h2 className={HEADING}>Observed identity</h2><Fields items={[
        ['Subject', data.learner.sub], ['Email', data.learner.email ?? 'Unknown'], ['Read at', time(data.fetchedAt)], ['First observed in backend', time(data.learner.firstObservedAt)], ['Last server activity', time(data.learner.lastServerActivityAt)], ['Last reported platform / app', `${data.learner.lastReportedPlatform ?? 'Unknown'} / ${data.learner.lastReportedVersion ?? 'Unknown'}`],
      ]} /><p className="text-sm text-slate-600">First observed is not signup time. Last server activity is not login or complete sync. Reported app data does not establish the device’s current OTA version.</p></section>
      <section className={PANEL}><h2 className={HEADING}>Evaluated access</h2><p className="text-sm text-slate-600">Evidence: {data.entitlements.state} · Evaluated: {time(data.entitlements.evaluatedAt)}</p><Fields items={[
        ['Entitlements tier', data.entitlements.effective.entitlementsTier], ['Entitlements source', data.entitlements.effective.entitlementsSource], ['Premium download eligible', yesNo(data.entitlements.effective.premiumDownloadEligible)], ['Download decision', data.entitlements.effective.downloadReason.replaceAll('_', ' ')], ['Sandbox premium downloads disallowed', yesNo(data.entitlements.effective.disallowSandboxPremium)], ['Development bypass', 'Not evaluated'],
      ]} /><p className="text-sm text-slate-600">The entitlements projection can include legacy grants. Premium downloads use RevenueCat evidence and the sandbox policy separately. These records do not verify a payment.</p></section>
      <section className={PANEL}><h2 className={HEADING}>RevenueCat raw evidence</h2><Fields items={[
        ['Record state', data.entitlements.revenueCat.state], ['Raw premium active flag', yesNo(data.entitlements.revenueCat.premiumActiveRaw)], ['Environment', data.entitlements.revenueCat.environment ?? 'Unknown'], ['Product', data.entitlements.revenueCat.productId ?? 'Unknown'], ['Expires', time(data.entitlements.revenueCat.expiresAtMs === null ? null : new Date(data.entitlements.revenueCat.expiresAtMs).toISOString())], ['Record updated', time(data.entitlements.revenueCat.updatedAt)], ['Last event time', time(data.entitlements.revenueCat.lastEventAtMs === null ? null : new Date(data.entitlements.revenueCat.lastEventAtMs).toISOString())],
      ]} /><p className="text-sm text-slate-600">The raw flag is not the evaluated decision: expiry and sandbox restrictions can change download access.</p></section>
      <section className={PANEL}><h2 className={HEADING}>Legacy entitlement evidence</h2><p className="text-sm">Source state: {data.entitlements.legacy.state}</p>{data.entitlements.legacy.items.length === 0 ? <p>{data.entitlements.legacy.state === 'unknown' ? 'Legacy source unavailable.' : 'No legacy entitlement records.'}</p> : <ul className="divide-y divide-slate-200">{data.entitlements.legacy.items.map((grant, index) => <li key={`${grant.key}:${index}`} className="py-2 text-sm break-words">{grant.key} · {grant.tier} · Source: {grant.source}<br />Expires: {time(grant.expiresAt)} · Updated: {time(grant.updatedAt)}</li>)}</ul>}{data.entitlements.legacy.truncated && <p className="text-sm text-slate-600">Only the first 100 legacy records are displayed; the evaluated tier is calculated separately.</p>}</section>
      <section className={PANEL}><h2 className={HEADING}>Server progress evidence</h2><p className="text-sm text-slate-600">Source: server event records and progress projections · State: {data.progress.state}</p><Fields items={[
        ['Unique received events', number(data.progress.uniqueReceivedEventCount)], ['Projected reviews', number(data.progress.projectedReviewCount)], ['Projected cards', number(data.progress.projectedCardCount)], ['Latest client event time', time(data.progress.latestEventAt)], ['Latest server receipt', time(data.progress.latestReceivedAt)],
      ]} /><p className="text-sm text-slate-600">Unique event IDs count once, including late events. Projected review counts are a separate measure. Neither receipt time nor event count proves complete device sync.</p>
        <h3 className="font-semibold text-slate-900">By deck · Page {cursors.length}</h3>{data.progress.decks.length === 0 ? <p>{data.progress.state === 'unknown' ? 'Progress source unavailable.' : 'No server progress records.'}</p> : <ul className="divide-y divide-slate-200">{data.progress.decks.map(deck => <li className="py-3 text-sm space-y-1" key={deck.deckSlug}><p className="font-medium break-words">{deck.deckSlug}</p><p>Cards: {number(deck.projectedCardCount)} · Projected reviews: {number(deck.projectedReviewCount)} · Unique events: {number(deck.uniqueReceivedEventCount)}</p><p>Latest client event: {time(deck.latestEventAt)} · Server receipt: {time(deck.latestReceivedAt)}</p></li>)}</ul>}
        <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={cursors.length === 1 || query.isFetching} onClick={() => setCursors(current => current.slice(0, -1))}>Previous decks</Button><Button variant="outline" disabled={!data.progress.nextDeckCursor || query.isFetching} onClick={() => setCursors(current => [...current, data.progress.nextDeckCursor!])}>Next decks</Button></div>
      </section>
      <section className={PANEL}><h2 className={HEADING}>Device state</h2><Fields items={[
        ['Device queue', 'Unknown'], ['Pending events', 'Unknown'], ['Last complete sync', 'Unknown'], ['Running device OTA', 'Unknown'],
      ]} /><p className="text-sm text-slate-600">This read does not collect device telemetry.</p></section>
    </>}
  </ConsolePage>;
}
