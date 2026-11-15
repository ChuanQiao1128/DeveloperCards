// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { useLayoutEffect } from 'react';

vi.hoisted(() => {
  vi.stubEnv('VITE_COGNITO_DOMAIN', 'https://auth.session-tests.invalid');
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'session-tests-client');
  vi.stubEnv('VITE_COGNITO_REDIRECT_URI', 'http://localhost:5173/auth/callback');
  vi.stubEnv('VITE_COGNITO_SCOPES', 'openid email profile');
});
import { AuthProvider, useAuth, type AuthContextValue } from '../src/auth/AuthContext';
import { AuthCallbackPage } from '../src/pages/AuthCallbackPage';
import { clearTokens, readStoredTokens, saveTokens } from '../src/auth/tokenStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function login(who: string) {
  return saveTokens({ accessToken: `${who}-access`, idToken: `${who}-id`, refreshToken: `${who}-refresh`, expiresIn: 3600 });
}
const aTokens = { access_token: 'A-access', id_token: 'A-id', refresh_token: 'A-refresh', expires_in: 3600, token_type: 'Bearer' };
let assigned: ReturnType<typeof vi.fn>;
let locationDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  sessionStorage.clear();
  assigned = vi.fn();
  locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
  Object.defineProperty(window, 'location', { configurable: true, value: { pathname: '/B', search: '', assign: assigned } });
});
afterEach(() => {
  cleanup(); clearTokens();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (locationDescriptor) Object.defineProperty(window, 'location', locationDescriptor);
  sessionStorage.clear();
});

describe('late OAuth callback after another session has signed in', () => {
  for (const outcome of ['success', 'failure'] as const) it(`ignores the old exchange ${outcome} without overwriting B or navigating`, async () => {
    sessionStorage.setItem('devcards:pkce:verifier', 'A-verifier');
    sessionStorage.setItem('devcards:pkce:state', 'A-state');
    sessionStorage.setItem('devcards:postLoginRedirect', '/A-target');
    const exchange = deferred<{ ok: boolean; status: number; text: () => Promise<string> }>();
    const fetchToken = vi.fn(() => exchange.promise);
    vi.stubGlobal('fetch', fetchToken);
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = createMemoryRouter([
      { path: '/auth/callback', element: <AuthCallbackPage /> },
      { path: '/B', element: <p>B account page</p> },
      { path: '*', element: <p>Unexpected navigation</p> },
    ], { initialEntries: ['/auth/callback?code=A-code&state=A-state'] });
    render(<AuthProvider><RouterProvider router={router} /></AuthProvider>);
    expect(fetchToken).toHaveBeenCalledTimes(1);
    await act(async () => { login('B'); await router.navigate('/B'); });
    await act(async () => {
      if (outcome === 'success') exchange.resolve({ ok: true, status: 200, text: async () => JSON.stringify(aTokens) });
      else exchange.reject(new Error('A token exchange failed'));
    });
    expect(readStoredTokens()?.accessToken).toBe('B-access');
    expect(router.state.location.pathname).toBe('/B');
    expect(sessionStorage.getItem('devcards:postLoginRedirect')).toBe('/A-target');
    expect(assigned).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
    router.dispose();
  });
});

let latest: AuthContextValue | null = null;
function ContextProbe() {
  const auth = useAuth();
  useLayoutEffect(() => { latest = auth; });
  return null;
}
describe('obsolete context handlers', () => {
  it('rejects completeSignIn captured before B without replacing B tokens', () => {
    login('A');
    render(<AuthProvider><ContextProbe /></AuthProvider>);
    const old = latest!;
    act(() => { login('B'); });
    expect(() => old.completeSignIn(aTokens)).toThrow(expect.objectContaining({ code: 'SESSION_CHANGED' }));
    expect(readStoredTokens()?.accessToken).toBe('B-access');
    expect(assigned).not.toHaveBeenCalled();
  });
  it('ignores signOut captured before B without clearing B or navigating', () => {
    login('A');
    render(<AuthProvider><ContextProbe /></AuthProvider>);
    const old = latest!;
    act(() => { login('B'); });
    act(() => { old.signOut(); });
    expect(readStoredTokens()?.accessToken).toBe('B-access');
    expect(assigned).not.toHaveBeenCalled();
  });
});
