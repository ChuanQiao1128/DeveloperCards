import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseDeckMarkdown, serializeDeckMarkdown, type DeckCardContent } from '../src/lib/deckImport';
import { validateTranslation } from '../src/lib/translationRules';
import { importCardsBatch, type ImportCardInput } from '../src/api/authoring';

const httpMock = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../src/api/http', () => ({ http: httpMock }));
const sample = (name: string) => readFileSync(new URL(`../../contracts/content-v1/samples/${name}`, import.meta.url), 'utf8');
const deck = JSON.parse(sample('deck.json'));

describe('shared content-v1 golden contract', () => {
  it('keeps teaching, prerequisites, tags and translations on the actual JSON import transport', async () => {
    httpMock.post.mockResolvedValue({ data: { success: true, data: { created: 2 }, error: null, traceId: 'fixture' } });
    const cards = deck.cards as ImportCardInput[];
    await importCardsBatch({ deckId: 7, cards });
    const [, body] = httpMock.post.mock.calls.at(-1)!;
    expect(JSON.stringify(body.cards)).toBe(JSON.stringify(deck.cards));
    expect(body.cards[1].teaching.prerequisites).toEqual(['fixture-base']);
    expect(body.cards[1].teaching['zh-CN'].answer).toBe('选择 A。');
    expect(body.cards[1].tags).toEqual({ domain: '1', examTask: '1.2' });
    expect(body.cards[1].translations).toEqual(deck.cards[1].translations);
  });

  it('keeps omission distinct from null in the JSON transport', async () => {
    httpMock.post.mockResolvedValue({ data: { success: true, data: {}, error: null, traceId: 'fixture' } });
    await importCardsBatch({ deckId: 7, cards: [deck.cards[0], { ...deck.cards[0], teaching: null, tags: null }] });
    const [, body] = httpMock.post.mock.calls.at(-1)!;
    expect(body.cards[0]).not.toHaveProperty('teaching');
    expect(body.cards[1]).toHaveProperty('teaching', null);
    expect(body.cards[1]).toHaveProperty('tags', null);
  });

  it('uses shared accepted/rejected translation cases with the existing validator', () => {
    const english = { ...deck.cards[1], mcq: null };
    for (const c of JSON.parse(sample('cases.json')).translations) {
      expect(validateTranslation({ translations: c.input, english, deckLocale: 'en-US' }).length === 0).toBe(c.valid);
    }
  });

  it('roundtrips translated prose through the existing Markdown parser and documents its absent structured fields', () => {
    const markdown = serializeDeckMarkdown(deck.slug, deck.cards as DeckCardContent[]);
    const parsed = parseDeckMarkdown(markdown);
    expect(parsed.errors).toEqual([]);
    expect(parsed.cards[1].translations).toEqual(deck.cards[1].translations);
    // Current Markdown has no TEACHING/TAGS markers. N5 must close this seam before calling it lossless.
    expect(parsed.cards[1]).not.toHaveProperty('teaching');
    expect(parsed.cards[1]).not.toHaveProperty('tags');
    expect(parsed.cards.map(c => c.stableUid)).toEqual(deck.cards.map((c: ImportCardInput) => c.stableUid));
  });
});
