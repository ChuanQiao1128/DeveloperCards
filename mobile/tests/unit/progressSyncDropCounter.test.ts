import { beforeEach, describe, it, expect, vi } from 'vitest';

const USER = 'queue-user';
const OTHER = 'queue-other';
const PENDING = '__pending__';
const qKey = (sub: string) => `devcards:u:${sub}:sync:progressQueue:v1`;
const dropKey = (sub: string) => `devcards:u:${sub}:sync:droppedEvents:v1`;
const ownersKey = 'devcards:sync:pendingOwners:v1';
const store = new Map<string, string>();
let failedKey: string | null = null;
let failOwnersAfterClear = false;
let pushed: string[][] = [];
let ackCount = 25;
let onWrite: ((key: string) => void) | null = null;
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (k: string) => store.get(k) ?? null),
  setItem: vi.fn(async (k: string, v: string) => {
    onWrite?.(k);
    if (k === failedKey || (failOwnersAfterClear && k === ownersKey && store.get(qKey(PENDING)) === '[]')) throw new Error('storage failed');
    store.set(k, v);
  }),
  removeItem: vi.fn(async (k: string) => { store.delete(k); }),
  getAllKeys: vi.fn(async () => [...store.keys()]),
  multiRemove: vi.fn(async (keys: string[]) => { keys.forEach(k => store.delete(k)); }),
} }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'device-id') }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: 'test' } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../../src/sync/drawStateSync', () => ({ syncDrawStateNow: vi.fn(async () => {}) }));
vi.mock('../../src/sync/clientCapabilities', () => ({ getClientCapabilities: vi.fn(async () => ({ clientFeatures: [] })) }));
vi.mock('../../src/api/apiClient', () => ({ apiJson: vi.fn(async (path: string, options: any) => {
  let data: any = { items: [], hasMore: false };
  if (path.includes('bootstrap')) data = { userSub: USER };
  if (path.includes('/push')) {
    const ids = options.body.events.map((e: any) => e.eventId);
    pushed.push(ids);
    data = { acceptedEventIds: ids.slice(0, ackCount), duplicateEventIds: [] };
  }
  return { success: true, data };
}) }));
vi.mock('../../src/content/deckRepository', () => ({ resolveDeckBySlug: vi.fn(async () => null) }));
vi.mock('../../src/review/storage', () => ({ loadDeckProgress: vi.fn(async () => []), setActiveUserSubForStorage: vi.fn() }));

let sync: typeof import('../../src/sync/progressSync');
function seed(sub: string, count: number, prefix = sub) {
  store.set(qKey(sub), JSON.stringify(Array.from({ length: count }, (_, i) => ({
    eventId: `${prefix}-${i}`, deckSlug: 'algo', stableUid: `uid-${i}`, rating: 3,
    reviewedAtMs: 1000, deckVersion: null, lastSeenRevision: null,
  }))));
}
function ids(sub: string) { return JSON.parse(store.get(qKey(sub)) ?? '[]').map((e: any) => e.eventId); }
function rate(eventId: string) { return sync.recordReviewEvent({ eventId, deckSlug: 'algo', stableUid: eventId, rating: 'good' }); }
async function restart() { vi.resetModules(); sync = await import('../../src/sync/progressSync'); }
beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllTimers(); vi.useRealTimers();
  store.clear(); failedKey = null; failOwnersAfterClear = false; onWrite = null; pushed = []; ackCount = 25;
  await restart();
});

describe('queue capacity preserves acknowledged facts', () => {
  it.each([2999, 3000, 3001])('protects a persisted queue of %i events', async count => {
    seed(PENDING, count);
    store.set(dropKey(PENDING), '7');
    const attempt = rate('next');
    if (count < 3000) await expect(attempt).resolves.toBe('next');
    else await expect(attempt).rejects.toThrow('Offline review queue is full');
    expect(ids(PENDING)).toEqual([...Array.from({ length: count }, (_, i) => `${PENDING}-${i}`), ...(count < 3000 ? ['next'] : [])]);
    expect((await sync.getProgressSyncDebugState()).pendingDroppedCount).toBe(7);
  });
  it('same ID retry succeeds at capacity without consuming a slot', async () => {
    seed(PENDING, 3000);
    await expect(rate(`${PENDING}-0`)).resolves.toBe(`${PENDING}-0`);
    expect(ids(PENDING)).toHaveLength(3000);
  });
  it('a failed enqueue cannot acknowledge an event or poison its cache', async () => {
    failedKey = qKey(PENDING);
    await expect(rate('retry')).rejects.toThrow('storage failed');
    expect(ids(PENDING)).toEqual([]);
    failedKey = null;
    await expect(rate('retry')).resolves.toBe('retry');
    expect(ids(PENDING)).toEqual(['retry']);
  });
});

describe('persistent anonymous ownership', () => {
  it('claims the full batch before copying, survives restart and keeps fresh reviews separate', async () => {
    seed(USER, 2999); seed(PENDING, 3, 'anon');
    await sync.setActiveUserSub(USER);
    expect(ids(USER)).toHaveLength(3000);
    expect(ids(PENDING)).toEqual(['anon-1', 'anon-2']);
    expect(JSON.parse(store.get(ownersKey)!)).toEqual({ 'anon-1': USER, 'anon-2': USER });
    await restart();
    await rate('fresh');
    await sync.setActiveUserSub(OTHER);
    expect(ids(OTHER)).toEqual(['fresh']);
    expect(ids(PENDING)).toEqual(['anon-1', 'anon-2']);
    await sync.setActiveUserSub(USER);
    expect(ids(PENDING)).toEqual(['anon-1', 'anon-2']);
  });
  it('ACK capacity resumes claimed events in the same bounded sync run', async () => {
    seed(USER, 3000); seed(PENDING, 2, 'anon');
    await sync.setActiveUserSub(USER);
    await sync.setSyncAccessToken('test-token');
    await sync.forceProgressSync();
    expect(ids(PENDING)).toEqual([]);
    expect(ids(USER)).toContain('anon-0');
    expect(ids(USER)).toContain('anon-1');
    expect(pushed).toHaveLength(20);
    expect(ids(USER)).toHaveLength(2502);
    expect(JSON.parse(store.get(ownersKey)!)).toEqual({});
    await sync.setSyncAccessToken(null);
  });
  it('continues even when the just-acked batch is shorter than 25', async () => {
    seed(USER, 1);
    await sync.setActiveUserSub(USER);
    // Inject an interrupted continuation after identity resolution.
    seed(PENDING, 2, 'later');
    store.set(ownersKey, JSON.stringify({ 'later-0': USER, 'later-1': USER }));
    (await import('../../src/sync/progressQueueCache')).invalidateProgressQueueCache(PENDING);
    await sync.setSyncAccessToken('test-token');
    await sync.forceProgressSync();
    expect(pushed).toEqual([['queue-user-0'], ['later-0', 'later-1']]);
    expect(ids(PENDING)).toEqual([]);
    await sync.setSyncAccessToken(null);
  });
  it('retries failed copy claims when the destination queue is empty', async () => {
    seed(PENDING, 2, 'anon');
    failedKey = qKey(USER);
    await expect(sync.setActiveUserSub(USER)).rejects.toThrow('storage failed');
    failedKey = null;
    await sync.setSyncAccessToken('test-token');
    await sync.forceProgressSync();
    expect(pushed).toEqual([['anon-0', 'anon-1']]);
    expect(ids(PENDING)).toEqual([]);
    await sync.setSyncAccessToken(null);
  });
  it('rejects invalid ownership metadata without reassigning or clearing events', async () => {
    seed(PENDING, 2, 'anon');
    store.set(ownersKey, JSON.stringify({ 'anon-0': 42 }));
    await expect(sync.setActiveUserSub(OTHER)).rejects.toThrow('Invalid pending review owner');
    expect(ids(OTHER)).toEqual([]);
    expect(ids(PENDING)).toEqual(['anon-0', 'anon-1']);
  });
  it.each(['claim', 'copy', 'clear', 'cleanup'])('recovers %s write failure without another account taking the batch', async step => {
    seed(PENDING, 2, 'anon');
    failedKey = step === 'claim' ? ownersKey : step === 'copy' ? qKey(USER) : step === 'clear' ? qKey(PENDING) : null;
    failOwnersAfterClear = step === 'cleanup';
    await expect(sync.setActiveUserSub(USER)).rejects.toThrow('storage failed');
    expect(new Set([...ids(PENDING), ...ids(USER)])).toEqual(new Set(['anon-0', 'anon-1']));
    failedKey = null; failOwnersAfterClear = false;
    await restart();
    await sync.setActiveUserSub(OTHER);
    // Before the ownership write succeeds no account has claimed anything.
    expect(ids(OTHER)).toEqual(step === 'claim' ? ['anon-0', 'anon-1'] : []);
    if (step !== 'claim') {
      await sync.setActiveUserSub(USER);
      expect(ids(USER)).toEqual(['anon-0', 'anon-1']);
      expect(ids(PENDING)).toEqual([]);
    }
  });
  it('stops adoption when the session changes during the ownership write', async () => {
    seed(PENDING, 2, 'anon');
    const boundary = await import('../../src/auth/sessionBoundary');
    onWrite = key => { if (key === ownersKey) boundary.invalidateAuthSession(); };
    await sync.setActiveUserSub(USER);
    expect(ids(USER)).toEqual([]);
    expect(ids(PENDING)).toEqual(['anon-0', 'anon-1']);
    onWrite = null;
    await sync.setActiveUserSub(OTHER);
    expect(ids(OTHER)).toEqual([]);
  });
  it('purge cleanup failure keeps other owners and is safe to retry', async () => {
    seed(PENDING, 2, 'anon');
    store.set(ownersKey, JSON.stringify({ 'anon-0': USER, 'anon-1': OTHER }));
    failedKey = ownersKey;
    await expect(sync.purgeClaimedPendingProgressEvents(USER)).rejects.toThrow('storage failed');
    expect(ids(PENDING)).toEqual(['anon-1']);
    expect(JSON.parse(store.get(ownersKey)!)['anon-1']).toBe(OTHER);
    failedKey = null;
    await sync.purgeClaimedPendingProgressEvents(USER);
    expect(ids(PENDING)).toEqual(['anon-1']);
    expect(JSON.parse(store.get(ownersKey)!)).toEqual({ 'anon-1': OTHER });
  });
  it('purges only the requested account claims, retaining all sources on failed deletion', async () => {
    seed(PENDING, 3, 'anon');
    store.set(ownersKey, JSON.stringify({ 'anon-0': USER, 'anon-1': OTHER }));
    failedKey = qKey(PENDING);
    await expect(sync.purgeClaimedPendingProgressEvents(USER)).rejects.toThrow('storage failed');
    expect(ids(PENDING)).toEqual(['anon-0', 'anon-1', 'anon-2']);
    expect(JSON.parse(store.get(ownersKey)!)['anon-0']).toBe(USER);
    failedKey = null;
    await sync.purgeClaimedPendingProgressEvents(USER);
    expect(ids(PENDING)).toEqual(['anon-1', 'anon-2']);
    expect(JSON.parse(store.get(ownersKey)!)).toEqual({ 'anon-1': OTHER });
  });
});
