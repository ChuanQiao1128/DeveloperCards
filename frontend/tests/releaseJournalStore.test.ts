import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadReleaseJournal, saveReleaseJournal } from '../src/lib/releaseJournalStore';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
describe('durable release journals', () => {
  it('round-trips a complete journal beyond sessionStorage quota with exact frozen request bytes', async () => {
    const raw = JSON.stringify({ backup: '卡片'.repeat(3_000_000), payload: '{"actionId":"publish", "expectedLive":null}' });
    const first = await saveReleaseJournal('owner', raw, 0, () => {});
    expect((await loadReleaseJournal('owner'))).toEqual(first);
    expect(first.raw).toBe(raw);
    expect(await loadReleaseJournal('other-owner')).toBeNull();
  });
  it('rejects stale tab writes and keeps the latest frozen action', async () => {
    await saveReleaseJournal('owner', 'initial', 0, () => {});
    await saveReleaseJournal('owner', 'frozen-publish', 1, () => {});
    await expect(saveReleaseJournal('owner', 'stale-import', 1, () => {})).rejects.toThrow('another tab');
    expect(await loadReleaseJournal('owner')).toEqual({ raw: 'frozen-publish', revision: 2 });
  });
  it.each(['', 'restored recovery journal'])('archives the previous journal before reset or recovery (%s)', async replacement => {
    await saveReleaseJournal('owner', 'complete recovery backup', 0, () => {});
    await saveReleaseJournal('owner', replacement, 1, () => {}, true);
    expect(await loadReleaseJournal('owner')).toEqual({ raw: replacement, revision: 2 });
    await expect(saveReleaseJournal('owner', 'stale result', 1, () => {})).rejects.toThrow('another tab');
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('devcards-content-release', 1); request.onsuccess = () => resolve(request.result); });
    const archived = await new Promise(resolve => { const tx = db.transaction('journals', 'readonly'); const request = tx.objectStore('journals').get(['owner', 1]); tx.oncomplete = () => resolve(request.result); });
    db.close();
    expect(archived).toEqual({ raw: 'complete recovery backup', revision: 1 });
  });
  it('aborts before persistence when ownership changes while opening storage', async () => {
    await saveReleaseJournal('owner', 'initial', 0, () => {});
    const assertOwner = vi.fn().mockImplementationOnce(() => {}).mockImplementation(() => { throw new Error('Owner changed'); });
    await expect(saveReleaseJournal('owner', 'foreign-result', 1, assertOwner)).rejects.toThrow('Owner changed');
    expect((await loadReleaseJournal('owner'))?.raw).toBe('initial');
  });
  it('aborts a transaction if ownership changes before the put', async () => {
    const assertOwner = vi.fn().mockImplementationOnce(() => {}).mockImplementationOnce(() => {})
      .mockImplementation(() => { throw new Error('Owner changed'); });
    await expect(saveReleaseJournal('owner', 'foreign-result', 0, assertOwner)).rejects.toThrow('Owner changed');
    expect(await loadReleaseJournal('owner')).toBeNull();
  });
});
