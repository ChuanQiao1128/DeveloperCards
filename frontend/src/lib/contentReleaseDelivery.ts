import { fetchContentManifest, getContentManifestUrl } from '../api/contentManifest';
import type { ImportCardInput } from '../api/authoring';
import type { ReleaseActions, ReleaseSession } from '../types/contentRelease';
import { canonicalReleaseCard } from './contentRelease';
import type { DeliveryArtifact } from './releaseArtifacts';

export interface ReleaseDeliveryProof { jobId: string; buildId: string; sha256: string; cards: number; verifiedAt: string }

export function backgroundDeliveryProof(session: ReleaseSession, query: ReleaseActions): ReleaseDeliveryProof | undefined {
  const expected = session.actions.publish?.result?.data;
  const job = query.jobs.find(item => item.job_id === expected?.jobId && item.build_id === expected?.buildId);
  if (!job || job.status !== 'SUCCESS' || job.manifestState !== 'delivered' ||
      job.cdnVerificationState !== 'verified' || query.liveBuildId !== job.build_id) return;
  if (!job.cdnVerifiedAt || !Number.isFinite(Date.parse(job.cdnVerifiedAt)) ||
      job.cdnVerifiedSha256 !== job.content_sha256 || !/^[0-9a-f]{64}$/.test(job.cdnVerifiedSha256 ?? '') ||
      !/^[a-zA-Z0-9_-]+$/.test(job.build_id) || job.cdnVerifiedCards !== session.bundle.cards.length)
    throw new Error('The background verification receipt does not match this saved release.');
  return { jobId: job.job_id, buildId: job.build_id, sha256: job.cdnVerifiedSha256!, cards: job.cdnVerifiedCards, verifiedAt: job.cdnVerifiedAt };
}

export function waitForReleasePoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Publication monitoring stopped.')); return; }
    const abort = () => { clearTimeout(timer); reject(new Error('Publication monitoring stopped.')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 5000);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** A successful build is complete only after the public index and downloaded bytes agree. */
export async function verifyReleaseDelivery(session: ReleaseSession, query: ReleaseActions, signal: AbortSignal, onVerified?: (proof: ReleaseDeliveryProof, bytes: Uint8Array) => Promise<void>): Promise<ReleaseDeliveryProof | null> {
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
  await assertDeckHash(job.content_sha256!, bytes);
  assertLegacyDeliveredCards(session, job.build_id, bytes);
  const proof = { jobId: job.job_id, buildId: job.build_id, sha256: job.content_sha256!, cards: session.bundle.cards.length, verifiedAt: new Date().toISOString() };
  if (onVerified) await onVerified(proof, new Uint8Array(bytes));
  return proof;
}

async function assertDeckHash(expectedHash: string, bytes: ArrayBuffer) {
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (sha256 !== expectedHash) throw new Error('Downloaded deck hash differs from the published job.');
}

function assertLegacyDeliveredCards(session: ReleaseSession, buildId: string, bytes: ArrayBuffer) {
  const deck = JSON.parse(new TextDecoder().decode(bytes)) as { slug: string; version: string; cards: Array<ImportCardInput & { revision: number }> };
  if (deck.slug !== session.bundle.deckSlug || deck.version !== buildId || !Array.isArray(deck.cards) || deck.cards.length !== session.bundle.cards.length) throw new Error('Downloaded deck identity or card count differs.');
  const candidates = new Map(session.bundle.cards.map(card => [card.stableUid, card]));
  const revisions = new Map(session.bundle.review.cards.map(card => [card.stableUid, card.revision]));
  const seen = new Set<string>();
  for (const card of deck.cards) {
    const candidate = card && candidates.get(card.stableUid);
    if (!candidate || seen.has(card.stableUid) || card.revision !== revisions.get(card.stableUid) || canonicalReleaseCard(card) !== canonicalReleaseCard(candidate)) throw new Error('Downloaded bilingual cards differ from the reviewed candidate.');
    seen.add(card.stableUid);
  }
}

/** Obtain bytes for local archiving after a verified receipt, independently of the public index. */
export async function downloadVerifiedDeck(session: ReleaseSession, proof: ReleaseDeliveryProof, signal: AbortSignal): Promise<Uint8Array> {
  if (!/^[a-zA-Z0-9_-]+$/.test(proof.buildId)) throw new Error('Invalid verified build ID.');
  const path = `decks/${session.bundle.deckSlug}/builds/${proof.buildId}/deck.json`;
  const url = new URL(path, new URL(getContentManifestUrl(), location.href));
  const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Verified file download failed (HTTP ${response.status}).`);
  const bytes = await response.arrayBuffer();
  await assertDeckHash(proof.sha256, bytes);
  return new Uint8Array(bytes);
}

export async function verifyStoredReleaseDelivery(session: ReleaseSession, query: ReleaseActions, artifact: DeliveryArtifact): Promise<ReleaseDeliveryProof> {
  const proof = artifact.proof; const published = session.actions.publish?.result?.data;
  const job = query.jobs.find(row => row.job_id === proof.jobId && row.build_id === proof.buildId);
  if (proof.jobId !== published?.jobId || proof.buildId !== published?.buildId || query.liveBuildId !== proof.buildId || job?.status !== 'SUCCESS' || job.manifestState !== 'delivered' || job.content_sha256 !== proof.sha256 || proof.cards !== session.bundle.cards.length || !Number.isFinite(Date.parse(proof.verifiedAt))) throw new Error('Saved CDN proof no longer matches the reconciled publication.');
  const bytes = artifact.bytes.slice().buffer;
  await assertDeckHash(proof.sha256, bytes);
  const background = backgroundDeliveryProof(session, query);
  if (!background) assertLegacyDeliveredCards(session, proof.buildId, bytes);
  else return background;
  return proof;
}
