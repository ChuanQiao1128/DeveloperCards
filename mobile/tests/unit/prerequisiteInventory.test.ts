import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CardExport } from '../../src/types/deckExport';
import { orderedCards, prerequisiteAcquisitionCards } from '../../src/features/gacha/draw/orderedAcquisition';
import { pickNextCard } from '../../src/features/gacha/planner/sessionPlanner';
import { pickStarterUids } from '../../src/features/gacha/starter/starterGate';

const raw = JSON.parse(readFileSync(new URL('../../../exports/aws-checklist-zh-20261114/source-public-deck.json', import.meta.url), 'utf8'));
const cards: CardExport[] = raw.cards.map((c: any) => ({ StableUid: c.stableUid, OrderInDeck: c.orderInDeck,
  Question: c.question, Difficulty: c.difficulty, Revision: c.revision, Teaching: c.teaching }));
const byUid = new Map(cards.map(c => [c.StableUid, c]));
const assertReady = (sequence: readonly CardExport[], initial: ReadonlySet<string>) => {
  const held = new Set(initial);
  for (const c of sequence) {
    expect(held.has(c.StableUid)).toBe(false);
    for (const parent of c.Teaching?.prerequisites ?? []) expect(held.has(parent), `${c.StableUid} before ${parent}`).toBe(true);
    held.add(c.StableUid);
  }
  return held;
};

describe('actual published 379-card prerequisite graph', () => {
  it('covers all 117 prerequisite links for every supported batch size without granting extra cards', () => {
    expect(cards).toHaveLength(379);
    expect(cards.reduce((n, c) => n + (c.Teaching?.prerequisites?.length ?? 0), 0)).toBe(117);
    for (let size = 1; size <= 10; size++) {
      let held = new Set<string>();
      while (held.size < cards.length) {
        const batch = prerequisiteAcquisitionCards(cards, held).slice(0, size);
        expect(batch.length).toBe(Math.min(size, cards.length - held.size));
        held = assertReady(batch, held);
      }
      expect(prerequisiteAcquisitionCards(cards, held)).toEqual([]);
    }
  });

  it('keeps single and batch results equal for arbitrary old user collections', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 0, max: cards.length - 1 }), { maxLength: 100 }),
      fc.integer({ min: 1, max: 10 }), (indices, size) => {
        const held = new Set(indices.map(index => cards[index].StableUid));
        const expected = prerequisiteAcquisitionCards(cards, held).slice(0, size);
        const singles: CardExport[] = [];
        const nextHeld = new Set(held);
        for (let i = 0; i < size; i++) {
          const next = prerequisiteAcquisitionCards(cards, nextHeld)[0];
          if (!next) break;
          singles.push(next); nextHeld.add(next.StableUid);
        }
        expect(singles.map(c => c.StableUid)).toEqual(expected.map(c => c.StableUid));
        assertReady(expected, held);
      }), { seed: 20261114, numRuns: 75 });
  });

  it('serves every owned foundation before new dependent learning, without requiring mastery', () => {
    const progress = cards.map(c => ({ stableUid: c.StableUid, stage: 0, nextReviewAt: 0, lastReviewedAt: 0 }));
    const held = new Set(cards.map(c => c.StableUid));
    const learned = new Set<string>();
    const index = { cards: orderedCards(cards), cardMap: byUid, deckSlug: raw.slug };
    for (let i = 0; i < cards.length; i++) {
      const next = pickNextCard({ index, progress, now: new Date(), mode: 'learn-new', ownedSet: held });
      expect(next).not.toBeNull();
      for (const parent of next!.card.Teaching?.prerequisites ?? []) expect(learned.has(parent)).toBe(true);
      learned.add(next!.card.StableUid);
      next!.progress.lastReviewedAt = 1;
    }
    expect(learned.size).toBe(379);
  });

  it('preserves the existing starter five without introducing an inaccessible prerequisite', () => {
    const starter = pickStarterUids(cards);
    expect(starter).toEqual(orderedCards(cards).slice(0, 5).map(c => c.StableUid));
    const seen = new Set<string>();
    for (const uid of starter) {
      for (const parent of byUid.get(uid)?.Teaching?.prerequisites ?? []) expect(seen.has(parent)).toBe(true);
      seen.add(uid);
    }
  });
});
