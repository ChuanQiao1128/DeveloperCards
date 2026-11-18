import React, { useMemo, useRef, useState } from 'react';
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
import { friendlyAuthError } from '../auth/authErrors';
import { OTP_SLOT_COUNT, OtpCodeSlots } from '../auth/components/OtpCodeSlots';
import { EMAIL_FORMAT_HINT, isValidEmail, normEmail } from '../auth/emailPolicy';
import { evaluatePassword, isPasswordValid } from '../auth/passwordPolicy';
import { colors } from '../theme/colors';
import { useResendCooldown } from '../auth/useResendCooldown';
import { leaveAuthFlow, type LeaveAuthNavigation } from '../auth/leaveAuthFlow';

type Props = NativeStackScreenProps<RootStackParamList, 'ForgotPassword'>;

const PASSWORD_RULES_ATTR =
  'minlength: 8; required: lower; required: upper; required: digit; required: special;';

export default function ForgotPasswordScreen({ navigation, route }: Props) {
  const loading = useAuthStore((s) => s.loading);
  const requestPasswordReset = useAuthStore((s) => s.requestPasswordReset);
  const confirmPasswordReset = useAuthStore((s) => s.confirmPasswordReset);
  const completeNewPasswordSignIn = useAuthStore((s) => s.completeNewPasswordSignIn);
  const isNewPasswordChallenge = route.params?.mode === 'new_password';

  const [step, setStep] = useState<'request' | 'confirm'>(isNewPasswordChallenge ? 'confirm' : 'request');
  const [email, setEmail] = useState(route.params?.email ?? '');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [emailBlurred, setEmailBlurred] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const { cooldownSec, startCooldown } = useResendCooldown();
  const inFlightRef = useRef(false);
  const codeInputRef = useRef<TextInput>(null);
  const newPasswordRef = useRef<TextInput>(null);

  const passwordRules = useMemo(() => evaluatePassword(newPassword), [newPassword]);
  const emailInvalid = emailBlurred && normEmail(email).length > 0 && !isValidEmail(email);

  const canSend = useMemo(
    () => isValidEmail(email) && !loading && (normEmail(email) !== sentEmail || cooldownSec === 0),
    [email, loading, sentEmail, cooldownSec],
  );

  const canConfirm = useMemo(
    () => (isNewPasswordChallenge || String(code || '').trim().length === OTP_SLOT_COUNT) && isPasswordValid(newPassword) && !loading,
    [code, newPassword, loading, isNewPasswordChallenge],
  );

  async function onSend() {
    if (inFlightRef.current) return;
    if (!canSend) {
      if (normEmail(email).length > 0 && !isValidEmail(email)) {
        setEmailBlurred(true);
      }
      return;
    }
    inFlightRef.current = true;
    setInlineError(null);
    try {
      await requestPasswordReset(email);
      setSentEmail(normEmail(email));
      startCooldown();
      setCode('');
      setNewPassword('');
      setResendNotice(null);
      setStep('confirm');
    } catch (e: any) {
      const friendly = friendlyAuthError(e);
      setInlineError(friendly);
    } finally {
      inFlightRef.current = false;
    }
  }

  async function onResend() {
    if (cooldownSec > 0 || loading || inFlightRef.current) return;
    inFlightRef.current = true;
    setInlineError(null);
    setResendNotice(null);
    try {
      await requestPasswordReset(email);
      startCooldown();
      setCode('');
      setResendNotice('If an account uses this email, a new reset code has been sent.');
    } catch (e: any) {
      const friendly = friendlyAuthError(e);
      setInlineError(friendly);
    } finally {
      inFlightRef.current = false;
    }
  }

  async function onConfirm() {
    if (!canConfirm || inFlightRef.current) return;
    const e = normEmail(email);
    inFlightRef.current = true;
    setInlineError(null);
    try {
      if (isNewPasswordChallenge) {
        if (await completeNewPasswordSignIn(newPassword)) {
          leaveAuthFlow(navigation as unknown as LeaveAuthNavigation);
        }
        return;
      }
      await confirmPasswordReset(e, code, newPassword);
      navigation.popTo('SignIn', { email: e, notice: 'password_reset', noticeAt: Date.now() });
    } catch (err: any) {
      const friendly = friendlyAuthError(err);
      setInlineError(friendly);
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
              <Text style={styles.title}>{isNewPasswordChallenge ? 'Choose a new password' : 'Reset password'}</Text>
              <Text style={styles.subtitle}>
                {isNewPasswordChallenge ? 'Set a new password to finish signing in.' : 'Use an email code to set a new password.'}
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            {inlineError ? (
              <View style={styles.errorBanner} testID="forgot-error-banner" accessibilityRole="alert">
                <Text style={styles.errorBannerText}>{inlineError}</Text>
              </View>
            ) : null}

            {step === 'request' ? (
              <>
                <Text style={styles.cardHint}>
                  Enter your account email. We’ll send a code if an account uses this address.
                </Text>

                <Text style={styles.label}>Email</Text>
                <View style={[styles.inputWrap, emailInvalid && styles.inputWrapError]}>
                  <TextInput
                    accessibilityLabel="Email"
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
                    returnKeyType="done"
                    onSubmitEditing={onSend}
                  />
                </View>
                {emailInvalid ? (
                  <Text style={styles.fieldError} testID="forgot-email-hint" accessibilityRole="alert">
                    {EMAIL_FORMAT_HINT}
                  </Text>
                ) : null}

                <Pressable
                  testID="forgot-send-code"
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    (!canSend || loading) && styles.disabled,
                    pressed && canSend && styles.pressed,
                  ]}
                  disabled={!canSend || loading}
                  onPress={onSend}
                >
                  {loading ? (
                    <View style={styles.rowCenter}>
                      <ActivityIndicator color={colors.ink} />
                      <Text style={[styles.primaryText, { marginLeft: 8 }]}>Sending…</Text>
                    </View>
                  ) : (
                    <Text style={styles.primaryText}>{cooldownSec > 0 && normEmail(email) === sentEmail ? `Send code in ${cooldownSec}s` : 'Send reset code'}</Text>
                  )}
                </Pressable>

              </>
            ) : (
              <>
                <Text style={styles.cardHint}>
                  {isNewPasswordChallenge
                    ? `Choose a new password for ${email}.`
                    : `If an account uses ${sentEmail ?? normEmail(email)}, a reset code has been sent. Check your spam folder too.`}
                </Text>

                {resendNotice ? <Text accessibilityLiveRegion="polite" testID="forgot-resend-notice" style={styles.cardHint}>{resendNotice}</Text> : null}

                {!isNewPasswordChallenge ? <>
                <Text style={styles.label}>Code</Text>
                <Pressable accessible={false} testID="forgot-code-touch" onPress={() => codeInputRef.current?.focus()}>
                <OtpCodeSlots code={code}>
                  <TextInput
                    accessibilityLabel="6-digit password reset code"
                    ref={codeInputRef}
                    testID="forgot-code-input"
                    value={code}
                    onChangeText={(v) => {
                      const clean = v.replace(/\D/g, '').slice(0, OTP_SLOT_COUNT);
                      setCode(clean);
                      if (inlineError) setInlineError(null);
                      if (clean.length === OTP_SLOT_COUNT) {
                        newPasswordRef.current?.focus();
                      }
                    }}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    placeholderTextColor="transparent"
                    caretHidden
                    autoFocus
                    style={styles.codeOverlayInput}
                    editable={!loading}
                    returnKeyType="next"
                    maxLength={OTP_SLOT_COUNT}
                  />
                </OtpCodeSlots>
                </Pressable>
                </> : null}

                <Text style={[styles.label, { marginTop: 12 }]}>New password</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    accessibilityLabel="New password"
                    ref={newPasswordRef}
                    testID="forgot-new-password-input"
                    value={newPassword}
                    onChangeText={(v) => {
                      setNewPassword(v);
                      if (inlineError) setInlineError(null);
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry={!showPwd}
                    textContentType="newPassword"
                    autoComplete="new-password"
                    passwordRules={PASSWORD_RULES_ATTR}
                    placeholder="Create a new password"
                    placeholderTextColor={colors.inkSecondary}
                    style={styles.input}
                    editable={!loading}
                    returnKeyType="done"
                    onSubmitEditing={onConfirm}
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

                <View style={styles.checklist}>
                  {passwordRules.map((rule) => (
                    <View
                      key={rule.id}
                      style={[styles.ruleChip, rule.ok && styles.ruleChipOk]}
                    >
                      <Text
                        testID={`forgot-password-rule-${rule.id}`}
                        style={[styles.checklistItem, rule.ok && styles.checklistItemOk]}
                      >
                        {(rule.ok ? '✓' : '•') + ' ' + rule.label}
                      </Text>
                    </View>
                  ))}
                </View>

                <Pressable
                  testID="forgot-confirm"
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    (!canConfirm || loading) && styles.disabled,
                    pressed && canConfirm && styles.pressed,
                  ]}
                  disabled={!canConfirm || loading}
                  onPress={onConfirm}
                >
                  {loading ? (
                    <View style={styles.rowCenter}>
                      <ActivityIndicator color={colors.ink} />
                      <Text style={[styles.primaryText, { marginLeft: 8 }]}>Saving…</Text>
                    </View>
                  ) : (
                    <Text style={styles.primaryText}>{isNewPasswordChallenge ? 'Set password and sign in' : 'Set new password'}</Text>
                  )}
                </Pressable>

                {!isNewPasswordChallenge ? <>
                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>Didn’t get it?</Text>
                  <View style={styles.dividerLine} />
                </View>

                <Pressable
                  testID="forgot-resend"
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
                  testID="forgot-change-email"
                  accessibilityRole="button"
                  disabled={loading}
                  style={styles.changeEmailLink}
                  onPress={() => {
                    setStep('request');
                    setCode('');
                    setNewPassword('');
                    setShowPwd(false);
                    setInlineError(null);
                    setResendNotice(null);
                  }}
                >
                  <Text style={styles.secondaryText}>Change email address</Text>
                </Pressable>
                </> : null}
              </>
            )}
          </View>

          <View style={{ height: 28 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  changeEmailLink: { minHeight: 44, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
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
    marginTop: 4,
    marginBottom: 8,
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

  codeOverlayInput: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.02,
    color: colors.ink,
    fontSize: 18,
  },

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

  checklist: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 6,
  },
  ruleChip: {
    width: '48.5%',
    minHeight: 30,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: colors.parchmentBg,
    borderWidth: 1,
    borderColor: colors.hairline,
    justifyContent: 'center',
  },
  ruleChipOk: {
    backgroundColor: colors.pokeBlueFaint,
    borderColor: 'rgba(44,156,192,0.35)',
  },
  checklistItem: { fontSize: 11, color: colors.inkSecondary, fontWeight: '700' },
  checklistItemOk: { color: colors.ink, fontWeight: '800' },

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

  footnote: { marginTop: 12, fontSize: 11, color: colors.inkSecondary, lineHeight: 16, fontWeight: '600' },
});
