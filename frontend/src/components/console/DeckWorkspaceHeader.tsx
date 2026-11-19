import { Link, useLocation } from 'react-router-dom';

import { useConsoleIdentity } from '../../hooks/useConsoleIdentity';
import { LINK } from '../../lib/consoleOperationsView';
import { cardListHref } from '../../lib/cardListLocation';
import { hasReviewedDeckRelease } from '../../lib/deckWorkspace';
import type { Deck } from '../../types/deck';

type DeckView = 'cards' | 'publishing' | 'versions' | 'settings';

export function DeckWorkspaceHeader({ deck, view, cardListSearch }: {
  deck: Pick<Deck, 'id' | 'slug' | 'title'>; view: DeckView; cardListSearch?: string;
}) {
  const identity = useConsoleIdentity();
  const { state } = useLocation();
  const inventory = { cardListSearch: cardListSearch ?? state?.cardListSearch };
  const query = `?deckId=${deck.id}`;
  const links: [DeckView, string, string][] = [['cards', 'Cards', '/decks/cards']];
  if (identity.allowed || (hasReviewedDeckRelease(deck) && identity.user?.groups.includes('editor'))) {
    links.push(['publishing', 'Publishing', '/decks/publish']);
  }
  if (identity.allowed) links.push(['versions', 'Published versions', '/decks/versions']);
  links.push(['settings', 'Settings', '/decks/edit']);

  return (
    <div className="space-y-3">
      <Link to="/" className={`${LINK} inline-flex min-h-11 items-center text-sm`}>All decks</Link>
      <div className="min-w-0">
        <h1 className="break-words text-2xl font-semibold tracking-tight text-slate-900">{deck.title}</h1>
        <p className="mt-1 break-all font-mono text-xs text-slate-600">{deck.slug}</p>
      </div>
      <nav aria-label="Deck pages" className="flex flex-wrap gap-1 border-b border-slate-200 pb-1">
        {links.map(([key, label, path]) => (
          <Link
            key={key}
            to={key === 'cards' ? cardListHref(deck.id, inventory) : path + query}
            state={inventory}
            aria-current={view === key ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${view === key ? 'bg-indigo-50 text-indigo-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`}
          >
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
