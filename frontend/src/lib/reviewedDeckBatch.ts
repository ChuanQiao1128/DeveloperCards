import { canonicalizeJson } from './canonicalJson';
import { parseFrontHelp } from './frontHelp';
import { planImport, validateCards, type ParsedCard } from './deckImport';
import { cardInputFor, IMPORT_BATCH_MAX_CARDS, IMPORT_BATCH_MAX_CHARS } from './deckImportRunner';
import { hasReviewedDeckRelease } from './deckWorkspace';
import type { Card } from '../types/card';
import type { Deck } from '../types/deck';

const TEXT_FIELDS = ['stableUid', 'question', 'explanation', 'codeSnippet', 'codeLanguage', 'realWorldUsage', 'topic'] as const;
const OBJECT_FIELDS = ['mcq', 'source', 'translations', 'teaching', 'tags'] as const;
const CARD_FIELDS = [...TEXT_FIELDS, ...OBJECT_FIELDS, 'frontHelp', 'difficulty', 'orderInDeck', 'expectedVersion'];
const MAX_FILE_CHARS = IMPORT_BATCH_MAX_CHARS * 3;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fields(value: unknown, expected: readonly string[]): asserts value is Record<string, unknown> {
  check(record(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)),
    `Expected these JSON fields: ${expected.join(', ')}.`);
}

function integer(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

type DraftCard = { input: Record<string, unknown>; card: ParsedCard; expectedVersion: number };

export function parseDeckBatchDraft(raw: string) {
  check(raw.length <= MAX_FILE_CHARS, 'Reviewed card batch is too large.');
  const draft: unknown = JSON.parse(raw);
  fields(draft, ['deckId', 'deckSlug', 'cards']);
  check(integer(draft.deckId, 1) && typeof draft.deckSlug === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(draft.deckSlug) && draft.deckSlug.trim() === draft.deckSlug, 'Invalid target deck.');
  check(!hasReviewedDeckRelease({ id: draft.deckId, slug: draft.deckSlug }), 'Use Publish batch for the existing AWS Architect Basics deck.');
  check(Array.isArray(draft.cards) && draft.cards.length >= 1 && draft.cards.length <= IMPORT_BATCH_MAX_CARDS, 'Invalid batch size.');
  const orders = new Set<number>();
  const cards: DraftCard[] = draft.cards.map((input: unknown, index: number) => {
    fields(input, CARD_FIELDS);
    for (const key of TEXT_FIELDS) {
      const value = input[key];
      check(typeof value === 'string' && value.trim() === value, `Card ${index + 1}: ${key} must be canonical text.`);
    }
    check(typeof input.topic === 'string' && input.topic.length <= 80, `Card ${index + 1}: topic is too long.`);
    for (const key of OBJECT_FIELDS) {
      check(input[key] === null || record(input[key]), `Card ${index + 1}: invalid ${key}.`);
    }
    const help = parseFrontHelp(input.frontHelp);
    check(help !== undefined && JSON.stringify(canonicalizeJson(help)) === JSON.stringify(canonicalizeJson(input.frontHelp)), `Card ${index + 1}: invalid frontHelp.`);
    check(integer(input.expectedVersion, 0), `Card ${index + 1}: invalid expected version.`);
    check(integer(input.orderInDeck, 1) && input.orderInDeck <= 100_000_000 && !orders.has(input.orderInDeck),
      `Card ${index + 1}: invalid or duplicate order.`);
    orders.add(input.orderInDeck);
    if (record(input.teaching)) {
      const { schema, answer, keyPoint, mustAnswer } = input.teaching;
      check(schema === 'teaching-v1' && typeof answer === 'string' && answer.trim() &&
        typeof keyPoint === 'string' && keyPoint.trim() && Array.isArray(mustAnswer) &&
        mustAnswer.length >= 1 && mustAnswer.length <= 8 && mustAnswer.every(item => typeof item === 'string' && item.trim()),
      `Card ${index + 1}: invalid teaching.`);
    }
    if (record(input.source)) {
      fields(input.source, ['url', 'quote']);
      check(typeof input.source.url === 'string' && (input.source.quote === null || typeof input.source.quote === 'string' && input.source.quote.trim() === input.source.quote && input.source.quote.length > 0),
        `Card ${index + 1}: invalid source.`);
    }
    if (record(input.mcq)) {
      const mcq = input.mcq;
      fields(mcq, ['v', 'qualifier', 'shuffle', 'options']);
      check(mcq.v === 1 && (mcq.qualifier === null || typeof mcq.qualifier === 'string') && typeof mcq.shuffle === 'boolean' && Array.isArray(mcq.options),
        `Card ${index + 1}: invalid MCQ.`);
      for (const option of mcq.options as unknown[]) {
        fields(option, ['key', 'text', 'why', 'correct']);
        check(typeof option.key === 'string' && typeof option.text === 'string' && (option.why === null || typeof option.why === 'string') && typeof option.correct === 'boolean',
          `Card ${index + 1}: invalid MCQ option.`);
      }
    }
    const { expectedVersion, ...content } = input;
    const card = {
      ...content, sourceLine: index + 1,
      mcq: input.mcq ?? undefined, source: input.source ?? undefined, translations: input.translations ?? undefined,
    } as unknown as ParsedCard;
    return { input, card, expectedVersion };
  });
  const parsed = { deckSlug: draft.deckSlug, cards: cards.map(row => row.card), errors: [], warnings: [] };
  const issue = validateCards(parsed.cards)[0];
  check(!issue, issue?.message ?? 'Invalid card.');
  check(JSON.stringify({ deckId: draft.deckId, cards: draft.cards }).length <= IMPORT_BATCH_MAX_CHARS,
    'The reviewed cards must fit in one import transaction.');
  return { deckId: draft.deckId, deckSlug: draft.deckSlug, parsed, cards };
}

export async function deckBatchDraftHash(draft: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(draft));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function readReviewedDeckBatch(raw: string) {
  check(raw.length <= MAX_FILE_CHARS, 'Reviewed card batch is too large.');
  const batch: unknown = JSON.parse(raw);
  fields(batch, ['schema', 'draft', 'review']);
  check(batch.schema === 'reviewed-deck-batch-v1' && typeof batch.draft === 'string', 'Expected a reviewed deck batch.');
  const draft = parseDeckBatchDraft(batch.draft);
  fields(batch.review, ['draftSha256', 'reviewer', 'cards']);
  const { reviewer, draftSha256, cards } = batch.review;
  check(typeof reviewer === 'string' && reviewer.trim() && reviewer.length <= 200, 'Review must identify the reviewer.');
  check(draftSha256 === await deckBatchDraftHash(batch.draft), 'The review belongs to a different draft.');
  check(Array.isArray(cards) && cards.length === draft.cards.length, 'Review must cover every card in the batch.');
  const pending = new Set(draft.cards.map(row => row.card.stableUid));
  for (const row of cards as unknown[]) {
    fields(row, ['stableUid', 'verdict', 'note']);
    check(typeof row.stableUid === 'string' && pending.delete(row.stableUid) && row.verdict === 'PASS' &&
      typeof row.note === 'string' && row.note.trim(),
    'Every card in the reviewed batch needs its own PASS and review note.');
  }
  return draft;
}

export function planReviewedDeckBatch(
  batch: ReturnType<typeof parseDeckBatchDraft>,
  deck: Pick<Deck, 'id' | 'slug' | 'locale'>,
  existing: readonly Card[],
) {
  check(batch.deckId === deck.id && batch.deckSlug === deck.slug, 'This reviewed batch belongs to a different deck.');
  const issue = validateCards(batch.parsed.cards, { deckLocale: deck.locale })[0];
  check(!issue, issue?.message ?? 'Invalid card.');
  const plan = planImport(batch.parsed, existing, { deckLocale: deck.locale });
  check(!plan.conflicts.length, plan.conflicts[0]?.message ?? 'Card import conflict.');
  const actions = new Map([...plan.creates, ...plan.updates].map(action => [action.card.stableUid, action]));
  const byUid = new Map(existing.map(row => [row.stableUid, row]));
  const byOrder = new Map(existing.map(row => [row.orderInDeck, row.stableUid]));
  for (const row of batch.cards) {
    const uid = row.card.stableUid;
    const current = byUid.get(uid);
    const occupyingUid = byOrder.get(row.card.orderInDeck);
    check((current?.version ?? 0) === row.expectedVersion, `${uid}: card version changed since review.`);
    check(!occupyingUid || occupyingUid === uid, `${uid}: card order is already in use.`);
    check(!current || row.card.orderInDeck === current.orderInDeck, `${uid}: keep the original order when editing a reviewed card.`);
    const action = actions.get(uid);
    check(action, `${uid}: the reviewed batch must contain a change.`);
    const sent = cardInputFor(action) as unknown as Record<string, unknown>;
    check(CARD_FIELDS.every(key => JSON.stringify(row.input[key]) === JSON.stringify(sent[key])),
      `${uid}: planned write differs from the reviewed card.`);
  }
  return plan;
}
