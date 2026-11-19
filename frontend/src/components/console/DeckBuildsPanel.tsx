// src/components/console/DeckBuildsPanel.tsx
//
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppQueryClient } from '../../api/queryClient';
import { getSessionGeneration } from '../../auth/tokenStore';
import { useConsoleIdentity } from '../../hooks/useConsoleIdentity';
import { formatTime } from '../../lib/consoleOperationsView';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';

import { useConfirm } from '../ui/ConfirmDialogContext';
import {
  fetchDeckBuilds,
  rollbackDeck,
  rebuildManifest,
  reapStuckPublishJobs,
  type DeckBuild,
  type DeckRollbackResult,
  type ManifestRebuildResult,
  type PublishReapResult,
} from '../../api/authoring';

type Feedback = { kind: 'ok' | 'err'; text: string };

export function DeckBuildsPanel({ deckId, deckSlug, canRollback = true }: { deckId: number; deckSlug: string; canRollback?: boolean }) {
  // useConfirm falls back to window.confirm when no provider is above it, but the
  // real app (and this panel's tests) mount it inside ConfirmDialogProvider, so
  // the typed phrase below is actually enforced.
  const confirm = useConfirm();

  const identity = useConsoleIdentity();
  const versions = useQuery({
    queryKey: ['deck-versions', identity.generation, deckId],
    enabled: identity.allowed,
    refetchOnMount: 'always',
    queryFn: async () => {
      const res = await fetchDeckBuilds(deckId);
      if (!res.success || !res.data) throw new Error(res.error?.message ?? 'Could not load versions.');
      return res.data;
    },
  }, useAppQueryClient());
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [rollingBack, setRollingBack] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [reaping, setReaping] = useState(false);

  async function handleRollback(build: DeckBuild): Promise<void> {
    if (!canRollback) return;
    // This action spends a confirmPhrase — the friction reserved for the one bar
    // ConfirmDialogContext.ts draws around "other people's data" — because a
    // rollback changes what every app user downloads on their next manifest
    // check, not just a row this admin owns.
    const okToGo = await confirm({
      title: `Roll back ${deckSlug} to build ${build.buildId}?`,
      body: 'Every app user gets this build on their next manifest check. The current live build stays in this list, so you can roll forward again.',
      destructive: true,
      confirmLabel: 'Roll back',
      confirmPhrase: deckSlug,
    });
    if (!okToGo || !identity.allowed || getSessionGeneration() !== identity.generation) return;

    setRollingBack(true);
    setFeedback(null);
    const res = await rollbackDeck(deckId, build.buildId);
    setRollingBack(false);
    if (!res.success || !res.data) {
      setFeedback({ kind: 'err', text: res.error?.message ?? 'Rollback failed.' });
      return;
    }
    const result: DeckRollbackResult = res.data;
    setFeedback({ kind: 'ok', text: `Rolled back. Live build is now ${result.liveBuildId}.` });
    await versions.refetch();
  }

  async function handleRebuild(): Promise<void> {
    const okToGo = await confirm({
      title: 'Rebuild manifest.json now?',
      body: 'Regenerates the manifest every app reads, from the current database state.',
      confirmLabel: 'Rebuild',
    });
    if (!okToGo || !identity.allowed || getSessionGeneration() !== identity.generation) return;

    setRebuilding(true);
    setFeedback(null);
    const res = await rebuildManifest();
    setRebuilding(false);
    if (!res.success || !res.data) {
      setFeedback({ kind: 'err', text: res.error?.message ?? 'Manifest rebuild failed.' });
      return;
    }
    const result: ManifestRebuildResult = res.data;
    setFeedback({ kind: 'ok', text: `Manifest rebuilt: ${result.deckCount} decks.` });
  }

  async function handleReap(): Promise<void> {
    const okToGo = await confirm({
      title: 'Mark stuck publish jobs as failed?',
      body: 'Fails PENDING jobs older than 10 minutes and PROCESSING jobs idle for 30 minutes, so their decks can be published again.',
      confirmLabel: 'Reap',
    });
    if (!okToGo || !identity.allowed || getSessionGeneration() !== identity.generation) return;

    setReaping(true);
    setFeedback(null);
    const res = await reapStuckPublishJobs();
    setReaping(false);
    if (!res.success || !res.data) {
      setFeedback({ kind: 'err', text: res.error?.message ?? 'Reap failed.' });
      return;
    }
    const result: PublishReapResult = res.data;
    const text =
      result.pending === 0 && result.processing === 0
        ? 'No stuck jobs found.'
        : `Reaped ${result.pending} pending and ${result.processing} processing jobs.`;
    setFeedback({ kind: 'ok', text });
  }

  const builds = versions.data?.builds ?? [];

  return (
    <section aria-labelledby="deck-builds-heading" className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="deck-builds-heading" className="text-lg font-semibold text-slate-900">Published versions</h2>
          <p className="mt-1 text-sm text-slate-600">Recent successful publishes. Live marks the version selected for distribution.</p>
        </div>
        <Button variant="outline" size="sm" loading={versions.isFetching} onClick={() => void versions.refetch()}>Refresh versions</Button>
      </div>

      {versions.isFetching && <p role="status" className="text-sm text-slate-600">Loading versions…</p>}
      {versions.isError && <Callout role="alert" tone="danger">{versions.error.message}</Callout>}
      {feedback && <Callout role={feedback.kind === 'ok' ? 'status' : 'alert'} tone={feedback.kind === 'ok' ? 'success' : 'danger'}>{feedback.text}</Callout>}

      {versions.isSuccess && !versions.isFetching && (
        builds.length === 0 ? <p className="text-sm text-slate-600">No published versions yet.</p> : (
          <ul className="divide-y divide-slate-200 border-t border-slate-200">
            {builds.map(build => (
              <li key={build.buildId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="break-all font-mono text-sm text-slate-900">{build.buildId}</div>
                  <div className="text-xs text-slate-600">{formatTime(build.createdAt)}</div>
                  {build.note && <div className="mt-1 break-words text-sm text-slate-600">{build.note}</div>}
                </div>
                {build.isLive ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800">Live</span>
                  : canRollback && <Button variant="outline" size="sm" disabled={rollingBack || versions.isFetching} onClick={() => void handleRollback(build)}>Roll back to this build</Button>}
              </li>
            ))}
          </ul>
        )
      )}
      {!canRollback && <p className="text-sm text-slate-600">This deck uses a controlled rollback procedure.</p>}

      <details className="border-t border-slate-200 pt-2">
        <summary className="cursor-pointer rounded py-2 text-sm font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Maintenance for all decks</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" loading={rebuilding} onClick={() => void handleRebuild()}>Rebuild manifest</Button>
          <Button variant="outline" size="sm" loading={reaping} onClick={() => void handleReap()}>Reap stuck jobs</Button>
        </div>
      </details>
    </section>
  );
}
