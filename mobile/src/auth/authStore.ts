// mobile/src/auth/authStore.ts
import { create } from 'zustand';

import {
  signUp,
  confirmSignUp,
  resendSignUpCode,
  signIn,
  signOut,
  fetchAuthSession,
  getCurrentUser,
  deleteUser,
  resetPassword,
  confirmResetPassword,
  autoSignIn,
} from 'aws-amplify/auth';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { AuthFlowError, AUTH_ERROR_COPY, friendlyAuthError } from './authErrors';
import { isPasswordValid } from './passwordPolicy';
import { normEmail } from './emailPolicy';
import { deleteServerAccountData } from './deleteServerAccount';
import { accessTokenSubject, getAuthSessionGeneration, invalidateAuthSession, setAuthIdentitySnapshot } from './sessionBoundary';

import { setSyncAccessToken, forceProgressSync, setActiveUserSub, purgeClaimedPendingProgressEvents } from '../sync/progressSync';
import { adoptAnonGachaState } from '../sync/drawStateSync';
import { blockSync, unblockSync } from '../sync/syncGuard';
import { clearActiveDeletion, clearDeletionPending, persistDeletionPending, readActiveDeletionPending, readDeletionPending } from './accountDeletionPending';
import { resumeSyncAfterFailedDeletion, stopSyncForDeletion } from '../sync/stopSyncForDeletion';
import { invalidateProgressQueueCache } from '../sync/progressQueueCache';
import { invalidateDrawStateCache } from '../features/gacha/draw/drawStateCache';

type AuthStatus = 'unknown' | 'anonymous' | 'signed_in' | 'deletion_pending';

// Persisted the first time we ever see a signed-in session. Lets a later
// tokenless init distinguish "this user's refresh token expired" (show the
// session-expired banner) from "never signed in" (stay quietly anonymous).
export const AUTH_WAS_SIGNED_IN_KEY = 'recallsmith:auth:wasSignedIn';

/**
 * True for transient/offline auth failures (network, timeout, abort), where
 * Amplify throws but keeps the cached tokens. False for a real expiry —
 * NotAuthorizedException means the refresh token is gone and tokens are wiped.
 */
export function isTransientAuthError(err: unknown): boolean {
  const name = String((err as any)?.name ?? '');
  if (name.startsWith('NotAuthorizedException')) return false;
  if (name === 'NetworkError' || name === 'TimeoutError' || name === 'AbortError') return true;
  const msg = String((err as any)?.message ?? '');
  return /network|timed? ?out|fetch failed|internet/i.test(msg);
}

type AuthState = {
  status: AuthStatus;
  userId: string | null; // ✅ 稳定用户标识（sub / userId）

  email: string | null;
  userSub: string | null;

  accessToken: string | null;
  idToken: string | null;

  loading: boolean;
  lastError: string | null;

  // A previously signed-in session whose refresh token expired. Drives the
  // Home "Session expired, sign in to keep syncing" banner.
  sessionExpired: boolean;
  // A transient (offline) init failure. The session was kept; retry on the
  // next foreground.
  initRetryPending: boolean;

  init: () => Promise<void>;

  markSessionExpired: () => Promise<void>;
  dismissSessionExpired: () => void;

  signUpWithEmail: (email: string, password: string) => Promise<void>;
  confirmSignUpCode: (email: string, code: string) => Promise<'signed_in' | 'needs_sign_in'>;
  resendConfirmCode: (email: string) => Promise<void>;

  requestPasswordReset: (email: string) => Promise<void>;
  confirmPasswordReset: (email: string, code: string, newPassword: string) => Promise<void>;

  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOutNow: () => Promise<void>;
  deleteAccountNow: () => Promise<void>;
};

const DEVICE_STREAK_PREFIX = 'recallsmith:streaks:';
export async function purgeUserScopedStorage(userSub: string | null, purgeDeviceStreaks = true): Promise<string[]> {
  const generation = getAuthSessionGeneration();
  if (userSub) await purgeClaimedPendingProgressEvents(userSub);
  if (generation !== getAuthSessionGeneration()) return [];
  const scoped = userSub ? `devcards:u:${userSub}:` : null;
  const keys = await AsyncStorage.getAllKeys();
  if (generation !== getAuthSessionGeneration()) return [];
  const doomed = keys.filter(
    (k) => (scoped !== null && k.startsWith(scoped)) || (purgeDeviceStreaks && k.startsWith(DEVICE_STREAK_PREFIX)),
  );
  if (doomed.length > 0) await AsyncStorage.multiRemove(doomed);
  if (generation !== getAuthSessionGeneration()) return [];
  invalidateProgressQueueCache(userSub ?? undefined);
  invalidateDrawStateCache();
  return doomed;
}

function tokenToString(t: any): string | null {
  if (!t) return null;
  if (typeof t === 'string') return t;
  if (typeof t?.toString === 'function') return String(t.toString());
  return null;
}

function safeStr(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

// Log RevenueCat out on sign-out and after account deletion so the previous
// user's entitlement cannot leak into the anonymous state on a shared device.
// Loaded lazily so importing the store never pulls react-native-purchases /
// expo-updates into the test bundle. Never throws.
async function logoutRevenueCat(): Promise<void> {
  const generation = getAuthSessionGeneration();
  try {
    const { rcLogout } = await import('../premium/revenuecat');
    if (generation !== getAuthSessionGeneration()) return;
    await rcLogout();
  } catch {
    // Best-effort: a RevenueCat logout failure must not block sign-out/delete.
  }
}

async function applySessionToState(set: any, generation: number): Promise<boolean> {
  const isCurrent = () => generation === getAuthSessionGeneration();
  const session: any = await fetchAuthSession();
  if (!isCurrent()) return false;

  const accessTokObj = session.tokens?.accessToken;
  const idTokObj = session.tokens?.idToken;

  const at = tokenToString(accessTokObj) ?? null;
  const it = tokenToString(idTokObj) ?? null;

  // ✅ Prefer claims from idToken (real email attribute)
  const claims: any =
    idTokObj && typeof idTokObj === 'object' && 'payload' in idTokObj
      ? (idTokObj as any).payload
      : null;

  let email: string | null =
    safeStr(claims?.email) ??
    safeStr(claims?.['cognito:username']) ??
    null;

  let userSub: string | null = safeStr(claims?.sub) ??
    safeStr((accessTokObj as any)?.payload?.sub) ?? (at ? accessTokenSubject(at) : null);

  // ✅ Optional fallback: getCurrentUser for userSub if needed (do NOT override email)
  try {
    const user = await getCurrentUser();
    userSub = userSub ?? safeStr(user?.userId);
  } catch {
    // ignore
  }
  if (!isCurrent()) return false;

  // Read the durable intent before adopting local data or injecting a sync token.
  // A storage read failure also fails closed; init can retry without bootstrapping.
  if (userSub && await readDeletionPending(userSub)) {
    if (!isCurrent()) return false;
    blockSync();
    await setSyncAccessToken(null);
    if (!isCurrent()) return false;
    set({ status: 'deletion_pending', userId: userSub, userSub, email,
      accessToken: at, idToken: it, lastError: null, sessionExpired: false,
      initRetryPending: false, loading: false });
    return true;
  }
  if (!isCurrent()) return false;
  if (at) unblockSync();

  // ✅ 关键：立刻设置 activeUserSub（让 Home 读取正确的 user-scoped progress）
  await setActiveUserSub(userSub);
  if (!isCurrent()) return false;

  // The signed-in scope needs the guest's downloaded public decks before its
  // first sync/render. No progress, premium content or other account is copied.
  if (userSub) {
    try {
      const { adoptAnonymousPublicDecks } = await import('../content/deckRepository');
      if (!isCurrent()) return false;
      await adoptAnonymousPublicDecks(userSub);
      if (!isCurrent()) return false;
      const { invalidateDeckCache } = await import('../content/deckCache');
      if (!isCurrent()) return false;
      invalidateDeckCache();
    } catch {
      // A missing/corrupt file must not turn a successful sign-in into a failure.
    }
  }

  // Union any anonymous-period collection/pity/wallet/Mistake Book into this account before
  // the first signed-in render (Library/Home read draw state on that render)
  // and before the first cloud push. A no-op when the anon partition is empty,
  // including the init() path.
  if (userSub) await adoptAnonGachaState();
  if (!isCurrent()) return false;

  // Remember that this device has held a real session (best-effort), and derive
  // the session-expired flag: a token means the session is valid; no token means
  // it expired only if we had previously been signed in on this device.
  let sessionExpired = false;
  if (at) {
    try {
      await AsyncStorage.setItem(AUTH_WAS_SIGNED_IN_KEY, '1');
    } catch {}
  } else {
    try {
      sessionExpired = (await AsyncStorage.getItem(AUTH_WAS_SIGNED_IN_KEY)) === '1';
    } catch {
      sessionExpired = false;
    }
  }

  if (!isCurrent()) return false;
  set({
    status: at ? 'signed_in' : 'anonymous',
    userId: userSub,
    email,
    userSub,
    accessToken: at,
    idToken: it,
    lastError: null,
    sessionExpired,
    initRetryPending: false,
    loading: false,
  });

  // Publishing the session changes its identity generation through the store subscriber.
  const publishedGeneration = getAuthSessionGeneration();
  // ✅ Inject token into progress sync layer
  await setSyncAccessToken(at);
  if (publishedGeneration !== getAuthSessionGeneration()) return false;

  // ✅ Best-effort sync, never block UI
  if (at) void forceProgressSync('token_set');
  return true;
}

let accountDeletionInFlight = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'unknown',
  userId: null,

  email: null,
  userSub: null,

  accessToken: null,
  idToken: null,

  loading: false,
  lastError: null,

  sessionExpired: false,
  initRetryPending: false,

  init: async () => {
    // Stored sync credentials must stay dormant until the durable deletion check finishes.
    blockSync();
    invalidateAuthSession();
    const generation = getAuthSessionGeneration();
    set({ loading: true, lastError: null });
    try {
      // Cognito may already be gone when the process died before local cleanup.
      // Recover this intent independently of tokens; only recovery/exit controls mount.
      const pending = await readActiveDeletionPending();
      if (generation !== getAuthSessionGeneration()) return;
      if (pending) {
        await setSyncAccessToken(null);
        if (generation !== getAuthSessionGeneration()) return;
        set({ status: 'deletion_pending', userId: pending.sub, userSub: pending.sub,
          accessToken: null, idToken: null, loading: false, lastError: null,
          sessionExpired: false, initRetryPending: false });
        return;
      }
      await applySessionToState(set, generation);
    } catch (err) {
      if (generation !== getAuthSessionGeneration()) return;
      if (isTransientAuthError(err)) {
        // Transient/offline failure: Amplify still holds the session. Keep the
        // sync token and the user's storage scope (do NOT clear them) so the
        // app reads the account's own data offline, and retry on next foreground.
        set({
          status: 'anonymous',
          userId: null,
          email: null,
          userSub: null,
          accessToken: null,
          idToken: null,
          lastError: null,
          initRetryPending: true,
          loading: false,
        });
      } else {
        // ✅ critical: ensure unsigned-in => no sync token (also clears activeUserSub)
        await setSyncAccessToken(null);
        if (generation !== getAuthSessionGeneration()) return;

        let sessionExpired = false;
        try {
          sessionExpired = (await AsyncStorage.getItem(AUTH_WAS_SIGNED_IN_KEY)) === '1';
        } catch {
          sessionExpired = false;
        }

        if (generation !== getAuthSessionGeneration()) return;
        set({
          status: 'anonymous',
          userId: null,
          email: null,
          userSub: null,
          accessToken: null,
          idToken: null,
          lastError: null,
          sessionExpired,
          initRetryPending: false,
          loading: false,
        });
      }
    } finally {
      if (generation === getAuthSessionGeneration()) set({ loading: false });
    }
  },

  markSessionExpired: async () => {
    invalidateAuthSession();
    const generation = getAuthSessionGeneration();
    await setSyncAccessToken(null);
    if (generation !== getAuthSessionGeneration()) return;
    set({
      status: 'anonymous',
      userId: null,
      email: null,
      userSub: null,
      accessToken: null,
      idToken: null,
      sessionExpired: true,
      initRetryPending: false,
    });
  },

  dismissSessionExpired: () => {
    set({ sessionExpired: false });
  },

  signUpWithEmail: async (email: string, password: string) => {
    const e = normEmail(email);
    if (!e) throw new Error('Email required');
    if (!isPasswordValid(password)) {
      // Block before the round-trip; the checklist already tells the user why.
      throw new AuthFlowError('FAILED', AUTH_ERROR_COPY.InvalidPasswordException);
    }

    set({ loading: true, lastError: null });
    try {
      await signUp({
        username: e,
        password,
        options: {
          userAttributes: { email: e },
          // Arm auto sign-in so a user who confirms within the 3-minute window
          // is signed in without retyping the password. Stays USER_PASSWORD_AUTH
          // (SRP switch is G49).
          autoSignIn: { authFlowType: 'USER_PASSWORD_AUTH' },
        },
      });
    } catch (err: any) {
      if (err?.name === 'UsernameExistsException') {
        set({ lastError: AUTH_ERROR_COPY.UsernameExistsException });
        throw new AuthFlowError('USERNAME_EXISTS', AUTH_ERROR_COPY.UsernameExistsException);
      }
      const msg = friendlyAuthError(err);
      set({ lastError: msg });
      throw new Error(msg);
    } finally {
      set({ loading: false });
    }
  },

  confirmSignUpCode: async (email: string, code: string) => {
    const e = normEmail(email);
    const c = String(code || '').trim();
    if (!e) throw new Error('Email required');
    if (!c) throw new Error('Code required');

    invalidateAuthSession();
    const generation = getAuthSessionGeneration();
    set({ loading: true, lastError: null });
    try {
      const result: any = await confirmSignUp({ username: e, confirmationCode: c });
      if (generation !== getAuthSessionGeneration()) return 'needs_sign_in';

      if (result?.nextStep?.signUpStep === 'COMPLETE_AUTO_SIGN_IN') {
        // Auto sign-in is in-memory and expires after ~3 minutes / an app
        // restart. Never throw here: a failed auto sign-in just means the user
        // signs in manually, which is a fine fallback, not an error.
        try {
          const signInOutput: any = await autoSignIn();
          if (generation !== getAuthSessionGeneration()) return 'needs_sign_in';
          if (signInOutput?.isSignedIn) {
            return await applySessionToState(set, generation) ? 'signed_in' : 'needs_sign_in';
          }
        } catch {
          // fall through to manual sign-in
        }
      }
      return 'needs_sign_in';
    } catch (err: any) {
      if (generation !== getAuthSessionGeneration()) return 'needs_sign_in';
      // 2026-11-01: Cognito rejects ConfirmSignUp for an already-confirmed
      // account with NotAuthorizedException("Current status is CONFIRMED").
      // Keep the typed code so the confirm screen can route to sign-in
      // instead of showing the generic fallback.
      if (
        err?.name === 'NotAuthorizedException' &&
        /current status is confirmed/i.test(String(err?.message ?? ''))
      ) {
        const flowErr = new AuthFlowError('ALREADY_CONFIRMED', 'This email is already verified. Please sign in.');
        set({ lastError: flowErr.message });
        throw flowErr;
      }
      const msg = friendlyAuthError(err);
      set({ lastError: msg });
      throw new Error(msg);
    } finally {
      if (generation === getAuthSessionGeneration()) set({ loading: false });
    }
  },

  resendConfirmCode: async (email: string) => {
    const e = normEmail(email);
    if (!e) throw new Error('Email required');

    set({ loading: true, lastError: null });
    try {
      await resendSignUpCode({ username: e });
    } catch (err: any) {
      const msg = friendlyAuthError(err);
      set({ lastError: msg });
      throw new Error(msg);
    } finally {
      set({ loading: false });
    }
  },

  requestPasswordReset: async (email: string) => {
    const e = normEmail(email);
    if (!e) throw new Error('Email required');

    set({ loading: true, lastError: null });
    try {
      // The pool has prevent_user_existence_errors ENABLED, so this resolves
      // even for an unknown email; the UI shows neutral "if an account exists"
      // copy rather than confirming the address.
      await resetPassword({ username: e });
    } catch (err: any) {
      const msg = friendlyAuthError(err);
      set({ lastError: msg });
      throw new Error(msg);
    } finally {
      set({ loading: false });
    }
  },

  confirmPasswordReset: async (email: string, code: string, newPassword: string) => {
    const e = normEmail(email);
    const c = String(code || '').trim();
    if (!e) throw new Error('Email required');
    if (!c) throw new Error('Code required');
    if (!isPasswordValid(newPassword)) {
      throw new AuthFlowError('FAILED', AUTH_ERROR_COPY.InvalidPasswordException);
    }

    set({ loading: true, lastError: null });
    try {
      await confirmResetPassword({ username: e, confirmationCode: c, newPassword });
    } catch (err: any) {
      const msg = friendlyAuthError(err);
      set({ lastError: msg });
      throw new Error(msg);
    } finally {
      set({ loading: false });
    }
  },

  signInWithEmail: async (email: string, password: string) => {
    const e = normEmail(email);
    if (!e) throw new Error('Email required');
    if (!password) throw new Error('Password required');

    invalidateAuthSession();
    const generation = getAuthSessionGeneration();
    set({ loading: true, lastError: null });
    try {
      const r: any = await signIn({
        username: e,
        password,
        options: { authFlowType: 'USER_PASSWORD_AUTH' },
      });
      if (generation !== getAuthSessionGeneration()) return;

      if (r?.isSignedIn) {
        await applySessionToState(set, generation);
        return;
      }

      const step = r?.nextStep?.signInStep || r?.nextStep?.step;

      if (step === 'CONFIRM_SIGN_UP') {
        throw new AuthFlowError('NEEDS_CONFIRMATION', AUTH_ERROR_COPY.UserNotConfirmedException);
      }
      if (step === 'RESET_PASSWORD') {
        throw new AuthFlowError(
          'RESET_REQUIRED',
          'Please reset your password to continue.',
        );
      }
      if (step === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        throw new AuthFlowError(
          'NEW_PASSWORD_REQUIRED',
          'A new password is required for this account.',
        );
      }

      throw new Error(friendlyAuthError(undefined));
    } catch (err: any) {
      if (generation !== getAuthSessionGeneration()) return;
      if (__DEV__) console.log('[auth] signIn error:', err?.name);

      // Step-routing errors we raised above already carry friendly copy.
      if (err instanceof AuthFlowError) {
        set({ lastError: err.message });
        throw err;
      }

      const name = String(err?.name ?? '');

      // Amplify may throw this instead of returning the CONFIRM_SIGN_UP step.
      if (name === 'UserNotConfirmedException') {
        const e2 = new AuthFlowError(
          'NEEDS_CONFIRMATION',
          AUTH_ERROR_COPY.UserNotConfirmedException,
        );
        set({ lastError: e2.message });
        throw e2;
      }

      // Keep the "already signed in" message recognisable so SignInScreen's
      // /already.*signed in/i re-init branch (G05/MACCT-16) still fires.
      if (name === 'UserAlreadyAuthenticatedException') {
        set({ lastError: err?.message ?? null });
        throw err;
      }

      const msg = friendlyAuthError(err);
      set({ lastError: msg });
      throw new AuthFlowError('FAILED', msg);
    } finally {
      if (generation === getAuthSessionGeneration()) set({ loading: false });
    }
  },

  signOutNow: async () => {
    const deletingSub = get().status === 'deletion_pending' ? get().userSub : null;
    let anotherSdkUser = false;
    invalidateAuthSession();
    const generation = getAuthSessionGeneration();
    set({ loading: true, lastError: null });
    try {
      if (deletingSub) {
        try {
          const sdkUser = await getCurrentUser();
          anotherSdkUser = !!sdkUser?.userId && sdkUser.userId !== deletingSub;
        } catch {}
        if (generation !== getAuthSessionGeneration()) return;
      }
      if (!anotherSdkUser) await signOut();
    } finally {
      // ✅ 关键：先清 sync token / activeUserSub，再更新 UI（避免 Home reload 还读旧 scope）
      if (generation !== getAuthSessionGeneration()) return;
      await setSyncAccessToken(null);
      if (generation !== getAuthSessionGeneration()) return;

      if (deletingSub) {
        const stage = await readDeletionPending(deletingSub);
        if (generation !== getAuthSessionGeneration()) return;
        // Server erasure is confirmed. A vanished Cognito session must not strand
        // local data: explicit exit clears this device without claiming identity deletion.
        if (stage === 'identity_pending' || stage === 'local_pending') {
          await purgeUserScopedStorage(deletingSub, !anotherSdkUser);
          if (generation !== getAuthSessionGeneration()) return;
        }
        if (stage === 'local_pending') await clearDeletionPending(deletingSub);
        else await clearActiveDeletion(deletingSub);
        if (generation !== getAuthSessionGeneration()) return;
      }

      if (anotherSdkUser) {
        // Finishing A's local recovery must not sign B out or log B out of purchases.
        await get().init();
        return;
      }

      // Explicit sign-out clears the was-signed-in flag so the session-expired
      // banner never shows after a deliberate sign-out.
      try {
        await AsyncStorage.removeItem(AUTH_WAS_SIGNED_IN_KEY);
      } catch {}

      if (generation !== getAuthSessionGeneration()) return;
      set({
        status: 'anonymous',
        userId: null,
        email: null,
        userSub: null,
        accessToken: null,
        idToken: null,
        loading: false,
        lastError: null,
        sessionExpired: false,
        initRetryPending: false,
      });

      // Drop the previous user's RevenueCat identity so the anonymous state
      // does not inherit their entitlement.
      await logoutRevenueCat();
    }
  },

  deleteAccountNow: async () => {
    if (accountDeletionInFlight) throw new Error('Account deletion is already in progress.');
    accountDeletionInFlight = true;
    try {
      const sub = get().userSub;
      if (!sub) throw new Error('Sign in to finish deleting your account.');
      let generation = getAuthSessionGeneration();
      const assertCurrent = () => {
        if (generation !== getAuthSessionGeneration()) throw new Error('Session changed. Please try again.');
      };
      const wasPending = get().status === 'deletion_pending';
      set({ lastError: null });

      try {
        await stopSyncForDeletion();
      } catch (err: any) {
        assertCurrent();
        if (wasPending) blockSync();
        set({ lastError: err?.message ?? 'Delete account failed' });
        throw err;
      }
      assertCurrent();

      let stage;
      try {
        stage = await readDeletionPending(sub);
        assertCurrent();
        // Persist before the request: a crash or lost response must not resume sync.
        if (!stage) await persistDeletionPending(sub, 'server_pending');
      } catch (err) {
        assertCurrent();
        if (!wasPending) resumeSyncAfterFailedDeletion();
        throw err;
      }
      assertCurrent();
      set({ status: 'deletion_pending' });
      generation = getAuthSessionGeneration();

      try {
        if (stage !== 'identity_pending' && stage !== 'local_pending') {
          // Read directly: normal freshToken deliberately excludes deletion_pending.
          // Never hand a deletion credential to the normal sync layer.
          let token = get().accessToken;
          let session;
          try {
            session = await fetchAuthSession({ forceRefresh: true });
          } catch (err) {
            assertCurrent();
            // The cached credential can still authorize an idempotent server retry.
            if (!token) throw err;
          }
          assertCurrent();
          token = tokenToString(session?.tokens?.accessToken) ?? token;
          const tokenSub = accessTokenSubject(token ?? '') ?? safeStr((session?.tokens?.accessToken as any)?.payload?.sub);
          if (tokenSub && tokenSub !== sub) throw new Error('Session changed. Please try again.');
          assertCurrent();
          await deleteServerAccountData(token);
          assertCurrent();
          await persistDeletionPending(sub, 'identity_pending');
          assertCurrent();
        }
        if (stage !== 'local_pending') {
          const sdkUser = await getCurrentUser();
          assertCurrent();
          if (sdkUser.userId !== sub) throw new Error('The signed-in account changed. Sign out to finish clearing this device.');
          await deleteUser();
          assertCurrent();
          // Resume local erasure without Cognito credentials after a crash.
          await persistDeletionPending(sub, 'local_pending');
          assertCurrent();
        }
      } catch (err: any) {
        assertCurrent();
        blockSync();
        const message = err?.message ?? 'Delete account failed';
        set({ lastError: message });
        throw err;
      }

      invalidateAuthSession();
      generation = getAuthSessionGeneration();
      set({ loading: true });
      let anotherSdkUser = false;
      try {
        const sdkUser = await getCurrentUser();
        anotherSdkUser = !!sdkUser?.userId && sdkUser.userId !== sub;
      } catch {}
      assertCurrent();
      if (!anotherSdkUser) {
        try { await signOut(); } catch {}
      }
      assertCurrent();
      await setSyncAccessToken(null);
      assertCurrent();
      await purgeUserScopedStorage(sub, !anotherSdkUser);
      assertCurrent();
      await clearDeletionPending(sub);
      assertCurrent();
      if (anotherSdkUser) {
        await get().init();
        return;
      }
      try { await AsyncStorage.removeItem(AUTH_WAS_SIGNED_IN_KEY); } catch {}
      assertCurrent();
      set({ status: 'anonymous', userId: null, email: null, userSub: null, accessToken: null, idToken: null, loading: false, lastError: null, sessionExpired: false, initRetryPending: false });
      await logoutRevenueCat();
    } finally {
      accountDeletionInFlight = false;
      if (get().status === 'deletion_pending') set({ loading: false });
    }
  },
}));

useAuthStore.subscribe((state, previous) => {
  setAuthIdentitySnapshot({
    status: state.status === 'deletion_pending' ? 'anonymous' : state.status,
    email: state.email,
    sessionExpired: state.sessionExpired,
  });
  if (state.status !== previous.status || state.userSub !== previous.userSub || state.userId !== previous.userId) {
    invalidateAuthSession();
  }
});

// ✅ helper: no object selector (avoid infinite loop in React 18 + zustand)
export function useAuthUser() {
  const status = useAuthStore((s) => s.status);
  const email = useAuthStore((s) => s.email);
  const loading = useAuthStore((s) => s.loading);
  const isSignedIn = useAuthStore((s) => s.status === 'signed_in');

  return { status, email, loading, isSignedIn };
}
