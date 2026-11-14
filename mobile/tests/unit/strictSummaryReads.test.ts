import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const data = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => {
    if (key === 'devcards:auth:activeUserSub:v1') throw new Error('identity unavailable');
    return data.get(key) ?? null;
  }),
  getAllKeys: vi.fn(async () => [...data.keys()]),
  setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
import { setActiveUserSubForStorage } from '../../src/review/storage';
import { loadStreakSnapshot } from '../../src/features/gacha/streaks/streakTracker';
import { listDrawStateSlugs, loadDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { loadMistakeBook } from '../../src/features/gacha/mistakes/mistakeBook';

describe('strict summary partition resolution', () => {
  beforeEach(() => {
    const now = Date.now();
    setActiveUserSubForStorage('a');
    vi.spyOn(Date, 'now').mockReturnValue(now + 2000);
    vi.mocked(AsyncStorage.getItem).mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    () => loadStreakSnapshot({ strict: true }),
    () => listDrawStateSlugs({ strict: true }),
    () => loadDrawState('aws', { strict: true }),
    () => loadMistakeBook({ strict: true }),
  ])('rejects an unreadable identity instead of reporting anonymous zeroes (%#)', async read => {
    await expect(read()).rejects.toThrow('identity unavailable');
    expect(vi.mocked(AsyncStorage.getItem).mock.calls.some(([key]) => key.startsWith('devcards:u:anon:'))).toBe(false);
  });
});
