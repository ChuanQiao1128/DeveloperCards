import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { useAuthStore } from '../auth/authStore';
import { friendlyAuthError, isAuthFlowError } from '../auth/authErrors';
import { EMAIL_FORMAT_HINT, isValidEmail, normEmail } from '../auth/emailPolicy';
import { leaveAuthFlow, type LeaveAuthNavigation } from '../auth/leaveAuthFlow';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'SignIn'>;

export default function SignInScreen({ navigation, route }: Props) {
  const loading = useAuthStore((s) => s.loading);
  const status = useAuthStore((s) => s.status);
  const isSignedIn = useAuthStore((s) => s.status === 'signed_in');
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
  const resendConfirmCode = useAuthStore((s) => s.resendConfirmCode);

  const [email, setEmail] = useState(route.params?.email ?? '');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [emailBlurred, setEmailBlurred] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (isSignedIn) leaveAuthFlow(navigation as unknown as LeaveAuthNavigation);
  }, [isSignedIn, navigation]);

  // ForgotPassword returns via popTo('SignIn', { email }); pick up a new email
  // so the field is prefilled when the user lands back here.
  useEffect(() => {
    const next = route.params?.email;
    if (next) setEmail(next);
  }, [route.params?.email]);

  const emailInvalid = emailBlurred && normEmail(email).length > 0 && !isValidEmail(email);

  const canSubmit = useMemo(() => {
    return isValidEmail(email) && password.length >= 1 && !loading && status !== 'signed_in';
  }, [email, password, loading, status]);

  async function onSubmit() {
    if (inFlightRef.current) return;
    if (!canSubmit) {
      if (normEmail(email).length > 0 && !isValidEmail(email)) {
        setEmailBlurred(true);
      }
      return;
    }

    inFlightRef.current = true;
    setInlineError(null);
    try {
      await signInWithEmail(email, password);
      leaveAuthFlow(navigation as unknown as LeaveAuthNavigation);
    } catch (e: any) {
      if (isAuthFlowError(e, 'NEEDS_CONFIRMATION')) {
        try {
          await resendConfirmCode(email);
        } catch {
          // ignore — the confirm screen offers a manual resend
        }
        navigation.navigate('ConfirmSignUp', { email: normEmail(email) });
        return;
      }

      const msg = String(e?.message ?? '');
      if (/already.*signed in/i.test(msg)) {
        await useAuthStore.getState().init();
        leaveAuthFlow(navigation as unknown as LeaveAuthNavigation);
        return;
      }
      setInlineError(friendlyAuthError(e));
    } finally {
      inFlightRef.current = false;
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        pointerEvents="none"
        colors={[colors.parchmentBg, colors.parchmentBgDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        >
          {/* Header */}
          <View style={styles.headerRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backText}>← Back</Text>
            </Pressable>

            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Welcome back</Text>
              <Text style={styles.subtitle}>Sign in to restore your study progress, sync, and account recovery.</Text>
            </View>
          </View>

          {/* Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign in</Text>
            <Text style={styles.cardHint}>Use the verified email tied to your study history.</Text>

            <View style={styles.mergeBadge} testID="signin-merge-reassurance">
              <Text style={styles.mergeBadgeText}>
                Cards and study progress on this device stay safe and merge automatically when you sign in.
              </Text>
            </View>

            {inlineError ? (
              <View style={styles.errorBanner} testID="signin-error-banner" accessibilityRole="alert">
                <Text style={styles.errorBannerText}>{inlineError}</Text>
              </View>
            ) : null}

            <Text style={styles.label}>Email</Text>
            <View style={[styles.inputWrap, emailInvalid && styles.inputWrapError]}>
              <TextInput
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  if (inlineError) setInlineError(null);
                }}
                onBlur={() => {
                  setEmail((prev) => normEmail(prev));
                  setEmailBlurred(true);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                autoComplete="email"
                placeholder="you@example.com"
                placeholderTextColor={colors.inkSecondary}
                style={styles.input}
                editable={!loading}
                returnKeyType="next"
              />
            </View>
            {emailInvalid ? (
              <Text style={styles.fieldError} testID="signin-email-hint" accessibilityRole="alert">
                {EMAIL_FORMAT_HINT}
              </Text>
            ) : null}

            <Text style={[styles.label, { marginTop: 12 }]}>Password</Text>
            <View style={styles.inputWrap}>
              <TextInput
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  if (inlineError) setInlineError(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showPwd}
                textContentType="password"
                autoComplete="current-password"
                placeholder="Your password"
                placeholderTextColor={colors.inkSecondary}
                style={styles.input}
                editable={!loading}
                returnKeyType="done"
                onSubmitEditing={onSubmit}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPwd ? 'Hide password' : 'Show password'}
                onPress={() => setShowPwd((v) => !v)}
                disabled={loading}
                style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
              >
                <Text style={styles.pillText}>{showPwd ? 'Hide' : 'Show'}</Text>
              </Pressable>
            </View>

            <Pressable
              testID="signin-forgot-password"
              accessibilityRole="button"
              onPress={() =>
                navigation.navigate('ForgotPassword', { email: normEmail(email) || undefined })
              }
              disabled={loading}
              style={({ pressed }) => [styles.forgotLink, pressed && styles.pressed]}
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primaryBtn,
                (!canSubmit || loading) && styles.disabled,
                pressed && canSubmit && styles.pressed,
              ]}
              disabled={!canSubmit || loading}
              onPress={onSubmit}
            >
              {loading ? (
                <View style={styles.rowCenter}>
                  <ActivityIndicator color={colors.ink} />
                  <Text style={[styles.primaryText, { marginLeft: 8 }]}>Signing in…</Text>
                </View>
              ) : (
                <Text style={styles.primaryText}>Continue</Text>
              )}
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>New here?</Text>
              <View style={styles.dividerLine} />
            </View>

            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
              onPress={() => navigation.replace('SignUp')}
              disabled={loading}
            >
              <Text style={styles.secondaryText}>Create an account</Text>
            </Pressable>

            <Text style={styles.footnote}>
              Keep using an email you can access later if you ever need to restore study history on a new device.
            </Text>
          </View>

          <View style={{ height: 28 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.parchmentBg },
  flex: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24 },

  pressed: { opacity: 0.9 },
  disabled: { opacity: 0.55 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  backButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.softCream,
    borderWidth: 1,
    borderColor: colors.hairline,
    marginRight: 10,
    justifyContent: 'center',
  },
  backText: { fontSize: 13, color: colors.inkSoft, fontWeight: '800' },

  title: { fontSize: 22, fontWeight: '900', color: colors.ink },
  subtitle: { marginTop: 4, fontSize: 13, color: colors.inkSecondary, lineHeight: 18, fontWeight: '600' },

  card: {
    borderRadius: 24,
    paddingVertical: 18,
    paddingHorizontal: 16,
    backgroundColor: colors.softCream,
    borderWidth: 1,
    borderColor: colors.hairline,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  cardTitle: { fontSize: 18, fontWeight: '900', color: colors.ink },
  cardHint: { marginTop: 4, fontSize: 12, color: colors.inkSecondary, fontWeight: '600' },

  mergeBadge: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.parchmentBg,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  mergeBadgeText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: colors.inkSecondary,
  },

  errorBanner: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: 'rgba(170,54,54,0.28)',
  },
  errorBannerText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.danger,
  },

  label: { marginTop: 14, fontSize: 12, fontWeight: '900', color: colors.inkSoft, letterSpacing: 0.4 },

  inputWrap: {
    marginTop: 8,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: '#FFFFFF',
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputWrapError: {
    borderColor: colors.danger,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 14, color: colors.inkSoft },

  fieldError: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: colors.danger,
  },

  pill: {
    marginLeft: 8,
    minHeight: 44,
    minWidth: 56,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.pokeBlueFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: { color: colors.ink, fontWeight: '900', fontSize: 12 },

  primaryBtn: {
    marginTop: 12,
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: colors.pokeBlue,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(44,156,192,0.4)',
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  primaryText: { fontSize: 15, fontWeight: '900', color: colors.ink, letterSpacing: 0.4 },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },

  forgotLink: {
    alignSelf: 'flex-end',
    marginTop: 6,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  forgotText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.inkSoft,
    textDecorationLine: 'underline',
  },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, marginBottom: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.hairline },
  dividerText: { marginHorizontal: 10, fontSize: 12, color: colors.inkSecondary, fontWeight: '700' },

  secondaryBtn: {
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontSize: 14, fontWeight: '800', color: colors.inkSoft },

  footnote: { marginTop: 12, fontSize: 11, color: colors.inkSecondary, lineHeight: 16, fontWeight: '600' },
});
