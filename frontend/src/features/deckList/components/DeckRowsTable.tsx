// src/features/deckList/components/DeckRowsTable.tsx
//
import { Link } from 'react-router-dom';
import { hasReviewedDeckRelease } from '../../../lib/deckWorkspace';
import { isStarterLike } from '../deckListPagination';
import type { DeckStatus } from '../deckListPagination';
import { safeDateTime } from '../deckListManifest';
import type { ConsoleDeckRow } from '../deckListRows';

const DECK_LINK = 'rounded text-left break-words font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

function statusBadge(status: DeckStatus) {
  if (status === 'published') {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm">Published</span>;
  }
  if (status === 'needs_publish') {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 shadow-sm">Needs Publish</span>;
  }
  return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200 shadow-sm">Unpublished</span>;
}

function typeBadge(deckType: number) {
  if (deckType === 1) {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">Starter</span>;
  }
  return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200">Paid</span>;
}

export interface DeckRowsTableProps {
  rows: ConsoleDeckRow[];
  loading: boolean;
  emptyMessage: string;
  superAdmin: boolean;
  publishingSlug: string | null;
  /** The row whose Publish click is waiting on the AI QA preview, before the dialog opens. */
  checkingQaSlug: string | null;
  deletingSlug: string | null;
  onNavigate: (row: ConsoleDeckRow, to: (id: number) => string) => void;
  onPublish: (row: ConsoleDeckRow) => void;
  onDelete: (row: ConsoleDeckRow) => void;
}

export function DeckRowsTable({
  rows,
  loading,
  emptyMessage,
  superAdmin,
  publishingSlug,
  checkingQaSlug,
  deletingSlug,
  onNavigate,
  onPublish,
  onDelete,
}: DeckRowsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table aria-label="Decks" className="w-full text-left text-sm">
        <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider whitespace-nowrap text-slate-500 font-semibold">
          <tr>
            <th className="px-4 py-3" scope="col">Deck</th>
            <th className="hidden px-4 py-3 md:table-cell" scope="col">Cards</th>
            <th className="hidden px-4 py-3 lg:table-cell" scope="col">Type</th>
            <th className="px-3 py-3" scope="col">Status</th>
            <th className="hidden px-4 py-3 lg:table-cell" scope="col">Updated</th>
            {superAdmin && <th className="px-4 py-3" scope="col">Actions</th>}
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {loading ? (
            <tr>
              <td colSpan={superAdmin ? 6 : 5} className="px-6 py-16 text-center text-slate-500 text-sm">
                Loading decks…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={superAdmin ? 6 : 5} className="px-6 py-16 text-center text-slate-500 text-sm">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map(row => (
              <tr key={row.key} className="hover:bg-slate-50/60 transition-colors group">
                <td className="min-w-0 px-4 py-3">
                  {row.id === null || !Number.isFinite(row.id) ? (
                    <button className={DECK_LINK} type="button" onClick={() => onNavigate(row, id => `/decks/cards?deckId=${id}`)}>{row.title || row.slug}</button>
                  ) : <Link className={DECK_LINK} to={`/decks/cards?deckId=${row.id}`}>{row.title || row.slug}</Link>}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span className="break-all font-mono">{row.slug}</span>
                    {row.manifestOrder != null && <span title="Manifest order">Order {row.manifestOrder}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600 md:hidden">
                    <span>{row.cardCount} cards</span>
                  </div>
                </td>
                <td className="hidden px-4 py-3 tabular-nums md:table-cell">{row.cardCount}</td>
                <td className="hidden px-4 py-3 lg:table-cell">{typeBadge(isStarterLike(row.deckType, row.tier) ? 1 : 2)}</td>
                <td className="whitespace-nowrap px-3 py-3">{statusBadge(row.status)}</td>
                <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-slate-600 lg:table-cell">{safeDateTime(row.updatedAt)}</td>
                {superAdmin && (
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {hasReviewedDeckRelease(row) ? (
                        <Link className={DECK_LINK} to={`/decks/publish?deckId=${row.id}`}>Reviewed release</Link>
                      ) : (
                        <button
                          type="button"
                          disabled={publishingSlug === row.slug || checkingQaSlug === row.slug}
                          onClick={() => onPublish(row)}
                          className={`rounded-md border px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 ${
                            row.status === 'needs_publish'
                              ? 'border-amber-200 bg-amber-50 font-semibold text-amber-900 hover:border-amber-300'
                              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {publishingSlug === row.slug
                            ? 'Publishing…'
                            : checkingQaSlug === row.slug
                              ? 'Checking AI QA…'
                              : 'Publish'}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={deletingSlug === row.slug}
                        onClick={() => onDelete(row)}
                        className="rounded px-2 text-xs font-medium text-red-700 hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingSlug === row.slug ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
