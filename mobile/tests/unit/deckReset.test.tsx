// 2026-11-01: the customer-facing "Reset deck progress" row (Settings → Study)
// reuses the debug reset's storage steps for ONE deck only — progress, owned
// cards/pity, daily stats — and leaves auth, premium and other decks alone.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveDeckBySlug: vi.fn(),
  resetDeckProgress: vi.fn(),
  captureProgressUserSub: vi.fn(),
  getUserScopedKey: vi.fn(),
  saveDrawState: vi.fn(),
  invalidateDrawStateCache: vi.fn(),
  invalidateProgressQueueCache: vi.fn(),
  notifyProgressChanged: vi.fn(),
  removeItem: vi.fn(async () => {}),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { removeItem: mocks.removeItem },
}));
vi.mock('../../src/content/deckRepository', () => ({
  resolveDeckBySlug: mocks.resolveDeckBySlug,
}));
vi.mock('../../src/review/storage', () => ({
  resetDeckProgress: mocks.resetDeckProgress,
  captureProgressUserSub: mocks.captureProgressUserSub,
  getUserScopedKey: mocks.getUserScopedKey,
}));
vi.mock('../../src/features/gacha/draw/drawStateStore', () => ({
  saveDrawState: mocks.saveDrawState,
}));
vi.mock('../../src/features/gacha/draw/drawStateCache', () => ({
  invalidateDrawStateCache: mocks.invalidateDrawStateCache,
}));
vi.mock('../../src/sync/progressQueueCache', () => ({
  invalidateProgressQueueCache: mocks.invalidateProgressQueueCache,
}));
vi.mock('../../src/sync/progressChanges', () => ({
  notifyProgressChanged: mocks.notifyProgressChanged,
}));

import { resetSingleDeckProgress } from '../../src/features/gacha/deckReset';

describe('resetSingleDeckProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveDeckBySlug.mockResolvedValue({ Slug: 'aws-saa-fundamentals' });
    mocks.getUserScopedKey.mockImplementation(async (k: string) => `devcards:u:sub1:${k}`);
    mocks.captureProgressUserSub.mockResolvedValue('sub1');
  });

  it('wipes progress, draw state and daily stats for the one deck only', async () => {
    await resetSingleDeckProgress('aws-saa-fundamentals');

    expect(mocks.resetDeckProgress).toHaveBeenCalledTimes(1);
    expect(mocks.saveDrawState).toHaveBeenCalledWith('aws-saa-fundamentals', { owned: [], pity: null });
    expect(mocks.removeItem).toHaveBeenCalledWith('devcards:u:sub1:deck-daily-stats:aws-saa-fundamentals');
    expect(mocks.invalidateDrawStateCache).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateProgressQueueCache).toHaveBeenCalledTimes(1);
    expect(mocks.notifyProgressChanged).toHaveBeenCalledWith({
      userSub: 'sub1',
      deckSlug: 'aws-saa-fundamentals',
    });
  });

  it('still resets when the deck is not installed locally', async () => {
    mocks.resolveDeckBySlug.mockResolvedValue(null);

    await resetSingleDeckProgress('gone-deck');

    expect(mocks.resetDeckProgress).not.toHaveBeenCalled();
    expect(mocks.saveDrawState).toHaveBeenCalledWith('gone-deck', { owned: [], pity: null });
    expect(mocks.removeItem).toHaveBeenCalledWith('devcards:u:sub1:deck-daily-stats:gone-deck');
  });
});
