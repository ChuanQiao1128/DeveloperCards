import { fetchContentManifest, getContentManifestUrl } from '../api/contentManifest';
import type { ImportCardInput } from '../api/authoring';
import type { ReleaseActions, ReleaseSession } from '../types/contentRelease';
import { canonicalReleaseCard } from './contentRelease';

export interface ReleaseDeliveryProof { jobId: string; buildId: string; sha256: string; cards: number; verifiedAt: string }

export function waitForReleasePoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Publication monitoring stopped.')); return; }
    const abort = () => { clearTimeout(timer); reject(new Error('Publication monitoring stopped.')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 5000);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** A successful build is complete only after the public index and downloaded bytes agree. */
export async function verifyReleaseDelivery(session: ReleaseSession, query: ReleaseActions, signal: AbortSignal): Promise<ReleaseDeliveryProof | null> {
  const expected = session.actions.publish?.result?.data;
  const job = query.jobs.find(item => item.job_id === expected?.jobId && item.build_id === expected?.buildId);
  if (!job || job.status !== 'SUCCESS') return null;
  if (query.liveBuildId !== job.build_id) throw new Error('Another release changed the live build. Publication verification stopped.');
  if (!/^[a-zA-Z0-9_-]+$/.test(job.build_id) || !/^[0-9a-f]{64}$/.test(job.content_sha256 ?? '')) throw new Error('Published job is missing a valid build or content hash.');
  // A browser-cached response can retain pre-CORS headers even after the CDN policy changes.
  const manifest = await fetchContentManifest({ signal, bustCache: true });
  if (!manifest.ok) throw new Error(manifest.error);
  const entry = manifest.data.decks.find(item => item.slug === session.bundle.deckSlug);
  if (entry?.buildId !== job.build_id) return null; // The public index may still be cached for 60 seconds.
  if (entry.sha256 !== job.content_sha256 || entry.totalCards !== session.bundle.cards.length) throw new Error('Public manifest differs from the published job.');
  const expectedPath = `decks/${session.bundle.deckSlug}/builds/${job.build_id}/deck.json`;
  if (entry.path !== expectedPath) throw new Error('Public manifest has an unexpected deck path.');
  const manifestUrl = new URL(getContentManifestUrl(), location.href);
  const deckUrl = new URL(expectedPath, manifestUrl);
  const response = await fetch(deckUrl, { signal, credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Published deck download failed (HTTP ${response.status}).`);
  const bytes = await response.arrayBuffer();
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (sha256 !== job.content_sha256) throw new Error('Downloaded deck hash differs from the published job.');
  const deck = JSON.parse(new TextDecoder().decode(bytes)) as { slug: string; version: string; cards: Array<ImportCardInput & { revision: number }> };
  if (deck.slug !== session.bundle.deckSlug || deck.version !== job.build_id || !Array.isArray(deck.cards) || deck.cards.length !== session.bundle.cards.length) throw new Error('Downloaded deck identity or card count differs.');
  const candidates = new Map(session.bundle.cards.map(card => [card.stableUid, card]));
  const revisions = new Map(session.bundle.review.cards.map(card => [card.stableUid, card.revision]));
  const seen = new Set<string>();
  for (const card of deck.cards) {
    const candidate = card && candidates.get(card.stableUid);
    if (!candidate || seen.has(card.stableUid) || card.revision !== revisions.get(card.stableUid) || canonicalReleaseCard(card) !== canonicalReleaseCard(candidate)) throw new Error('Downloaded bilingual cards differ from the reviewed candidate.');
    seen.add(card.stableUid);
  }
  return { jobId: job.job_id, buildId: job.build_id, sha256, cards: deck.cards.length, verifiedAt: new Date().toISOString() };
}
