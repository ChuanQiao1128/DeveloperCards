import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { asyncStore } = vi.hoisted(() => ({ asyncStore: new Map<string, string>() }));

vi.mock('aws-amplify/auth', () => ({
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  confirmSignIn: vi.fn(),
  resendSignUpCode: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(async () => {}),
  fetchAuthSession: vi.fn(),
  getCurrentUser: vi.fn(),
  deleteUser: vi.fn(async () => {}),
  resetPassword: vi.fn(async () => {}),
  confirmResetPassword: vi.fn(async () => {}),
  autoSignIn: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => (asyncStore.has(k) ? asyncStore.get(k)! : null)),
    setItem: vi.fn(async (k: string, v: string) => {
      asyncStore.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      asyncStore.delete(k);
    }),
    getAllKeys: vi.fn(async () => Array.from(asyncStore.keys())),
    multiRemove: vi.fn(async (ks: string[]) => {
      ks.forEach((k) => asyncStore.delete(k));
    }),
  },
}));

vi.mock('../../src/sync/progressSync', () => ({
  setSyncAccessToken: vi.fn(async () => {}),
  setActiveUserSub: vi.fn(async () => {}),
  forceProgressSync: vi.fn(async () => {}),
  scheduleProgressSync: vi.fn(async () => {}),
}));

import {
  signUp,
  confirmSignUp,
  signIn,
  fetchAuthSession,
  getCurrentUser,
  resetPassword,
  confirmResetPassword,
  autoSignIn,
} from 'aws-amplify/auth';
import { useAuthStore } from '../../src/auth/authStore';
import {
  AuthFlowError,
  AUTH_ERROR_COPY,
  friendlyAuthError,
  isAuthFlowError,
} from '../../src/auth/authErrors';
import { PASSWORD_RULES, evaluatePassword, isPasswordValid } from '../../src/auth/passwordPolicy';
import { leaveAuthFlow } from '../../src/auth/leaveAuthFlow';

const mockSignUp = vi.mocked(signUp);
const mockConfirmSignUp = vi.mocked(confirmSignUp);
const mockSignIn = vi.mocked(signIn);
const mockFetchAuthSession = vi.mocked(fetchAuthSession);
const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockResetPassword = vi.mocked(resetPassword);
const mockConfirmResetPassword = vi.mocked(confirmResetPassword);
const mockAutoSignIn = vi.mocked(autoSignIn);

beforeEach(() => {
  vi.clearAllMocks();
  asyncStore.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});


describe('auth recovery preserves actionable errors', () => {
  const actions = [
    ['confirmation', () => useAuthStore.getState().confirmSignUpCode('audit@example.invalid', '123456'), () => mockConfirmSignUp],
    ['resend', () => useAuthStore.getState().resendConfirmCode('audit@example.invalid'), async () => vi.mocked((await import('aws-amplify/auth')).resendSignUpCode)],
    ['request reset', () => useAuthStore.getState().requestPasswordReset('audit@example.invalid'), () => mockResetPassword],
    ['confirm reset', () => useAuthStore.getState().confirmPasswordReset('audit@example.invalid', '123456', 'Abcdef1!'), () => mockConfirmResetPassword],
  ] as const;
  for (const [action, run, mockProvider] of actions) {
    it.each(['CodeMismatchException', 'ExpiredCodeException', 'LimitExceededException', 'NetworkError'])(`${action}: %s survives the store and screen formatter`, async name => {
      const mock = await mockProvider();
      mock.mockRejectedValueOnce({ name });
      const shown = await run().catch(friendlyAuthError);
      expect(friendlyAuthError({ name })).not.toBe('Something went wrong. Please try again.');
      expect(shown).toBe(AUTH_ERROR_COPY[name]);
    });
  }
});


describe('new password sign-in challenge', () => {
  it('finishes the challenge and applies the authenticated session', async () => {
    const { confirmSignIn } = await import('aws-amplify/auth');
    vi.mocked(confirmSignIn).mockResolvedValueOnce({ isSignedIn: true, nextStep: { signInStep: 'DONE' } } as any);
    mockFetchAuthSession.mockResolvedValue({ tokens: { accessToken: 'atok', idToken: 'itok' } } as any);
    mockGetCurrentUser.mockResolvedValue({ userId: undefined } as any);
    expect(await useAuthStore.getState().completeNewPasswordSignIn('Abcdef1!')).toBe(true);
    expect(confirmSignIn).toHaveBeenCalledWith({ challengeResponse: 'Abcdef1!' });
    expect(useAuthStore.getState().status).toBe('signed_in');
  });
  it('preserves a network failure and stops loading', async () => {
    const { confirmSignIn } = await import('aws-amplify/auth');
    vi.mocked(confirmSignIn).mockRejectedValueOnce({ name: 'NetworkError' });
    const result = await useAuthStore.getState().completeNewPasswordSignIn('Abcdef1!').catch(friendlyAuthError);
    expect(result).toBe(AUTH_ERROR_COPY.NetworkError);
    expect(useAuthStore.getState().loading).toBe(false);
  });
  it('does not apply a challenge session after the auth generation changes', async () => {
    const { confirmSignIn } = await import('aws-amplify/auth');
    const { invalidateAuthSession } = await import('../../src/auth/sessionBoundary');
    let resolve!: (result: any) => void;
    vi.mocked(confirmSignIn).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const request = useAuthStore.getState().completeNewPasswordSignIn('Abcdef1!');
    invalidateAuthSession();
    resolve({ isSignedIn: true });
    expect(await request).toBe(false);
    expect(mockFetchAuthSession).not.toHaveBeenCalled();
  });
  it('routes the thrown reset-required exception as well as the returned step', async () => {
    mockSignIn.mockRejectedValueOnce({ name: 'PasswordResetRequiredException' });
    const result = await useAuthStore.getState().signInWithEmail('audit@example.invalid', 'old').catch(error => error);
    expect(isAuthFlowError(result, 'RESET_REQUIRED')).toBe(true);
  });
});

it('an expired new-password challenge directs the user to restart sign-in', async () => {
  const { confirmSignIn } = await import('aws-amplify/auth');
  vi.mocked(confirmSignIn).mockRejectedValueOnce({ name: 'NotAuthorizedException', message: 'raw expired session' });
  const result = await useAuthStore.getState().completeNewPasswordSignIn('Abcdef1!').catch(friendlyAuthError);
  expect(result).toBe(AUTH_ERROR_COPY.SignInException);
  expect(result).not.toContain('Incorrect email or password');
});
