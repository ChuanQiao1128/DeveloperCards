import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resendConfirmCodeMock = vi.fn(async () => undefined);

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children),
    KeyboardAvoidingView: ({ children, ...props }: any) => React.createElement('KeyboardAvoidingView', props, children),
    TextInput: ({ children, ...props }: any) => React.createElement('TextInput', props, children),
    Pressable: ({ children, onPress, ...props }: any) => React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    Alert: { alert: vi.fn() },
    Platform: { OS: 'ios' },
    StyleSheet: { create: (styles: any) => styles, absoluteFill: {} },
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return { LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children) };
});

vi.mock('../../src/auth/authStore', () => ({
  useAuthStore: (selector: any) =>
    selector({
      loading: false,
      status: 'signed_out',
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      confirmSignUpCode: vi.fn(),
      resendConfirmCode: resendConfirmCodeMock,
    }),
}));

import SignInScreen from '../../src/screens/SignInScreen';
import SignUpScreen from '../../src/screens/SignUpScreen';
import ConfirmSignUpScreen from '../../src/screens/ConfirmSignUpScreen';
import { colors } from '../../src/theme/colors';

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

describe('auth polish screens', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    resendConfirmCodeMock.mockClear();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('keeps sign-in productized around sync and recovery instead of generic auth copy', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SignInScreen navigation={{ goBack: vi.fn(), canGoBack: () => true, reset: vi.fn(), navigate: vi.fn() } as any} route={{ key: 'signin', name: 'SignIn' } as any} />);
    });
    const blob = textBlob(tree);
    expect(blob).toContain('Welcome back');
    expect(blob).toContain('Sign in to restore your study progress, sync, and account recovery.');
    expect(blob).toContain('Use the verified email tied to your study history.');
    expect(blob).toContain('Create an account');
    expect(blob).toContain('merge automatically');
    expect(blob).not.toContain('Sign in to sync your progress.');
  });

  it('keeps sign-up focused on protecting sync and future account recovery with unified parchment theme', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SignUpScreen navigation={{ goBack: vi.fn(), replace: vi.fn() } as any} route={{ key: 'signup', name: 'SignUp' } as any} />);
    });
    const blob = textBlob(tree);
    expect(blob).toContain('Create your account');
    expect(blob).toContain('Verify email to protect sync and future account recovery.');
    expect(blob).toContain('We’ll send a verification code before cloud sync turns on.');
    expect(blob).toContain('Use an email you can access again later if you ever need to recover your account.');
    expect(blob).toContain('merge into your new account automatically');

    const gradient = tree.root.findByType('LinearGradient' as any);
    expect(gradient.props.colors).toEqual([colors.parchmentBg, colors.parchmentBgDeep]);
  });

  it('shows inline email format guidance when a malformed email blurs', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SignInScreen navigation={{ goBack: vi.fn(), canGoBack: () => true, reset: vi.fn(), navigate: vi.fn() } as any} route={{ key: 'signin', name: 'SignIn' } as any} />);
    });
    const emailInput = tree.root.findAllByProps({ placeholder: 'you@example.com' })[0];
    await act(async () => {
      emailInput.props.onChangeText('abc');
      emailInput.props.onBlur();
    });
    expect(tree.root.findAllByProps({ testID: 'signin-email-hint' }).length).toBeGreaterThan(0);
  });

  it('keeps email-confirmation copy calm, renders 6 OTP slots, and enforces resend cooldown', async () => {
    const goBack = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<ConfirmSignUpScreen navigation={{ goBack, replace: vi.fn() } as any} route={{ key: 'confirm', name: 'ConfirmSignUp', params: { email: 'person@example.com' } } as any} />);
    });
    const blob = textBlob(tree);
    expect(blob).toContain('Verify your email');
    expect(blob).toContain('Use the latest code to finish protecting sync and recovery.');
    expect(blob).toContain('Only the latest code works. If you requested several, use the newest email.');
    expect(blob).not.toContain('Use the latest code you received.');

    const gradient = tree.root.findByType('LinearGradient' as any);
    expect(gradient.props.colors).toEqual([colors.parchmentBg, colors.parchmentBgDeep]);
    expect(tree.root.findAllByProps({ testID: 'otp-code-slots' }).length).toBeGreaterThan(0);
    expect(tree.root.findByProps({ placeholder: '123456' }).props.autoFocus).toBe(true);

    const resendBtn = tree.root.findByProps({ testID: 'confirm-resend-code' });
    await act(async () => {
      await resendBtn.props.onPress();
    });
    expect(resendConfirmCodeMock).toHaveBeenCalledWith('person@example.com');
    expect(textBlob(tree)).toContain('Resend code in 60s');

    const changeEmailBtn = tree.root.findByProps({ testID: 'confirm-change-email' });
    act(() => {
      changeEmailBtn.props.onPress();
    });
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('auto-submits exactly once when 6 digits are entered or pasted', async () => {
    const confirmSignUpCodeMock = vi.fn(async () => 'needs_sign_in');
    const useAuthStoreModule = await import('../../src/auth/authStore');
    const origUseAuthStore = useAuthStoreModule.useAuthStore;
    (useAuthStoreModule as any).useAuthStore = (selector: any) =>
      selector({
        loading: false,
        status: 'signed_out',
        confirmSignUpCode: confirmSignUpCodeMock,
        resendConfirmCode: resendConfirmCodeMock,
      });

    try {
      let tree!: renderer.ReactTestRenderer;
      await act(async () => {
        tree = renderer.create(
          <ConfirmSignUpScreen
            navigation={{ goBack: vi.fn(), replace: vi.fn(), popTo: vi.fn() } as any}
            route={{ key: 'confirm', name: 'ConfirmSignUp', params: { email: 'person@example.com' } } as any}
          />,
        );
      });

      const input = tree.root.findByProps({ placeholder: '123456' });

      // Incomplete code (5 digits) should NOT trigger submit
      await act(async () => {
        input.props.onChangeText('12345');
      });
      expect(confirmSignUpCodeMock).not.toHaveBeenCalled();

      // Complete 6 digits should auto-submit exactly once
      await act(async () => {
        input.props.onChangeText('123456');
      });
      expect(confirmSignUpCodeMock).toHaveBeenCalledTimes(1);
      expect(confirmSignUpCodeMock).toHaveBeenCalledWith('person@example.com', '123456');

      // Re-render with same 6 digits should not submit again
      await act(async () => {
        input.props.onChangeText('123456');
      });
      expect(confirmSignUpCodeMock).toHaveBeenCalledTimes(1);
    } finally {
      (useAuthStoreModule as any).useAuthStore = origUseAuthStore;
    }
  });

  it('guards against concurrent in-flight resend requests', async () => {
    let resolveFirstRequest!: () => void;
    const slowResendMock = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstRequest = resolve;
        }),
    );

    const useAuthStoreModule = await import('../../src/auth/authStore');
    const origUseAuthStore = useAuthStoreModule.useAuthStore;
    (useAuthStoreModule as any).useAuthStore = (selector: any) =>
      selector({
        loading: false,
        status: 'signed_out',
        confirmSignUpCode: vi.fn(),
        resendConfirmCode: slowResendMock,
      });

    try {
      let tree!: renderer.ReactTestRenderer;
      await act(async () => {
        tree = renderer.create(
          <ConfirmSignUpScreen
            navigation={{ goBack: vi.fn(), replace: vi.fn(), popTo: vi.fn() } as any}
            route={{ key: 'confirm', name: 'ConfirmSignUp', params: { email: 'person@example.com' } } as any}
          />,
        );
      });

      const resendBtn = tree.root.findByProps({ testID: 'confirm-resend-code' });

      // Fire two resend presses before the first one resolves
      let p1: Promise<any>;
      let p2: Promise<any>;
      await act(async () => {
        p1 = resendBtn.props.onPress();
        p2 = resendBtn.props.onPress();
      });

      expect(slowResendMock).toHaveBeenCalledTimes(1);

      // Resolve the first request
      await act(async () => {
        resolveFirstRequest();
        await Promise.all([p1, p2]);
      });

      expect(slowResendMock).toHaveBeenCalledTimes(1);
    } finally {
      (useAuthStoreModule as any).useAuthStore = origUseAuthStore;
    }
  });

});
