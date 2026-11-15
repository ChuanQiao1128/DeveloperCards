import { describe, it, expect, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createImportJournal, readImportJournal, saveImportJournal } from '../src/lib/deckImportJournal';
import { resumeImport } from '../src/lib/deckImportRunner';
import { parseDeckMarkdown, planImport } from '../src/lib/deckImport';

vi.stubGlobal('crypto', webcrypto);
function storage() {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: (i: number) => [...data.keys()][i] ?? null, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
}
const actions = (count = 1) => planImport(parseDeckMarkdown('# deck: test\n' + Array.from({ length: count }, (_, i) => `\n## uid-${i} | d2\nQ:\nQuestion\nA:\nAnswer`).join('\n')), []).creates;
const ok = <T>(data: T) => ({ success: true, data, error: null, traceId: 't' });
const failed = { success: false, data: null, error: { code: 'TIMEOUT', message: 'lost' }, traceId: 't' };
describe('durable import recovery', () => {
  it('persists before send, reconciles a missing response after reload, and never writes twice', async () => {
    const store = storage();
    const journal = await createImportJournal('account-a', 7, actions(), store);
    const write = vi.fn(async () => failed);
    const lookup = vi.fn(async () => failed);
    await resumeImport(journal, { importCards: write, lookupReceipt: lookup }, { storage: store });
    expect(write).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledTimes(1);
    const restored = await readImportJournal('account-a', 7, store);
    expect(restored?.batches[0].state).toBe('unknown');
    lookup.mockResolvedValueOnce(ok({ found: true, result: { created: 1, updated: 0, unchanged: 0 } }) as never);
    const result = await resumeImport(restored!, { importCards: write, lookupReceipt: lookup }, { storage: store });
    expect(result.created).toBe(1); expect(write).toHaveBeenCalledTimes(1);
    expect(await readImportJournal('account-b', 7, store)).toBeNull();
  });
  it('resends the original identity and body only after authoritative absence', async () => {
    const store = storage(); const journal = await createImportJournal('a', 7, actions(), store);
    journal.batches[0].state = 'unknown'; saveImportJournal(journal, store);
    const write = vi.fn<import('../src/lib/deckImportRunner').ImportBatchWriter['importCards']>(async () => ok({ created: 1, updated: 0, unchanged: 0 }));
    await resumeImport(journal, { importCards: write, lookupReceipt: vi.fn(async () => ok({ found: false })) }, { storage: store });
    expect(write.mock.calls[0][0].serializedBody).toBe(journal.batches[0].body);
    expect(write.mock.calls[0][0].operationId).toBe(JSON.parse(journal.batches[0].body).operationId);
  });
  it('storage failure or corrupt body blocks submission', async () => {
    const store = storage(); const journal = await createImportJournal('a', 7, actions(), store);
    const write = vi.fn();
    await expect(resumeImport(journal, { importCards: write, lookupReceipt: vi.fn() }, { storage: { ...store, setItem: () => { throw Error('quota'); } } })).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    journal.batches[0].body = journal.batches[0].body.replace('Question', 'changed');
    await expect(resumeImport(journal, { importCards: write, lookupReceipt: vi.fn() }, { storage: store })).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
  it('session changes and permission denial stop recovery before a send', async () => {
    const store = storage(); const journal = await createImportJournal('a', 7, actions(), store);
    journal.batches[0].state = 'unknown'; saveImportJournal(journal, store);
    const write = vi.fn();
    const lookup = vi.fn(async () => ({ ...failed, error: { code: 'FORBIDDEN', message: 'revoked' } }));
    await resumeImport(journal, { importCards: write, lookupReceipt: lookup }, { storage: store });
    expect(write).not.toHaveBeenCalled();
    lookup.mockClear();
    await resumeImport(journal, { importCards: write, lookupReceipt: lookup }, { storage: store, isCurrent: () => false });
    expect(lookup).not.toHaveBeenCalled();
  });
});


it('keeps earlier commits and stops later dependent batches on a rejected preview', async () => {
  const store = storage(); const journal = await createImportJournal('a', 7, actions(1001), store);
  const write = vi.fn<import('../src/lib/deckImportRunner').ImportBatchWriter['importCards']>()
    .mockImplementationOnce(async params => {
      expect((await readImportJournal('a', 7, store))!.batches[0].state).toBe('unknown');
      expect((await readImportJournal('a', 7, store))!.batches[0].body).toBe(params.serializedBody);
      return ok({ created: 500, updated: 0, unchanged: 0 });
    }).mockResolvedValueOnce({ ...failed, error: { code: 'VERSION_CONFLICT', message: 'Stale preview' } });
  const result = await resumeImport(journal, { importCards: write }, { storage: store });
  expect(result.created).toBe(500); expect(result.notRun).toBe(1); expect(write).toHaveBeenCalledTimes(2);
  expect((await readImportJournal('a', 7, store))!.batches.map(b => b.state)).toEqual(['committed', 'rejected', 'pending']);
  const again = await resumeImport((await readImportJournal('a', 7, store))!, { importCards: write }, { storage: store });
  expect(again.created).toBe(500); expect(write).toHaveBeenCalledTimes(2);
  await expect(createImportJournal('a', 7, actions(), store)).resolves.toBeDefined();
});

it('bounds retained journals and refuses expired resends until a serialized absence is known', async () => {
  const store = storage();
  for (let i = 1; i <= 10; i++) await createImportJournal('a', i, actions(), store);
  await expect(createImportJournal('a', 11, actions(), store)).rejects.toThrow('storage is full');
  const journal = (await readImportJournal('a', 1, store))!;
  journal.createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000; journal.batches[0].state = 'unknown'; saveImportJournal(journal, store);
  const write = vi.fn();
  const lookup = vi.fn(async () => failed);
  await resumeImport(journal, { importCards: write, lookupReceipt: lookup }, { storage: store });
  expect((await readImportJournal('a', 1, store))!.batches[0].state).toBe('unknown');
  const result = await resumeImport(journal, { importCards: write, lookupReceipt: async () => ok({ found: false }) }, { storage: store });
  expect(result.failures[0].code).toBe('IMPORT_EXPIRED'); expect(write).not.toHaveBeenCalled();
});

it('retains unknown work when a later committed state cannot be saved', async () => {
  const store = storage(); const journal = await createImportJournal('a', 7, actions(), store);
  let writes = 0;
  const unreliable = { ...store, setItem: (k: string, v: string) => { if (++writes === 2) throw Error('full'); store.setItem(k, v); } };
  const write = vi.fn(async () => ok({ created: 1, updated: 0, unchanged: 0 }));
  await expect(resumeImport(journal, { importCards: write }, { storage: unreliable })).rejects.toThrow('full');
  const restored = (await readImportJournal('a', 7, store))!;
  expect(restored.batches[0].state).toBe('unknown');
  const result = await resumeImport(restored, { importCards: write, lookupReceipt: async () => ok({ found: true, result: { created: 1, updated: 0, unchanged: 0 } }) }, { storage: store });
  expect(result.created).toBe(1); expect(write).toHaveBeenCalledTimes(1);
});
