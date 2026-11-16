// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { clearTokens, getSessionGeneration, saveTokens } from '../src/auth/tokenStore';
import { queryClient } from '../src/api/queryClient';
function tokens(sub: string, groups: string[]) {
  const jwt = `h.${btoa(JSON.stringify({ sub, iss: 'console-pool', aud: 'console-client', client_id: 'console-client', 'cognito:groups': groups }))}.s`;
  return { accessToken: jwt, idToken: jwt, expiresIn: 3600 };
}
afterEach(() => { clearTokens(); queryClient.clear(); });
it('ordinary same-subject same-role refresh preserves generation and cache even if group order changes', () => {
  saveTokens(tokens('A', ['editor', 'super_admin'])); const generation = getSessionGeneration();
  queryClient.setQueryData(['console-learners', 'A', generation], { secret: 'A-record' });
  saveTokens(tokens('A', ['super_admin', 'editor']), generation);
  expect(getSessionGeneration()).toBe(generation);
  expect(queryClient.getQueryData(['console-learners', 'A', generation])).toEqual({ secret: 'A-record' });
});
it.each([['A', ['editor']], ['B', ['super_admin']]] as const)('refresh changing identity or authorization clears old query data (%s)', (sub, groups) => {
  saveTokens(tokens('A', ['super_admin'])); const generation = getSessionGeneration();
  queryClient.setQueryData(['console-learners', 'A', generation], { secret: 'A-record' });
  saveTokens(tokens(sub, [...groups]), generation);
  expect(getSessionGeneration()).toBe(generation + 1);
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
});

it('access-token authorization changes invalidate even when the id-token claims are unchanged', () => {
  const original = tokens('A', ['super_admin']);
  saveTokens(original); const generation = getSessionGeneration();
  queryClient.setQueryData(['console-learners', 'A', generation], { secret: 'A-record' });
  saveTokens({ ...original, accessToken: tokens('A', ['editor']).accessToken }, generation);
  expect(getSessionGeneration()).toBe(generation + 1);
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
});

it('does not resurrect refresh credentials if reading a malformed previous record ends the session', () => {
  saveTokens(tokens('A', ['super_admin'])); const generation = getSessionGeneration();
  sessionStorage.setItem('devcards:tokens', '{malformed');
  expect(() => saveTokens(tokens('A', ['super_admin']), generation)).toThrow(expect.objectContaining({ code: 'SESSION_CHANGED' }));
  expect(sessionStorage.getItem('devcards:tokens')).toBeNull();
});
