import { http } from './http';
import { assertSessionGeneration, clearTokens, getSessionGeneration } from '../auth/tokenStore';

export type LearnerRow = { sub: string; email: string | null; firstObservedAt: string; lastServerActivityAt: string | null; lastReportedPlatform: string | null; lastReportedVersion: string | null };
export type Learners = { scope: 'backend_observed_users'; fetchedAt: string; asOf: string; items: LearnerRow[]; nextCursor: string | null };
export type SourceState = { state: 'fresh' | 'stale' | 'unknown'; status: 'healthy' | 'degraded' | 'failed' | 'unknown'; source: string; observedAt: string | null; fetchedAt: string; expiresAt: string | null; reason: string | null };
export type Operations = {
  fetchedAt: string;
  synthetic: SourceState & { schemaVersion: number | null; runId: string | null; checks: { name: string; status: SourceState['status']; advisory: boolean; httpStatus: number | null; latencyMs: number | null; code: string | null }[] };
  alarms: SourceState & { items: { name: string; state: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA' | 'UNKNOWN'; stateUpdatedAt: string | null }[] };
  database: SourceState & { reachable: boolean | null };
  publishing: SourceState & { items: { jobId: string; deckSlug: string | null; status: string; updatedAt: string; releaseId: string | null; buildId: string | null; deliveryVerification: 'unknown'; href: string | null }[]; truncated: boolean };
  links: { cloudWatch: string | null; sentry: string | null };
};
export type ProgressDeck = { deckSlug: string; projectedCardCount: number; projectedReviewCount: number; uniqueReceivedEventCount: number; latestEventAt: string | null; latestReceivedAt: string | null };
export type LearnerDetail = {
  scope: 'backend_observed_users'; fetchedAt: string; learner: LearnerRow;
  entitlements: {
    state: 'known' | 'partial' | 'unknown'; evaluatedAt: string;
    revenueCat: { state: 'present' | 'absent' | 'unknown'; premiumActiveRaw: boolean | null; environment: string | null; productId: string | null; expiresAtMs: number | null; updatedAt: string | null; lastEventAtMs: number | null };
    legacy: { state: 'known' | 'unknown'; items: { key: string; tier: string; source: string; expiresAt: string | null; updatedAt: string }[]; truncated: boolean };
    effective: { entitlementsTier: 'premium' | 'free' | 'unknown'; entitlementsSource: 'revenuecat' | 'legacy' | 'none' | 'unknown'; premiumDownloadEligible: boolean | null; downloadReason: 'active_rc' | 'inactive_or_absent_rc' | 'sandbox_disallowed' | 'source_unavailable'; disallowSandboxPremium: boolean; devBypass: 'not_evaluated' };
  };
  progress: { state: 'known' | 'unknown'; uniqueReceivedEventCount: number | null; latestEventAt: string | null; latestReceivedAt: string | null; projectedCardCount: number | null; projectedReviewCount: number | null; decks: ProgressDeck[]; nextDeckCursor: string | null };
  device: { queueState: 'unknown'; pendingEventCount: null; completeSyncState: 'unknown'; runningOtaVersion: null };
};

type Check = (value: unknown) => boolean;
const string: Check = v => typeof v === 'string';
const bool: Check = v => typeof v === 'boolean';
const count: Check = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const epoch: Check = v => count(v) && (v as number) <= 8_640_000_000_000_000;
const timestamp: Check = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|\+00:00)$/.test(v) && Number.isFinite(Date.parse(v));
const nullable = (check: Check): Check => v => v === null || check(v);
const oneOf = (...values: unknown[]): Check => v => values.includes(v);
const array = (check: Check, max: number): Check => v => Array.isArray(v) && v.length <= max && v.every(check);
const object = (fields: Record<string, Check>): Check => v => !!v && typeof v === 'object' && !Array.isArray(v) && Object.entries(fields).every(([key, check]) => check((v as Record<string, unknown>)[key]));
const row = object({ sub: string, email: nullable(string), firstObservedAt: timestamp, lastServerActivityAt: nullable(timestamp), lastReportedPlatform: nullable(string), lastReportedVersion: nullable(string) });
const source = { state: oneOf('fresh', 'stale', 'unknown'), status: oneOf('healthy', 'degraded', 'failed', 'unknown'), source: string, observedAt: nullable(timestamp), fetchedAt: timestamp, expiresAt: nullable(timestamp), reason: nullable(string) };
const deck = object({ deckSlug: string, projectedCardCount: count, projectedReviewCount: count, uniqueReceivedEventCount: count, latestEventAt: nullable(timestamp), latestReceivedAt: nullable(timestamp) });
const validators: Record<'learners' | 'detail' | 'operations', Check> = {
  learners: object({ scope: oneOf('backend_observed_users'), fetchedAt: timestamp, asOf: timestamp, items: array(row, 100), nextCursor: nullable(string) }),
  detail: object({ scope: oneOf('backend_observed_users'), fetchedAt: timestamp, learner: row,
    entitlements: object({ state: oneOf('known', 'partial', 'unknown'), evaluatedAt: timestamp,
      revenueCat: object({ state: oneOf('present', 'absent', 'unknown'), premiumActiveRaw: nullable(bool), environment: nullable(string), productId: nullable(string), expiresAtMs: nullable(epoch), updatedAt: nullable(timestamp), lastEventAtMs: nullable(epoch) }),
      legacy: object({ state: oneOf('known', 'unknown'), items: array(object({ key: string, tier: string, source: string, expiresAt: nullable(timestamp), updatedAt: timestamp }), 100), truncated: bool }),
      effective: object({ entitlementsTier: oneOf('premium', 'free', 'unknown'), entitlementsSource: oneOf('revenuecat', 'legacy', 'none', 'unknown'), premiumDownloadEligible: nullable(bool), downloadReason: oneOf('active_rc', 'inactive_or_absent_rc', 'sandbox_disallowed', 'source_unavailable'), disallowSandboxPremium: bool, devBypass: oneOf('not_evaluated') }),
    }),
    progress: object({ state: oneOf('known', 'unknown'), uniqueReceivedEventCount: nullable(count), latestEventAt: nullable(timestamp), latestReceivedAt: nullable(timestamp), projectedCardCount: nullable(count), projectedReviewCount: nullable(count), decks: array(deck, 100), nextDeckCursor: nullable(string) }),
    device: object({ queueState: oneOf('unknown'), pendingEventCount: oneOf(null), completeSyncState: oneOf('unknown'), runningOtaVersion: oneOf(null) }),
  }),
  operations: object({ fetchedAt: timestamp,
    synthetic: object({ ...source, schemaVersion: nullable(count), runId: nullable(string), checks: array(object({ name: string, status: source.status, advisory: bool, httpStatus: nullable(count), latencyMs: nullable(count), code: nullable(string) }), 20) }),
    alarms: object({ ...source, items: array(object({ name: string, state: oneOf('OK', 'ALARM', 'INSUFFICIENT_DATA', 'UNKNOWN'), stateUpdatedAt: nullable(timestamp) }), 20) }),
    database: object({ ...source, reachable: nullable(bool) }),
    publishing: object({ ...source, truncated: bool, items: array(object({ jobId: string, deckSlug: nullable(string), status: string, updatedAt: timestamp, releaseId: nullable(string), buildId: nullable(string), deliveryVerification: oneOf('unknown'), href: nullable(string) }), 20) }),
    links: object({ cloudWatch: nullable(string), sentry: nullable(string) }),
  }),
};

export class ConsoleReadError extends Error {
  readonly code: string;
  readonly traceId: string | null;
  constructor(code: string, traceId: string | null = null) {
    super(code === 'FORBIDDEN' ? 'Super administrator access is required.' : code === 'NOT_FOUND' ? 'This learner is no longer in the observed directory.' : code === 'VALIDATION_ERROR' ? 'The request was not accepted. Check the search or start a new page.' : 'Could not load this source. Try refreshing.');
    this.name = 'ConsoleReadError';
    this.code = code;
    this.traceId = traceId;
  }
}
export function parseConsoleData<T>(kind: keyof typeof validators, value: unknown): T {
  if (!validators[kind](value)) throw new ConsoleReadError('INVALID_RESPONSE');
  return value as T;
}
function safeFailure(value: unknown): ConsoleReadError {
  const response = value && typeof value === 'object' && 'response' in value ? (value as { response?: { data?: unknown; status?: number } }).response : null;
  const body = response?.data as { error?: { code?: unknown }; traceId?: unknown } | undefined;
  const code = typeof body?.error?.code === 'string' && /^(FORBIDDEN|NOT_FOUND|VALIDATION_ERROR|UNAUTHORIZED|SERVICE_UNAVAILABLE|INTERNAL_ERROR)$/.test(body.error.code) ? body.error.code : response?.status === 403 ? 'FORBIDDEN' : 'READ_FAILED';
  const trace = typeof body?.traceId === 'string' && /^[\w-]{1,128}$/.test(body.traceId) ? body.traceId : null;
  return new ConsoleReadError(code, trace);
}
async function read<T>(kind: keyof typeof validators, path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> {
  const generation = getSessionGeneration();
  try {
    const response = await http.get(path, { params, signal });
    assertSessionGeneration(generation);
    if (signal?.aborted) throw new ConsoleReadError('CANCELLED');
    const envelope = response.data;
    if (envelope?.success !== true) throw safeFailure({ response: { data: envelope } });
    return parseConsoleData<T>(kind, envelope.data);
  } catch (error) {
    assertSessionGeneration(generation);
    const failure = error instanceof ConsoleReadError ? error : safeFailure(error);
    if (failure.code === 'FORBIDDEN') clearTokens();
    throw failure;
  }
}
export const fetchOperations = (signal?: AbortSignal) => read<Operations>('operations', '/api/v1/admin/operations/overview', {}, signal);
export const fetchLearners = (query: string, cursor?: string, signal?: AbortSignal) => read<Learners>('learners', '/api/v1/admin/learners', { query: query.trim() || undefined, cursor, limit: 25 }, signal);
export const fetchLearner = (sub: string, deckCursor?: string, signal?: AbortSignal) => read<LearnerDetail>('detail', `/api/v1/admin/learners/${encodeURIComponent(sub)}`, { deckCursor, deckLimit: 25 }, signal);

