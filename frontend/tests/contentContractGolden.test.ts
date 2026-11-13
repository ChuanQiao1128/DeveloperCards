import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseDeckMarkdown, serializeDeckMarkdown, planImport, type DeckCardContent } from '../src/lib/deckImport';
import { runImport } from '../src/lib/deckImportRunner';
import type { Card } from '../src/types/card';
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

  it('roundtrips translated prose through the existing Markdown parser and preserves structured fields', () => {
    const markdown = serializeDeckMarkdown(deck.slug, deck.cards as DeckCardContent[]);
    const parsed = parseDeckMarkdown(markdown);
    expect(parsed.errors).toEqual([]);
    expect(parsed.cards[1].translations).toEqual(deck.cards[1].translations);
    expect(parsed.cards[1].teaching).toEqual(deck.cards[1].teaching);
    expect(parsed.cards[1].tags).toEqual(deck.cards[1].tags);
    expect(parsed.cards.map(c => c.stableUid)).toEqual(deck.cards.map((c: ImportCardInput) => c.stableUid));
  });
});

it('keeps legacy Markdown bytes unchanged', () => {
  expect(serializeDeckMarkdown('legacy', [deck.cards[0]])).toBe('# deck: legacy\n\n## fixture-base | d1\nQ:\nWhat is kept?\nA:\nThe value.\n');
});

it('runs structured Markdown through planning and the real batch runner, preserving explicit clears and legacy omission', async () => {
  for (const fields of [{ teaching: deck.cards[1].teaching, tags: deck.cards[1].tags }, { teaching: null, tags: null }, {}]) {
    const parsed = parseDeckMarkdown(serializeDeckMarkdown(deck.slug, [{ ...deck.cards[0], ...fields }]));
    const plan = planImport(parsed, []);
    const batches: ImportCardInput[][] = [];
    await runImport(7, plan.creates, { importCards: async ({ cards }) => { batches.push(cards); return { success: true, data: { created: 1, updated: 0, unchanged: 0 }, error: null, traceId: 't' }; } });
    expect(batches).toHaveLength(1);
    for (const key of ['teaching', 'tags'] as const) {
      if (key in fields) expect(batches[0][0][key]).toEqual(fields[key]);
      else expect(batches[0][0]).not.toHaveProperty(key);
    }
  }
});

it('treats JSON object key ordering as unchanged, and preserves structures omitted by an old document', () => {
  const parsed = parseDeckMarkdown(serializeDeckMarkdown(deck.slug, [deck.cards[1]]));
  const existing = { ...parsed.cards[0], id: 1, deckId: 7, version: 1, isDeleted: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', tags: { examTask: '1.2', domain: '1' }, teaching: Object.fromEntries(Object.entries(deck.cards[1].teaching).reverse()) } as Card;
  expect(planImport(parsed, [existing]).unchanged).toHaveLength(1);
  const legacy = { ...parsed.cards[0] }; delete legacy.teaching; delete legacy.tags;
  expect(planImport({ cards: [legacy] }, [existing]).unchanged).toHaveLength(1);
  const clears = { ...legacy, teaching: null, tags: null };
  expect(planImport({ cards: [clears] }, [existing]).updates[0].changedFields).toEqual(['teaching', 'tags']);
});

it('refuses malformed and future structured JSON markers instead of appending them to answer text', () => {
  const doc = '# deck: fixture\n## fixture-base | d1\nQ:\nQ\nA:\nA\n';
  for (const [marker, value, code] of [['TEACHING', '[]', 'TEACHING_BAD_SHAPE'], ['TEACHING', '{"schema":"teaching-v2"}', 'TEACHING_BAD_SHAPE'], ['TAGS', 'oops', 'TAGS_BAD_SHAPE']]) {
    expect(parseDeckMarkdown(`${doc}${marker}:\n${value}`).errors[0].code).toBe(code);
  }
});

it('accepts the explicit tags-only review schema in real release bundle/snapshot guards', async () => {
  const { releaseFixture } = await import('./support/contentReleaseFixtures');
  const { parseReleaseBundle, assertReleaseSnapshot } = await import('../src/lib/contentRelease');
  const { bundle, snapshot } = releaseFixture(1);
  bundle.cards[0].frontHelp = null;
  bundle.cards[0].translations!['zh-CN']!.frontHelp = null;
  bundle.cards[0].teaching = null;
  bundle.cards[0].tags = { domain: '1', examTask: '1.1' };
  bundle.review.cards[0].schema = 'tags-only-v1';
  const row = snapshot.backup[0];
  row.front_help = null;
  (row.translations as Record<string, Record<string, unknown>>)['zh-CN'].frontHelp = null;
  row.teaching = null;
  row.tags = bundle.cards[0].tags;
  snapshot.cards[0].schema = 'tags-only-v1';
  expect(parseReleaseBundle(JSON.stringify(bundle)).review.cards[0].schema).toBe('tags-only-v1');
  expect(() => assertReleaseSnapshot(snapshot)).not.toThrow();
});
