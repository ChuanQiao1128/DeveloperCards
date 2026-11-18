import { describe, expect, it } from 'vitest';
import { pickNextCard } from '../../src/features/gacha/planner/sessionPlanner';
import type { CardExport, DeckExport } from '../../src/types/deckExport';
import type { CardProgress } from '../../src/review/model';

const now = new Date('2026-11-14T01:00:00Z');
const card = (uid: string, order: number, parents: string[] = []): CardExport => ({
  StableUid: uid, Question: uid, OrderInDeck: order, Difficulty: 1,
  Teaching: { schema: 'teaching-v1', answer: uid, keyPoint: uid, mustAnswer: [uid], prerequisites: parents },
});
const child = card('child', 1, ['parent']);
const other = card('other', 2);
const parent = card('parent', 10);
const cards = [child, other, parent];
const deck: DeckExport = { Slug: 'aws-saa-fundamentals', Title: 'AWS', Locale: 'en', Version: 'v',
  DeckType: 1, IsFreeStarter: true, TotalCards: 3, FreeCardCount: 3, Cards: cards };
const fresh = (stableUid: string): CardProgress => ({ stableUid, stage: 0, nextReviewAt: 0 });
const learned = (stableUid: string): CardProgress => ({ ...fresh(stableUid), lastReviewedAt: now.getTime() - 1000, nextReviewAt: now.getTime() + 86400000 });
function pick(rows = cards.map(c => fresh(c.StableUid)), extra: any = {}) {
  return pickNextCard({ deck, progress: rows, now, mode: 'learn-new', ownedSet: new Set(cards.map(c => c.StableUid)), ...extra })?.card.StableUid;
}

describe('owned foundations before new dependent learning', () => {
  it('teaches the owned foundation before its earlier dependent', () => expect(pick()).toBe('parent'));
  it('continues after the first study, without waiting for Mastered', () => {
    expect(pick([fresh('child'), fresh('other'), learned('parent')])).toBe('child');
  });
  it('prioritizes an owned foundation of an already learned legacy dependent', () => {
    expect(pick([learned('child'), fresh('other'), fresh('parent')])).toBe('parent');
  });
  it('never lets avoidUid skip a still-new foundation in favor of its dependent', () => {
    expect(pick(undefined, { avoidUid: 'parent', ownedSet: new Set(['parent', 'child']) })).toBe('parent');
    expect(pick(undefined, { avoidUid: 'parent' })).toBe('other');
  });
  it('keeps legacy owned cards playable when a foundation is unowned or absent', () => {
    expect(pick(undefined, { ownedSet: new Set(['child']) })).toBe('child');
    expect(pick(undefined, { index: { cards: [child], cardMap: new Map(cards.map(c => [c.StableUid,c])), deckSlug: deck.Slug } })).toBe('child');
  });
  it('uses the same rule with a cached index, never admitting out-of-scope cards', () => {
    expect(pick(undefined, { deck: undefined, index: { cards, cardMap: new Map(cards.map(c => [c.StableUid,c])), deckSlug: deck.Slug } })).toBe('parent');
  });
  it('preserves due review and sweep behavior', () => {
    const dueChild = { ...learned('child'), nextReviewAt: 1 };
    expect(pick([dueChild, fresh('other'), fresh('parent')], { mode: 'mixed' })).toBe('child');
    expect(pick([dueChild, fresh('other'), fresh('parent')], { mode: 'sweep' })).toBe('child');
  });
  it('does not introduce a learning lock for legacy cyclic metadata', () => {
    const cyclic = [card('child', 1, ['parent']), card('parent', 2, ['child'])];
    expect(pick(cyclic.map(c => fresh(c.StableUid)), { deck: { ...deck, Cards: cyclic } })).toBeTruthy();
  });
  it('leaves other decks in their existing order', () => expect(pick(undefined, { deck: { ...deck, Slug: 'other' } })).toBe('child'));
});
