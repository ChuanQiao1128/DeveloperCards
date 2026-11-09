import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
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
import { OTP_SLOT_COUNT, OtpCodeSlots } from '../auth/components/OtpCodeSlots';
import { leaveAuthFlow, type LeaveAuthNavigation } from '../auth/leaveAuthFlow';
import { recordFunnelEvent } from '../telemetry/funnel';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'ConfirmSignUp'>;

const RESEND_COOLDOWN_SECONDS = 60;

function maskEmail(email: string) {
  const e = String(email || '').trim();
  const at = e.indexOf('@');
  if (at <= 1) return e;
  const name = e.slice(0, at);
  const dom = e.slice(at + 1);
  return `${name.slice(0, 2)}***${name.slice(-1)}@${dom}`;
}

export default function ConfirmSignUpScreen({ navigation, route }: Props) {
  const email = route.params.email;

  const loading = useAuthStore((s) => s.loading);
  const confirmSignUpCode = useAuthStore((s) => s.confirmSignUpCode);
  const resendConfirmCode = useAuthStore((s) => s.resendConfirmCode);

  const [code, setCode] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [cooldownSec, setCooldownSec] = useState(0);
  const inFlightRef = useRef(false);
  const autoSubmittedCodeRef = useRef<string | null>(null);
  const codeInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const timer = setTimeout(() => setCooldownSec((prev) => Math.max(0, prev - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldownSec]);

  const canSubmit = useMemo(() => {
    const c = String(code || '').trim();
    return c.length === OTP_SLOT_COUNT && !loading;
  }, [code, loading]);

  async function submitCode(rawCode: string) {
    const clean = String(rawCode || '').replace(/\s/g, '');
    if (clean.length < OTP_SLOT_COUNT || loading || inFlightRef.current) return;

    inFlightRef.current = true;
    setInlineError(null);
    setResendNotice(null);
    try {
      const outcome = await confirmSignUpCode(email, clean);
      // R24 M01: anonymous funnel step; both outcomes mean the account now exists.
      recordFunnelEvent('signup_completed');
      if (outcome === 'signed_in') {
        leaveAuthFlow(navigation as unknown as LeaveAuthNavigation);
        return;
      }
      Alert.alert('Verified', 'Your email is verified. Please sign in.', [
        { text: 'Continue', onPress: () => navigation.popTo('SignIn', { email }) },
      ]);
    } catch (e: any) {
      if (isAuthFlowError(e, 'ALREADY_CONFIRMED')) {
        Alert.alert('Already verified', e.message, [
          { text: 'Sign in', onPress: () => navigation.popTo('SignIn', { email }) },
        ]);
        return;
      }
      setInlineError(friendlyAuthError(e));
    } finally {
      inFlightRef.current = false;
    }
  }

  function handleCodeChange(raw: string) {
    const clean = String(raw || '').replace(/\D/g, '').slice(0, OTP_SLOT_COUNT);
    setCode(clean);
    if (inlineError) setInlineError(null);
    if (clean.length < OTP_SLOT_COUNT) {
      autoSubmittedCodeRef.current = null;
      return;
    }
    if (clean.length === OTP_SLOT_COUNT && autoSubmittedCodeRef.current !== clean) {
      autoSubmittedCodeRef.current = clean;
      void submitCode(clean);
    }
  }

  function onSubmitEditing() {
    const clean = String(code || '').replace(/\s/g, '');
    if (autoSubmittedCodeRef.current === clean) return;
    void submitCode(clean);
  }

  function onPressVerify() {
    const clean = String(code || '').replace(/\s/g, '');
    void submitCode(clean);
  }

  async function onResend() {
    if (cooldownSec > 0 || loading || inFlightRef.current) return;
    inFlightRef.current = true;
    setInlineError(null);
    setResendNotice(null);
    try {
      await resendConfirmCode(email);
      setCooldownSec(RESEND_COOLDOWN_SECONDS);
      setResendNotice('A new code has been sent to your email.');
    } catch (e: any) {
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
          <View style={styles.headerRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
              onPress={() => navigation.goBack()}
              disabled={loading}
            >
              <Text style={styles.backText}>← Back</Text>
            </Pressable>

            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Verify your email</Text>
              <Text style={styles.subtitle}>Code sent to {maskEmail(email)}.</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Confirmation code</Text>
            <Text style={styles.cardHint}>Use the latest code to finish protecting sync and recovery.</Text>

            {inlineError ? (
              <View style={styles.errorBanner} testID="confirm-error-banner" accessibilityRole="alert">
                <Text style={styles.errorBannerText}>{inlineError}</Text>
              </View>
            ) : null}

            {resendNotice ? (
              <View style={styles.noticeBanner} testID="confirm-resend-notice" accessibilityLiveRegion="polite">
                <Text style={styles.noticeBannerText}>{resendNotice}</Text>
              </View>
            ) : null}

            <Text style={styles.label}>6-digit verification code</Text>
            <Pressable accessible={false} testID="confirm-code-touch" onPress={() => codeInputRef.current?.focus()}>
            <OtpCodeSlots code={code}>
              <TextInput
                ref={codeInputRef}
                value={code}
                onChangeText={handleCodeChange}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                placeholder="123456"
                placeholderTextColor="transparent"
                caretHidden
                autoFocus
                style={styles.codeOverlayInput}
                editable={!loading}
                returnKeyType="done"
                onSubmitEditing={onSubmitEditing}
                maxLength={OTP_SLOT_COUNT}
              />
            </OtpCodeSlots>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primaryBtn,
                (!canSubmit || loading) && styles.disabled,
                pressed && canSubmit && styles.pressed,
              ]}
              disabled={!canSubmit || loading}
              onPress={onPressVerify}
            >
              {loading ? (
                <View style={styles.rowCenter}>
                  <ActivityIndicator color={colors.ink} />
                  <Text style={[styles.primaryText, { marginLeft: 8 }]}>Verifying…</Text>
                </View>
              ) : (
                <Text style={styles.primaryText}>Verify</Text>
              )}
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>Didn’t get it?</Text>
              <View style={styles.dividerLine} />
            </View>

            <Pressable
              testID="confirm-resend-code"
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.secondaryBtn,
                pressed && styles.pressed,
                (loading || cooldownSec > 0) && styles.disabled,
              ]}
              onPress={onResend}
              disabled={loading || cooldownSec > 0}
            >
              <Text style={styles.secondaryText}>
                {cooldownSec > 0 ? `Resend code in ${cooldownSec}s` : 'Resend code'}
              </Text>
            </Pressable>

            <Pressable
              testID="confirm-change-email"
              accessibilityRole="button"
              style={({ pressed }) => [styles.changeEmailLink, pressed && styles.pressed]}
              onPress={() => navigation.goBack()}
              disabled={loading}
            >
              <Text style={styles.changeEmailText}>Wrong email address? Go back</Text>
            </Pressable>

            <Text style={styles.footnote}>Only the latest code works. If you requested several, use the newest email.</Text>
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

  noticeBanner: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.pokeBlueFaint,
    borderWidth: 1,
    borderColor: 'rgba(44,156,192,0.35)',
  },
  noticeBannerText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.ink,
  },

  label: { marginTop: 14, fontSize: 12, fontWeight: '900', color: colors.inkSoft, letterSpacing: 0.4 },

  codeOverlayInput: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.02,
    color: colors.ink,
    fontSize: 18,
  },

  primaryBtn: {
    marginTop: 16,
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

  changeEmailLink: {
    marginTop: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changeEmailText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.inkSoft,
    textDecorationLine: 'underline',
  },

  footnote: { marginTop: 12, fontSize: 11, color: colors.inkSecondary, lineHeight: 16, fontWeight: '600' },
});
