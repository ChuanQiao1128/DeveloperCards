import type { LearnerDetail, Learners, Operations, SourceState } from '../../src/api/consoleOperations';
export const AT = '2026-11-16T04:00:00Z';
export const learner = { sub: 'observed-1', email: 'learner@example.invalid', firstObservedAt: AT, lastServerActivityAt: null, lastReportedPlatform: null, lastReportedVersion: null };
export const learners: Learners = { scope: 'backend_observed_users', fetchedAt: AT, asOf: AT, items: [learner], nextCursor: null };
const source: SourceState = { state: 'unknown', status: 'unknown', source: 'fixture-source', observedAt: null, fetchedAt: AT, expiresAt: null, reason: 'not_configured' };
export const operations: Operations = {
  fetchedAt: AT,
  synthetic: { ...source, schemaVersion: null, runId: null, checks: [] },
  alarms: { ...source, items: [{ name: 'alarm-a', state: 'INSUFFICIENT_DATA', stateUpdatedAt: AT }] },
  database: { ...source, state: 'fresh', status: 'healthy', reachable: true, source: 'database' },
  publishing: { ...source, items: [], truncated: false },
  links: { cloudWatch: null, sentry: null },
};
export const detail: LearnerDetail = {
  scope: 'backend_observed_users', fetchedAt: AT, learner,
  entitlements: { state: 'known', evaluatedAt: AT,
    revenueCat: { state: 'present', premiumActiveRaw: true, environment: 'sandbox', productId: 'test-product', expiresAtMs: null, updatedAt: AT, lastEventAtMs: null },
    legacy: { state: 'known', items: [{ key: 'premium_all', tier: 'premium', source: 'legacy', expiresAt: null, updatedAt: AT }], truncated: false },
    effective: { entitlementsTier: 'premium', entitlementsSource: 'legacy', premiumDownloadEligible: false, downloadReason: 'sandbox_disallowed', disallowSandboxPremium: true, devBypass: 'not_evaluated' },
  },
  progress: { state: 'known', uniqueReceivedEventCount: 7, latestEventAt: AT, latestReceivedAt: AT, projectedCardCount: 2, projectedReviewCount: 9, decks: [{ deckSlug: 'aws', projectedCardCount: 2, projectedReviewCount: 9, uniqueReceivedEventCount: 7, latestEventAt: AT, latestReceivedAt: AT }], nextDeckCursor: null },
  device: { queueState: 'unknown', pendingEventCount: null, completeSyncState: 'unknown', runningOtaVersion: null },
};
export function envelope<T>(data: T) { return { data: { success: true, data, error: null, traceId: 'fixture-trace', version: '1' } }; }
