import { beforeEach, describe, expect, it, vi } from 'vitest';
import { releaseFixture } from './support/contentReleaseFixtures';
import { ok } from './support/apiResult';
import type { ReleaseActions } from '../src/types/contentRelease';
import { assertActionResult } from '../src/lib/contentRelease';

const manifestApi = vi.hoisted(() => ({ fetchContentManifest: vi.fn() }));
vi.mock('../src/api/contentManifest', () => ({ ...manifestApi, getContentManifestUrl: () => 'https://cdn.example/content/manifest.json' }));
const { verifyReleaseDelivery } = await import('../src/lib/contentReleaseDelivery');
const signal = new AbortController().signal;
async function fixture() {
  const { session, snapshot } = releaseFixture(5);
  const deck = { slug: session.bundle.deckSlug, version: 'build-123', cards: session.bundle.cards.map(card => ({ ...card, revision: session.bundle.review.cards.find(item => item.stableUid === card.stableUid)!.revision })) };
  const bytes = new TextEncoder().encode(JSON.stringify(deck));
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  session.verifiedSnapshot = snapshot;
  session.actions.publish = { kind: 'publish', actionId: 'publish', payload: '{}', outcome: 'confirmed', queried: true, reconciled: true,
    result: ok({ jobId: 'job', buildId: deck.version, outcome: 'queued', manifestVerified: false, snapshotSha256: snapshot.publishSnapshot }) };
  const query: ReleaseActions = { action: {}, receipts: [], jobs: [{ job_id: 'job', build_id: deck.version, status: 'SUCCESS', content_sha256: sha, error_message: null, manifestState: 'delivered' }], liveBuildId: deck.version, manifestVerified: false };
  const manifest = { decks: [{ slug: deck.slug, version: deck.version, buildId: deck.version, sha256: sha, totalCards: 5, path: `decks/${deck.slug}/builds/${deck.version}/deck.json` }] };
  manifestApi.fetchContentManifest.mockResolvedValue({ ok: true, data: manifest });
  const fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => bytes.buffer }); vi.stubGlobal('fetch', fetch);
  return { session, query, deck, bytes, manifest, fetch };
}
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('location', { href: 'https://console.example/decks/release' }); });

describe('published content delivery', () => {
  it('verifies the actual CDN bytes and all five bilingual identities/revisions', async () => {
    const { session, query, fetch } = await fixture();
    expect(await verifyReleaseDelivery(session, query, signal)).toMatchObject({ jobId: 'job', buildId: 'build-123', cards: 5 });
    expect(fetch.mock.calls[0][0].href).toBe('https://cdn.example/content/decks/aws-saa-fundamentals/builds/build-123/deck.json');
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error', signal });
  });
  it('keeps an old cached public index pending without downloading another build', async () => {
    const { session, query, manifest, fetch } = await fixture(); manifest.decks[0].buildId = 'old';
    expect(await verifyReleaseDelivery(session, query, signal)).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['manifest hash', 'path', 'download hash', 'bilingual content', 'duplicate uid', 'live pointer'])('rejects %s mismatches', async kind => {
    const { session, query, manifest, fetch } = await fixture();
    if (kind === 'manifest hash') manifest.decks[0].sha256 = '0'.repeat(64);
    if (kind === 'path') manifest.decks[0].path = 'https://other.example/untrusted';
    if (kind === 'download hash') fetch.mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode('changed').buffer });
    if (kind === 'bilingual content') session.bundle.cards[0].translations['zh-CN']!.explanation += ' changed after review';
    if (kind === 'duplicate uid') session.bundle.cards[0].stableUid = session.bundle.cards[1].stableUid;
    if (kind === 'live pointer') query.liveBuildId = 'another-release';
    await expect(verifyReleaseDelivery(session, query, signal)).rejects.toThrow();
  });
  it.each(['committed', 'queued', 'processing', 'success', 'failed'])('accepts an authentic %s response without treating it as CDN verification', async outcome => {
    const { session } = await fixture();
    const result = structuredClone(session.actions.publish!.result!); result.data!.outcome = outcome;
    expect(() => assertActionResult(session, session.actions.publish!, result)).not.toThrow();
    result.data!.snapshotSha256 = 'wrong';
    expect(() => assertActionResult(session, session.actions.publish!, result)).toThrow();
  });
});
