// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';
const cognito = vi.hoisted(() => ({ refreshTokens: vi.fn() }));
vi.mock('../src/auth/cognito', async original => ({ ...await original<typeof import('../src/auth/cognito')>(), ...cognito }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const refreshResponse = (who: string) => ({ access_token: `${who}-new`, id_token: `${who}-id`, expires_in: 3600, token_type: 'Bearer' });
const response = (config: InternalAxiosRequestConfig, data = 'A private data') => ({ config, data, status: 200, statusText: 'OK', headers: {} });
let locationDescriptor: PropertyDescriptor | undefined;
let navigate: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules(); sessionStorage.clear(); cognito.refreshTokens.mockReset();
  navigate = vi.fn();
  locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
  Object.defineProperty(window, 'location', { configurable: true, value: { pathname: '/cards/edit', search: '?id=1', assign: navigate } });
});
afterEach(() => {
  vi.restoreAllMocks();
  if (locationDescriptor) Object.defineProperty(window, 'location', locationDescriptor);
  sessionStorage.clear();
});
async function setup() {
  const store = await import('../src/auth/tokenStore');
  const { http } = await import('../src/api/http');
  const { TokenRefreshError } = await import('../src/auth/cognito');
  const login = (who: string, expiresIn = 3600) => store.saveTokens({ accessToken: `${who}-access`, idToken: `${who}-id`, refreshToken: `${who}-refresh`, expiresIn });
  return { store, http, login, TokenRefreshError };
}
describe('session-bound requests', () => {
  for (const status of [200, 401]) it(`rejects A late ${status} without touching B tokens or navigation`, async () => {
    const { store, http, login } = await setup(); login('A');
    const entered = deferred<InternalAxiosRequestConfig>(); const reply = deferred<ReturnType<typeof response>>();
    http.defaults.adapter = config => { entered.resolve(config); return reply.promise; };
    const result = http.get('/private').catch(error => error);
    const config = await entered.promise; login('B');
    if (status === 200) reply.resolve(response(config));
    else reply.reject({ isAxiosError: true, config, response: { status: 401, data: null } });
    expect(await result).toMatchObject({ code: 'SESSION_CHANGED' });
    expect(store.readStoredTokens()?.accessToken).toBe('B-access'); expect(navigate).not.toHaveBeenCalled();
  });
  for (const initial of ['A', 'anonymous']) it(`captures ${initial} synchronously before Axios starts`, async () => {
    const { http, login } = await setup(); if (initial === 'A') login('A');
    const sent = vi.fn(async (config: InternalAxiosRequestConfig) => response(config)); http.defaults.adapter = sent;
    const result = http.get('/private').catch(error => error); login('B');
    expect(await result).toMatchObject({ code: 'SESSION_CHANGED' }); expect(sent).not.toHaveBeenCalled();
  });
  it('distinguishes rapid logout/login with the same identity and token values', async () => {
    const { store, http, login } = await setup(); login('same');
    const entered = deferred<InternalAxiosRequestConfig>(); const reply = deferred<ReturnType<typeof response>>();
    http.defaults.adapter = config => { entered.resolve(config); return reply.promise; };
    const result = http.get('/private').catch(error => error); const config = await entered.promise;
    store.clearTokens(); login('same'); reply.resolve(response(config));
    expect(await result).toMatchObject({ code: 'SESSION_CHANGED' }); expect(store.readStoredTokens()?.accessToken).toBe('same-access');
  });
  for (const outcome of ['success', 'permanent', 'temporary'] as const) it(`ignores A late refresh ${outcome}`, async () => {
    const { store, http, login, TokenRefreshError } = await setup(); login('A', -60);
    const entered = deferred<void>(); const refresh = deferred<ReturnType<typeof refreshResponse>>();
    cognito.refreshTokens.mockImplementation(() => { entered.resolve(); return refresh.promise; });
    const sent = vi.fn(async (config: InternalAxiosRequestConfig) => response(config)); http.defaults.adapter = sent;
    const result = http.get('/private').catch(error => error); await entered.promise; login('B');
    if (outcome === 'success') refresh.resolve(refreshResponse('A')); else refresh.reject(new TokenRefreshError(outcome));
    expect(await result).toMatchObject({ code: 'SESSION_CHANGED' }); expect(store.readStoredTokens()?.accessToken).toBe('B-access');
    expect(sent).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  });
  it('lets B refresh while A refresh remains pending', async () => {
    const { store, http, login } = await setup();
    const aStarted = deferred<void>(); const aRefresh = deferred<ReturnType<typeof refreshResponse>>();
    const bRefresh = deferred<ReturnType<typeof refreshResponse>>();
    cognito.refreshTokens.mockImplementation((token: string) => { if (token === 'A-refresh') { aStarted.resolve(); return aRefresh.promise; } return bRefresh.promise; });
    http.defaults.adapter = async config => response(config, config.headers.get('Authorization') as string);
    login('A', -60); const a = http.get('/A').catch(error => error); await aStarted.promise;
    login('B', -60); const b = http.get('/B');
    try { await vi.waitFor(() => expect(cognito.refreshTokens).toHaveBeenCalledWith('B-refresh')); }
    finally { aRefresh.resolve(refreshResponse('A')); bRefresh.resolve(refreshResponse('B')); }
    expect((await b).data).toBe('Bearer B-new'); expect(await a).toMatchObject({ code: 'SESSION_CHANGED' });
    expect(store.readStoredTokens()?.accessToken).toBe('B-new');
  });
  it('shares same-session refresh without invalidating parallel in-flight success', async () => {
    const { http, login } = await setup(); login('A');
    const entered = deferred<InternalAxiosRequestConfig>(); const reply = deferred<ReturnType<typeof response>>();
    http.defaults.adapter = async config => { if (config.url === '/first') { entered.resolve(config); return reply.promise; } return response(config, config.headers.get('Authorization') as string); };
    const first = http.get('/first'); const config = await entered.promise;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3600_000);
    const refresh = deferred<ReturnType<typeof refreshResponse>>(); cognito.refreshTokens.mockReturnValue(refresh.promise);
    const next = [http.get('/second'), http.get('/third')]; await vi.waitFor(() => expect(cognito.refreshTokens).toHaveBeenCalledTimes(1));
    refresh.resolve(refreshResponse('A')); expect((await Promise.all(next)).map(r => r.data)).toEqual(['Bearer A-new', 'Bearer A-new']);
    reply.resolve(response(config)); expect((await first).data).toBe('A private data');
  });
  it('retains session and draft route on temporary refresh failure', async () => {
    const { store, http, login, TokenRefreshError } = await setup(); login('A', -60);
    cognito.refreshTokens.mockRejectedValue(new TokenRefreshError('temporary'));
    const sent = vi.fn(); http.defaults.adapter = sent;
    await expect(http.get('/private')).rejects.toMatchObject({ kind: 'temporary' });
    expect(store.readStoredTokens()?.refreshToken).toBe('A-refresh'); expect(sent).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  });
  it('keeps stable authless local requests working', async () => {
    const { http } = await setup(); http.defaults.adapter = async config => response(config, String(config.headers.get('Authorization') ?? 'none'));
    expect((await http.get('/local')).data).toBe('none');
  });
});
