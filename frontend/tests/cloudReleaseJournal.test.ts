import { createHash, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudJournalPointer } from '../src/api/contentRelease';
import { loadCloudReleaseJournal, saveCloudReleaseJournal } from '../src/lib/cloudReleaseJournal';

const api = vi.hoisted(() => ({
  fetchCloudJournalPart: vi.fn(),
  fetchCloudJournalPointer: vi.fn(),
  putCloudJournalPart: vi.fn(),
  putCloudJournalPointer: vi.fn(),
}));
vi.mock('../src/api/contentRelease', () => api);

const owner = 'console-editor';
const empty: CloudJournalPointer = { revision: null, parts: [] };
const revision = `"${'a'.repeat(32)}"`;

beforeEach(() => vi.resetAllMocks());

describe('cloud release journal', () => {
  it('publishes a complete bounded part inventory and restores the exact bilingual journal', async () => {
    const raw = JSON.stringify({ question: '请求\n\nHow can I recover?', action: randomBytes(800_000).toString('base64') });
    const stored = new Map<string, string>();
    api.putCloudJournalPart.mockImplementation(async (digest: string, encoded: string, subject: string) => {
      expect(subject).toBe(owner);
      expect(encoded.length).toBeLessThan(1_048_576);
      expect(createHash('sha256').update(Buffer.from(encoded, 'base64')).digest('hex')).toBe(digest);
      stored.set(digest, encoded);
    });
    api.putCloudJournalPointer.mockImplementation(async (next: CloudJournalPointer, subject: string) => {
      expect(subject).toBe(owner);
      expect(next.revision).toBeNull();
      expect(next.parts).toEqual([...stored.keys()]);
      return { ...next, revision };
    });
    const pointer = await saveCloudReleaseJournal(owner, raw, empty);
    expect(pointer.parts).toHaveLength(2);

    api.fetchCloudJournalPointer.mockResolvedValue(pointer);
    api.fetchCloudJournalPart.mockImplementation(async (digest: string, subject: string) => {
      expect(subject).toBe(owner);
      return stored.get(digest);
    });
    expect(await loadCloudReleaseJournal(owner)).toEqual({ pointer, raw });
    expect(api.fetchCloudJournalPointer).toHaveBeenCalledWith(owner);
  });

  it('leaves the current pointer intact when a part could not be saved', async () => {
    api.putCloudJournalPart.mockRejectedValue(new Error('Could not store part.'));
    await expect(saveCloudReleaseJournal(owner, '{}', empty)).rejects.toThrow('Could not store part.');
    expect(api.putCloudJournalPointer).not.toHaveBeenCalled();
  });

  it('clears a completed journal using the expected previous revision', async () => {
    const current = { revision, parts: ['b'.repeat(64)] };
    const next = { revision: `"${'c'.repeat(32)}"`, parts: [] };
    api.putCloudJournalPointer.mockResolvedValue(next);
    expect(await saveCloudReleaseJournal(owner, '', current)).toEqual(next);
    expect(api.putCloudJournalPointer).toHaveBeenCalledWith({ revision, parts: [] }, owner);
    expect(api.putCloudJournalPart).not.toHaveBeenCalled();
  });
});
