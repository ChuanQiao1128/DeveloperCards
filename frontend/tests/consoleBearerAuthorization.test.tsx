// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { clearTokens, getSessionGeneration, getUserGroups, saveTokens } from '../src/auth/tokenStore';
import { readSessionUser } from '../src/auth/sessionUser';
import { ConsoleShell } from '../src/components/console/ConsoleShell';
import { consoleNav } from '../src/components/console/consoleNav';
import { LearnerWorkspace } from '../src/pages/LearnerWorkspace';
import { LearnersPage } from '../src/pages/LearnersPage';
import { LearnerDetailPage } from '../src/pages/LearnerDetailPage';
import { OperationsPage } from '../src/pages/OperationsPage';
import { OverviewPage } from '../src/pages/OverviewPage';
import { detail, envelope, learners, operations } from './support/consoleOperationsFixture';
const get = vi.hoisted(() => vi.fn());
vi.mock('../src/api/http', () => ({ http: { get } }));
function jwt(sub: string, groups?: string[]) {
  return `header.${btoa(JSON.stringify({ sub, 'cognito:groups': groups }))}.signature`;
}
function AuthProbe() {
  return <output data-testid="auth-groups">{JSON.stringify(useAuth().user?.groups ?? [])}</output>;
}
const original = { accessToken: jwt('A', ['super_admin']), idToken: jwt('A', ['super_admin']), expiresIn: 3600 };
const cases = [
  { name: 'editor bearer', sub: 'A', groups: ['editor'] },
  { name: 'empty bearer groups', sub: 'A', groups: [] },
  { name: 'missing bearer groups', sub: 'A', groups: undefined },
  { name: 'mismatched bearer subject', sub: 'B', groups: ['super_admin'] },
];
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockReset();
  get.mockImplementation((path: string) => Promise.resolve(envelope(path.endsWith('/operations/overview') ? operations : path.endsWith('/observed-1') ? detail : learners)));
  saveTokens(original);
});
afterEach(() => { cleanup(); clearTokens(); client.clear(); });
for (const path of ['/overview', '/operations', '/learners', '/learners/observed-1']) {
  it.each(cases)(`immediately denies ${path} after refreshed $name despite unchanged super-admin ID token`, async scenario => {
    render(<QueryClientProvider client={client}><AuthProvider><MemoryRouter initialEntries={[path]}><AuthProbe /><Routes>
      <Route path="/overview" element={<OverviewPage />} /><Route path="/operations" element={<OperationsPage />} />
      <Route path="/learners" element={<LearnerWorkspace />}><Route index element={<LearnersPage />} /><Route path=":sub" element={<LearnerDetailPage />} /></Route>
    </Routes></MemoryRouter></AuthProvider></QueryClientProvider>);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.getByRole('link', { name: '用户管理' })).toBeTruthy();
    client.setQueryData(['private-A-marker'], 'A cached PII');
    get.mockImplementation(() => new Promise(() => {}));
    act(() => { saveTokens({ ...original, accessToken: jwt(scenario.sub, scenario.groups) }, getSessionGeneration()); });
    expect(screen.getByText('Super administrator access required')).toBeTruthy();
    for (const name of ['Overview', 'Operations', '用户管理', 'Admin Management', 'Webhooks']) expect(screen.queryByRole('link', { name })).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['private-A-marker'])).toBeUndefined();
    expect(JSON.stringify(client.getQueryCache().getAll().map(q => q.state.data))).not.toContain('learner@example.invalid');
    const expected = scenario.sub === 'A' ? scenario.groups ?? [] : [];
    expect(getUserGroups()).toEqual(expected);
    expect(readSessionUser()?.groups ?? []).toEqual(expected);
    expect(screen.getByTestId('auth-groups').textContent).toBe(JSON.stringify(expected));
    if (scenario.sub !== 'A') expect(readSessionUser()).toBeNull();
  });
}
it.each(cases)('a stale explicit superAdmin prop cannot retain privileged navigation with $name', scenario => {
  render(<MemoryRouter><ConsoleShell title="Console" superAdmin={true} {...consoleNav()}>Body</ConsoleShell></MemoryRouter>);
  expect(screen.getByRole('link', { name: '用户管理' })).toBeTruthy();
  act(() => { saveTokens({ ...original, accessToken: jwt(scenario.sub, scenario.groups) }, getSessionGeneration()); });
  for (const name of ['Overview', 'Operations', '用户管理', 'Admin Management', 'Webhooks']) expect(screen.queryByRole('link', { name })).toBeNull();
});
