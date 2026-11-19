import { describe, expect, it } from 'vitest';
import { publicationStatus } from '../src/lib/contentReleaseStatus';
import { releaseFixture } from './support/contentReleaseFixtures';
import { ok } from './support/apiResult';
import type { ReleaseActions } from '../src/types/contentRelease';

function queried(status = 'PENDING', extra: Partial<ReleaseActions['jobs'][number]> = {}) {
  const { session } = releaseFixture(5);
  session.actions.publish = { kind: 'publish', actionId: 'publish', payload: '{}', outcome: 'confirmed', queried: true, reconciled: true,
    result: ok({ jobId: 'job', buildId: 'build' }), query: { action: {}, receipts: [], jobs: [{ job_id: 'job', build_id: 'build', status,
      content_sha256: 'a'.repeat(64), error_message: null, ...extra }], liveBuildId: status === 'SUCCESS' ? 'build' : 'old-live', manifestVerified: false } };
  return session;
}

describe('publication status uses current evidence and stage-specific actions', () => {
  it('does not present saved status as current or trust a failed latest query', () => {
    const session = queried('FAILED'); session.actions.publish!.reconciled = false;
    expect(publicationStatus(session, false)?.kind).toBe('unknown');
    session.actions.publish!.reconciled = true;
    expect(publicationStatus(session, true, true)?.kind).toBe('unknown');
  });
  it('never offers delivery replay for a terminal build or exhausted stage', () => {
    for (const session of [queried('FAILED'), queried('PENDING', { dispatchState: 'needs_attention' }), queried('SUCCESS', { manifestState: 'needs_attention' })]) {
      expect(publicationStatus(session, false)?.continueLabel).toBeUndefined();
    }
    expect(publicationStatus(queried('FAILED'), false)?.title).toBe('Publication failed');
  });
  it('respects the server lease and backoff and does not redeliver an acknowledged queue message', () => {
    const now = Date.parse('2026-11-19T00:00:00Z');
    const session = queried('PENDING', { dispatchState: 'pending', dispatchLeaseUntil: '2026-11-19T00:01:00Z' });
    expect(publicationStatus(session, false, false, now)?.nextAttemptAt).toBe('2026-11-19T00:01:00.000Z');
    expect(publicationStatus(session, false, false, now)?.continueLabel).toBeUndefined();
    expect(publicationStatus(session, false, false, now + 61_000)?.continueLabel).toBe('Continue queue delivery');
    session.actions.publish!.query!.jobs[0].dispatchState = 'delivered';
    expect(publicationStatus(session, false, false, now + 61_000)?.continueLabel).toBeUndefined();
  });
  it('offers index recovery only when due and public verification only after delivered', () => {
    const session = queried('SUCCESS', { manifestState: 'pending' });
    expect(publicationStatus(session, false)?.continueLabel).toBe('Continue index delivery');
    session.actions.publish!.query!.jobs[0].manifestState = 'delivered';
    expect(publicationStatus(session, false)?.kind).toBe('verification');
    expect(publicationStatus(session, true)?.kind).toBe('verified');
  });
  it('keeps index recovery available until a certified build’s index is delivered', () => {
    const session = queried('SUCCESS', { manifestState: 'pending', cdnVerificationState: 'pending' });
    expect(publicationStatus(session, false)).toMatchObject({ kind: 'index', continueLabel: 'Continue index delivery' });
    session.actions.publish!.query!.jobs[0].manifestState = 'delivered';
    expect(publicationStatus(session, false)?.kind).toBe('background_verification');
  });
  it('does not claim success or offer replay after the current live version changes', () => {
    const session = queried('SUCCESS', { manifestState: 'delivered' }); session.actions.publish!.query!.liveBuildId = 'another-build';
    expect(publicationStatus(session, true)?.kind).toBe('superseded');
    expect(publicationStatus(session, true)?.continueLabel).toBeUndefined();
  });
  it('does not offer replay on malformed timing or a missing exact job', () => {
    expect(publicationStatus(queried('PENDING', { dispatchLeaseUntil: 'invalid' }), false)?.kind).toBe('unknown');
    const session = queried(); session.actions.publish!.query!.jobs[0].job_id = 'unrelated';
    expect(publicationStatus(session, false)?.kind).toBe('unknown');
  });
});
