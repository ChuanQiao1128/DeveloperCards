export interface StoredReleaseJournal { raw: string; revision: number }

/** Serialize journal work within a browser. Each store also checks its revision. */
export async function withReleaseJournalLock<T>(owner: string, work: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  return locks ? locks.request(`recallsmith-release:${owner}`, work) : work();
}

async function openJournalDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('devcards-content-release', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('journals');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open release journal storage.'));
    request.onblocked = () => reject(new Error('Release journal storage is blocked by another tab.'));
  });
}

export async function loadReleaseJournal(owner: string): Promise<StoredReleaseJournal | null> {
  const db = await openJournalDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('journals', 'readonly');
    const request = tx.objectStore('journals').get(owner);
    tx.oncomplete = () => { db.close(); resolve(request.result ?? null); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Could not read release journal.')); };
  });
}

/** Commit the exact journal before transport; a stale tab cannot overwrite a newer action. */
export async function saveReleaseJournal(owner: string, raw: string, expectedRevision: number, assertOwner: () => void, archivePrevious = false): Promise<StoredReleaseJournal> {
  assertOwner();
  const db = await openJournalDatabase();
  try { assertOwner(); } catch (error) { db.close(); throw error; }
  return new Promise((resolve, reject) => {
    const tx = db.transaction('journals', 'readwrite');
    const store = tx.objectStore('journals');
    const request = store.get(owner);
    let failure: unknown;
    const next = { raw, revision: expectedRevision + 1 };
    request.onsuccess = () => {
      try {
        assertOwner();
        if ((request.result?.revision ?? 0) !== expectedRevision) throw new Error('Release journal changed in another tab. Reload and reconcile its actions before continuing.');
        // Reset or file recovery preserves the previous complete backup in the same transaction.
        if ((!raw || archivePrevious) && request.result?.raw) store.put(request.result, [owner, expectedRevision]);
        store.put(next, owner);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.onabort = () => { db.close(); reject(failure ?? tx.error ?? new Error('Could not persist release journal; request was not sent.')); };
    tx.oncomplete = () => {
      db.close();
      try { assertOwner(); resolve(next); } catch (error) { reject(error); }
    };
  });
}
