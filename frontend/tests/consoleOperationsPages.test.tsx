// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../src/auth/AuthContext';
import { clearTokens, getSessionGeneration, saveTokens } from '../src/auth/tokenStore';
import { LearnersPage } from '../src/pages/LearnersPage';
import { LearnerDetailPage } from '../src/pages/LearnerDetailPage';
import { OperationsPage } from '../src/pages/OperationsPage';
import { OverviewPage } from '../src/pages/OverviewPage';
import { detail, envelope, learners, operations } from './support/consoleOperationsFixture';
const get = vi.hoisted(() => vi.fn());
vi.mock('../src/api/http', () => ({ http: { get } }));
function login(sub = 'A', groups = ['super_admin'], refresh = false) {
  const jwt = `header.${btoa(JSON.stringify({ sub, 'cognito:groups': groups }))}.signature`;
  return saveTokens({ accessToken: jwt, idToken: jwt, expiresIn: 3600 }, refresh ? getSessionGeneration() : undefined);
}
let client: QueryClient;
function mount(path = '/learners') {
  return render(<QueryClientProvider client={client}><AuthProvider><MemoryRouter initialEntries={[path]}><Routes><Route path="/learners" element={<LearnersPage />} /><Route path="/learners/:sub" element={<LearnerDetailPage />} /><Route path="/operations" element={<OperationsPage />} /><Route path="/overview" element={<OverviewPage />} /></Routes></MemoryRouter></AuthProvider></QueryClientProvider>);
}
beforeEach(() => { client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); get.mockReset(); login(); });
afterEach(() => { cleanup(); clearTokens(); client.clear(); localStorage.clear(); });
it.each(['/overview', '/operations', '/learners', '/learners/observed-1'])('guards direct route %s and makes no request for editors', async path => {
  login('editor', ['editor']); mount(path);
  expect(screen.getByText('Super administrator access required')).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Learners' })).toBeNull();
  expect(get).not.toHaveBeenCalled();
});
it('shows loading, observed directory semantics, literal search, empty state and server cursor paging', async () => {
  let resolve!: (value: unknown) => void;
  get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  mount(); expect(screen.getByRole('status').textContent).toContain('Loading observed learners');
  await act(async () => resolve(envelope({ ...learners, nextCursor: 'next-opaque' })));
  expect(screen.getByText(/not all Cognito registrations/)).toBeTruthy();
  expect(await screen.findByText(/First observed: 2026-11-16 04:00:00 UTC/)).toBeTruthy();
  get.mockResolvedValue(envelope({ ...learners, items: [], nextCursor: null }));
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByText('No observed learners match this search.');
  expect(get.mock.calls.at(-1)?.[1].params.cursor).toBe('next-opaque');
  fireEvent.change(screen.getByLabelText('Search email or subject'), { target: { value: 'a%_@example.invalid' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(get.mock.calls.at(-1)?.[1].params.query).toBe('a%_@example.invalid'));
  expect(get.mock.calls.at(-1)?.[1].params.cursor).toBeUndefined();
  expect(window.location.search).toBe('');
  expect(JSON.stringify({ ...localStorage })).not.toContain('a%_');
  expect(sessionStorage.getItem('devcards:tokens')).not.toContain('a%_');
});
it('separates raw flag, legacy tier, download decision and unique events from projected reviews', async () => {
  get.mockResolvedValue(envelope(detail)); mount('/learners/observed-1');
  await screen.findByRole('heading', { name: 'Evaluated access' });
  expect(screen.getByText('sandbox disallowed')).toBeTruthy();
  expect(screen.getByText('Premium download eligible').nextSibling?.textContent).toBe('No');
  expect(screen.getByText('Raw premium active flag').nextSibling?.textContent).toBe('Yes');
  expect(screen.getByText('Unique received events').nextSibling?.textContent).toBe('7');
  expect(screen.getByText('Projected reviews').nextSibling?.textContent).toBe('9');
  for (const label of ['Device queue', 'Last complete sync', 'Running device OTA']) expect(screen.getByText(label).nextSibling?.textContent).toBe('Unknown');
  get.mockRejectedValue({ response: { status: 404, data: { error: { code: 'NOT_FOUND' } } } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh learner' }));
  await screen.findByText('This learner is no longer in the observed directory.');
  expect(screen.queryByText('learner@example.invalid')).toBeNull();
});
it('labels stale samples, insufficient data and failed refresh without promoting alarms to health', async () => {
  get.mockResolvedValue(envelope({ ...operations, synthetic: { ...operations.synthetic, state: 'stale', status: 'healthy' } })); mount('/operations');
  await screen.findByText('Stale — historical results');
  expect(screen.getByText(/INSUFFICIENT_DATA/)).toBeTruthy();
  expect(screen.getByText(/OK means the alarm is not firing/)).toBeTruthy();
  expect(screen.getByText('Publishing source unavailable.')).toBeTruthy();
  get.mockRejectedValue(new Error('sensitive-query@example.invalid'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh sources' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('historical; current status is unknown');
  expect(screen.getByRole('alert').textContent).not.toContain('sensitive-query');
});
it('shares overview / operations data and one polling owner on navigation', async () => {
  get.mockResolvedValue(envelope(operations)); mount('/overview');
  await screen.findByRole('heading', { name: 'Operational sources' });
  expect(get).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('link', { name: 'Operations: checks, alarms and publishing' }));
  await screen.findByRole('heading', { name: 'Synthetic checks', level: 2 });
  expect(get).toHaveBeenCalledTimes(1);
});
it.each(['logout', 'identity', 'permission'])('cancels and drops cached PII on %s, refusing delayed A data', async change => {
  let resolve!: (value: unknown) => void;
  get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  get.mockResolvedValue(envelope({ ...learners, items: [] }));
  mount();
  fireEvent.change(screen.getByLabelText('Search email or subject'), { target: { value: 'A-search@example.invalid' } });
  const signal = get.mock.calls[0][1].signal as AbortSignal;
  await act(async () => { if (change === 'logout') clearTokens(); else if (change === 'identity') login('B'); else login('A', ['editor'], true); });
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(envelope(learners)));
  expect(screen.queryByText('learner@example.invalid')).toBeNull();
  expect(screen.queryByDisplayValue('A-search@example.invalid')).toBeNull();
  expect(JSON.stringify(client.getQueryCache().getAll().map(q => q.state.data))).not.toContain('learner@example.invalid');
  if (change === 'identity') { await screen.findByText('No observed learners match this search.'); expect(client.getQueryCache().getAll().every(q => q.queryKey.includes('B'))).toBe(true); }
  else expect(screen.getByText('Super administrator access required')).toBeTruthy();
});

it('drops previously loaded sensitive data when the API authoritatively denies a later read', async () => {
  get.mockResolvedValue(envelope(learners)); mount();
  await screen.findByText('learner@example.invalid');
  get.mockRejectedValue({ response: { status: 403, data: { error: { code: 'FORBIDDEN' }, traceId: 'denied' } } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh page' }));
  await screen.findByText('Super administrator access required');
  expect(screen.queryByText('learner@example.invalid')).toBeNull();
  expect(client.getQueryCache().getAll().some(q => JSON.stringify(q.state.data ?? null).includes('learner@example.invalid'))).toBe(false);
});

it('keeps non-null server activity and receipt times distinct from unknown complete device sync', async () => {
  const observed = { ...learners.items[0], lastServerActivityAt: '2026-11-14T12:34:56Z' };
  const evidence = { ...detail, learner: observed, progress: { ...detail.progress, latestEventAt: '2026-11-14T11:00:00Z', latestReceivedAt: '2026-11-14T13:00:00Z' } };
  get.mockImplementation((path: string) => Promise.resolve(envelope(path.endsWith('/observed-1') ? evidence : { ...learners, items: [observed] })));
  mount();
  await screen.findByText('Last server activity: 2026-11-14 12:34:56 UTC');
  fireEvent.click(screen.getByRole('link', { name: 'learner@example.invalid' }));
  await screen.findByRole('heading', { name: 'Observed identity' });
  expect(screen.getByText('Last server activity').nextSibling?.textContent).toBe('2026-11-14 12:34:56 UTC');
  expect(screen.getByText('Latest client event time').nextSibling?.textContent).toBe('2026-11-14 11:00:00 UTC');
  expect(screen.getByText('Latest server receipt').nextSibling?.textContent).toBe('2026-11-14 13:00:00 UTC');
  expect(screen.getByText('Last complete sync').nextSibling?.textContent).toBe('Unknown');
});
