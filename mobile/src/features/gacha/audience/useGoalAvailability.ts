import { useEffect, useState } from 'react';
import type { ManifestDeckEntry } from '../../../content/deckRepository';
import { DEFAULT_GOAL_DECK_SLUG, GOAL_CHOICES } from './goalChoices';

export function resolveGoalChoices(manifest: readonly ManifestDeckEntry[] | null) {
  return GOAL_CHOICES.map((choice) => {
    const entry = manifest?.find((item) => item.slug === choice.deckSlug);
    const status = entry?.availability?.toLowerCase();
    // The bundled release offers Basics; the manifest can enable future courses without an App update.
    const available = manifest === null ? choice.deckSlug === DEFAULT_GOAL_DECK_SLUG :
      !!entry && (!status || status === 'live') && entry.downloadMode !== 'none';
    return { ...choice, available, availabilityLabel: available ? 'Available now' :
      manifest === null || status === 'coming' ? 'Coming soon' : 'Unavailable' };
  });
}

export function useGoalAvailability(active = true) {
  const [manifest, setManifest] = useState<ManifestDeckEntry[] | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const { listVisibleManifestDecks } = await import('../../../content/visibleManifest');
        const entries = await listVisibleManifestDecks();
        // The repository also returns [] when both the network and cache are unavailable.
        if (!cancelled && entries.length > 0) setManifest(entries);
      } catch {
        // The bundled release remains selectable when the first-run availability check is offline.
      }
    })();
    return () => { cancelled = true; };
  }, [active]);
  return resolveGoalChoices(manifest);
}
