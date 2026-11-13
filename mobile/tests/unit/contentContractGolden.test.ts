import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseCardTranslations } from '../../src/content/cardTranslation';
import { installDeckFromChunkedPackage } from '../../src/content/chunkedInstall';
import { localizeForDisplay } from '../../src/content/localizeCard';

/**
 * C07 — the two signed mapper lines in deckRepository.ts surface the server's
 * cards.topic as CardExport.Topic. This suite drives the mappers through the
 * only public entry point (resolveDeckBySlug) using the harness of
 * deckRepositoryTimeouts.test.ts: a free-tier manifest keeps the read off the
 * network, so an installed file is a pure file read.
 */

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_CONTENT_BASE_URL = 'https://cdn.test';
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.test';
});

const store = new Map<string, string>();
const files = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const k of keys) store.delete(k);
    }),
  },
}));

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  EncodingType: { UTF8: 'utf8' },
  readAsStringAsync: vi.fn(async (uri: string) => {
    const found = files.get(uri);
    if (found == null) throw new Error('ENOENT');
    return found;
  }),
  writeAsStringAsync: vi.fn(async (uri: string, text: string) => {
    files.set(uri, text);
  }),
  deleteAsync: vi.fn(async (uri: string) => {
    files.delete(uri);
  }),
  moveAsync: vi.fn(async ({ from, to }: { from: string; to: string }) => { files.set(to, files.get(from)!); files.delete(from); }),
  getInfoAsync: vi.fn(async (uri: string) => ({ exists: files.has(uri), isDirectory: false, uri })),
  makeDirectoryAsync: vi.fn(async () => {}),
  readDirectoryAsync: vi.fn(async () => []),
  downloadAsync: vi.fn(async () => ({ status: 404 })),
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async (_alg: string, text: string) =>
    createHash('sha256').update(text, 'utf8').digest('hex'),
  ),
}));

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(async () => ({
    userSub: 'user1',
    tokens: { accessToken: 'access-token-1' },
  })),
}));

let localPremiumFixture = false;
vi.mock('../../src/premium/premiumStore', () => ({
  getIsPremiumUser: vi.fn(async () => localPremiumFixture),
}));

async function loadRepo() {
  vi.resetModules();
  return await import('../../src/content/deckRepository');
}

const CACHE_KEY = 'devcards:content:manifest:v2';
const DECK_FILE = 'file:///docs/devcards-decks-v2/user1/algo.json';

function manifestJson() {
  return {
    schemaVersion: 2,
    generatedAtMs: 1,
    prefix: 'content',
    decks: [
      {
        slug: 'algo',
        title: 'Algo',
        locale: 'en-US',
        deckType: 1,
        tier: 'free',
        availability: 'live',
        downloadMode: 'public',
        totalCards: 1,
        version: 'v1',
        buildId: 'v1',
        path: 'decks/algo/builds/v1/deck.json',
        sha256: null,
        patches: null,
      },
    ],
  };
}

/** Seed a free-tier installed deck whose file text is `fileJson` (flat or v1 shape). */
function seed(fileJson: unknown) {
  store.set(CACHE_KEY, JSON.stringify(manifestJson()));
  store.set(
    'devcards:content:deckmeta:v2:user1:algo',
    JSON.stringify({ slug: 'algo', buildId: 'v1', fileUri: DECK_FILE, installedAtMs: 1 }),
  );
  files.set(DECK_FILE, JSON.stringify(fileJson));
}

beforeEach(() => {
  store.clear();
  files.clear();
  localPremiumFixture = false;
  globalThis.fetch = vi.fn(async () => ({
    ok: false,
    status: 404,
    json: async () => null,
    headers: { get: () => null },
  })) as unknown as typeof fetch;
});

const sample = (name: string) => readFileSync(new URL(`../../../contracts/content-v1/samples/${name}`, import.meta.url), 'utf8');
const golden = JSON.parse(sample('deck.json'));

describe('shared content-v1 actual installed-deck paths', () => {
  for (const shape of ['flat', 'v1']) {
    it(`preserves teaching/prerequisites/tags in the ${shape} mapper and translates prose`, async () => {
      seed(shape === 'flat' ? { ...golden, slug: 'algo' } : { buildId: 'v1', deck: { ...golden, slug: 'algo' }, cards: golden.cards });
      const { resolveDeckBySlug } = await loadRepo();
      const deck = await resolveDeckBySlug('algo');
      const card = deck!.Cards[1];
      expect(card.Teaching).toEqual(golden.cards[1].teaching);
      expect(card.Tags).toEqual(golden.cards[1].tags);
      expect(deck!.Cards[0]).not.toHaveProperty('Teaching');
      const translations = parseCardTranslations(golden.cards[1].translations)!;
      const display = localizeForDisplay({ card, mcq: null, shownOrder: [], translation: translations['zh-CN'], lang: 'zh-CN' });
      expect(display.lang).toBe('zh-CN');
      expect(display.card.Question).toBe(golden.cards[1].translations['zh-CN'].question);
      expect(display.card.StableUid).toBe(card.StableUid);
      expect(display.card.Teaching).toEqual(card.Teaching);
      expect(display.card.Tags).toEqual(card.Tags);
    });
  }

  it('maps explicit null structured fields like omitted legacy fields', async () => {
    seed({ ...golden, slug: 'algo', cards: [{ ...golden.cards[0], teaching: null, tags: null }] });
    const { resolveDeckBySlug } = await loadRepo();
    const deck = await resolveDeckBySlug('algo');
    expect(deck!.Cards[0]).not.toHaveProperty('Teaching');
    expect(deck!.Cards[0]).not.toHaveProperty('Tags');
  });

  it('uses shared translation cases with the actual mobile parser', () => {
    for (const c of JSON.parse(sample('cases.json')).translations) {
      const parsed = parseCardTranslations(c.input);
      if (c.name === 'v1') expect(parsed?.['zh-CN']?.question).toBe(golden.cards[1].translations['zh-CN'].question);
      else expect(parsed).toBeNull();
    }
  });

  it('installs shared cards without dropping structure and rejects future packages before replacing installed content', async () => {
    const chunk = JSON.stringify({ slug: golden.slug, version: golden.version, seq: 0, cards: golden.cards });
    const pkg = { schemaVersion: 1, slug: golden.slug, version: golden.version, deck: golden, totalCards: 2,
      chunks: [{ seq: 0, path: 'chunk.json', bytes: Buffer.byteLength(chunk), sha256: createHash('sha256').update(chunk).digest('hex'), cardCount: 2 }] };
    const args = { slug: golden.slug, packageUrl: 'https://cdn.test/package.json', remoteVersion: golden.version,
      deckDir: 'file:///docs/contract/', finalPath: 'file:///docs/contract/deck.json', resolveRelativeUrl: (p: string) => `https://cdn.test/${p}` };
    for (const version of JSON.parse(sample('cases.json')).packageVersions) {
      const before = files.get(args.finalPath);
      globalThis.fetch = vi.fn(async (url: string) => ({ ok: true, text: async () => url.endsWith('package.json') ? JSON.stringify({ ...pkg, schemaVersion: version.value }) : chunk })) as unknown as typeof fetch;
      const result = await installDeckFromChunkedPackage(args);
      expect(result.ok).toBe(version.valid);
      if (version.valid) expect(JSON.parse(files.get(args.finalPath)!).cards).toEqual(golden.cards);
      else expect(files.get(args.finalPath)).toBe(before);
    }
  });

  it('rejects future translation versions through the actual translation parser', () => {
    expect(parseCardTranslations({ 'zh-CN': { ...golden.cards[1].translations['zh-CN'], v: 2 } })).toBeNull();
  });

  it('documents the current mapper forwarding unsupported teaching schemas and unknown tags', async () => {
    const teaching = { ...golden.cards[1].teaching, schema: 'teaching-v2' };
    const tags = { ...golden.cards[1].tags, future: true };
    seed({ ...golden, slug: 'algo', cards: [{ ...golden.cards[1], teaching, tags }] });
    const { resolveDeckBySlug } = await loadRepo();
    const card = (await resolveDeckBySlug('algo'))!.Cards[0];
    expect(card.Teaching).toEqual(teaching);
    expect(card.Tags).toEqual(tags);
  });
});
