import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { releaseFixture } from './support/contentReleaseFixtures';
import { loadDeliveryArtifact, releaseArtifactDownload, saveDeliveryArtifact, sha256, writeReleaseArtifacts, type ArtifactDirectory } from '../src/lib/releaseArtifacts';
import { loadReleaseJournal, saveReleaseJournal, withReleaseJournalLock } from '../src/lib/releaseJournalStore';

function directory() {
  const files = new Map<string, string | Blob>();
  const operations: string[] = [];
  const folder: ArtifactDirectory = {
    queryPermission: async () => 'granted', getDirectoryHandle: async () => folder,
    getFileHandle: async (name, options) => {
      if (!options?.create && !files.has(name)) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      return { getFile: async () => ({ text: async () => String(files.get(name)) }), createWritable: async () => {
        let pending: string | Blob = '';
        return { write: async value => { pending = value; operations.push('write:' + name); },
          close: async () => { files.set(name, pending); operations.push('close:' + name); },
          abort: async () => { operations.push('abort:' + name); } };
      } };
    },
  };
  return { folder, files, operations };
}
beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
describe('durable release artifacts', () => {
  it('serializes the journal CAS and filesystem commit so a stale tab cannot replace newer actions', async () => {
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
  it('writes one recoverable folder and preserves the exact CDN bytes and receipt', async () => {
    const { session } = releaseFixture(2); const bytes = new TextEncoder().encode('{"synthetic":true}');
    const proof = { jobId: 'synthetic', buildId: 'synthetic', sha256: await sha256(bytes), cards: 2, verifiedAt: new Date().toISOString() };
    await saveDeliveryArtifact(session, proof, bytes, () => {}); const saved = (await loadDeliveryArtifact(session, () => {}))!;
    session.delivery = { ...proof, verifiedAt: '2026-11-18T00:00:00Z' };
    const { folder, files } = directory(); await writeReleaseArtifacts(folder, session, () => {}, saved);
    expect(new Uint8Array(await (files.get('after-deck.json') as Blob).arrayBuffer())).toEqual(bytes);
    expect(JSON.parse(files.get('publication-verification.json') as string)).toMatchObject({ status: 'PUBLISHED_AND_VERIFIED', sha256: proof.sha256 });
    expect(JSON.parse(files.get('publication-verification.json') as string).verifiedAt).toBe(session.delivery.verifiedAt);
    expect(releaseArtifactDownload(session, saved).proof.verifiedAt).toBe(session.delivery.verifiedAt);
    expect(JSON.parse(files.get('console-journal.json') as string).baselineInventory).toEqual(session.baselineInventory);
  });
  it('does not overwrite another bundle or close a file after its owner changes', async () => {
    const { session } = releaseFixture(2); const { folder, files, operations } = directory();
    files.set('release-bundle.json', '{"another":"release"}');
    await expect(writeReleaseArtifacts(folder, session, () => {})).rejects.toThrow(/different frozen release/);
    expect(operations).toEqual([]); files.clear();
    await expect(writeReleaseArtifacts(folder, session, () => { if (operations.length) throw new Error('account changed'); })).rejects.toThrow(/account changed/);
    expect(operations).toContain('abort:release-bundle.json'); expect(files.size).toBe(0);
  });
});
