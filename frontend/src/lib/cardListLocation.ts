import { DEFAULT_CARD_LIST_CRITERIA, type CardListCriteria } from './cardListFilter';

const KEYS = {
  query: 'q',
  kind: 'kind',
  difficulty: 'difficulty',
  translation: 'translation',
  sort: 'sort',
} satisfies Record<keyof CardListCriteria, string>;

export function readCardListCriteria(params: URLSearchParams): CardListCriteria {
  const kind = params.get(KEYS.kind);
  const translation = params.get(KEYS.translation);
  const sort = params.get(KEYS.sort);
  const rawDifficulty = params.get(KEYS.difficulty);
  const difficulty = rawDifficulty?.trim() ? Number(rawDifficulty) : Number.NaN;
  return {
    query: params.get(KEYS.query) ?? '',
    kind: kind === 'mcq' || kind === 'qa' ? kind : 'all',
    difficulty: Number.isSafeInteger(difficulty) && difficulty >= 0 ? difficulty : 'all',
    translation: translation === 'zh-missing' || translation === 'zh-stale' ? translation : 'all',
    sort: sort === 'updated' || sort === 'difficulty' ? sort : 'order',
  };
}

export function writeCardListCriteria(params: URLSearchParams, criteria: CardListCriteria): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of Object.keys(KEYS) as (keyof CardListCriteria)[]) {
    if (criteria[key] === DEFAULT_CARD_LIST_CRITERIA[key]) next.delete(KEYS[key]);
    else next.set(KEYS[key], String(criteria[key]));
  }
  next.delete('page');
  return next;
}

export function cardListHref(deckId: number, state?: { cardListSearch?: unknown } | null): string {
  const previous = new URLSearchParams(typeof state?.cardListSearch === 'string' ? state.cardListSearch : '');
  const params = Number(previous.get('deckId')) === deckId ? previous : new URLSearchParams();
  // Construct a local route from the validated deck id.
  params.set('deckId', String(deckId));
  return `/decks/cards?${params}`;
}
