import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { releaseFixture } from './support/contentReleaseFixtures';
import { loadDeliveryArtifact, releaseArtifactDownload, saveDeliveryArtifact, sha256 } from '../src/lib/releaseArtifacts';
import { loadReleaseJournal, saveReleaseJournal, withReleaseJournalLock } from '../src/lib/releaseJournalStore';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
describe('durable release artifacts', () => {
  it('serializes legacy journal writes so a stale tab cannot replace newer actions', async () => {
    let queue = Promise.resolve();
    vi.stubGlobal('navigator', { locks: { request: (_: string, work: () => Promise<void>) => {
      const next = queue.then(work); queue = next.catch(() => {}); return next;
    } } });
    let release!: () => void; const paused = new Promise<void>(resolve => { release = resolve; });
    let written = '';
    const first = withReleaseJournalLock('owner', async () => {
      await saveReleaseJournal('owner', '{"actions":{"import":{}}}', 0, () => {});
      await paused; written = 'new';
    });
    const stale = withReleaseJournalLock('owner', async () => {
      await saveReleaseJournal('owner', '{"actions":{}}', 0, () => {}); written = 'old';
    });
    release(); await first;
    await expect(stale).rejects.toThrow(/another tab/);
    expect(written).toBe('new'); expect((await loadReleaseJournal('owner'))!.revision).toBe(1);
    vi.unstubAllGlobals();
  });
  it('keeps verified bytes owner-scoped and refuses another frozen bundle', async () => {
    const { session } = releaseFixture(2); const bytes = new TextEncoder().encode('synthetic bytes');
    const proof = { jobId: 'synthetic', buildId: 'synthetic', sha256: await sha256(bytes), cards: 2, verifiedAt: new Date().toISOString() };
    await saveDeliveryArtifact(session, proof, bytes, () => {});
    const saved = await loadDeliveryArtifact(session, () => {});
    expect(saved!.bytes).toEqual(bytes);
    const packet = releaseArtifactDownload(session, saved!);
    expect(atob(packet.deckBase64)).toBe('synthetic bytes');
    session.bundle.cards[0].question = 'changed';
    await expect(loadDeliveryArtifact(session, () => {})).rejects.toThrow(/frozen release/);
    await expect(loadDeliveryArtifact(session, () => { throw new Error('identity changed'); })).rejects.toThrow(/identity changed/);
  });
});
