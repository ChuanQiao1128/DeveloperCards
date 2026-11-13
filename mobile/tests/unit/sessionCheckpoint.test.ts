import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_REWARD_OUTCOME } from '../../src/features/gacha/rewards/rewardResolver';

const data = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => data.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { data.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { data.delete(key); }),
} }));
vi.mock('../../src/review/storage', () => ({
  getUserScopedKey: async (key: string, sub: string) => `user:${sub}:${key}`,
}));
import { checkpointDate, checkpointProgressStamp, clearSessionCheckpoint, loadSessionCheckpoint,
  saveSessionCheckpoint, type SessionCheckpoint } from '../../src/features/gacha/session/sessionCheckpoint';

const expected = { deckVersion: 'r2', context: 'mixed', progressStamp: 'progress-and-ownership' };
const value = (): SessionCheckpoint => ({
  v: 1, dateKey: checkpointDate(), ...expected, currentUid: 'next', showAnswer: true, limit: 2, minimumGoal: 1,
  focusRatedUids: [], attempts: [['next', 1]], mcqRun: { served: 0, lastNewKind: 'qa' },
  picks: { landed: 0, answered: 0 }, loadForecast: null,
  session: { sessionId: 'session', slug: 'aws', currentIndex: 1, completedCount: 1,
    startedAt: Date.now(), streakEarned: true, sessionRatings: [{ stableUid: 'previous', rating: 'hard' }],
    route: [1, 2].map(i => ({ id: String(i), role: 'normal', title: 'Study', subtitle: '' })),
    rewardOutcome: { ...EMPTY_REWARD_OUTCOME } },
});
beforeEach(() => { data.clear(); vi.clearAllMocks(); });
afterEach(() => vi.restoreAllMocks());

describe('durable study position', () => {
  it('restores from storage without an in-memory session and isolates account and deck', async () => {
    const saved = value();
    await saveSessionCheckpoint('a', 'aws', saved);
    expect(await loadSessionCheckpoint('a', 'aws', expected)).toEqual(saved);
    expect(await loadSessionCheckpoint('b', 'aws', expected)).toBeNull();
    expect(await loadSessionCheckpoint('a', 'other', expected)).toBeNull();
  });

  it('refuses stale deck, parameters, scheduler/ownership data and another calendar day', async () => {
    await saveSessionCheckpoint('a', 'aws', value());
    for (const field of ['deckVersion', 'context', 'progressStamp']) {
      expect(await loadSessionCheckpoint('a', 'aws', { ...expected, [field]: 'changed' })).toBeNull();
    }
    const now = new Date();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12));
    expect(await loadSessionCheckpoint('a', 'aws', expected)).toBeNull();
    vi.useRealTimers();
  });

  it('fingerprints every progress field and ownership, independent of property/row ordering', () => {
    const a = { stableUid: 'a', stage: 1, nextReviewAt: 3, lastReviewedAt: 2 };
    const b = { stableUid: 'b', stage: 0, nextReviewAt: 0 };
    expect(checkpointProgressStamp([a, b], new Set(['b', 'a'])))
      .toBe(checkpointProgressStamp([b, { nextReviewAt: 3, lastReviewedAt: 2, stage: 1, stableUid: 'a' }], new Set(['a', 'b'])));
    expect(checkpointProgressStamp([a], new Set(['a'])))
      .not.toBe(checkpointProgressStamp([{ ...a, lastReviewedAt: 4 }], new Set(['a'])));
    expect(checkpointProgressStamp([a], new Set(['a'])))
      .not.toBe(checkpointProgressStamp([a], new Set()));
  });

  it('rejects malformed counts and does not replace saved data after a failed read', async () => {
    await expect(saveSessionCheckpoint('a', 'aws', { ...value(), limit: -1 })).rejects.toThrow();
    await saveSessionCheckpoint('a', 'aws', value());
    const before = [...data];
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(loadSessionCheckpoint('a', 'aws', expected)).rejects.toThrow('disk unavailable');
    expect([...data]).toEqual(before);
  });

  it('serializes completion after pending writes, so a late write cannot resurrect the position', async () => {
    await Promise.all([saveSessionCheckpoint('a', 'aws', value()), clearSessionCheckpoint('a', 'aws')]);
    expect(await loadSessionCheckpoint('a', 'aws', expected)).toBeNull();
  });
});
