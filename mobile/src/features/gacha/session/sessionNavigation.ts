import * as Crypto from 'expo-crypto';
import type { DeckExport } from '../../../types/deckExport';

/** Bounded, account-scoped checkpoint data; never a second installed deck cache. */
export type SessionNavigation = {
  v: 1;
  core: string;
  cards: { uid: string; order: number; prerequisites: string[] | null }[];
};

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}

export async function captureSessionNavigation(deck: DeckExport): Promise<SessionNavigation | null> {
  if (!deck.Cards.length || deck.Cards.length > 1000 || new Set(deck.Cards.map(c => c.StableUid)).size !== deck.Cards.length) return null;
  const { Version: _version, Cards, ...metadata } = deck;
  // Exact canonical content equality: only edit-version/timestamps, card ordering and prerequisites may differ.
  const core = JSON.stringify(canonical({ ...metadata, Cards: Cards.map(card => {
    const { OrderInDeck: _order, Teaching, Version: _editVersion, UpdatedAt: _updatedAt, ...content } = card as typeof card & { Version?: number; UpdatedAt?: string | null };
    if (!Teaching) return { ...content, Teaching };
    const { prerequisites: _prerequisites, ...teaching } = Teaching;
    return { ...content, Teaching: teaching };
  }).sort((a, b) => a.StableUid.localeCompare(b.StableUid)) }));
  if (core.length > 2000000) return null;
  const cards = Cards.map(card => ({ uid: card.StableUid, order: card.OrderInDeck,
    prerequisites: card.Teaching?.prerequisites ?? null }));
  const snapshot = { v: 1 as const, core: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, core), cards };
  return validSessionNavigation(snapshot) ? snapshot : null;
}

export function validSessionNavigation(value: any): value is SessionNavigation {
  return value?.v === 1 && typeof value.core === 'string' && /^[0-9a-f]{64}$/.test(value.core) &&
    Array.isArray(value.cards) && value.cards.length > 0 && value.cards.length <= 1000 &&
    new Set(value.cards.map((c: any) => c?.uid)).size === value.cards.length && value.cards.every((c: any) =>
      typeof c?.uid === 'string' && c.uid.length > 0 && c.uid.length <= 1000 && Number.isSafeInteger(c.order) &&
      (c.prerequisites === null || (Array.isArray(c.prerequisites) && c.prerequisites.length <= 1000 &&
        c.prerequisites.every((uid: any) => typeof uid === 'string' && uid.length > 0 && uid.length <= 1000)))) &&
    JSON.stringify(value.cards).length <= 300000;
}

/** Apply only to this session's in-memory deck after load has checked content and account state. */
export function restoreSessionNavigation(deck: DeckExport, snapshot: SessionNavigation): DeckExport {
  const cards = new Map(deck.Cards.map(card => [card.StableUid, card]));
  return { ...deck, Cards: snapshot.cards.map(saved => {
    const card = cards.get(saved.uid)!;
    return { ...card, OrderInDeck: saved.order, ...(card.Teaching ? { Teaching: { ...card.Teaching,
      prerequisites: saved.prerequisites ?? undefined } } : {}) };
  }) };
}
