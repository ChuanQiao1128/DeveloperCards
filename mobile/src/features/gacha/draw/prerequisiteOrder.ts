import type { CardExport } from '../../../types/deckExport';

/** Dependency order within the supplied scope; paid acquisition rejects invalid graphs. */
export function prerequisiteOrder(
  cards: readonly CardExport[],
  priorityUids: readonly string[] = [],
  strict = false,
): CardExport[] {
  const byUid = new Map(cards.map(card => [card.StableUid, card]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: CardExport[] = [];
  function visit(uid: string) {
    if (visited.has(uid)) return;
    const card = byUid.get(uid);
    if (!card || visiting.has(uid)) {
      if (strict) throw new Error('Course prerequisites are unavailable; update the pack and retry');
      return;
    }
    visiting.add(uid);
    const raw = card.Teaching?.prerequisites;
    if (raw != null && (!Array.isArray(raw) || raw.some(parent => typeof parent !== 'string' || !parent))) {
      if (strict) throw new Error('Course prerequisites are invalid; update the pack and retry');
    } else {
      const parents = [...(raw ?? [])].sort((a, b) =>
        (byUid.get(a)?.OrderInDeck ?? Infinity) - (byUid.get(b)?.OrderInDeck ?? Infinity));
      for (const parent of parents) visit(parent);
    }
    visiting.delete(uid);
    visited.add(uid);
    result.push(card);
  }
  for (const uid of priorityUids) visit(uid);
  for (const card of cards) visit(card.StableUid);
  return result;
}

/** Missing/unowned foundations never lock an already acquired legacy card. */
export function hasPendingPrerequisite(card: CardExport, pending: ReadonlySet<string>, scope: ReadonlyMap<string, CardExport>): boolean {
  const visited = new Set<string>();
  function visit(current: CardExport): boolean {
    if (visited.has(current.StableUid)) return false;
    visited.add(current.StableUid);
    const parents = current.Teaching?.prerequisites;
    return Array.isArray(parents) && parents.some(uid => pending.has(uid) ||
      (scope.has(uid) && visit(scope.get(uid)!)));
  }
  return visit(card);
}
