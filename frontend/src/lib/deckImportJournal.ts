import type { ImportCardsBatchResult } from '../api/authoring';
import { cardInputFor, chunkImportActions, wouldClearTranslations, type ImportAction } from './deckImportRunner';

export type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & Partial<Pick<Storage, 'key' | 'length'>>;
export interface ImportJournal {
  version: 1;
  account: string;
  deckId: number;
  runId: string;
  createdAt: number;
  batches: Array<{
    body: string;
    fingerprint: string;
    actions: ImportAction[];
    state: 'pending' | 'unknown' | 'committed' | 'rejected';
    result?: ImportCardsBatchResult;
    error?: { code: string; message: string };
  }>;
}
const PREFIX = 'recallsmith-import/v1/';
export const IMPORT_JOURNAL_MAX_CHARS = 2_000_000;
const key = (account: string, deckId: number) => `${PREFIX}${encodeURIComponent(account)}/${deckId}`;
const corrupt = () => new Error('Import recovery data is invalid. Submission is blocked; keep this browser data and contact support.');
export const hasPendingImport = (journal: ImportJournal) => !journal.batches.some(b => b.state === 'rejected') && journal.batches.some(b => b.state === 'pending' || b.state === 'unknown');
export const IMPORT_JOURNAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

async function fingerprint(body: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))), b => b.toString(16).padStart(2, '0')).join('');
}
async function validate(journal: ImportJournal, account: string, deckId: number) {
  if (journal?.version !== 1 || journal.account !== account || journal.deckId !== deckId || !journal.runId ||
      !Number.isFinite(journal.createdAt) || !Array.isArray(journal.batches) || journal.batches.length === 0 || journal.batches.length > 100) throw corrupt();
  const ids = new Set<string>();
  let stopped = false;
  for (const batch of journal.batches) {
    if (stopped && batch.state !== 'pending') throw corrupt();
    if (batch.state !== 'committed') stopped = true;
    if (typeof batch.body !== 'string' || !Array.isArray(batch.actions) || !['pending', 'unknown', 'committed', 'rejected'].includes(batch.state) ||
        batch.fingerprint !== await fingerprint(batch.body)) throw corrupt();
    const body = JSON.parse(batch.body);
    if (body.deckId !== deckId || typeof body.operationId !== 'string' || !body.operationId || ids.has(body.operationId) ||
        !Array.isArray(body.cards) || body.cards.length === 0 || body.cards.length > 500 ||
        JSON.stringify(body.cards) !== JSON.stringify(batch.actions.map(cardInputFor)) ||
        (batch.state === 'committed' && (!batch.result || ![batch.result.created, batch.result.updated, batch.result.unchanged].every(n => Number.isSafeInteger(n) && n >= 0)))) throw corrupt();
    ids.add(body.operationId);
  }
}

export async function readImportJournal(account: string, deckId: number, storage: JournalStorage = localStorage): Promise<ImportJournal | null> {
  const raw = storage.getItem(key(account, deckId));
  if (raw === null) return null;
  if (raw.length > IMPORT_JOURNAL_MAX_CHARS) throw corrupt();
  let journal: ImportJournal;
  try { journal = JSON.parse(raw) as ImportJournal; await validate(journal, account, deckId); }
  catch { throw corrupt(); }
  if (!hasPendingImport(journal) && Date.now() - journal.createdAt > IMPORT_JOURNAL_RETENTION_MS) {
    storage.removeItem(key(account, deckId));
    return null;
  }
  return journal;
}

export function saveImportJournal(journal: ImportJournal, storage: JournalStorage = localStorage): void {
  const raw = JSON.stringify(journal);
  if (raw.length > IMPORT_JOURNAL_MAX_CHARS) throw new Error('Import is too large to save safely in this browser. Split the source and preview again.');
  const current = storage.getItem(key(journal.account, journal.deckId));
  if (current && JSON.parse(current).runId !== journal.runId) throw new Error('Another import replaced this run. Reload recovery before continuing.');
  storage.setItem(key(journal.account, journal.deckId), raw);
  if (storage.getItem(key(journal.account, journal.deckId)) !== raw) throw new Error('Browser storage could not retain import recovery data. Submission is blocked.');
}

/** One bounded journal per account/deck. Unknown work is never aged out as if rolled back. */
export async function createImportJournal(account: string, deckId: number, actions: readonly ImportAction[], storage: JournalStorage = localStorage): Promise<ImportJournal> {
  if (!account) throw new Error('Sign in again before importing.');
  if (actions.some(wouldClearTranslations)) throw new Error('Preview again and explicitly approve clearing translations before importing.');
  const previous = await readImportJournal(account, deckId, storage);
  if (previous && hasPendingImport(previous)) throw new Error('Recover the saved import before starting another import.');
  const batches = [];
  for (const chunk of chunkImportActions(deckId, actions)) {
    const body = JSON.stringify({ deckId, operationId: crypto.randomUUID(), cards: chunk.map(cardInputFor) });
    batches.push({ body, fingerprint: await fingerprint(body), actions: chunk, state: 'pending' as const });
  }
  const journal: ImportJournal = { version: 1, account, deckId, runId: crypto.randomUUID(), createdAt: Date.now(), batches };
  await validate(journal, account, deckId);
  // Replacing a completed/rejected run is safe only after a fresh preview. Keep the old
  // journal until the replacement write succeeds, including quota failure.
  const raw = JSON.stringify(journal);
  if (raw.length > IMPORT_JOURNAL_MAX_CHARS) throw new Error('Import is too large to save safely. Split the source and preview again.');
  if (storage.key && storage.length !== undefined) {
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key!(i)).filter((k): k is string => !!k?.startsWith(PREFIX));
    let count = 0, chars = raw.length;
    for (const savedKey of keys) {
      if (savedKey === key(account, deckId)) continue;
      const saved = storage.getItem(savedKey);
      if (saved === null) continue;
      try {
        const old = JSON.parse(saved) as ImportJournal;
        await validate(old, old.account, old.deckId);
        if (old.version === 1 && Array.isArray(old.batches) && old.batches.every(b => b.state === 'committed') && Date.now() - old.createdAt > IMPORT_JOURNAL_RETENTION_MS) {
          storage.removeItem(savedKey); continue;
        }
      } catch { /* Retain unrecognized data; it cannot prove a safe discard. */ }
      count++; chars += saved.length;
    }
    if (count >= 10 || chars > 4_000_000) throw new Error('Saved import recovery storage is full. Recover existing imports before starting another.');
  }
  const latest = await readImportJournal(account, deckId, storage);
  if (latest && hasPendingImport(latest)) throw new Error('Another tab started an import. Recover that saved import first.');
  storage.setItem(key(account, deckId), raw);
  if (storage.getItem(key(account, deckId)) !== raw) throw new Error('Browser storage could not retain import recovery data.');
  return journal;
}

export async function validateImportJournal(journal: ImportJournal): Promise<void> {
  await validate(journal, journal.account, journal.deckId);
}


/** Serialize the entire create/recover cycle across tabs, including the first save. */
export async function withImportJournalLock<T>(account: string, deckId: number, action: () => Promise<T>): Promise<T> {
  if (!globalThis.navigator?.locks) throw new Error('This browser cannot safely lock import recovery. Use a current browser in a secure connection.');
  return navigator.locks.request(key(account, deckId), { mode: 'exclusive' }, action);
}
