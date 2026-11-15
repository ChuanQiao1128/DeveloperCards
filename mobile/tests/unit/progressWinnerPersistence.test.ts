import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ store: new Map<string, string>(), rows: [] as any[], installed: false }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => io.store.get(key) ?? null,
  setItem: async (key: string, value: string) => { io.store.set(key, value); },
  removeItem: async (key: string) => { io.store.delete(key); },
  getAllKeys: async () => [...io.store.keys()],
  multiRemove: async (keys: string[]) => { keys.forEach(key => io.store.delete(key)); },
} }));
vi.mock('expo-crypto', () => ({ randomUUID: () => '20000000-0000-4000-8000-000000000001' }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: 'test' } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../../src/sync/drawStateSync', () => ({ syncDrawStateNow: async () => {} }));
vi.mock('../../src/sync/clientCapabilities', () => ({ getClientCapabilities: async () => ({}) }));
vi.mock('../../src/content/deckRepository', () => ({ resolveDeckBySlug: async () => io.installed ? deck : null }));
vi.mock('../../src/api/apiClient', () => ({ apiJson: async (path: string) => {
  if (path.includes('/user/bootstrap')) return { data: { userSub: 'A' } };
  if (path.includes('/sync/progress')) { const items = io.rows; io.rows = []; return { data: { items } }; }
  return { data: { acceptedEventIds: [], duplicateEventIds: [] } };
} }));

const T = 1_700_000_000_000;
const LOW = '10000000-0000-4000-8000-000000000001';
const HIGH = 'f0000000-0000-4000-8000-000000000001';
const deck: any = { Slug: 'winner', Version: '1', Cards: [{ StableUid: 'one', Revision: 1 }] };
const row = (high: boolean) => ({ deckSlug: 'winner', stableUid: 'one', status: high ? 1 : 2,
  reviewCount: high ? 2 : 9, lastSeenRevision: high ? 2 : 9,
  lastRating: high ? 4 : 1, lastReviewedAtMs: T, updatedAtMs: T + 1,
  lastReviewEventId: high ? HIGH : LOW, nextReviewAtMs: T + (high ? 3 : 1) * 86_400_000,
  srsStage: high ? 2 : 0, schedulerState: { lapses: high ? 2 : 0, hardStreak: high ? 1 : 0,
    fsrsStability: high ? 4 : 1, fsrsDifficulty: high ? 5 : 7, fsrsAnchorAt: T, fsrsReviewedAt: T } });
const expected = { stableUid: 'one', lastReviewEventId: HIGH, stage: 2,
  lastReviewedAt: T, nextReviewAt: T + 3 * 86_400_000, lapses: 2, hardStreak: 1,
  fsrsStability: 4, fsrsDifficulty: 5, fsrsAnchorAt: T, fsrsReviewedAt: T,
  reviewCount: 9, status: 2, lastSeenRevision: 9 };
let sync: typeof import('../../src/sync/progressSync');
let storage: typeof import('../../src/review/storage');
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers({ now: T + 10_000 });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  io.store.clear(); io.rows = []; io.installed = false;
  sync = await import('../../src/sync/progressSync');
  storage = await import('../../src/review/storage');
  await sync.setActiveUserSub('A'); await sync.setSyncAccessToken('token');
  await vi.advanceTimersByTimeAsync(1);
});
afterEach(async () => {
  await sync.setSyncAccessToken(null); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});
async function pull(...rows: any[]) {
  await vi.advanceTimersByTimeAsync(2_001);
  io.rows = rows; sync.scheduleProgressSync({ delayMs: 0, reason: 'manual' });
  await vi.advanceTimersByTimeAsync(1);
}

describe('winning review survives separate responses and durable replay', () => {
  it('converges in separate calls, one batch and duplicate replays without losing independent maxima', () => {
    for (const order of [[false,true], [true,false], [true,false,true,false]]) {
      let local: any[] = [];
      for (const high of order) local = sync.mergeRemoteIntoLocalProgress(local, [row(high)]).merged;
      expect(local[0]).toMatchObject(expected);
      expect(sync.mergeRemoteIntoLocalProgress(local, [row(true)]).changed).toBe(false);
    }
    expect(sync.mergeRemoteIntoLocalProgress([], [row(false),row(true)]).merged[0]).toMatchObject(expected);
  });
  it('replaces an equal-time legacy-null winner but preserves a later content demotion', () => {
    const legacy = { stableUid: 'one', lastReviewedAt: T, stage: 5, nextReviewAt: T + 10 * 86_400_000, lapses: 7 };
    expect(sync.mergeRemoteIntoLocalProgress([legacy], [row(true)]).merged[0])
      .toMatchObject({ ...expected, reviewCount: 2, status: 1, lastSeenRevision: 2 });
    const demoted = { ...legacy, stage: 0, nextReviewAt: T + 1, revisionDemotedAt: T + 1 };
    const merged = sync.mergeRemoteIntoLocalProgress([demoted], [row(true)]).merged[0];
    expect(merged).toMatchObject({ ...demoted, lastReviewEventId: HIGH });
    expect(sync.mergeRemoteIntoLocalProgress([merged], [row(false)]).merged[0])
      .toMatchObject({ ...demoted, lastReviewEventId: HIGH, reviewCount: 9, status: 2, lastSeenRevision: 9 });
  });
  it('retains winner identity and complete state through actual storage and a module restart', async () => {
    const merged = sync.mergeRemoteIntoLocalProgress([], [row(false),row(true)]).merged;
    await storage.saveDeckProgress(deck, merged, 'A');
    await sync.setSyncAccessToken(null);
    vi.resetModules(); storage = await import('../../src/review/storage');
    const loaded = await storage.loadDeckProgress(deck, 'A');
    expect(loaded[0]).toMatchObject(expected);
    expect(sync.mergeRemoteIntoLocalProgress(loaded, [row(false)]).merged[0]).toMatchObject(expected);
  });
  it.each([[false,true], [true,false]])('replaces equal-updatedAt durable cache by event order: %j', async (first, second) => {
    await pull(row(first)); await pull(row(second));
    const cached = JSON.parse(io.store.get('devcards:u:A:sync:remoteCache:v1:winner')!).one;
    expect(cached).toMatchObject({ lastReviewEventId: HIGH, reviewCount: 9, status: 2, lastSeenRevision: 9 });
    io.installed = true;
    await sync.applyCachedRemoteProgress('winner');
    expect((await storage.loadDeckProgress(deck, 'A'))[0]).toMatchObject(expected);
    // Late losing response and cached replay cannot undo the higher winner.
    await pull(row(false)); await sync.applyCachedRemoteProgress('winner');
    expect((await storage.loadDeckProgress(deck, 'A'))[0]).toMatchObject(expected);
    await sync.setSyncAccessToken(null);
    vi.resetModules(); sync = await import('../../src/sync/progressSync'); storage = await import('../../src/review/storage');
    await sync.setActiveUserSub('A'); await sync.setSyncAccessToken('token'); await vi.advanceTimersByTimeAsync(1);
    await sync.applyCachedRemoteProgress('winner');
    expect((await storage.loadDeckProgress(deck, 'A'))[0]).toMatchObject(expected);
  });
});
