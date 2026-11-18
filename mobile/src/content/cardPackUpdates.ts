import { getAuthIdentitySnapshot, getAuthSessionGeneration } from '../auth/sessionBoundary';
import { installDeckAndInvalidate } from './deckCache';
import { checkManifestForUpdates, getInstalledDeckInfo, type InstalledDeckInfo } from './deckRepository';

export type CardPackUpdateResult = {
  installed: InstalledDeckInfo;
  latestVersion: string;
  checkedAtMs: number;
};

export type CardPackUpdateProgress = { phase: 'checked' | 'updating'; latestVersion: string };

/** A successful check requires a remote response and the expected version on disk. */
export async function checkAndUpdateCardPack(
  slug: string,
  onProgress: (progress: CardPackUpdateProgress) => void = () => {},
): Promise<CardPackUpdateResult> {
  const generation = getAuthSessionGeneration();
  const assertOwner = () => {
    if (generation !== getAuthSessionGeneration()) throw new Error('Account changed during update.');
  };
  const updates = await checkManifestForUpdates(
    getAuthIdentitySnapshot().isPremium === true,
    { requireRemote: true },
  );
  assertOwner();
  const update = updates[slug];
  if (!update?.remoteVersion) throw new Error('This card pack is not available right now.');
  onProgress({ phase: 'checked', latestVersion: update.remoteVersion });
  let installed = await getInstalledDeckInfo(slug);
  assertOwner();
  if (installed?.version !== update.remoteVersion) {
    if (!update.remoteUrl) throw new Error('Open this card pack from Home to update it.');
    onProgress({ phase: 'updating', latestVersion: update.remoteVersion });
    const ok = await installDeckAndInvalidate(
      slug, update.remoteUrl, update.remoteVersion, update.remoteSha256,
    );
    assertOwner();
    if (!ok) throw new Error('The card pack could not be updated.');
    installed = await getInstalledDeckInfo(slug);
    assertOwner();
  }
  if (!installed || installed.version !== update.remoteVersion) {
    throw new Error('The latest card pack has not finished installing.');
  }
  return { installed, latestVersion: update.remoteVersion, checkedAtMs: Date.now() };
}
