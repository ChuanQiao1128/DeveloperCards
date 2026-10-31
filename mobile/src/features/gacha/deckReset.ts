import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveDeckBySlug } from '../../content/deckRepository';
import { resetDeckProgress, captureProgressUserSub, getUserScopedKey } from '../../review/storage';
import { saveDrawState } from './draw/drawStateStore';
import { invalidateDrawStateCache } from './draw/drawStateCache';
import { invalidateProgressQueueCache } from '../../sync/progressQueueCache';
import { notifyProgressChanged } from '../../sync/progressChanges';

export async function resetSingleDeckProgress(slug: string): Promise<void> {
  const deck = await resolveDeckBySlug(slug);
  if (deck) {
    await resetDeckProgress(deck);
  }
  await saveDrawState(slug, { owned: [], pity: null });
  invalidateDrawStateCache();

  try {
    const dailyK = await getUserScopedKey(`deck-daily-stats:${slug}`);
    await AsyncStorage.removeItem(dailyK);
  } catch {
    // ignore
  }

  invalidateProgressQueueCache();
  const sub = await captureProgressUserSub();
  notifyProgressChanged({ userSub: sub, deckSlug: slug });
}
