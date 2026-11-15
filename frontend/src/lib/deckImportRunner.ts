// Preview-bound, transactional batches. Retries reuse the operation identity.
// Transport failures may follow a commit, so unconfirmed batches stop the run.

import { VERSION_CONFLICT } from '../api/errors';
import type { ImportCardInput, ImportCardsBatchResult } from '../api/authoring';
import type { ApiError, ApiResult } from '../types/api';
import type { ImportCreate, ImportUpdate } from './deckImport';

export type ImportAction = ImportCreate | ImportUpdate;

// F01's per-call ceiling (CardsImport.MaxCards). A payload with more than this
// is refused, so the runner never sends one.
export const IMPORT_BATCH_MAX_CARDS = 500;

// A serialized-size ceiling that keeps each batch under E07's 1 MiB body cap
// with headroom for the request envelope. Measured on
// JSON.stringify({ deckId, cards }).
export const IMPORT_BATCH_MAX_CHARS = 900_000;

// Backoff between retries of a transient batch failure: 1s, 2s, 4s. Its length
// is the retry count, so there are at most three retries (four attempts total).
export const IMPORT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

// code stamped on a batch the operator cancelled mid-write. Distinct from the
// api layer's CANCELLED so the page can tell "you stopped this" from any other
// refusal and point the operator at a re-preview.
export const IMPORT_CANCELLED = 'IMPORT_CANCELLED';

// code stamped on an update the runner refused to send because it would delete
// a stored translation without the operator's opt-in. Same code as the plan
// conflict it backs up.
export const TRANSLATIONS_WOULD_BE_CLEARED = 'TRANSLATIONS_WOULD_BE_CLEARED';

const CANCELLED_MESSAGE =
  'Cancelled while this batch was being written. Re-run the preview to see whether it landed.';

/**
 * The one API call the runner needs, described structurally so tests can pass a
 * fake without importing api/authoring.ts (which pulls in axios and
 * import.meta.env, neither of which belongs in a unit test).
 */
export interface ImportBatchWriter {
  importCards(params: {
    deckId: number;
    operationId: string;
    cards: ImportCardInput[];
    signal?: AbortSignal;
  }): Promise<ApiResult<ImportCardsBatchResult>>;
}

export interface RunImportOptions {
  onProgress?: (p: ImportProgress) => void;
  signal?: AbortSignal;
  /** Overridable so tests can run without real timers. Defaults to a setTimeout that resolves early on abort. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Captured by the page so an old run cannot continue under a new account. */
  isCurrent?: () => boolean;
}

export interface ImportFailure {
  action: ImportAction;
  stableUid: string;
  code: string;
  message: string;
}

export interface ImportRunResult {
  created: number;
  updated: number;
  failures: ImportFailure[];
  /** True when the operator cancelled before the run finished. */
  cancelled: boolean;
  /** Actions never attempted, because a cancel stopped the run before their batch. */
  notRun: number;
  batches: { operationId: string; state: 'committed' | 'failed' | 'unknown'; cards: number }[];
}

export interface ImportProgress {
  /** Actions finished so far, successful or not. */
  done: number;
  total: number;
  /** The last action of the batch just finished, so the UI can name what it is working on. */
  current: ImportAction;
}

// error.code the authoring API returns when expectedVersion is stale. Declared
// in src/api/errors.ts now that EditCardPage branches on it too, and re-exported
// from here so this module's existing importers do not have to care where it
// moved.
export { VERSION_CONFLICT };

/**
 * Optional text is stored trimmed by the server and read back as either null
 * or "", so the runner sends the same normalized string the planner compares.
 * Without this a card whose USAGE section is only whitespace would flip
 * between update and unchanged on alternating imports.
 */
function optionalText(value: string | null): string {
  return (value ?? '').trim();
}

/**
 * Builds the F01 card body for one action. Mirrors the create/update field rules
 * the per-card path used: cleared optional text becomes "", mcq is always an
 * explicit value (null on a Q/A card), source is explicit too (null without
 * SOURCE:), and expectedVersion binds the write to the preview.
 */
function cardInputFor(action: ImportAction): ImportCardInput {
  const card = action.card;
  return {
    expectedVersion: action.kind === 'update' ? action.expectedVersion : 0,
    stableUid: card.stableUid,
    question: card.question,
    explanation: card.explanation,
    codeSnippet: optionalText(card.codeSnippet),
    codeLanguage: optionalText(card.codeLanguage),
    realWorldUsage: optionalText(card.realWorldUsage),
    topic: optionalText(card.topic ?? null),
    mcq: card.mcq ?? null,
    source: card.source ?? null,
    ...(card.frontHelp !== undefined ? { frontHelp: card.frontHelp } : {}),
    ...(card.teaching !== undefined ? { teaching: card.teaching } : {}),
    ...(card.tags !== undefined ? { tags: card.tags } : {}),
    translations: card.translations ?? null,
    difficulty: card.difficulty,
    orderInDeck: card.orderInDeck,
  };
}

/**
 * True for an update that would delete the card's stored translation without
 * the plan's explicit opt-in: the server holds one (the compare found a
 * difference), the file has none, and nobody ticked "clear translations".
 */
export function wouldClearTranslations(action: ImportAction): boolean {
  return (
    action.kind === 'update' &&
    action.card.translations === undefined &&
    action.changedFields.includes('translations') &&
    action.clearsTranslations !== true
  );
}

/** Human sentence for a failure, with the one hint that is not obvious. */
export function describeFailure(failure: ImportFailure): string {
  // A stale version and a mid-import reorder are both cleared by planning again
  // against fresh server state, so both point the operator at the same fix.
  if (failure.code === VERSION_CONFLICT || failure.code === 'ORDER_CONFLICT') {
    return `${failure.message} Re-run the preview to refresh the reconciliation before retrying.`;
  }
  return failure.message;
}

/**
 * Splits actions, in plan order, into consecutive batches of at most `maxCards`
 * actions whose serialized `{ deckId, cards }` body stays within `maxChars`. A
 * single action that alone exceeds `maxChars` gets a batch of its own: the
 * server will refuse it, and that refusal is the honest answer rather than a
 * silent drop.
 */
export function chunkImportActions(
  deckId: number,
  actions: readonly ImportAction[],
  maxCards = IMPORT_BATCH_MAX_CARDS,
  maxChars = IMPORT_BATCH_MAX_CHARS,
): ImportAction[][] {
  // JSON.stringify({ deckId, cards: [c1, ..., cn] }).length is exactly this
  // wrapper's length plus each card's own serialized length plus the (n - 1)
  // commas between them, so the running sum below measures the real body without
  // re-stringifying the whole batch on every card.
  const wrapperLen = JSON.stringify({ deckId, cards: [] as ImportCardInput[] }).length;
  const chunkChars = (cardsLen: number, count: number): number =>
    count === 0 ? wrapperLen : wrapperLen + cardsLen + (count - 1);

  const chunks: ImportAction[][] = [];
  let current: ImportAction[] = [];
  let currentLen = 0;

  for (const action of actions) {
    const cardLen = JSON.stringify(cardInputFor(action)).length;
    const fits =
      current.length > 0 &&
      current.length < maxCards &&
      chunkChars(currentLen + cardLen, current.length + 1) <= maxChars;

    if (fits) {
      current.push(action);
      currentLen += cardLen;
    } else {
      if (current.length > 0) chunks.push(current);
      current = [action];
      currentLen = cardLen;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * True for a batch failure worth retrying: a timeout or network drop, a 429, or
 * any 5xx — except MIGRATION_REQUIRED, which is a 503 that stays broken until
 * someone runs migration 022, so retrying it only wastes the backoff. Everything
 * else (a cancel, a version or order conflict, a soft-deleted uid, a validation
 * error, a payload that is too large) is final.
 */
export function isRetryableImportFailure(error: ApiError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'MIGRATION_REQUIRED') return false;
  if (error.code === 'TIMEOUT' || error.code === 'NETWORK_ERROR') return true;
  if (error.httpStatus === 429) return true;
  if (typeof error.httpStatus === 'number' && error.httpStatus >= 500) return true;
  return false;
}

/** setTimeout as a promise that also resolves early when `signal` aborts. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function pushChunkFailures(
  result: ImportRunResult,
  chunk: readonly ImportAction[],
  code: string,
  message: string,
): void {
  for (const action of chunk) {
    result.failures.push({ action, stableUid: action.card.stableUid, code, message });
  }
}

/**
 * Runs the plan as a sequence of batches, in plan order. Returns counts plus the
 * list of actions that failed. A failed batch does not stop the run; a cancel
 * does, and everything the cancel left unwritten is reported so the operator can
 * re-preview against fresh server state before importing again.
 */
export async function runImport(
  deckId: number,
  actions: readonly ImportAction[],
  writer: ImportBatchWriter,
  options: RunImportOptions = {},
): Promise<ImportRunResult> {
  const { onProgress, signal, sleep = defaultSleep, isCurrent = () => true } = options;
  const result: ImportRunResult = {
    created: 0,
    updated: 0,
    failures: [],
    cancelled: false,
    notRun: 0,
    batches: [],
  };
  const total = actions.length;
  const refused = actions.filter(wouldClearTranslations);
  for (const action of refused) {
    result.failures.push({
      action,
      stableUid: action.card.stableUid,
      code: TRANSLATIONS_WOULD_BE_CLEARED,
      message: `Not sent: importing "${action.card.stableUid}" would delete its Chinese translation. Re-run the preview and choose to clear translations if that is intended.`,
    });
  }
  const chunks = chunkImportActions(
    deckId,
    refused.length === 0 ? actions : actions.filter((action) => !wouldClearTranslations(action)),
  );
  let done = refused.length;
  if (refused.length > 0) onProgress?.({ done, total, current: refused[refused.length - 1] });

  for (const chunk of chunks) {
    // Cancelled before this batch even started: none of it, or anything after
    // it, was attempted.
    if (signal?.aborted || !isCurrent()) {
      result.cancelled = true;
      result.notRun = total - done;
      return result;
    }

    const cards = chunk.map(cardInputFor);
    const operationId = crypto.randomUUID();
    const batch = { operationId, state: 'unknown' as 'committed' | 'failed' | 'unknown', cards: chunk.length };
    result.batches.push(batch);

    let unconfirmedAttempt = false;
    for (let attempt = 0; ; attempt++) {
      let outcome: ApiResult<ImportCardsBatchResult>;
      try {
        if (!isCurrent()) {
          result.notRun = total - done;
          return result;
        }
        outcome = await writer.importCards({ deckId, operationId, cards, signal });
      } catch (err: unknown) {
        // The api layer converts axios errors into ApiResult, so a throw here is
        // a bug or a browser-level failure. Record the batch and move on rather
        // than losing every batch after it.
        pushChunkFailures(
          result,
          chunk,
          'IMPORT_UNCONFIRMED',
          `The result is unconfirmed. Operation ${operationId}. ${err instanceof Error ? err.message : ''}`,
        );
        result.notRun = total - (done + chunk.length);
        return result;
      }

      if (!isCurrent() || outcome.error?.code === 'SESSION_CHANGED') {
        result.notRun = total - (done + chunk.length);
        return result;
      }

      if (outcome.success) {
        batch.state = 'committed';
        result.created += outcome.data?.created ?? 0;
        result.updated += outcome.data?.updated ?? 0;
        break;
      }

      const error = outcome.error;

      // A cancel can follow a commit. Keep the batch unconfirmed and stop.
      if (error?.code === 'CANCELLED' || signal?.aborted) {
        pushChunkFailures(result, chunk, IMPORT_CANCELLED, CANCELLED_MESSAGE);
        result.cancelled = true;
        result.notRun = total - (done + chunk.length);
        return result;
      }

      if (isRetryableImportFailure(error) && error?.httpStatus !== 429) unconfirmedAttempt = true;
      if (isRetryableImportFailure(error) && attempt < IMPORT_RETRY_DELAYS_MS.length) {
        await sleep(IMPORT_RETRY_DELAYS_MS[attempt], signal);
        // A cancel during the backoff wait ends the run the same way.
        if (signal?.aborted || !isCurrent()) {
          pushChunkFailures(result, chunk, IMPORT_CANCELLED, CANCELLED_MESSAGE);
          result.cancelled = true;
          result.notRun = total - (done + chunk.length);
          return result;
        }
        continue;
      }

      // A lost response never proves rollback. Stop rather than submit more work.
      const unknown = unconfirmedAttempt;
      batch.state = unknown ? 'unknown' : 'failed';
      pushChunkFailures(
        result,
        chunk,
        unknown ? 'IMPORT_UNCONFIRMED' : error?.code ?? 'UNKNOWN_ERROR',
        unknown ? `The result is unconfirmed. Operation ${operationId}. Check this operation before importing again.` : error?.message ?? 'Write failed.',
      );
      if (unknown) {
        result.notRun = total - (done + chunk.length);
        return result;
      }
      break;
    }

    done += chunk.length;
    onProgress?.({ done, total, current: chunk[chunk.length - 1] });
  }

  return result;
}
