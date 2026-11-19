import type { ReleaseActions, ReleaseSession } from '../types/contentRelease';

export interface PublicationStatus {
  kind: 'unknown' | 'queued' | 'building' | 'index' | 'attention' | 'failed' | 'verification' | 'background_verification' | 'verified' | 'superseded';
  tone: 'info' | 'success' | 'warning' | 'danger';
  title: string;
  description: string;
  continueLabel?: string;
  nextAttemptAt?: string;
  liveBuildId?: string | null;
}

/** Reject malformed replies before they can become current evidence or render state. */
export function assertPublicationQuery(query: ReleaseActions): void {
  if (!query || !Array.isArray(query.jobs) || !(query.liveBuildId === null || typeof query.liveBuildId === 'string') ||
      query.jobs.some(job => !job || typeof job !== 'object' || typeof job.job_id !== 'string' || typeof job.build_id !== 'string' || typeof job.status !== 'string' ||
        [job.error_message, job.content_sha256, job.manifestState, job.manifestError, job.manifestNextAttemptAt, job.manifestLeaseUntil,
          job.dispatchState, job.dispatchNextAttemptAt, job.dispatchLeaseUntil, job.cdnVerifiedAt, job.cdnVerifiedSha256,
          job.cdnVerificationError].some(value => value != null && typeof value !== 'string') ||
        (job.cdnVerificationState != null && !['pending', 'verified', 'needs_attention'].includes(job.cdnVerificationState)) ||
        (job.cdnVerifiedCards != null && !Number.isSafeInteger(job.cdnVerifiedCards)))) {
    throw new Error('Publication status response is incomplete. Check the saved action again; no publication was retried.');
  }
}

/** Only a reconciled query is current evidence. Stored results after reload remain historical. */
export function publicationStatus(session: ReleaseSession | null, verified: boolean, lookupFailed = false, now = Date.now()): PublicationStatus | null {
  const action = session?.actions.publish;
  if (!action) return null;
  const unknown: PublicationStatus = { kind: 'unknown', tone: 'warning', title: 'Publication result not confirmed',
    description: 'Check the saved action before continuing. A timeout does not mean the publication failed.' };
  if (lookupFailed || !action.reconciled || !action.queried) return unknown;
  const query = action.query;
  if (!query) return action.outcome === 'unknown'
    ? { ...unknown, description: 'The last check found no committed action. You can resend the same saved request.', continueLabel: 'Send saved publish request' }
    : unknown;
  try { assertPublicationQuery(query); } catch { return unknown; }
  const job = query.jobs.find(item => item.job_id === action.result?.data?.jobId && item.build_id === action.result?.data?.buildId);
  if (!job) return unknown;
  const current = { liveBuildId: query.liveBuildId };
  if (job.status === 'FAILED') return { ...current, kind: 'failed', tone: 'danger', title: 'Publication failed',
    description: 'The card build has stopped. Inspect the error details before repairing it. Replaying this request cannot restart a failed job.' };
  if (job.status === 'SUCCESS' && query.liveBuildId !== job.build_id) return { ...current, kind: 'superseded', tone: 'warning', title: 'Live version changed',
    description: 'Another release changed the live version. Check its status before continuing this saved release.' };
  if (job.status === 'PENDING' && job.dispatchState === 'needs_attention') return { ...current, kind: 'attention', tone: 'danger', title: 'Queue delivery needs attention',
    description: 'Queue delivery retries are exhausted. The original job is retained; this page cannot start a replacement job.' };
  if (job.manifestState === 'needs_attention') return { ...current, kind: 'attention', tone: 'warning', title: 'Index delivery needs attention',
    description: 'The card build is ready, but index delivery retries are exhausted. Public availability has not been verified.' };
  if (job.cdnVerificationState === 'needs_attention') return { ...current, kind: 'attention', tone: 'warning', title: 'CDN verification needs attention',
    description: 'The background verifier exhausted its attempts. The existing build and its diagnostics are retained.' };
  if (job.status === 'SUCCESS' && job.cdnVerificationState && !verified) return {
    ...current, kind: 'background_verification', tone: 'info', title: 'Background CDN verification',
    description: 'The server continues this check after you close the page. Check publication status for the saved receipt.',
  };
  if (job.status === 'SUCCESS' && job.manifestState === 'delivered') return verified
    ? { ...current, kind: 'verified', tone: 'success', title: 'Published and verified', description: 'The public card pack matches the reviewed content.' }
    : { ...current, kind: 'verification', tone: 'warning', title: 'Public verification incomplete',
      description: 'The build and index delivery succeeded. Verify the public download before marking this release complete.' };
  const index = job.status === 'SUCCESS';
  const timing = index ? [job.manifestNextAttemptAt, job.manifestLeaseUntil] : [job.dispatchNextAttemptAt, job.dispatchLeaseUntil];
  if (timing.some(value => value != null && !Number.isFinite(Date.parse(value)))) return unknown;
  const due = Math.max(...timing.map(value => value ? Date.parse(value) : 0));
  const canContinue = index ? job.manifestState === 'pending'
    : job.status === 'PENDING' && (!job.dispatchState || job.dispatchState === 'pending');
  if (index || job.status === 'PENDING' || job.status === 'PROCESSING') return { ...current,
    kind: index ? 'index' : job.status === 'PROCESSING' ? 'building' : 'queued', tone: 'info',
    title: index ? 'Index delivery in progress' : job.status === 'PROCESSING' ? 'Building card pack' : 'Waiting for the card build',
    description: index ? 'The card build is ready. Continue the same job when its next retry is due; a new card build is not needed.'
      : 'The saved job is still in progress. Check its status rather than submitting another release.',
    ...(due > now ? { nextAttemptAt: new Date(due).toISOString() } : {}),
    ...(canContinue && due <= now ? { continueLabel: index ? 'Continue index delivery' : 'Continue queue delivery' } : {}) };
  return unknown;
}
