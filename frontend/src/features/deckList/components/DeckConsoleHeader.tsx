import type { PublishJob } from '../../../api/authoring';
import { Button } from '../../../components/ui/Button';

type View = 'decks' | 'publishJobs';

export interface DeckConsoleHeaderProps {
  activeTab: View;
  onSelectTab: (tab: View) => void;
  superAdmin: boolean;
  publishJobs: PublishJob[];
  onRefreshDecks: () => void;
  onRefreshJobs: () => void;
  onNewDeck: () => void;
}

const views = [
  ['decks', 'Decks'],
  ['publishJobs', 'Publish Jobs'],
] as const;

export function DeckConsoleHeader({
  activeTab,
  onSelectTab,
  superAdmin,
  publishJobs,
  onRefreshDecks,
  onRefreshJobs,
  onNewDeck,
}: DeckConsoleHeaderProps) {
  const isDecks = activeTab === 'decks';
  const inProgress = publishJobs.filter(job => job.status === 'PENDING' || job.status === 'PROCESSING').length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{isDecks ? 'Decks' : 'Publish Jobs'}</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={isDecks ? onRefreshDecks : onRefreshJobs}>Refresh</Button>
          {superAdmin && <Button onClick={onNewDeck}>New Deck</Button>}
        </div>
      </div>
      {superAdmin && (
        <div role="tablist" aria-label="Deck console views" className="flex flex-wrap gap-1 border-b border-slate-200 pb-1">
          {views.map(([view, label]) => (
            <Button
              key={view}
              role="tab"
              aria-selected={activeTab === view}
              variant={activeTab === view ? 'secondary' : 'ghost'}
              className="min-h-11 gap-2"
              onClick={() => onSelectTab(view)}
            >
              {label}
              {view === 'publishJobs' && inProgress > 0 && (
                <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">{inProgress}</span>
              )}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
