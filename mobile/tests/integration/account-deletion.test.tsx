import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { asyncStore } = vi.hoisted(() => ({ asyncStore: new Map<string, string>() }));

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    TextInput: ({ children, ...props }: any) => React.createElement('TextInput', props, children),
    StyleSheet: { create: (styles: any) => styles },
    Platform: { OS: 'ios' },
  };
});

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => React.createElement('SafeAreaView', {}, children),
}));

vi.mock('aws-amplify/auth', () => ({
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(async () => {}),
  // getFreshAccessToken (via freshToken.ts) re-reads the session before the
  // server delete; return a token so it resolves to a fresh access token
  // instead of tripping the session-expired path.
  fetchAuthSession: vi.fn(async () => ({
    tokens: {
      accessToken: { payload: { sub: 'sub-1' }, toString: () => 'fresh-access' },
      idToken: 'fresh-id',
    },
  })),
  getCurrentUser: vi.fn(),
  deleteUser: vi.fn(async () => {}),
  resetPassword: vi.fn(),
  confirmResetPassword: vi.fn(),
  autoSignIn: vi.fn(),
}));

// The real server-delete is exercised in tests/unit/deleteServerAccount.test.ts.
// Here we mock the call but keep the real AccountDeletionError class so
// `err instanceof AccountDeletionError` and the friendly copy stay authentic.
vi.mock('../../src/auth/deleteServerAccount', async (importActual) => {
  const actual = await importActual<typeof import('../../src/auth/deleteServerAccount')>();
  return {
    ...actual,
    deleteServerAccountData: vi.fn(async () => 'deleted' as const),
  };
});

vi.mock('../../src/premium/revenuecat', () => ({
  rcLogout: vi.fn(async () => {}),
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
  isProgressSyncInFlight: vi.fn(() => false),
  purgeClaimedPendingProgressEvents: vi.fn(async () => {}),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteUser, signOut, signIn, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import { setSyncAccessToken, setActiveUserSub, forceProgressSync, purgeClaimedPendingProgressEvents } from '../../src/sync/progressSync';
import { useAuthStore } from '../../src/auth/authStore';
import {
  AccountDeletionError,
  deleteServerAccountData,
} from '../../src/auth/deleteServerAccount';
import { rcLogout } from '../../src/premium/revenuecat';
import { ACTIVE_DELETION_SUB_KEY, deletionPendingKey } from '../../src/auth/accountDeletionPending';
import { isSyncBlocked, unblockSync } from '../../src/sync/syncGuard';
import { AccountDeletionGate } from '../../src/auth/AccountDeletionGate';
import { AccountSection, ACCOUNT_COPY } from '../../src/features/gacha/settings/account/AccountSection';

function collectText(node: renderer.ReactTestInstance): string {
  const parts: string[] = [];
  for (const child of node.children) {
    if (typeof child === 'string') {
      parts.push(child);
      continue;
    }
    parts.push(collectText(child));
  }
  return parts.join(' ');
}

function textBlob(tree: renderer.ReactTestRenderer): string {
  return collectText(tree.root).replace(/\s+/g, ' ').trim();
}

function findByTestID(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll(
    (node) => typeof node.type === 'string' && (node.props as any)?.testID === testID,
  );
}

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('account deletion', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.clearAllMocks();
    // clearAllMocks resets call history but not implementations; restore clean
    // defaults for the mocks individual tests override with persistent impls.
    (deleteServerAccountData as any).mockReset();
    (deleteServerAccountData as any).mockResolvedValue('deleted');
    (deleteUser as any).mockReset();
    (deleteUser as any).mockResolvedValue(undefined);
    asyncStore.clear();
    unblockSync();
    (getCurrentUser as any).mockReset();
    (getCurrentUser as any).mockResolvedValue({ userId: 'sub-1' });
    (fetchAuthSession as any).mockResolvedValue({ tokens: {
      accessToken: { payload: { sub: 'sub-1' }, toString: () => 'fresh-access' }, idToken: 'fresh-id',
    } });
    useAuthStore.setState({
      status: 'signed_in',
      userId: 'sub-1',
      userSub: 'sub-1',
      email: 'a@b.c',
      accessToken: null,
      idToken: null,
      lastError: null,
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('deleteAccountNow purges the deleted account partition + device streaks, keeps others, signs out', async () => {
    asyncStore.set('devcards:u:sub-1:deck-progress:csharp-basics', '1');
    asyncStore.set('devcards:u:sub-1:recallsmith:reward-wallet:v1', '1');
    asyncStore.set('devcards:u:sub-1:devcards:draw-state:csharp-basics', '1');
    asyncStore.set('recallsmith:streaks:snapshot:v1', '1');
    asyncStore.set('devcards:u:anon:deck-progress:csharp-basics', '1');
    asyncStore.set('devcards:u:sub-2:deck-progress:csharp-basics', '1');
    asyncStore.set('recallsmith:onboarding:stage', '1');

    await useAuthStore.getState().deleteAccountNow();

    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(purgeClaimedPendingProgressEvents).toHaveBeenCalledWith('sub-1');
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(setSyncAccessToken).toHaveBeenCalledWith(null);

    expect(Array.from(asyncStore.keys()).sort()).toEqual(
      [
        'devcards:u:anon:deck-progress:csharp-basics',
        'devcards:u:sub-2:deck-progress:csharp-basics',
        'recallsmith:onboarding:stage',
      ].sort(),
    );

    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().userSub).toBeNull();
  });

  it('keeps the session and surfaces an error when deleteUser rejects', async () => {
    (deleteUser as any).mockRejectedValueOnce(new Error('network down'));

    await expect(useAuthStore.getState().deleteAccountNow()).rejects.toThrow();

    expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('deletion_pending');
    expect(isSyncBlocked()).toBe(true);
    expect(useAuthStore.getState().lastError).not.toBeNull();
  });

  it('restores identity-pending after restart, skips bootstrap/adoption, and retries only Cognito', async () => {
    (deleteUser as any).mockRejectedValueOnce(new Error('network down'));
    await expect(useAuthStore.getState().deleteAccountNow()).rejects.toThrow();
    expect(asyncStore.get(deletionPendingKey('sub-1'))).toBe('identity_pending');
    vi.clearAllMocks();
    // Simulate fresh process state with the same persisted AsyncStorage and Cognito session.
    unblockSync();
    useAuthStore.setState({ status: 'unknown', userSub: null, userId: null, accessToken: null, idToken: null });
    await useAuthStore.getState().init();
    expect(useAuthStore.getState().status).toBe('deletion_pending');
    expect(isSyncBlocked()).toBe(true);
    expect(setActiveUserSub).not.toHaveBeenCalled();
    expect(setSyncAccessToken).toHaveBeenCalledWith(null);
    expect(setSyncAccessToken).not.toHaveBeenCalledWith('fresh-access');
    expect(forceProgressSync).not.toHaveBeenCalled();
    await useAuthStore.getState().deleteAccountNow();
    expect(deleteServerAccountData).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(asyncStore.has(deletionPendingKey('sub-1'))).toBe(false);
  });

  it('restores pending mode from access-token identity when the id token/user lookup is unavailable', async () => {
    asyncStore.set(deletionPendingKey('sub-1'), 'identity_pending');
    (getCurrentUser as any).mockRejectedValueOnce(new Error('offline'));
    unblockSync();
    useAuthStore.setState({ status: 'unknown', userSub: null, userId: null });
    const restarting = useAuthStore.getState().init();
    // No foreground/manual sync may load the persisted token while auth is still resolving.
    expect(isSyncBlocked()).toBe(true);
    await restarting;
    expect(useAuthStore.getState().status).toBe('deletion_pending');
    expect(useAuthStore.getState().userSub).toBe('sub-1');
    expect(forceProgressSync).not.toHaveBeenCalled();
  });

  it('retains the pending sub on sign-out and blocks that same sub on sign-in', async () => {
    (deleteUser as any).mockRejectedValueOnce(new Error('network down'));
    await expect(useAuthStore.getState().deleteAccountNow()).rejects.toThrow();
    await useAuthStore.getState().signOutNow();
    expect(asyncStore.get(deletionPendingKey('sub-1'))).toBe('identity_pending');
    vi.clearAllMocks();
    (signIn as any).mockResolvedValueOnce({ isSignedIn: true });
    await useAuthStore.getState().signInWithEmail('a@b.c', 'password');
    expect(useAuthStore.getState().status).toBe('deletion_pending');
    expect(forceProgressSync).not.toHaveBeenCalled();
  });

  it('a different sub can sign in without taking over the pending account', async () => {
    asyncStore.set(deletionPendingKey('sub-1'), 'identity_pending');
    await useAuthStore.getState().signOutNow();
    (getCurrentUser as any).mockResolvedValue({ userId: 'sub-2' });
    (fetchAuthSession as any).mockResolvedValue({ tokens: {
      accessToken: { payload: { sub: 'sub-2' }, toString: () => 'fresh-b' },
      idToken: { payload: { sub: 'sub-2', email: 'b@c.d' }, toString: () => 'id-b' },
    } });
    (signIn as any).mockResolvedValueOnce({ isSignedIn: true });
    await useAuthStore.getState().signInWithEmail('b@c.d', 'password');
    expect(useAuthStore.getState().status).toBe('signed_in');
    expect(useAuthStore.getState().userSub).toBe('sub-2');
    expect(isSyncBlocked()).toBe(false);
    expect(asyncStore.get(deletionPendingKey('sub-1'))).toBe('identity_pending');
  });

  it('persists intent before the network request and retries an unconfirmed server result', async () => {
    (deleteServerAccountData as any).mockImplementationOnce(async () => {
      expect(asyncStore.get(deletionPendingKey('sub-1'))).toBe('server_pending');
      throw new AccountDeletionError('network');
    });
    await expect(useAuthStore.getState().deleteAccountNow()).rejects.toThrow();
    await useAuthStore.getState().init();
    expect(useAuthStore.getState().status).toBe('deletion_pending');
    await useAuthStore.getState().deleteAccountNow();
    expect(deleteServerAccountData).toHaveBeenCalledTimes(2);
    expect(deleteUser).toHaveBeenCalledTimes(1);
  });

  it('does not send deletion when intent cannot be persisted', async () => {
    (AsyncStorage.setItem as any).mockRejectedValueOnce(new Error('disk full'));
    await expect(useAuthStore.getState().deleteAccountNow()).rejects.toThrow('disk full');
    expect(deleteServerAccountData).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('signed_in');
  });

  it('restarts after Cognito succeeded and retries local cleanup without credentials or another delete', async () => {
    const localKey = 'devcards:u:sub-1:progress';
    asyncStore.set(localKey, 'saved');
    (AsyncStorage.multiRemove as any).mockRejectedValueOnce(new Error('storage temporarily unavailable'));
    await expect(useAuthStore.getState().deleteAccountNow()).rejects.toThrow('storage temporarily unavailable');
    expect(asyncStore.get(deletionPendingKey('sub-1'))).toBe('local_pending');
    expect(useAuthStore.getState().loading).toBe(false);
    (getCurrentUser as any).mockRejectedValue(new Error('not signed in'));
    (fetchAuthSession as any).mockResolvedValue({ tokens: {} });
    useAuthStore.setState({ status: 'unknown', userId: null, userSub: null, accessToken: null, idToken: null });
    await useAuthStore.getState().init();
    expect(useAuthStore.getState().status).toBe('deletion_pending');
    await useAuthStore.getState().deleteAccountNow();
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(deleteServerAccountData).toHaveBeenCalledTimes(1);
    expect(asyncStore.has(localKey)).toBe(false);
    expect(asyncStore.has(ACTIVE_DELETION_SUB_KEY)).toBe(false);
    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  it('can explicitly clear this device after a crash between Cognito success and its local receipt', async () => {
    asyncStore.set(deletionPendingKey('sub-1'), 'identity_pending');
    asyncStore.set(ACTIVE_DELETION_SUB_KEY, 'sub-1');
    asyncStore.set('devcards:u:sub-1:progress', 'A');
    asyncStore.set('devcards:u:sub-2:progress', 'B');
    (getCurrentUser as any).mockRejectedValue(new Error('not signed in'));
    (fetchAuthSession as any).mockResolvedValue({ tokens: {} });
    useAuthStore.setState({ status: 'unknown', userId: null, userSub: null, accessToken: null, idToken: null });
    await useAuthStore.getState().init();
    expect(useAuthStore.getState().status).toBe('deletion_pending');
    expect(isSyncBlocked()).toBe(true);
    await useAuthStore.getState().signOutNow();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(asyncStore.has('devcards:u:sub-1:progress')).toBe(false);
    expect(asyncStore.get('devcards:u:sub-2:progress')).toBe('B');
    expect(asyncStore.get(deletionPendingKey('sub-1'))).toBe('identity_pending');
    expect(asyncStore.has(ACTIVE_DELETION_SUB_KEY)).toBe(false);
    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  it('never deletes the SDK B identity while recovering A, and explicit exit preserves B', async () => {
    asyncStore.set(deletionPendingKey('sub-1'), 'identity_pending');
    asyncStore.set(ACTIVE_DELETION_SUB_KEY, 'sub-1');
    asyncStore.set('devcards:u:sub-1:progress', 'A');
    asyncStore.set('devcards:u:sub-2:progress', 'B');
    useAuthStore.setState({ status: 'deletion_pending' });
    (getCurrentUser as any).mockResolvedValue({ userId: 'sub-2' });
    (fetchAuthSession as any).mockResolvedValue({ tokens: {
      accessToken: { payload: { sub: 'sub-2' }, toString: () => 'fresh-b' },
      idToken: { payload: { sub: 'sub-2' }, toString: () => 'id-b' },
    } });
    await expect(useAuthStore.getState().deleteAccountNow()).rejects.toThrow('account changed');
    expect(deleteUser).not.toHaveBeenCalled();
    expect(deleteServerAccountData).not.toHaveBeenCalled();
    await useAuthStore.getState().signOutNow();
    expect(signOut).not.toHaveBeenCalled();
    expect(rcLogout).not.toHaveBeenCalled();
    expect(asyncStore.has('devcards:u:sub-1:progress')).toBe(false);
    expect(asyncStore.get('devcards:u:sub-2:progress')).toBe('B');
    expect(useAuthStore.getState().userSub).toBe('sub-2');
    expect(useAuthStore.getState().status).toBe('signed_in');
  });

  it('never sends a server DELETE for a raw SDK B token while recovering A', async () => {
    asyncStore.set(deletionPendingKey('sub-1'), 'server_pending');
    asyncStore.set(ACTIVE_DELETION_SUB_KEY, 'sub-1');
    useAuthStore.setState({ status: 'deletion_pending', accessToken: null });
    (getCurrentUser as any).mockResolvedValue({ userId: 'sub-2' });
    const bToken = `header.${Buffer.from(JSON.stringify({ sub: 'sub-2' })).toString('base64url')}.signature`;
    (fetchAuthSession as any).mockResolvedValue({ tokens: { accessToken: bToken } });
    await expect(useAuthStore.getState().deleteAccountNow()).rejects.toThrow('Session changed');
    expect(deleteServerAccountData).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('local_pending only clears A and restores an existing SDK B session', async () => {
    asyncStore.set(deletionPendingKey('sub-1'), 'local_pending');
    asyncStore.set(ACTIVE_DELETION_SUB_KEY, 'sub-1');
    asyncStore.set('devcards:u:sub-1:progress', 'A');
    asyncStore.set('devcards:u:sub-2:progress', 'B');
    asyncStore.set('recallsmith:streaks:device', 'B-current-session');
    useAuthStore.setState({ status: 'deletion_pending' });
    (getCurrentUser as any).mockResolvedValue({ userId: 'sub-2' });
    (fetchAuthSession as any).mockResolvedValue({ tokens: {
      accessToken: { payload: { sub: 'sub-2' }, toString: () => 'fresh-b' },
      idToken: { payload: { sub: 'sub-2' }, toString: () => 'id-b' },
    } });
    await useAuthStore.getState().deleteAccountNow();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(deleteServerAccountData).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(rcLogout).not.toHaveBeenCalled();
    expect(asyncStore.has('devcards:u:sub-1:progress')).toBe(false);
    expect(asyncStore.get('devcards:u:sub-2:progress')).toBe('B');
    expect(asyncStore.get('recallsmith:streaks:device')).toBe('B-current-session');
    expect(useAuthStore.getState().userSub).toBe('sub-2');
    expect(useAuthStore.getState().status).toBe('signed_in');
    expect(asyncStore.has(deletionPendingKey('sub-1'))).toBe(false);
  });

  it('calls the server delete before Cognito deleteUser', async () => {
    const order: string[] = [];
    (deleteServerAccountData as any).mockImplementation(async () => {
      order.push('server');
      return 'deleted';
    });
    (deleteUser as any).mockImplementation(async () => {
      order.push('cognito');
    });

    await useAuthStore.getState().deleteAccountNow();

    expect(order).toEqual(['server', 'cognito']);
    // A fresh access token (from getFreshAccessToken) reaches the server delete.
    expect(deleteServerAccountData).toHaveBeenCalledWith('fresh-access');
  });

  it('keeps the session and does not call deleteUser when the server delete fails', async () => {
    (deleteServerAccountData as any).mockRejectedValueOnce(new AccountDeletionError('network'));

    await expect(useAuthStore.getState().deleteAccountNow()).rejects.toBeInstanceOf(
      AccountDeletionError,
    );

    expect(deleteUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(setSyncAccessToken).not.toHaveBeenCalledWith(null);
    expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('deletion_pending');
    expect(isSyncBlocked()).toBe(true);
    expect(useAuthStore.getState().lastError).toBe(new AccountDeletionError('network').message);
  });

  it('logs RevenueCat out after deleting the account', async () => {
    await useAuthStore.getState().deleteAccountNow();

    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(rcLogout).toHaveBeenCalledTimes(1);
  });

  it('signOutNow logs RevenueCat out', async () => {
    await useAuthStore.getState().signOutNow();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(rcLogout).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(purgeClaimedPendingProgressEvents).not.toHaveBeenCalled();
  });

  it('shows the App Store subscription notice and a retry after a failed delete', async () => {
    (deleteServerAccountData as any).mockRejectedValue(new AccountDeletionError('network'));

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <AccountSection
          signedIn
          email="a@b.c"
          onSignIn={vi.fn()}
          onSignOut={vi.fn()}
          primaryCtaTestID="screen-settings-primary-cta"
        />,
      );
    });

    act(() => {
      findByTestID(tree, 'settings-delete-account-open')[0].props.onPress();
    });
    act(() => {
      findByTestID(tree, 'settings-delete-account-input')[0].props.onChangeText('DELETE');
    });
    await act(async () => {
      findByTestID(tree, 'settings-delete-account-confirm')[0].props.onPress();
      await flushMicrotasks();
    });

    // The account is still signed in; deletion was not carried out.
    expect(deleteUser).not.toHaveBeenCalled();
    expect(findByTestID(tree, 'settings-delete-account-subscription-notice').length).toBe(1);
    expect(textBlob(tree)).toContain(ACCOUNT_COPY.subscriptionNotice);
    expect(textBlob(tree)).toContain(new AccountDeletionError('network').message);

    const retry = findByTestID(tree, 'settings-delete-account-retry');
    expect(retry.length).toBe(1);
    expect(collectText(retry[0])).toContain(ACCOUNT_COPY.retry);
  });

  it('runs the typed-confirmation flow to a deleted notice', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <AccountSection
          signedIn
          email="a@b.c"
          onSignIn={vi.fn()}
          onSignOut={vi.fn()}
          primaryCtaTestID="screen-settings-primary-cta"
        />,
      );
    });

    act(() => {
      findByTestID(tree, 'settings-delete-account-open')[0].props.onPress();
    });

    expect(findByTestID(tree, 'settings-delete-account-input').length).toBe(1);

    act(() => {
      findByTestID(tree, 'settings-delete-account-input')[0].props.onChangeText('delete');
    });
    act(() => {
      findByTestID(tree, 'settings-delete-account-confirm')[0].props.onPress();
    });
    expect(deleteUser).not.toHaveBeenCalled();

    act(() => {
      findByTestID(tree, 'settings-delete-account-input')[0].props.onChangeText('DELETE');
    });
    await act(async () => {
      findByTestID(tree, 'settings-delete-account-confirm')[0].props.onPress();
      await flushMicrotasks();
    });

    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(textBlob(tree)).toContain(ACCOUNT_COPY.deletedNotice);
  });

  it('the app gate removes normal screens while pending and restores them after sign-out', async () => {
    useAuthStore.setState({ status: 'deletion_pending' });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<AccountDeletionGate><span>normal learning screen</span></AccountDeletionGate>);
    });
    expect(textBlob(tree)).not.toContain('normal learning screen');
    expect(textBlob(tree)).toContain(ACCOUNT_COPY.deletionPending);
    await act(async () => { await useAuthStore.getState().signOutNow(); });
    expect(textBlob(tree)).toContain('normal learning screen');
  });

  it('pending deletion exposes only continuation and sign-out without a keep-account action', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<AccountSection signedIn deletionPending email="a@b.c"
        onSignIn={vi.fn()} onSignOut={vi.fn()} primaryCtaTestID="pending-sign-out" />);
    });
    expect(textBlob(tree)).toContain(ACCOUNT_COPY.deletionPending);
    expect(findByTestID(tree, 'settings-delete-account-input')).toHaveLength(0);
    expect(findByTestID(tree, 'settings-delete-account-cancel')).toHaveLength(0);
    expect(findByTestID(tree, 'settings-delete-account-retry')).toHaveLength(1);
    expect(findByTestID(tree, 'pending-sign-out')).toHaveLength(1);
  });

  it('hides the delete row entirely when signed out', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <AccountSection
          signedIn={false}
          email={null}
          onSignIn={vi.fn()}
          onSignOut={vi.fn()}
          primaryCtaTestID="screen-settings-primary-cta"
        />,
      );
    });

    expect(findByTestID(tree, 'settings-delete-account-open').length).toBe(0);
    expect(textBlob(tree)).not.toContain(ACCOUNT_COPY.deleteTitle);
  });

  it('keeps a single primary-cta anchor while the confirm panel is open', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <AccountSection
          signedIn
          email="a@b.c"
          onSignIn={vi.fn()}
          onSignOut={vi.fn()}
          primaryCtaTestID="screen-settings-primary-cta"
        />,
      );
    });

    act(() => {
      findByTestID(tree, 'settings-delete-account-open')[0].props.onPress();
    });

    expect(findByTestID(tree, 'screen-settings-primary-cta').length).toBe(1);
  });
});
