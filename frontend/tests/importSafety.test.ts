import { describe, expect, it, vi } from 'vitest';
import { parseDeckMarkdown, planImport } from '../src/lib/deckImport';
import { runImport } from '../src/lib/deckImportRunner';
import type { ImportBatchWriter } from '../src/lib/deckImportRunner';

function actions(count = 1) {
  const doc = '# deck: test\n' + Array.from({ length: count }, (_, i) =>
    `\n## test-${i} | d2\nQ:\nQuestion ${i}?\nA:\nAnswer ${i}.\n`).join('');
  return planImport(parseDeckMarkdown(doc), []).creates;
}

const ok = { success: true as const, data: { created: 1, updated: 0, unchanged: 0 }, error: null, traceId: 'test' };
const timeout = { success: false as const, data: null, error: { code: 'TIMEOUT', message: 'timeout' }, traceId: 'test' };

describe('import safety at the writer boundary', () => {
  it('binds every create to absence and keeps one operation ID across retries', async () => {
    const write = vi.fn<ImportBatchWriter['importCards']>().mockResolvedValueOnce(timeout).mockResolvedValue(ok);
    await runImport(7, actions(), { importCards: write }, { sleep: async () => {} });
    expect(write.mock.calls).toHaveLength(2);
    const first = write.mock.calls[0][0];
    expect(first).toHaveProperty('operationId', expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(first.cards[0]).toHaveProperty('expectedVersion', 0);
    expect(write.mock.calls[1][0]).toEqual(first);
  });

  it('assigns separate operation IDs to separate committed batches', async () => {
    const write = vi.fn<ImportBatchWriter['importCards']>().mockResolvedValue(ok);
    await runImport(7, actions(501), { importCards: write });
    expect(write.mock.calls).toHaveLength(2);
    expect(write.mock.calls[0][0]).toHaveProperty('operationId', expect.any(String));
    expect(write.mock.calls[1][0]).toHaveProperty('operationId', expect.any(String));
    expect(write.mock.calls[0][0].operationId).not.toBe(write.mock.calls[1][0].operationId);
  });

  it('records exhausted transport errors as unknown and stops later batches', async () => {
    const write = vi.fn<ImportBatchWriter['importCards']>().mockResolvedValue(timeout);
    const result = await runImport(7, actions(501), { importCards: write }, { sleep: async () => {} });
    expect(write).toHaveBeenCalledTimes(4);
    expect(result.notRun).toBe(1);
    expect(result.batches).toMatchObject([{ state: 'unknown', operationId: expect.any(String) }]);
    expect(result.failures[0].code).toBe('IMPORT_UNCONFIRMED');
  });

  it('stops before another batch when the originating session changes', async () => {
    let current = true;
    const progress = vi.fn();
    const write = vi.fn<ImportBatchWriter['importCards']>().mockImplementation(async () => { current = false; return ok; });
    await runImport(7, actions(501), { importCards: write }, { isCurrent: () => current, onProgress: progress });
    expect(write).toHaveBeenCalledTimes(1);
    expect(progress).not.toHaveBeenCalled();
  });
});
