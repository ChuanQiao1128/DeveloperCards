import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

const USER = 'envelope-user';
const NOW_MS = 50_000;

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      store.delete(k);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const k of keys) store.delete(k);
    }),
  },
}));

let uuidN = 0;
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => `new-${++uuidN}`) }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: 'test' } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

// Records every push body so the golden assertion can inspect the exact bytes;
// acks every id so the queue drains and the next test starts empty.
const pushedBodies: unknown[] = [];

vi.mock('../../src/api/apiClient', () => ({
  apiJson: vi.fn(async (path: string, opts: any) => {
    const ok = (data: any) => ({ success: true, data, error: null, traceId: 't', version: '1' });
    if (path.startsWith('/api/v1/user/bootstrap')) {
      return ok({ created: false, serverTimeMs: 1 });
    }
    if (path.startsWith('/api/v1/sync/push')) {
      pushedBodies.push(opts?.body);
      const ids = (opts?.body?.events ?? []).map((e: any) => String(e.eventId));
      return ok({
        serverTimeMs: 1,
        receivedCount: ids.length,
        acceptedCount: ids.length,
        acceptedEventIds: ids,
        duplicateEventIds: [],
      });
    }
    return ok({ serverTimeMs: 1, sinceMs: null, items: [] });
  }),
}));

vi.mock('../../src/content/deckRepository', () => ({ resolveDeckBySlug: vi.fn(async () => null) }));
vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => []),
  saveDeckProgress: vi.fn(async () => undefined),
  setActiveUserSubForStorage: vi.fn(),
}));

// This file, and only this file, mocks clientCapabilities; every other
// progressSync suite runs the real module (its dynamic import fails under node
// and yields {}). The capability outcome is swapped per case via capsState.
const capsState = vi.hoisted(() => ({ value: {} as { clientFeatures?: string[]; updateId?: string } }));
vi.mock('../../src/sync/clientCapabilities', () => ({
  getClientCapabilities: vi.fn(async () => capsState.value),
}));

import {
  forceProgressSync,
  recordReviewEvent,
  setActiveUserSub,
  setSyncAccessToken,
} from '../../src/sync/progressSync';

let dateSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  store.set('devcards:deviceId:v1', 'device-golden');
  await setActiveUserSub(USER);
  await setSyncAccessToken('test-token');
});

beforeEach(() => {
  pushedBodies.length = 0;
  capsState.value = {};
  dateSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
});

afterEach(() => {
  dateSpy.mockRestore();
});

// Record after sign-in so the event lands in the user partition and the queue
// cache sees it, then drive one push and hand back the captured body.
async function pushOne(stableUid: string): Promise<{ id: string | null; body: any }> {
  const id = await recordReviewEvent({
    deckSlug: 'algo',
    stableUid,
    rating: 'good',
    reviewedAtMs: 1_000,
  });
  await forceProgressSync('manual');
  expect(pushedBodies).toHaveLength(1);
  return { id, body: pushedBodies[0] };
}

const eventBytes = readFileSync(new URL('../../../contracts/content-v1/samples/sync-event.bytes.json', import.meta.url), 'utf8');
const goldenEvent = JSON.parse(eventBytes);

it('produces the shared sync-event bytes through the actual record/queue/push path', async () => {
  const { body } = await pushOne('fixture-choice');
  const event = body.events[0];
  // Identity comes from UUID generation; the contract fixture supplies its deterministic value.
  expect(JSON.stringify({ ...event, eventId: goldenEvent.eventId, deckSlug: 'fixture-contract' })).toBe(eventBytes);
});

it('replays shared missing/null/future sync schema versions through the actual queue mapper', async () => {
  const cases = JSON.parse(readFileSync(new URL('../../../contracts/content-v1/samples/cases.json', import.meta.url), 'utf8'));
  for (const version of cases.syncVersions) {
    pushedBodies.length = 0;
    const user = `contract-${version.name}`;
    const event = { ...goldenEvent };
    delete event.schemaVersion;
    if ('value' in version) event.schemaVersion = version.value;
    store.set(`devcards:u:${user}:sync:progressQueue:v1`, JSON.stringify([event]));
    await setActiveUserSub(user);
    await setSyncAccessToken('test-token');
    await forceProgressSync('manual');
    expect((pushedBodies[0] as any).events[0].schemaVersion).toBe(version.expected);
    expect((pushedBodies[0] as any).events[0].eventId).toBe(goldenEvent.eventId);
  }
});
