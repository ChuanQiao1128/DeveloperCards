import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  store: new Map<string, string>(),
  failLegacyCleanup: false,
}));
const TOKEN_KEY = 'devcards:auth:accessToken:v1';
const SUB_KEY = 'devcards:auth:activeUserSub:v1';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => state.store.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { state.store.set(key, value); }),
  removeItem: vi.fn(async (key: string) => {
    if (key === 'devcards:auth:accessToken:v1' && state.failLegacyCleanup) throw new Error('storage unavailable');
    state.store.delete(key);
  }),
  getAllKeys: vi.fn(async () => [...state.store.keys()]),
  multiRemove: vi.fn(async (keys: string[]) => { keys.forEach(key => state.store.delete(key)); }),
} }));
vi.mock('aws-amplify/auth', () => ({
  signUp: vi.fn(), confirmSignUp: vi.fn(), resendSignUpCode: vi.fn(), signIn: vi.fn(),
  signOut: vi.fn(async () => {}), fetchAuthSession: vi.fn(), getCurrentUser: vi.fn(),
  deleteUser: vi.fn(), resetPassword: vi.fn(), confirmResetPassword: vi.fn(), autoSignIn: vi.fn(),
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'device-1' }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: 'test' } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../../src/content/deckRepository', () => ({
  resolveDeckBySlug: async () => null, adoptAnonymousPublicDecks: async () => {},
}));
vi.mock('../../src/content/deckCache', () => ({ invalidateDeckCache: vi.fn() }));
vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: async () => [], updateDeckProgress: vi.fn(), setActiveUserSubForStorage: vi.fn(),
}));
vi.mock('../../src/sync/drawStateSync', () => ({
  syncDrawStateNow: async () => {}, adoptAnonGachaState: async () => {},
}));
vi.mock('../../src/sync/clientCapabilities', () => ({ getClientCapabilities: async () => ({ clientFeatures: [] }) }));
vi.mock('../../src/api/apiClient', () => ({ apiJson: vi.fn(), setAccessTokenRefresher: vi.fn() }));
vi.mock('../../src/premium/revenuecat', () => ({ rcLogout: vi.fn(async () => {}) }));
vi.mock('../../src/auth/deleteServerAccount', async (importActual) => ({
  ...await importActual<typeof import('../../src/auth/deleteServerAccount')>(),
  deleteServerAccountData: vi.fn(async () => 'deleted' as const),
}));

let auth: typeof import('../../src/auth/authStore');
let sync: typeof import('../../src/sync/progressSync');
let fresh: typeof import('../../src/auth/freshToken');
let sdk: typeof import('aws-amplify/auth');
let api: typeof import('../../src/api/apiClient');
let disk: typeof import('@react-native-async-storage/async-storage').default;

function token(sub: string, version = 'sdk') {
  return `header.${Buffer.from(JSON.stringify({ sub, version })).toString('base64url')}.signature`;
}
function session(sub: string, version = 'sdk') {
  return { tokens: { accessToken: token(sub, version), idToken: { payload: { sub, email: `${sub}@example.com` }, toString: () => 'dummy-id' } } } as any;
}
async function restart() {
  vi.resetModules();
  auth = await import('../../src/auth/authStore');
  sync = await import('../../src/sync/progressSync');
  fresh = await import('../../src/auth/freshToken');
  sdk = await import('aws-amplify/auth');
  api = await import('../../src/api/apiClient');
  disk = (await import('@react-native-async-storage/async-storage')).default;
}
function expectNoDiskTokenUse() {
  expect(disk.getItem).not.toHaveBeenCalledWith(TOKEN_KEY);
  expect(vi.mocked(disk.setItem).mock.calls.some(([key]) => key === TOKEN_KEY)).toBe(false);
}
async function drainSync() {
  const pending = sync.forceProgressSync('manual');
  await vi.advanceTimersByTimeAsync(100);
  await pending;
}
function expectNetworkToken(expected: string) {
  expect(api.apiJson).toHaveBeenCalled();
  expect(vi.mocked(api.apiJson).mock.calls.every(([, options]) => options.accessToken === expected)).toBe(true);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.store.clear(); state.failLegacyCleanup = false;
  await restart();
  vi.mocked(sdk.fetchAuthSession).mockReset();
  vi.mocked(sdk.getCurrentUser).mockRejectedValue(new Error('No current user'));
  vi.mocked(api.apiJson).mockReset();
  vi.mocked(api.apiJson).mockImplementation(async (path, options) => ({
    success: true,
    data: path.includes('bootstrap')
      ? { userSub: JSON.parse(Buffer.from(options.accessToken!.split('.')[1], 'base64url').toString()).sub }
      : { items: [], hasMore: false },
  }) as any);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('SDK session is the sync token source', () => {
  it('cold-inits through authStore and injects the SDK token without keeping a disk copy', async () => {
    state.store.set(TOKEN_KEY, token('legacy'));
    state.store.set('devcards:u:other:sync:progressQueue:v1', '[]');
    state.store.set('devcards:sync:pendingOwners:v1', '{}');
    vi.mocked(sdk.fetchAuthSession).mockResolvedValue(session('A'));

    await auth.useAuthStore.getState().init();
    await drainSync();

    expect(sdk.fetchAuthSession).toHaveBeenCalledExactlyOnceWith();
    expect(auth.useAuthStore.getState()).toMatchObject({ status: 'signed_in', userSub: 'A', accessToken: token('A') });
    expectNetworkToken(token('A'));
    expect(state.store.has(TOKEN_KEY)).toBe(false);
    expect(state.store.get(SUB_KEY)).toBe('A');
    expect(state.store.get('devcards:u:other:sync:progressQueue:v1')).toBe('[]');
    expect(state.store.get('devcards:sync:pendingOwners:v1')).toBe('{}');
    expect(disk.removeItem).toHaveBeenCalledWith(TOKEN_KEY);
    expectNoDiskTokenUse();
  });

  it('cannot authenticate from a legacy disk token before auth init', async () => {
    state.store.set(TOKEN_KEY, token('A', 'legacy'));
    state.store.set(SUB_KEY, 'A');
    expect((await sync.getProgressSyncDebugState()).userSub).toBeNull();
    await drainSync();
    expect(api.apiJson).not.toHaveBeenCalled();
    expectNoDiskTokenUse();
  });

  it('cleans legacy credentials on a signed-out cold init and queues guest reviews', async () => {
    state.store.set(TOKEN_KEY, token('A', 'legacy'));
    state.store.set(SUB_KEY, 'A');
    vi.mocked(sdk.fetchAuthSession).mockResolvedValue({} as any);
    await auth.useAuthStore.getState().init();
    await drainSync();
    await sync.recordReviewEvent({ eventId: 'guest-review', deckSlug: 'deck', stableUid: 'card', rating: 'good' });

    expect(auth.useAuthStore.getState().status).toBe('anonymous');
    expect((await sync.getProgressSyncDebugState()).userSub).toBeNull();
    expect(api.apiJson).not.toHaveBeenCalled();
    expect(state.store.has(TOKEN_KEY)).toBe(false);
    expect(JSON.parse(state.store.get('devcards:u:__pending__:sync:progressQueue:v1')!)).toMatchObject([{ eventId: 'guest-review' }]);
    expectNoDiskTokenUse();
  });

  it('does not restore a logged-out account after restart when legacy cleanup fails', async () => {
    vi.mocked(sdk.fetchAuthSession).mockResolvedValue(session('A'));
    await auth.useAuthStore.getState().init();
    await drainSync();
    state.store.set(TOKEN_KEY, token('A', 'legacy'));
    state.failLegacyCleanup = true;
    await auth.useAuthStore.getState().signOutNow();
    expect(sdk.signOut).toHaveBeenCalled();
    vi.clearAllTimers();
    await restart();
    vi.mocked(api.apiJson).mockClear();
    vi.mocked(sdk.fetchAuthSession).mockResolvedValue({} as any);
    await auth.useAuthStore.getState().init();
    await drainSync();

    expect(state.store.has(TOKEN_KEY)).toBe(true);
    expect(auth.useAuthStore.getState().status).toBe('anonymous');
    expect((await sync.getProgressSyncDebugState()).userSub).toBeNull();
    expect(api.apiJson).not.toHaveBeenCalled();
    expectNoDiskTokenUse();
  });

  it('cannot revive a completed account deletion from a surviving disk token after restart', async () => {
    vi.mocked(sdk.fetchAuthSession).mockResolvedValue(session('A'));
    vi.mocked(sdk.getCurrentUser).mockResolvedValue({ userId: 'A' } as any);
    await auth.useAuthStore.getState().init();
    await drainSync();
    state.store.set(TOKEN_KEY, token('A', 'legacy'));
    state.failLegacyCleanup = true;
    await auth.useAuthStore.getState().deleteAccountNow();
    const { deleteServerAccountData } = await import('../../src/auth/deleteServerAccount');
    expect(deleteServerAccountData).toHaveBeenCalledWith(token('A'));
    expect(sdk.deleteUser).toHaveBeenCalledOnce();
    expect(auth.useAuthStore.getState().status).toBe('anonymous');
    expect(state.store.has('recallsmith:auth:activeDeletionSub')).toBe(false);
    vi.clearAllTimers();
    await restart();
    vi.mocked(api.apiJson).mockClear();
    vi.mocked(sdk.fetchAuthSession).mockResolvedValue({} as any);
    vi.mocked(sdk.getCurrentUser).mockRejectedValue(new Error('No current user'));
    await auth.useAuthStore.getState().init();
    await drainSync();

    expect(state.store.has(TOKEN_KEY)).toBe(true);
    expect(auth.useAuthStore.getState().status).toBe('anonymous');
    expect((await sync.getProgressSyncDebugState()).userSub).toBeNull();
    expect(api.apiJson).not.toHaveBeenCalled();
    expectNoDiskTokenUse();
  });

  it('keeps deleted-account recovery blocked despite a legacy token and SDK session', async () => {
    state.store.set(TOKEN_KEY, token('A', 'legacy'));
    state.store.set(SUB_KEY, 'A');
    state.store.set('recallsmith:auth:activeDeletionSub', 'A');
    state.store.set('recallsmith:auth:deletionPending:A', 'identity_pending');
    state.failLegacyCleanup = true;
    vi.mocked(sdk.fetchAuthSession).mockResolvedValue(session('A'));
    await auth.useAuthStore.getState().init();
    await fresh.refreshAuthOnForeground();
    await drainSync();

    expect(auth.useAuthStore.getState().status).toBe('deletion_pending');
    expect(sdk.fetchAuthSession).not.toHaveBeenCalled();
    expect((await sync.getProgressSyncDebugState()).userSub).toBeNull();
    expect(api.apiJson).not.toHaveBeenCalled();
    expect(state.store.has(TOKEN_KEY)).toBe(true);
    expectNoDiskTokenUse();
  });

  it('refreshes the injected token on foreground and keeps it during a transient offline refresh', async () => {
    vi.mocked(sdk.fetchAuthSession).mockResolvedValue(session('A'));
    await auth.useAuthStore.getState().init();
    await drainSync();
    vi.mocked(api.apiJson).mockClear();
    vi.mocked(sdk.fetchAuthSession).mockResolvedValue(session('A', 'refreshed'));
    await fresh.refreshAuthOnForeground();
    await drainSync();
    expectNetworkToken(token('A', 'refreshed'));
    vi.mocked(api.apiJson).mockClear();
    vi.mocked(sdk.fetchAuthSession).mockRejectedValue({ name: 'NetworkError' });
    await fresh.refreshAuthOnForeground();
    await drainSync();

    expectNetworkToken(token('A', 'refreshed'));
    expect(auth.useAuthStore.getState().status).toBe('signed_in');
    expect(state.store.has(TOKEN_KEY)).toBe(false);
    expectNoDiskTokenUse();
  });

  it('ignores legacy credentials during offline cold init and retries the SDK on foreground', async () => {
    state.store.set(TOKEN_KEY, token('legacy'));
    state.store.set(SUB_KEY, 'legacy');
    vi.mocked(sdk.fetchAuthSession).mockRejectedValue({ name: 'NetworkError' });
    await auth.useAuthStore.getState().init();
    await drainSync();
    expect(auth.useAuthStore.getState().initRetryPending).toBe(true);
    expect((await sync.getProgressSyncDebugState()).userSub).toBeNull();
    expect(api.apiJson).not.toHaveBeenCalled();
    vi.mocked(sdk.fetchAuthSession).mockResolvedValue(session('B'));
    await fresh.refreshAuthOnForeground();
    await drainSync();

    expectNetworkToken(token('B'));
    expect(state.store.has(TOKEN_KEY)).toBe(false);
    expectNoDiskTokenUse();
  });

  it('best-effort cleanup failure does not prevent SDK injection or read the surviving legacy token', async () => {
    state.store.set(TOKEN_KEY, token('legacy'));
    state.failLegacyCleanup = true;
    vi.mocked(sdk.fetchAuthSession).mockResolvedValue(session('B'));
    await auth.useAuthStore.getState().init();
    await drainSync();

    expectNetworkToken(token('B'));
    expect(state.store.get(TOKEN_KEY)).toBe(token('legacy'));
    expectNoDiskTokenUse();
  });
});
