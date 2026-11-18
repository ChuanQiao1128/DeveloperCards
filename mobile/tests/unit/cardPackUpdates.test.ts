import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  check: vi.fn(), installed: vi.fn(), install: vi.fn(), generation: 0,
}));
vi.mock('../../src/content/deckRepository', () => ({
  checkManifestForUpdates: mocks.check, getInstalledDeckInfo: mocks.installed,
}));
vi.mock('../../src/content/deckCache', () => ({ installDeckAndInvalidate: mocks.install }));
vi.mock('../../src/auth/sessionBoundary', () => ({
  getAuthSessionGeneration: () => mocks.generation,
  getAuthIdentitySnapshot: () => ({ isPremium: false }),
}));
import { checkAndUpdateCardPack } from '../../src/content/cardPackUpdates';

const current = { version: 'v2', installedAtMs: 200 };
const update = { remoteVersion: 'v2', remoteUrl: 'https://cdn.test/deck.json', remoteSha256: 'a'.repeat(64) };

beforeEach(() => {
  vi.resetAllMocks(); mocks.generation = 0;
  mocks.check.mockResolvedValue({ aws: update });
  mocks.installed.mockResolvedValue(current);
  mocks.install.mockResolvedValue(true);
});

describe('card-pack check and update', () => {
  it('confirms a remote version against the installed file without rewriting current cards', async () => {
    const result = await checkAndUpdateCardPack('aws');
    expect(mocks.check).toHaveBeenCalledWith(false, { requireRemote: true });
    expect(mocks.install).not.toHaveBeenCalled();
    expect(result.installed).toEqual(current);
    expect(result.latestVersion).toBe('v2');
  });

  it('installs a new version through the existing installer and then reads it back', async () => {
    mocks.installed.mockResolvedValueOnce({ version: 'v1', installedAtMs: 100 }).mockResolvedValueOnce(current);
    const updating = vi.fn();
    expect((await checkAndUpdateCardPack('aws', updating)).installed.version).toBe('v2');
    expect(updating.mock.calls.map(([progress]) => progress.phase)).toEqual(['checked', 'updating']);
    expect(mocks.install).toHaveBeenCalledWith('aws', update.remoteUrl, 'v2', update.remoteSha256);
    expect(mocks.installed).toHaveBeenCalledTimes(2);
  });

  it('does not claim current when offline, even with an installed pack', async () => {
    mocks.check.mockRejectedValue(new Error('offline'));
    await expect(checkAndUpdateCardPack('aws')).rejects.toThrow('offline');
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it('rejects failed installs and mismatched post-install versions', async () => {
    mocks.installed.mockResolvedValue({ version: 'v1', installedAtMs: 100 });
    mocks.install.mockResolvedValueOnce(false);
    await expect(checkAndUpdateCardPack('aws')).rejects.toThrow('could not be updated');
    await expect(checkAndUpdateCardPack('aws')).rejects.toThrow('not finished installing');
  });

  it('does not install under a changed account or silently pick an unavailable pack', async () => {
    mocks.check.mockImplementationOnce(async () => { mocks.generation += 1; return { aws: update }; });
    await expect(checkAndUpdateCardPack('aws')).rejects.toThrow('Account changed');
    expect(mocks.install).not.toHaveBeenCalled();
    await expect(checkAndUpdateCardPack('missing')).rejects.toThrow('not available');
  });

  it('does not replace premium content with a fallback URL when none is offered', async () => {
    mocks.check.mockResolvedValue({ aws: { ...update, remoteUrl: null } });
    mocks.installed.mockResolvedValue({ version: 'v1', installedAtMs: 100 });
    await expect(checkAndUpdateCardPack('aws')).rejects.toThrow('from Home');
    expect(mocks.install).not.toHaveBeenCalled();
  });
});
