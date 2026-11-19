import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useDeck } from '../hooks/useDecks';
import { useCards, useDeleteCard } from '../hooks/useCards';
import { ApiFailureError, NOT_FOUND } from '../api/errors';
import { parseDeckId } from '../lib/parseDeckId';
import { qaPageHref } from '../lib/qaGate';
import { isSuperAdmin, readSessionUser } from '../auth/sessionUser';
import { CONSOLE_NAME } from '../lib/brand';
import { ConsoleShell } from '../components/console/ConsoleShell';
import { DeckWorkspaceHeader } from '../components/console/DeckWorkspaceHeader';
import { LINK } from '../lib/consoleOperationsView';
import { consoleNav } from '../components/console/consoleNav';
import { RarityBadge } from '../components/RarityBadge';
import { Button } from '../components/ui/Button';
import { INPUT_CLASS } from '../components/console/consoleStyles';
import { mapDifficultyToRarity } from '../gacha/rarityConfig';
import { readCardListCriteria, writeCardListCriteria } from '../lib/cardListLocation';
import { RarityDistribution } from '../components/RarityDistribution';
import { ErrorBannerList } from '../components/ui/ErrorBanner';
import { useConfirm } from '../components/ui/ConfirmDialogContext';
import {
  DEFAULT_CARD_LIST_CRITERIA,
  filterAndSortCards,
  formatCardDate,
  isCriteriaActive,
} from '../lib/cardListFilter';
import type { CardListCriteria } from '../lib/cardListFilter';
import { deckUsesTranslations, translationState, type TranslationState } from '../lib/translationView';
import {
  emptyErrorFeed,
  clearNotice,
  reportBusinessFailure,
  reportThrownFailure,
} from '../lib/errorFeed';
import type { ErrorNotice } from '../lib/errorFeed';

// One key for the delete action: a user who retries against a server that is
// still refusing gets the latest verdict, not a growing stack of copies.
const ERR_DELETE_CARD = 'card.delete';
const PAGE_SIZE = 30;

/**
 * The page's one failure surface. Both the "no deckId in the URL" case and a
 * load that came back wrong land here, exactly as they did when a single
 * `state.error` string drove this block.
 *
 * The two optional props are what the failure's `code` and `traceId` buy, and
 * they are the reason those fields are carried instead of being flattened into
 * a sentence:
 *
 *   onRetry  is offered for a failure that MIGHT come out differently, and
 *            withheld for one that cannot. A deck that is not there is not
 *            going to be there on the second press, and a button that re-asks
 *            an answered question teaches people to press it at every failure.
 *   traceId  is the only string on this screen that a server log can be
 *            searched for. It is printed rather than swallowed because the
 *            alternative -- asking someone to reproduce the failure while
 *            somebody watches the logs -- is what its absence costs.
 */
function LoadFailureScreen({
  message,
  traceId,
  onRetry,
}: {
  message: string;
  traceId?: string;
  onRetry?: () => void;
}) {
  return (
    <ConsoleShell
      title={CONSOLE_NAME}
      subtitle="Authoring · Cards"
      {...consoleNav()}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-800">Deck Cards</h1>
        <Link to="/" className="text-sm text-indigo-600 hover:text-indigo-800">
          ← Back to Decks
        </Link>
      </div>

      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
          <div className="font-semibold mb-1">Failed to load cards</div>
          <div className="text-sm">{message}</div>

          {traceId ? (
            <div className="text-xs mt-2 font-mono text-red-700">Trace {traceId}</div>
          ) : null}

          {onRetry ? (
            <button
              type="button"
              className="mt-3 text-sm px-3 py-1.5 rounded-md border border-red-200 text-red-800 hover:bg-red-100"
              onClick={onRetry}
            >
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </ConsoleShell>
  );
}

const TRANSLATION_BADGE: Record<TranslationState, { label: string; className: string }> = {
  ok: { label: 'zh-CN', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  stale: { label: 'zh-CN stale', className: 'bg-amber-50 text-amber-900 border-amber-200' },
  missing: { label: 'zh-CN missing', className: 'bg-red-50 text-red-800 border-red-200' },
};

function TranslationBadge({ state }: { state: TranslationState }) {
  const badge = TRANSLATION_BADGE[state];
  return (
    <span
      data-testid={`card-translation-badge-${state}`}
      className={`ml-1 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}

export function CardListPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // The rule this page used to spell out inline now lives in one place, because
  // NewCardPage and EditCardPage each had their own and the three disagreed.
  // The semantics are unchanged HERE -- it is the other two that move. NaN
  // stands in for "no id" when handing the value to the hooks, which keep the
  // same predicate for callers that have not parsed anything.
  const deckId = parseDeckId(searchParams.get('deckId'));
  const numericDeckId = deckId ?? Number.NaN;

  const user = useMemo(() => readSessionUser(), []);
  const superAdmin = useMemo(() => isSuperAdmin(user), [user]);

  // The read path. Both requests are keyed by deckId, which is what replaces
  // the two guards this page used to keep by hand — a `cancelled` flag captured
  // by the fetch effect, and a `state.deckId !== deckId` comparison — so a
  // response for a deck the user already left cannot repaint the current one.
  // tests/cardListPageRace.test.tsx is the same pair of assertions, written and
  // made green against the hand-guarded version before this rewrite.
  const deckQuery = useDeck(numericDeckId);
  const cardsQuery = useCards(numericDeckId);
  const deleteCardMutation = useDeleteCard();

  const [errors, setErrors] = useState<ErrorNotice[]>(emptyErrorFeed);
  const confirm = useConfirm();

  const criteria = readCardListCriteria(searchParams);
  function changeCriteria(next: CardListCriteria) {
    setSearchParams(writeCardListCriteria(searchParams, next), { replace: true, preventScrollReset: true });
  }
  const deferredQuery = useDeferredValue(criteria.query);
  const visibleCards = useMemo(
    () =>
      filterAndSortCards(cardsQuery.data ?? [], {
        query: deferredQuery,
        kind: criteria.kind,
        difficulty: criteria.difficulty,
        translation: criteria.translation,
        sort: criteria.sort,
      }),
    [cardsQuery.data, deferredQuery, criteria.kind, criteria.difficulty, criteria.translation, criteria.sort],
  );

  async function handleDelete(cardId: number) {
    if (!superAdmin) return;

    // The old string was 'Are you sure you want to delete this card?'. The
    // question mark was doing work that window.confirm could not: its buttons
    // are OK and Cancel, which name no action, so the sentence had to carry the
    // whole meaning. Here the button says "Delete card", so the question moves
    // to the title and the sentence is spent on the consequence instead.
    const ok = await confirm({
      title: 'Delete this card?',
      body: 'This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete card',
    });
    if (!ok) return;

    // Clearing up front is what makes a successful retry remove the banner,
    // instead of every success path having to remember to.
    setErrors(prev => clearNotice(prev, ERR_DELETE_CARD));

    try {
      // The mutation hands back the ApiResult rather than throwing on a
      // refusal, so the two failures stay distinguishable here: a server that
      // said no reaches the line below, a request that never came back reaches
      // the catch. They recommend opposite things.
      const { result } = await deleteCardMutation.mutateAsync({
        cardId,
        deckId: numericDeckId,
      });
      if (!result.success) {
        setErrors(prev =>
          reportBusinessFailure(
            prev,
            ERR_DELETE_CARD,
            `Deleting card #${cardId} failed`,
            result.error?.message,
          ),
        );
        return;
      }
      // The deleted row leaves the screen because the mutation removed it from
      // the cards query's cache, not because this page filtered a local array.
    } catch (err: unknown) {
      setErrors(prev =>
        reportThrownFailure(prev, ERR_DELETE_CARD, `Deleting card #${cardId} failed`, err),
      );
    }
  }

  // This has to come before the pending check, not after it. In react-query v5
  // a disabled query reports status 'pending' forever — idle only shows up in
  // fetchStatus — so reading isPending first would leave a URL with no deckId
  // on "Loading cards..." for good, where today it says so immediately.
  if (deckId === null) {
    return <LoadFailureScreen message="Missing or invalid deckId." />;
  }

  if (deckQuery.isPending || cardsQuery.isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-600 text-lg">Loading cards...</div>
      </div>
    );
  }

  // Same precedence as before: whatever went wrong with the deck is what the
  // user hears about, and only if the deck is fine does a cards failure get to
  // speak.
  //
  // What is gone is the middle rung that precedence used to have. A deck that
  // came back empty was reported by testing `deck === null` after a query that
  // had not errored -- reasoning backwards from a missing value to a verdict,
  // in a page that cannot see whether the value is missing because the deck
  // does not exist or because something else went quiet. useDeck now throws
  // that case as an ApiFailureError carrying NOT_FOUND, so there is one failure
  // channel and the branch reads the code instead of inferring it.
  if (deckQuery.isError || cardsQuery.isError) {
    const failure = deckQuery.error ?? cardsQuery.error;
    const known = failure instanceof ApiFailureError ? failure : null;

    return (
      <LoadFailureScreen
        message={failure instanceof Error ? failure.message : 'Unknown error'}
        traceId={known?.traceId ? known.traceId : undefined}
        onRetry={
          known?.code === NOT_FOUND
            ? undefined
            : () => {
                void deckQuery.refetch();
                void cardsQuery.refetch();
              }
        }
      />
    );
  }

  const deck = deckQuery.data;
  const cards = cardsQuery.data;

  // One option per difficulty actually present in the deck, ascending. Building
  // it from the full `cards` (not the filtered set) keeps every choice reachable
  // no matter what the current filter has narrowed the table down to.
  const difficulties = Array.from(new Set(cards.map(card => card.difficulty))).sort(
    (a, b) => a - b,
  );
  const filtersActive = isCriteriaActive(criteria);
  // The translation filter and badges only appear on a deck that declares
  // zh-CN or already holds a translated card; every other deck looks as before.
  const showTranslations = deckUsesTranslations(deck, cards);

  const pageCount = Math.max(1, Math.ceil(visibleCards.length / PAGE_SIZE));
  const requestedPage = Number(searchParams.get('page'));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, pageCount) : 1;
  const pageCards = visibleCards.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const state = { cardListSearch: searchParams.toString() };
  const deckQueryString = `?deckId=${deck.id}`;

  function changePage(next: number) {
    const params = new URLSearchParams(searchParams);
    if (next === 1) params.delete('page');
    else params.set('page', String(next));
    setSearchParams(params, { preventScrollReset: true });
  }

  return (
    <ConsoleShell title={CONSOLE_NAME} subtitle="Cards" {...consoleNav()}>
      <DeckWorkspaceHeader deck={deck} view="cards" cardListSearch={state.cardListSearch} />
      {errors.length > 0 && <ErrorBannerList notices={errors} onDismiss={key => setErrors(prev => clearNotice(prev, key))} />}
      <section className="rounded-lg border border-slate-200 bg-white" aria-labelledby="card-inventory">
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="card-inventory" className="text-lg font-semibold text-slate-900">Cards</h2>
              <p className="text-sm text-slate-600">{cards.length} cards in this deck</p>
            </div>
            <Link className="inline-flex min-h-11 items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              to={`/decks/cards/new${deckQueryString}`} state={state}>New card</Link>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link className={LINK} to={`/decks/cards/import${deckQueryString}`} state={state}>Import Markdown</Link>
            <Link className={LINK} to={`/decks/preview${deckQueryString}`} state={state}>Preview deck</Link>
            <Link className={LINK} to={qaPageHref(deck.id)} state={state}>AI QA</Link>
            <Link className={LINK} to={`/review${deckQueryString}`}>AI draft review</Link>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="card-list-search">Search cards</label>
            <input id="card-list-search" name="q" type="search" autoComplete="off" value={criteria.query}
              onChange={event => changeCriteria({ ...criteria, query: event.target.value })}
              className={`${INPUT_CLASS} min-h-11 max-w-xl`} placeholder="Question, topic, or card ID…" />
          </div>
          <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
            <label className="min-w-0 space-y-1 text-xs font-medium text-slate-700">Type
              <select aria-label="Card type" className={`${INPUT_CLASS} block bg-white`} value={criteria.kind}
                onChange={event => changeCriteria({ ...criteria, kind: event.target.value as CardListCriteria['kind'] })}>
                <option value="all">All types</option><option value="mcq">Multiple choice</option><option value="qa">Q&amp;A</option>
              </select>
            </label>
            <label className="min-w-0 space-y-1 text-xs font-medium text-slate-700">Rarity
              <select aria-label="Rarity" className={`${INPUT_CLASS} block bg-white`} value={criteria.difficulty}
                onChange={event => changeCriteria({ ...criteria, difficulty: event.target.value === 'all' ? 'all' : Number(event.target.value) })}>
                <option value="all">All rarities</option>
                {difficulties.map(difficulty => <option key={difficulty} value={difficulty}>
                  {difficulty === 0 ? 'Common (difficulty 0)' : mapDifficultyToRarity(difficulty)?.label ?? `Difficulty ${difficulty}`}
                </option>)}
              </select>
            </label>
            {showTranslations && <label className="min-w-0 space-y-1 text-xs font-medium text-slate-700">Translation
              <select aria-label="Chinese translation" className={`${INPUT_CLASS} block bg-white`} value={criteria.translation}
                onChange={event => changeCriteria({ ...criteria, translation: event.target.value as CardListCriteria['translation'] })}>
                <option value="all">Any translation status</option><option value="zh-missing">Chinese missing</option><option value="zh-stale">Chinese stale</option>
              </select>
            </label>}
            <label className="min-w-0 space-y-1 text-xs font-medium text-slate-700">Sort
              <select aria-label="Sort cards" className={`${INPUT_CLASS} block bg-white`} value={criteria.sort}
                onChange={event => changeCriteria({ ...criteria, sort: event.target.value as CardListCriteria['sort'] })}>
                <option value="order">Deck order</option><option value="updated">Recently updated</option><option value="difficulty">Difficulty</option>
              </select>
            </label>
            {filtersActive && <Button variant="outline" onClick={() => changeCriteria(DEFAULT_CARD_LIST_CRITERIA)}>Clear filters</Button>}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <div role="status">
            {filtersActive ? <span data-testid="card-list-visible-count">{visibleCards.length} of {cards.length} cards match</span>
              : <span>{visibleCards.length} cards</span>}
          </div>
          {pageCount > 1 && <nav aria-label="Card pages" className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => changePage(page - 1)}>Previous</Button>
            <span className="tabular-nums">Page {page} of {pageCount}</span>
            <Button variant="outline" size="sm" disabled={page === pageCount} onClick={() => changePage(page + 1)}>Next</Button>
          </nav>}
        </div>

        {pageCards.length === 0 ? <p className="px-4 py-6 text-sm text-slate-600">
          {cards.length === 0 ? 'No cards yet. Use New card or Import Markdown to add cards.' : 'No cards match these filters.'}
        </p> : (
          <table className="w-full text-left text-sm" aria-label="Cards in deck">
            <thead>
              <tr className="border-b border-slate-200 text-slate-700">
                <th scope="col" className="px-4 py-3 font-medium">Question</th>
                <th scope="col" className="hidden px-3 py-3 font-medium lg:table-cell">Updated</th>
                {superAdmin && <th scope="col" className="px-3 py-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {pageCards.map(card => (
                <tr key={card.id} className="align-top hover:bg-slate-50">
                  <td className="min-w-0 px-4 py-3">
                    <Link className="break-words rounded font-medium text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      to={`/decks/cards/edit${deckQueryString}&cardId=${card.id}`} state={state}>{card.question}</Link>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span className="tabular-nums">#{card.orderInDeck}</span>
                      {card.topic && <span className="break-words">{card.topic}</span>}
                      <RarityBadge difficulty={card.difficulty} />
                      {card.mcq ? <span data-testid="card-mcq-badge" className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium">MCQ</span> : null}
                      {showTranslations && <TranslationBadge state={translationState(card)} />}
                    </div>
                    <p className="mt-1 break-all font-mono text-xs text-slate-500">{card.stableUid}</p>
                  </td>
                  <td className="hidden px-3 py-3 text-xs text-slate-600 lg:table-cell">{formatCardDate(card.updatedAt)}</td>
                  {superAdmin && <td className="px-3 py-3">
                    <Button variant="ghost" size="xs" className="text-red-700" onClick={() => void handleDelete(card.id)}>Delete</Button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {cards.length > 0 && <details className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Card breakdown</summary>
        <RarityDistribution cards={cards} />
      </details>}
    </ConsoleShell>
  );
}
