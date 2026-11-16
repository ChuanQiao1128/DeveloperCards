// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../src/auth/AuthContext';
import { clearTokens, getSessionGeneration, saveTokens } from '../src/auth/tokenStore';
import { LearnersPage } from '../src/pages/LearnersPage';
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
  return render(<QueryClientProvider client={client}><AuthProvider><MemoryRouter initialEntries={[path]}><Routes><Route path="/learners/*" element={<LearnersPage />} /><Route path="/operations" element={<OperationsPage />} /><Route path="/overview" element={<OverviewPage />} /></Routes></MemoryRouter></AuthProvider></QueryClientProvider>);
}
beforeEach(() => { client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); get.mockReset(); login(); });
afterEach(() => { cleanup(); clearTokens(); client.clear(); localStorage.clear(); });
it.each(['/overview', '/operations', '/learners', '/learners/observed-1'])('guards direct route %s and makes no request for editors', async path => {
  login('editor', ['editor']); mount(path);
  expect(await screen.findByText('Super administrator access required')).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Learners' })).toBeNull();
  expect(get).not.toHaveBeenCalled();
});
it('shows loading, observed directory semantics, literal search, empty state and server cursor paging', async () => {
  let resolve!: (value: unknown) => void;
  get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  mount(); expect(screen.getByRole('status').textContent).toContain('Loading users');
  await act(async () => resolve(envelope({ ...learners, nextCursor: 'next-opaque' })));
  expect(screen.getByText(/not all registrations/)).toBeTruthy();
  expect((await screen.findAllByText(/2026-11-16 04:00:00 UTC/)).length).toBeGreaterThan(0);
  get.mockResolvedValue(envelope({ ...learners, items: [], nextCursor: null }));
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByText('No users on this page');
  expect(get.mock.calls.at(-1)?.[1].params.cursor).toBe('next-opaque');
  fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'a%_@example.invalid' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(get.mock.calls.at(-1)?.[1].params.query).toBe('a%_@example.invalid'));
  expect(get.mock.calls.at(-1)?.[1].params.cursor).toBeUndefined();
  expect(window.location.search).toBe('');
  expect(JSON.stringify({ ...localStorage })).not.toContain('a%_');
  expect(sessionStorage.getItem('devcards:tokens')).not.toContain('a%_');
});
it('separates raw flag, legacy tier, download decision and unique events from projected reviews', async () => {
  get.mockResolvedValue(envelope(detail)); mount('/learners/observed-1');
  await screen.findByRole('heading', { name: 'Account details' });
  fireEvent.click(screen.getByRole('tab', { name: 'Membership' }));
  expect(screen.getByText('Sandbox access does not permit premium downloads')).toBeTruthy();
  expect(screen.getByText('Premium downloads').nextSibling?.textContent).toBe('Not allowed');
  fireEvent.click(screen.getByText('Troubleshooting: subscription and legacy records'));
  expect(screen.getByText('Raw subscription active flag').nextSibling?.textContent).toBe('Yes');
  fireEvent.click(screen.getByRole('tab', { name: 'Learning' }));
  fireEvent.click(screen.getByText('Troubleshooting: sync and device state'));
  expect(screen.getByText('Unique received events').nextSibling?.textContent).toBe('7');
  expect(screen.getAllByText('Total reviews')[0].nextSibling?.textContent).toBe('9');
  for (const label of ['Device queue', 'Last complete sync', 'Running device OTA']) expect(screen.getByText(label).nextSibling?.textContent).toBe('Not collected');
  get.mockRejectedValue({ response: { status: 404, data: { error: { code: 'NOT_FOUND' } } } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh profile' }));
  await screen.findByText('This user is no longer in the observed directory.');
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
  fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'A-search@example.invalid' } });
  const signal = get.mock.calls[0][1].signal as AbortSignal;
  await act(async () => { if (change === 'logout') clearTokens(); else if (change === 'identity') login('B'); else login('A', ['editor'], true); });
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(envelope(learners)));
  expect(screen.queryByText('learner@example.invalid')).toBeNull();
  expect(screen.queryByDisplayValue('A-search@example.invalid')).toBeNull();
  expect(JSON.stringify(client.getQueryCache().getAll().map(q => q.state.data))).not.toContain('learner@example.invalid');
  if (change === 'identity') { await screen.findByText('No connected users yet'); expect(client.getQueryCache().getAll().every(q => q.queryKey.includes('B'))).toBe(true); }
  else expect(screen.getByText('Super administrator access required')).toBeTruthy();
});

it('drops previously loaded sensitive data when the API authoritatively denies a later read', async () => {
  get.mockResolvedValue(envelope(learners)); mount();
  await screen.findByText('learner@example.invalid');
  get.mockRejectedValue({ response: { status: 403, data: { error: { code: 'FORBIDDEN' }, traceId: 'denied' } } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }));
  await screen.findByText('Super administrator access required');
  expect(screen.queryByText('learner@example.invalid')).toBeNull();
  expect(client.getQueryCache().getAll().some(q => JSON.stringify(q.state.data ?? null).includes('learner@example.invalid'))).toBe(false);
});

it('keeps non-null server activity and receipt times distinct from unknown complete device sync', async () => {
  const observed = { ...learners.items[0], lastServerActivityAt: '2026-11-14T12:34:56Z' };
  const evidence = { ...detail, learner: observed, progress: { ...detail.progress, latestEventAt: '2026-11-14T11:00:00Z', latestReceivedAt: '2026-11-14T13:00:00Z' } };
  get.mockImplementation((path: string) => Promise.resolve(envelope(path.endsWith('/observed-1') ? evidence : { ...learners, items: [observed] })));
  mount();
  await screen.findAllByText(/2026-11-14 12:34:56 UTC/);
  fireEvent.click(screen.getByRole('link', { name: 'learner@example.invalid' }));
  await screen.findByRole('heading', { name: 'Account details' });
  expect(screen.getByText('Last connected').nextSibling?.textContent).toBe('2026-11-14 12:34:56 UTC');
  fireEvent.click(screen.getByRole('tab', { name: 'Learning' }));
  fireEvent.click(screen.getByText('Troubleshooting: sync and device state'));
  expect(screen.getByText('Latest client event time').nextSibling?.textContent).toBe('2026-11-14 11:00:00 UTC');
  expect(screen.getByText('Latest server receipt').nextSibling?.textContent).toBe('2026-11-14 13:00:00 UTC');
  expect(screen.getByText('Last complete sync').nextSibling?.textContent).toBe('Not collected');
});

it('returns to the same search and cursor after opening a user, without persisting the search', async () => {
  get.mockImplementation((path: string, config: { params: { cursor?: string } }) => Promise.resolve(envelope(path.endsWith('/observed-1') ? detail : { ...learners, nextCursor: config.params.cursor ? null : 'saved-page-2' })));
  mount();
  await screen.findByText('learner@example.invalid');
  fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'learner@example.invalid' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(get.mock.calls.at(-1)?.[1].params.query).toBe('learner@example.invalid'));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByText('Page 2');
  await screen.findByText('learner@example.invalid');
  fireEvent.click(screen.getByRole('link', { name: 'learner@example.invalid' }));
  await screen.findByRole('heading', { name: 'Account details' });
  fireEvent.click(screen.getByRole('link', { name: 'Back to users' }));
  await screen.findByText('Page 2');
  expect(screen.getByDisplayValue('learner@example.invalid')).toBeTruthy();
  expect(get.mock.calls.at(-1)?.[1].params).toMatchObject({ query: 'learner@example.invalid', cursor: 'saved-page-2' });
  expect(window.location.search).toBe('');
  expect(JSON.stringify({ ...sessionStorage, ...localStorage })).not.toContain('learner@example.invalid');
});

it('rejects invalid searches before calling the API and lets the operator clear them', async () => {
  get.mockResolvedValue(envelope(learners)); mount();
  await screen.findByText('learner@example.invalid');
  fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'a'.repeat(129) } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(screen.getByRole('alert').textContent).toContain('128');
  expect(get).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByLabelText('Search users') as HTMLInputElement).value).toBe('');
});

it('supports keyboard tabs and makes a failed ID copy recoverable', async () => {
  get.mockResolvedValue(envelope(detail)); mount('/learners/observed-1');
  await screen.findByRole('heading', { name: 'Account details' });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard unavailable')) } });
  fireEvent.click(screen.getByRole('button', { name: 'Copy ID' }));
  await screen.findByText('Could not copy. Select the user ID below and copy it manually.');
  expect(screen.getByText('observed-1')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Account' }), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Membership', selected: true })).toBe(document.activeElement);
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  expect(screen.getByRole('tab', { name: 'Learning', selected: true })).toBe(document.activeElement);
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(screen.getByRole('tab', { name: 'Account', selected: true })).toBe(document.activeElement);
});

it('shows unavailable entitlement and progress sources as unknown rather than free or zero', async () => {
  const unknown = { ...detail, entitlements: { ...detail.entitlements, state: 'unknown', effective: { ...detail.entitlements.effective, entitlementsTier: 'unknown', entitlementsSource: 'unknown', premiumDownloadEligible: null, downloadReason: 'source_unavailable' } }, progress: { ...detail.progress, state: 'unknown', projectedCardCount: null, projectedReviewCount: null, uniqueReceivedEventCount: null, decks: [] } };
  get.mockResolvedValue(envelope(unknown)); mount('/learners/observed-1');
  await screen.findByRole('heading', { name: 'Account details' });
  expect(screen.getAllByText('Access unknown').length).toBeGreaterThan(0);
  expect(screen.queryByText('Free access')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Learning' }));
  expect(screen.getByText('Cards with progress').nextSibling?.textContent).toBe('Unknown');
  expect(screen.getByText('Total reviews').nextSibling?.textContent).toBe('Unknown');
  expect(screen.getByText('Learning data unavailable')).toBeTruthy();
});

it('marks a failed detail refresh as historical and keeps backend errors private', async () => {
  get.mockResolvedValue(envelope(detail)); mount('/learners/observed-1');
  await screen.findByRole('heading', { name: 'Account details' });
  get.mockRejectedValue(new Error('private@example.invalid SQL error'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh profile' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('historical');
  expect(alert.textContent).not.toContain('private@example.invalid');
  expect(screen.getByRole('heading', { name: 'learner@example.invalid' })).toBeTruthy();
});

it('clears saved directory state after leaving and re-entering the learner workspace', async () => {
  get.mockImplementation((path: string) => Promise.resolve(envelope(path.endsWith('/operations/overview') ? operations : learners)));
  mount();
  await screen.findByText('learner@example.invalid');
  fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'private-search@example.invalid' } });
  fireEvent.click(screen.getByRole('link', { name: 'Operations', exact: true }));
  await screen.findByRole('heading', { name: 'Synthetic checks', level: 2 });
  fireEvent.click(screen.getByRole('link', { name: 'Learners', exact: true }));
  await screen.findByText('learner@example.invalid');
  expect((screen.getByLabelText('Search users') as HTMLInputElement).value).toBe('');
  expect(screen.queryByDisplayValue('private-search@example.invalid')).toBeNull();
});
