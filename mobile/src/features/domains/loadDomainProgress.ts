import { getAuthSessionGeneration } from '../../auth/sessionBoundary';
import { getCachedDeck } from '../../content/deckCache';
import { captureProgressUserSub, loadDeckProgress } from '../../review/storage';
import { applyCachedRemoteProgress } from '../../sync/progressSync';
import { resolveEffectiveOwned } from '../gacha/draw/effectiveOwned';
import { activeMistakes, loadMistakeBook } from '../gacha/mistakes/mistakeBook';
import { computeDomainProgress } from './domainProgress';

export async function loadDomainProgress(slug: string, { hydrateCached = false } = {}) {
  const generation = getAuthSessionGeneration();
  const userSub = await captureProgressUserSub(true);
  const requireCurrentAccount = async () => {
    if (await captureProgressUserSub(true) !== userSub || generation !== getAuthSessionGeneration()) {
      throw new Error('Account changed');
    }
  };
  if (hydrateCached) {
    await requireCurrentAccount();
    await applyCachedRemoteProgress(slug).catch(() => {});
  }
  const deck = await getCachedDeck(slug);
  await requireCurrentAccount();
  if (!deck) return null;
  const now = new Date();
  const progress = await loadDeckProgress(deck, userSub);
  const owned = await resolveEffectiveOwned(slug, progress);
  const mistakes = activeMistakes(await loadMistakeBook(), { deckSlug: slug, now: now.getTime() });
  await requireCurrentAccount();
  const domains = computeDomainProgress(slug, deck.Cards ?? [], progress, owned, mistakes, now);
  return { deck, now, progress, owned, mistakes, domains, userSub };
}
