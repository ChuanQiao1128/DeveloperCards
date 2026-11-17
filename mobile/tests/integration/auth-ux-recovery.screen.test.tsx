import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { store } = vi.hoisted(() => ({
  store: {
    loading: false,
    status: 'anonymous' as string,
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    confirmSignUpCode: vi.fn(),
    resendConfirmCode: vi.fn(),
    requestPasswordReset: vi.fn(),
    confirmPasswordReset: vi.fn(),
    completeNewPasswordSignIn: vi.fn(),
    init: vi.fn(async () => {}),
  },
}));

const recordFunnelEventMock = vi.fn();
vi.mock('../../src/telemetry/funnel', () => ({
  recordFunnelEvent: (...args: unknown[]) => recordFunnelEventMock(...args),
}));

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children),
    KeyboardAvoidingView: ({ children, ...props }: any) =>
      React.createElement('KeyboardAvoidingView', props, children),
    TextInput: ({ children, ...props }: any) => React.createElement('TextInput', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    Alert: { alert: vi.fn() },
    Platform: { OS: 'ios' },
    AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
    StyleSheet: { create: (styles: any) => styles, absoluteFill: {} },
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return {
    LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children),
  };
});

vi.mock('../../src/auth/authStore', () => {
  const useAuthStore: any = (selector: any) => selector(store);
  useAuthStore.getState = () => store;
  return { useAuthStore };
});

import { Alert } from 'react-native';
import SignInScreen from '../../src/screens/SignInScreen';
import SignUpScreen from '../../src/screens/SignUpScreen';
import ConfirmSignUpScreen from '../../src/screens/ConfirmSignUpScreen';
import ForgotPasswordScreen from '../../src/screens/ForgotPasswordScreen';
import { AuthFlowError } from '../../src/auth/authErrors';

const mockAlert = vi.mocked(Alert.alert);

function makeNav() {
  return {
    navigate: vi.fn(),
    replace: vi.fn(),
    goBack: vi.fn(),
    popTo: vi.fn(),
    reset: vi.fn(),
    canGoBack: vi.fn(() => true),
    getState: vi.fn(() => ({ routes: [{ name: 'Home' }, { name: 'SignIn' }] })),
  };
}

function byTestID(tree: renderer.ReactTestRenderer, id: string) {
  return tree.root.findByProps({ testID: id });
}

function byPlaceholder(tree: renderer.ReactTestRenderer, placeholder: string) {
  return tree.root.findAllByProps({ placeholder })[0];
}

function collectText(node: renderer.ReactTestInstance): string {
  const parts: string[] = [];
  for (const child of node.children) {
    if (typeof child === 'string') parts.push(child);
    else parts.push(collectText(child));
  }
  return parts.join('');
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}


describe('auth navigation and feedback recovery', () => {
  let tree: renderer.ReactTestRenderer;
  const focus = vi.fn();
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    for (const name of ['signInWithEmail', 'signUpWithEmail', 'confirmSignUpCode', 'resendConfirmCode', 'requestPasswordReset', 'confirmPasswordReset']) {
      (store as any)[name].mockReset();
    }
  });
  afterEach(async () => { if (tree) await act(async () => tree.unmount()); });
  async function render(Screen: any, name: string, params?: object) {
    const nav = makeNav();
    await act(async () => { tree = renderer.create(<Screen navigation={nav as any} route={{ key: 'audit', name, params } as any} />, { createNodeMock: () => ({ focus }) }); });
    return nav;
  }
  async function fillSignIn() {
    await act(async () => {
      tree.root.findAllByType('TextInput' as any)[0].props.onChangeText('audit@example.invalid');
      tree.root.findAllByType('TextInput' as any)[1].props.onChangeText('Abcdef1!');
    });
    await act(async () => { await tree.root.findAllByType('TextInput' as any)[1].props.onSubmitEditing(); });
  }
  it.each([[SignInScreen, 'SignIn'], [SignUpScreen, 'SignUp']] as const)('%s email Next focuses the password field', async (Screen, name) => {
    await render(Screen, name);
    const input = tree.root.findAllByType('TextInput' as any)[0];
    expect(input.props.returnKeyType).toBe('next');
    expect(input.props.onSubmitEditing).toEqual(expect.any(Function));
    expect(input.props.accessibilityLabel).toBe('Email');
    focus.mockClear();
    await act(async () => { input.props.onSubmitEditing(); });
    expect(focus).toHaveBeenCalledOnce();
  });
  it('change email explicitly returns to the signup editor with the address', async () => {
    const nav = await render(ConfirmSignUpScreen, 'ConfirmSignUp', { email: 'audit@example.invalid' });
    await act(async () => { tree.root.findByProps({ testID: 'confirm-change-email' }).props.onPress(); });
    expect(nav.goBack).not.toHaveBeenCalled();
    expect(nav.navigate).not.toHaveBeenCalled();
    expect(nav.replace).toHaveBeenCalledWith('SignUp', { email: 'audit@example.invalid' });
    expect(nav.popTo).not.toHaveBeenCalled();
  });
  it('failed login-triggered resend opens verification with truthful delivery feedback', async () => {
    store.signInWithEmail.mockRejectedValueOnce(new AuthFlowError('NEEDS_CONFIRMATION', 'Verify your email'));
    store.resendConfirmCode.mockRejectedValueOnce(new Error('No connection'));
    const nav = await render(SignInScreen, 'SignIn');
    await fillSignIn();
    expect(store.resendConfirmCode).toHaveBeenCalledOnce();
    expect(nav.navigate).toHaveBeenCalledWith('ConfirmSignUp', { email: 'audit@example.invalid', source: 'signin', codeSentAt: undefined, deliveryError: 'Something went wrong. Please try again.' });
    await act(async () => tree.unmount());
    await render(ConfirmSignUpScreen, 'ConfirmSignUp', nav.navigate.mock.calls[0][1]);
    expect(collectText(tree.root)).not.toContain('Code sent to');
    expect(collectText(tree.root)).toContain('Something went wrong. Please try again.');
    expect(tree.root.findByProps({ testID: 'confirm-resend-code' }).props.disabled).toBe(false);
  });
  it.each(['RESET_REQUIRED', 'NEW_PASSWORD_REQUIRED'] as const)('%s opens the matching password recovery step', async code => {
    store.signInWithEmail.mockRejectedValueOnce(new AuthFlowError(code, 'A new password is required.'));
    const nav = await render(SignInScreen, 'SignIn');
    await fillSignIn();
    expect(nav.navigate).toHaveBeenCalledWith('ForgotPassword', { email: 'audit@example.invalid', ...(code === 'NEW_PASSWORD_REQUIRED' ? { mode: 'new_password' } : {}) });
    expect(nav.replace).not.toHaveBeenCalled();
    expect(nav.popTo).not.toHaveBeenCalled();
  });
  it('password recovery does not claim a code sent before submission', async () => {
    await render(ForgotPasswordScreen, 'ForgotPassword');
    expect(store.requestPasswordReset).not.toHaveBeenCalled();
    expect(collectText(tree.root)).not.toContain('we sent');
  });
  it('password recovery confirmation shows the address and offers correction', async () => {
    store.requestPasswordReset.mockResolvedValueOnce(undefined);
    await render(ForgotPasswordScreen, 'ForgotPassword', { email: 'audit@example.invalid' });
    await act(async () => { await tree.root.findByProps({ testID: 'forgot-send-code' }).props.onPress(); });
    expect(tree.root.findAllByProps({ testID: 'forgot-code-input' }).length).toBeGreaterThan(0);
    expect(collectText(tree.root)).toContain('audit@example.invalid');
    await act(async () => { tree.root.findByProps({ testID: 'forgot-change-email' }).props.onPress(); });
    expect(tree.root.findAllByType('TextInput' as any)[0].props.value).toBe('audit@example.invalid');
    expect(tree.root.findAllByType('TextInput' as any).some(node => node.props.autoComplete === 'email')).toBe(true);
  });
});

it('completed reset clears the old password on the existing login instance and explains success', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  store.status = 'anonymous';
  store.loading = false;
  store.requestPasswordReset.mockResolvedValue(undefined);
  store.confirmPasswordReset.mockResolvedValue(undefined);
  const signinNav = makeNav();
  const resetNav = makeNav();
  let signin!: renderer.ReactTestRenderer;
  let reset!: renderer.ReactTestRenderer;
  await act(async () => {
    signin = renderer.create(<SignInScreen navigation={signinNav as any} route={{ key: 'signin-audit', name: 'SignIn' } as any} />);
    reset = renderer.create(<ForgotPasswordScreen navigation={resetNav as any} route={{ key: 'reset-audit', name: 'ForgotPassword', params: { email: 'audit@example.invalid' } } as any} />);
  });
  try {
    await act(async () => { signin.root.findAllByType('TextInput' as any)[1].props.onChangeText('OldPassword1!'); });
    await act(async () => { await reset.root.findByProps({ testID: 'forgot-send-code' }).props.onPress(); });
    await act(async () => {
      reset.root.findByProps({ testID: 'forgot-code-input' }).props.onChangeText('123456');
      reset.root.findByProps({ testID: 'forgot-new-password-input' }).props.onChangeText('NewPassword1!');
    });
    await act(async () => { await reset.root.findByProps({ testID: 'forgot-confirm' }).props.onPress(); });
    expect(store.confirmPasswordReset).toHaveBeenCalledWith('audit@example.invalid', '123456', 'NewPassword1!');
    expect(resetNav.popTo).toHaveBeenCalledWith('SignIn', { email: 'audit@example.invalid', notice: 'password_reset', noticeAt: expect.any(Number) });
    const params = resetNav.popTo.mock.calls.at(-1)![1];
    await act(async () => { signin.update(<SignInScreen navigation={signinNav as any} route={{ key: 'signin-audit', name: 'SignIn', params } as any} />); });
    expect(signin.root.findAllByType('TextInput' as any)[1].props.value).toBe('');
    expect(collectText(signin.root)).toContain('Password updated. Sign in with your new password.');
  } finally {
    await act(async () => { signin.unmount(); reset.unmount(); });
  }
});

it('temporary-password accounts set the new password without requesting an email code', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  store.completeNewPasswordSignIn.mockResolvedValueOnce(true);
  store.requestPasswordReset.mockClear();
  const navigation = makeNav();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<ForgotPasswordScreen navigation={navigation as any} route={{ key: 'challenge', name: 'ForgotPassword', params: { email: 'audit@example.invalid', mode: 'new_password' } } as any} />); });
  try {
    expect(tree.root.findAllByProps({ testID: 'forgot-code-input' })).toHaveLength(0);
    expect(collectText(tree.root)).toContain('Choose a new password');
    await act(async () => { tree.root.findByProps({ testID: 'forgot-new-password-input' }).props.onChangeText('Abcdef1!'); });
    await act(async () => { await tree.root.findByProps({ testID: 'forgot-confirm' }).props.onPress(); });
    expect(store.completeNewPasswordSignIn).toHaveBeenCalledWith('Abcdef1!');
    expect(store.requestPasswordReset).not.toHaveBeenCalled();
    expect(navigation.popTo).toHaveBeenCalledWith('Home', undefined);
  } finally { await act(async () => tree.unmount()); }
});

it('verification waits after a successful initial send and changes signin email at the correct editor', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const navigation = makeNav();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<ConfirmSignUpScreen navigation={navigation as any} route={{ key: 'verify', name: 'ConfirmSignUp', params: { email: 'audit@example.invalid', source: 'signin', codeSentAt: Date.now() } } as any} />); });
  try {
    expect(collectText(tree.root)).toContain('Code sent to audit@example.invalid.');
    expect(tree.root.findByProps({ testID: 'confirm-resend-code' }).props.disabled).toBe(true);
    await act(async () => { tree.root.findByProps({ testID: 'confirm-change-email' }).props.onPress(); });
    expect(navigation.popTo).toHaveBeenCalledWith('SignIn', { email: 'audit@example.invalid', notice: 'check_email', noticeAt: expect.any(Number) });
    expect(navigation.replace).not.toHaveBeenCalled();
  } finally { await act(async () => tree.unmount()); }
});

it('a failed resend clears the previous success notice', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T01:00:00Z'));
  store.requestPasswordReset.mockReset().mockResolvedValue(undefined);
  const navigation = makeNav();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<ForgotPasswordScreen navigation={navigation as any} route={{ key: 'reset', name: 'ForgotPassword', params: { email: 'audit@example.invalid' } } as any} />); });
  try {
    await act(async () => { await tree.root.findByProps({ testID: 'forgot-send-code' }).props.onPress(); });
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await act(async () => { await tree.root.findByProps({ testID: 'forgot-resend' }).props.onPress(); });
    expect(tree.root.findAllByProps({ testID: 'forgot-resend-notice' }).length).toBeGreaterThan(0);
    await act(async () => { vi.advanceTimersByTime(60_000); });
    store.requestPasswordReset.mockRejectedValueOnce(new AuthFlowError('FAILED', 'No connection. Check your internet and try again.'));
    await act(async () => { await tree.root.findByProps({ testID: 'forgot-resend' }).props.onPress(); });
    expect(tree.root.findAllByProps({ testID: 'forgot-resend-notice' })).toHaveLength(0);
    expect(collectText(tree.root)).toContain('No connection.');
  } finally { await act(async () => tree.unmount()); vi.useRealTimers(); }
});
