// src/pages/ReportsPage.tsx
//
// Learner card reports (R20 contract §4 console routes): what learners flagged
// as wrong, outdated, unclear or mistyped, listed newest first and filtered by
// status, deck and reason (in the URL). The editor returns to the same queue.
// A report only leaves the open queue after the server confirms its resolution.
//
// A report note is learner-written text: it is rendered as a text node and
// nothing else. The server never sends who reported a card, and this page
// shows no reporter. A report from a learner who was not signed in (R28
// ANONREPORT) carries no note and is marked "Not signed in" under its reason.
//
// A server whose database has no card_reports table yet answers 503 NOT_READY;
// that is an owner step, not an error, so it gets a neutral callout.
import { Fragment, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { fetchDecks } from '../api/authoring';
import {
  CARD_REPORT_NOTE_MAX,
  CARD_REPORT_REASONS,
  CARD_REPORT_RESOLUTIONS,
  cardReportEditorHref,
  cardReportLocaleBadge,
  listCardReports,
  resolveCardReport,
  type CardReport,
  type CardReportReason,
  type CardReportResolution,
  type CardReportStatusFilter,
} from '../api/cardReports';
import { ConsoleShell } from '../components/console/ConsoleShell';
import { consoleNav } from '../components/console/consoleNav';
import {
  CARD_CLASS,
  H1_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  TD_CLASS,
  TH_CLASS,
} from '../components/console/consoleStyles';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { CONSOLE_NAME } from '../lib/brand';
import { formatAge } from '../lib/automationRules';

type LoadError = { code: string; message: string };

type ReportView = { filter: string; refresh: number };
type ListState = {
  /** Distinguishes separate visits to the same filter while requests overlap. */
  forView: ReportView | null;
  requestId: symbol | null;
  error: LoadError | null;
  items: CardReport[];
  nextCursor: string | null;
  /** When the first page arrived, for the Age column. */
  loadedAt: number;
};

type DeckOption = { id: number; label: string };

const STATUS_OPTIONS: Array<{ value: CardReportStatusFilter; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

const REASON_LABELS: Record<CardReportReason, { label: string; tone: 'danger' | 'warning' | 'info' | 'neutral' }> = {
  wrong_answer: { label: 'Wrong answer', tone: 'danger' },
  outdated: { label: 'Outdated', tone: 'warning' },
  unclear: { label: 'Unclear', tone: 'info' },
  typo: { label: 'Typo', tone: 'neutral' },
  other: { label: 'Other', tone: 'neutral' },
};

const RESOLUTION_LABELS: Record<CardReportResolution, string> = {
  fixed: 'Fixed',
  wont_fix: "Won't fix",
  duplicate: 'Duplicate',
  invalid: 'Invalid',
};

const NOT_READY_TEXT = 'Card reports are not set up on the server yet (run the database migration)';

function statusFrom(value: string | null): CardReportStatusFilter {
  return value === 'resolved' || value === 'all' ? value : 'open';
}

function deckIdFrom(value: string | null): number | null {
  if (value === null || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function toLoadError(error: { code: string; message: string } | null, fallback: string): LoadError {
  return error ? { code: error.code, message: error.message } : { code: 'UNKNOWN', message: fallback };
}

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = statusFrom(searchParams.get('status'));
  const deckId = deckIdFrom(searchParams.get('deckId'));
  const reason = CARD_REPORT_REASONS.find(value => value === searchParams.get('reason'));

  const [list, setList] = useState<ListState>({ forView: null, requestId: null, error: null, items: [], nextCursor: null, loadedAt: 0 });
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [pagingRequest, setPagingRequest] = useState<symbol | null>(null);
  const [decks, setDecks] = useState<DeckOption[]>([]);
  const [resolving, setResolving] = useState<number | null>(null);
  const [resolution, setResolution] = useState<CardReportResolution>('fixed');
  const [resolutionNote, setResolutionNote] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  // Keep the live region mounted so assistive technology announces changes to it.
  const [announcement, setAnnouncement] = useState('');
  const [savingReport, setSavingReport] = useState<number | null>(null);
  const saving = useRef(false);
  const activeRead = useRef<symbol | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const filter = `${status}|${deckId ?? ''}|${reason ?? ''}`;
  const [view, setView] = useState<ReportView>({ filter, refresh: refreshNonce });
  if (view.filter !== filter || view.refresh !== refreshNonce) {
    setView({ filter, refresh: refreshNonce });
    if (view.filter !== filter) {
      setResolving(null);
      setActionError(null);
      setAnnouncement('');
    }
  }
  const loadingMore = pagingRequest !== null && pagingRequest === list.requestId;

  useEffect(() => {
    const requestId = Symbol();
    activeRead.current = requestId;
    async function run() {
      const res = await listCardReports({ status, deckId, cursor: null, ...(reason ? { reason } : {}) });
      if (activeRead.current !== requestId) return;
      if (!res.success || !res.data) {
        setList({
          forView: view,
          requestId,
          error: toLoadError(res.error, 'Failed to load card reports.'),
          items: [],
          nextCursor: null,
          loadedAt: Date.now(),
        });
        return;
      }
      setList({ forView: view, requestId, error: null, items: res.data.items, nextCursor: res.data.nextCursor, loadedAt: Date.now() });
    }
    void run();
    return () => { activeRead.current = null; };
  }, [status, deckId, reason, view]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const res = await fetchDecks();
      if (cancelled || !res.success || !res.data) return;
      setDecks(res.data.map(d => ({ id: d.id, label: `${d.title} (${d.slug})` })));
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = list.forView !== view;
  const notReady = !loading && list.error?.code === 'NOT_READY';
  const visibleReports = list.items.filter(report => status === 'all' || report.status === status);

  // Decks the deck list did not return (no access, or it failed) still filter by
  // the slug their reports carry.
  const deckOptions: DeckOption[] = [...decks];
  for (const r of list.items) {
    if (r.deckId !== null && !deckOptions.some(d => d.id === r.deckId)) {
      deckOptions.push({ id: r.deckId, label: r.deckSlug || `Deck ${r.deckId}` });
    }
  }
  if (deckId !== null && !deckOptions.some(d => d.id === deckId)) {
    deckOptions.push({ id: deckId, label: `Deck ${deckId}` });
  }

  function setFilter(name: 'status' | 'deckId' | 'reason', value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === '' || (name === 'status' && value === 'open')) next.delete(name);
    else next.set(name, value);
    setSearchParams(next);
  }

  async function loadMore() {
    const { requestId, nextCursor } = list;
    if (!nextCursor || !requestId || loadingMore) return;
    setPagingRequest(requestId);
    setActionError(null);
    const res = await listCardReports({ status, deckId, cursor: nextCursor, ...(reason ? { reason } : {}) });
    if (activeRead.current !== requestId) return;
    setPagingRequest(null);
    if (!res.success || !res.data) {
      setActionError(res.error?.message ?? 'Failed to load more card reports.');
      return;
    }
    const page = res.data;
    setList(prev =>
      prev.requestId === requestId
        ? {
            ...prev,
            items: [...prev.items, ...page.items.filter(r => !prev.items.some(p => p.reportId === r.reportId))],
            nextCursor: page.nextCursor,
          }
        : prev,
    );
  }

  function openResolve(reportId: number) {
    setResolving(reportId);
    setResolution('fixed');
    setResolutionNote('');
    setActionError(null);
  }

  async function submitResolve(event: FormEvent<HTMLFormElement>, report: CardReport) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setSavingReport(report.reportId);
    setActionError(null);
    setAnnouncement('Saving report resolution…');
    const requestId = activeRead.current;
    const note = resolutionNote.trim();
    const res = await resolveCardReport(report.reportId, note === '' ? { resolution } : { resolution, note });
    saving.current = false;
    if (activeRead.current === null) return;

    setSavingReport(null);
    if (activeRead.current !== requestId) {
      // A different read may have started before the write committed.
      if (res.success || res.error?.code === 'ALREADY_RESOLVED') setRefreshNonce(n => n + 1);
      return;
    }
    if (res.success && res.data) {
      const confirmed = res.data.resolution;
      setList(prev => ({
        ...prev,
        items: prev.items.map(row => row.reportId === report.reportId
          ? { ...row, status: 'resolved', resolution: confirmed, resolutionNote: note || null }
          : row),
      }));
      setResolving(null);
      setAnnouncement(`Report resolved as ${RESOLUTION_LABELS[confirmed]}.`);
      heading.current?.focus();
    } else if (res.error?.code === 'ALREADY_RESOLVED') {
      setResolving(null);
      setAnnouncement('This report was already resolved. Refreshing the queue.');
      setRefreshNonce(n => n + 1);
      heading.current?.focus();
    } else {
      setActionError(`Could not confirm the resolution: ${res.error?.message ?? 'unknown error'}. Refresh to check the report, or retry.`);
      setAnnouncement('');
    }
  }

  const noteHelpId = 'reports-resolve-note-help';

  return (
    <ConsoleShell title={CONSOLE_NAME} subtitle="Card feedback" {...consoleNav()}>
      <h1 ref={heading} tabIndex={-1} className={H1_CLASS}>Card feedback</h1>
      <p className="text-sm text-slate-600">
        Review feedback on published cards. Open the card in the editor to make a correction, then record the resolution.
      </p>

      <div role="status" aria-live="polite" className="sr-only" data-testid="reports-live">
        {announcement}
      </div>

      <section className={CARD_CLASS} aria-label="Filters">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="reports-status" className={LABEL_CLASS}>
              Status
            </label>
            <select
              id="reports-status"
              className={INPUT_CLASS}
              value={status}
              disabled={savingReport !== null}
              onChange={e => setFilter('status', e.target.value)}
            >
              {STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="reports-deck" className={LABEL_CLASS}>
              Deck
            </label>
            <select
              id="reports-deck"
              className={INPUT_CLASS}
              value={deckId === null ? '' : String(deckId)}
              disabled={savingReport !== null}
              onChange={e => setFilter('deckId', e.target.value)}
            >
              <option value="">All decks</option>
              {deckOptions.map(d => (
                <option key={d.id} value={String(d.id)}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="reports-reason" className={LABEL_CLASS}>Reason</label>
            <select
              id="reports-reason"
              className={INPUT_CLASS}
              value={reason ?? ''}
              disabled={savingReport !== null}
              onChange={e => setFilter('reason', e.target.value)}
            >
              <option value="">All reasons</option>
              {CARD_REPORT_REASONS.map(value => <option key={value} value={value}>{REASON_LABELS[value].label}</option>)}
            </select>
          </div>
          <Button variant="outline" loading={loading} disabled={savingReport !== null} onClick={() => {
            setActionError(null);
            setAnnouncement('');
            setRefreshNonce(n => n + 1);
          }}>
            Refresh reports
          </Button>
        </div>
      </section>

      {actionError ? (
        <Callout tone="danger" role="alert">
          {actionError}
        </Callout>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading card reports…</p>
      ) : notReady ? (
        <Callout tone="info">{NOT_READY_TEXT}</Callout>
      ) : list.error ? (
        <Callout tone="danger" role="alert" title="Could not load card reports">
          {list.error.message}
        </Callout>
      ) : visibleReports.length === 0 && !list.nextCursor ? (
        <p className="text-sm text-slate-500">No card reports match these filters.</p>
      ) : (
        <section className={CARD_CLASS} aria-label="Report list">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm" aria-label="Card reports" data-testid="reports-table">
              <thead>
                <tr className="border-b border-slate-200">
                  <th scope="col" className={TH_CLASS}>Deck</th>
                  <th scope="col" className={TH_CLASS}>Card question</th>
                  <th scope="col" className={TH_CLASS}>Reason</th>
                  <th scope="col" className={TH_CLASS}>Note</th>
                  <th scope="col" className={TH_CLASS}>Age</th>
                  <th scope="col" className={`${TH_CLASS} whitespace-nowrap`}>Status</th>
                  <th scope="col" className={TH_CLASS}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleReports.map(r => {
                  const reason = REASON_LABELS[r.reason];
                  const editorHref = cardReportEditorHref(r);
                  const cardName = r.question || r.stableUid;
                  const localeBadge = cardReportLocaleBadge(r);
                  return (
                    <Fragment key={r.reportId}>
                      <tr className="border-b border-slate-100 align-top">
                        <td className={TD_CLASS}>{r.deckSlug || '—'}</td>
                        <td className={TD_CLASS}>
                          <div className="text-slate-900">{r.question || '—'}</div>
                          <div className="text-xs text-slate-500">{r.stableUid}</div>
                        </td>
                        <td className={TD_CLASS}>
                          <span className="whitespace-nowrap"><Badge tone={reason.tone}>{reason.label}</Badge></span>
                          {r.anonymous ? (
                            <div className="text-xs text-slate-500 mt-1" data-testid="report-anonymous">
                              Not signed in
                            </div>
                          ) : null}
                          {localeBadge ? (
                            <div className="mt-1" data-testid="report-display-locale">
                              <Badge tone="info">{localeBadge}</Badge>
                            </div>
                          ) : null}
                        </td>
                        <td className={`${TD_CLASS} whitespace-pre-wrap break-words max-w-xs`}>
                          {r.note ?? <span className="text-slate-400">—</span>}
                        </td>
                        <td className={`${TD_CLASS} whitespace-nowrap`}>{formatAge(r.createdAt || null, list.loadedAt)}</td>
                        <td className={TD_CLASS}>
                          {r.status === 'resolved' ? (
                            <>
                              <Badge tone="success">
                                {r.resolution ? `Resolved · ${RESOLUTION_LABELS[r.resolution]}` : 'Resolved'}
                              </Badge>
                              {r.resolutionNote ? (
                                <div className="text-xs text-slate-600 mt-1 whitespace-pre-wrap break-words">
                                  {r.resolutionNote}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <span className="whitespace-nowrap"><Badge tone="warning">Open</Badge></span>
                          )}
                        </td>
                        <td className={TD_CLASS}>
                          <div className="flex flex-wrap items-center gap-2">
                            {editorHref ? (
                              <Link
                                to={editorHref}
                                state={{ reportSearch: searchParams.toString() }}
                                className="text-indigo-700 underline"
                                aria-label={`Open in editor: ${cardName}`}
                              >
                                Open in editor
                              </Link>
                            ) : (
                              <span className="text-xs text-slate-500">Card deleted</span>
                            )}
                            {r.status === 'open' ? (
                              <Button
                                variant="outline"
                                size="xs"
                                aria-label={`Resolve report: ${cardName}`}
                                aria-expanded={resolving === r.reportId}
                                disabled={savingReport !== null}
                                onClick={() => openResolve(r.reportId)}
                              >
                                Resolve
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      {resolving === r.reportId ? (
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <td className={TD_CLASS} colSpan={7}>
                            <form
                              aria-busy={savingReport === r.reportId}
                              aria-label={`Resolve report: ${cardName}`}
                              className="flex flex-wrap items-start gap-4"
                              onSubmit={e => void submitResolve(e, r)}
                            >
                              <div>
                                <label htmlFor={`reports-resolution-${r.reportId}`} className={LABEL_CLASS}>
                                  Resolution
                                </label>
                                <select
                                  id={`reports-resolution-${r.reportId}`}
                                  className={INPUT_CLASS}
                                  value={resolution}
                                  disabled={savingReport === r.reportId}
                                  onChange={e => setResolution(e.target.value as CardReportResolution)}
                                >
                                  {CARD_REPORT_RESOLUTIONS.map(value => (
                                    <option key={value} value={value}>
                                      {RESOLUTION_LABELS[value]}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex-1 min-w-[16rem]">
                                <label htmlFor={`reports-resolution-note-${r.reportId}`} className={LABEL_CLASS}>
                                  Note (optional)
                                </label>
                                <textarea
                                  id={`reports-resolution-note-${r.reportId}`}
                                  className={INPUT_CLASS}
                                  rows={2}
                                  maxLength={CARD_REPORT_NOTE_MAX}
                                  aria-describedby={noteHelpId}
                                  value={resolutionNote}
                                  disabled={savingReport === r.reportId}
                                  onChange={e => setResolutionNote(e.target.value)}
                                />
                                <div id={noteHelpId} className="text-xs text-slate-500 mt-1">
                                  {resolutionNote.length} / {CARD_REPORT_NOTE_MAX} characters. Shown to the learner who reported the card.
                                </div>
                              </div>
                              <div className="flex items-center gap-2 pt-5">
                                <Button type="submit" size="xs" loading={savingReport === r.reportId}>
                                  Save resolution
                                </Button>
                                <Button variant="ghost" size="xs" disabled={savingReport === r.reportId} onClick={() => setResolving(null)}>
                                  Cancel
                                </Button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {list.nextCursor ? (
            <div className="mt-3">
              <Button variant="outline" size="xs" loading={loadingMore} disabled={savingReport !== null} onClick={() => void loadMore()}>
                Load more
              </Button>
            </div>
          ) : null}
        </section>
      )}
    </ConsoleShell>
  );
}
