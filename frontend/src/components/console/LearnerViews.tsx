import { useState } from 'react';
import { ConsoleReadError, type LearnerDetail, type MembershipSummary } from '../../api/consoleOperations';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';

export function LearnerReadError({ error, historical = false }: { error: unknown; historical?: boolean }) {
  const failure = error instanceof ConsoleReadError ? error : new ConsoleReadError('READ_FAILED');
  const message = failure.code === 'NOT_FOUND' ? 'This user is no longer in the observed directory.'
    : failure.code === 'FORBIDDEN' ? 'Your account does not have permission to view users.'
      : failure.code === 'VALIDATION_ERROR' ? 'The search has expired. Return to the directory and search again.' : 'Could not read user data. Try again.';
  return <Callout tone="danger" role="alert" title="Could not load user data">
    {message}{historical && ' The previous read below is historical; current status is unknown.'}
    {failure.traceId && <span className="block mt-1">Support reference: {failure.traceId}</span>}
  </Callout>;
}

export function LearnerLoading() {
  return <div role="status" aria-label="Loading users" className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
    <span className="sr-only">Loading users…</span>
    {[0, 1, 2].map(row => <div key={row} aria-hidden="true" className="h-10 rounded bg-slate-100" />)}
  </div>;
}

export function CopyUserId({ sub }: { sub: string }) {
  const [feedback, setFeedback] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(sub); setFeedback('User ID copied'); }
    catch { setFeedback('Could not copy. Select the user ID below and copy it manually.'); }
  }
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-3"><span className="text-sm text-slate-600">User ID</span><Button size="xs" variant="outline" onClick={() => void copy()}>Copy ID</Button><span role="status" className="text-sm text-slate-600">{feedback}</span></div>
    <p className="learner-user-id break-all font-mono text-xs text-slate-700">{sub}</p>
  </div>;
}

export function MembershipBadge({ entitlements }: { entitlements: LearnerDetail['entitlements'] }) {
  const effective = entitlements.effective;
  const label = effective.entitlementsTier === 'unknown' ? 'Access unknown'
    : effective.entitlementsTier === 'free' ? 'Free access'
      : effective.entitlementsSource === 'revenuecat' && entitlements.revenueCat.environment === 'sandbox' ? 'Premium · Sandbox'
        : effective.entitlementsSource === 'legacy' ? 'Premium · Legacy grant' : 'Premium access';
  return <span className={`inline-flex rounded px-2 py-1 text-sm font-medium ${effective.entitlementsTier === 'premium' ? 'bg-indigo-50 text-indigo-800' : 'bg-slate-100 text-slate-700'}`}>{label}</span>;
}


export function DirectoryMembership({ membership }: { membership?: MembershipSummary | null }) {
  const label = !membership || membership.state === 'unknown' ? 'Access unknown'
    : membership.status === 'expired' ? 'Expired' : membership.status === 'inactive' ? 'Inactive'
      : membership.tier === 'free' ? 'Free' : membership.source === 'legacy' ? 'Premium · Grant'
        : membership.environment === 'sandbox' ? 'Premium · Sandbox' : 'Premium';
  const source = !membership || membership.source === 'unknown' ? 'Source unavailable'
    : membership.source === 'legacy' ? 'Manual or legacy grant'
      : membership.source === 'revenuecat' ? `Subscription · ${membership.environment === 'production' ? 'Production' : membership.environment === 'sandbox' ? 'Sandbox' : 'Environment unknown'}` : 'No premium record';
  return <div className="space-y-1"><span className={`inline-flex rounded px-2 py-1 text-sm font-medium ${membership?.status === 'active' ? 'bg-indigo-50 text-indigo-800' : 'bg-slate-100 text-slate-700'}`}>{label}</span><p className="text-xs text-slate-600">{source}</p>{membership?.status === 'active' && <p className="text-xs text-slate-600">{membership.scope === 'all' ? 'All decks' : membership.scope === 'selected_decks' ? 'Selected decks' : 'Scope unknown'}</p>}</div>;
}
