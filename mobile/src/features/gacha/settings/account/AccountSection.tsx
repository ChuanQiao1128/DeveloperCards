import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';
import { AccountDeletionError } from '../../../../auth/deleteServerAccount';

export const ACCOUNT_COPY = {
  title: 'Account',
  body: 'Manage sign-in and keep your progress tied to this account.',
  signedOutState: 'Signed out · Local progress only',
  signedInState: (email: string) => `Signed in as ${email}`,
  signIn: 'Sign in',
  signOut: 'Sign out',
  deleteTitle: 'Delete account',
  deleteBody:
    'Permanently deletes your account and the progress, cards and saved draws stored for it on our servers and on this device. This cannot be undone.',
  subscriptionNotice:
    'Deleting your account does not cancel an App Store subscription. Cancel it first in iOS Settings > Apple Account > Subscriptions.',
  deleteOpen: 'Delete account…',
  deleteConfirmPrompt: 'Type DELETE to confirm',
  deleteConfirmCta: 'Delete my account',
  deleteCancel: 'Keep my account',
  deleting: 'Deleting...',
  deletionPending: 'Account deletion is in progress. Sync is paused. Continue deleting your account or sign out.',
  continueDeletion: 'Continue account deletion',
  pendingExit: 'If your sign-in is no longer available, sign out to clear this account’s saved data from this device once server deletion is confirmed.',
  deleteError: 'Could not delete your account. Check your connection and try again.',
  retry: 'Try again',
  deletedNotice: 'Your account was deleted and you are signed out.',
} as const;

export const DELETE_CONFIRM_TOKEN = 'DELETE';

export function AccountSection(props: {
  signedIn: boolean;
  deletionPending?: boolean;
  email: string | null;
  onSignIn: () => void;
  onSignOut: () => void;
  primaryCtaTestID?: string;
  syncSummary?: {
    sessionsLine: string;
    reminderLine: string;
  };
  style?: any;
}) {
  const {
    signedIn,
    deletionPending = false,
    email,
    onSignIn,
    onSignOut,
    primaryCtaTestID,
    syncSummary,
  } = props;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  const armed = confirmText.trim() === DELETE_CONFIRM_TOKEN;

  async function onConfirmDelete() {
    if (deleting || (!deletionPending && confirmText.trim() !== DELETE_CONFIRM_TOKEN)) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const { useAuthStore } = await import('../../../../auth/authStore');
      await useAuthStore.getState().deleteAccountNow();
      setDeleted(true);
      setConfirmOpen(false);
      setConfirmText('');
    } catch (e) {
      setDeleteError(e instanceof AccountDeletionError ? e.message : ACCOUNT_COPY.deleteError);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <View style={[styles.sectionCard, props.style]}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {ACCOUNT_COPY.title}
      </Text>
      <Text style={styles.sectionBody}>
        {ACCOUNT_COPY.body}
      </Text>

      <View style={styles.statusPill}>
        <View style={[styles.statusDot, signedIn ? styles.statusDotSignedIn : styles.statusDotSignedOut]} />
        <Text style={styles.metaText}>
          {signedIn ? ACCOUNT_COPY.signedInState(email ?? 'your account') : ACCOUNT_COPY.signedOutState}
        </Text>
      </View>

      {syncSummary && !deletionPending ? (
        <View style={styles.syncSummaryBox} testID="settings-account-sync-summary">
          <Text style={styles.syncSummaryLine}>{syncSummary.sessionsLine}</Text>
          <Text style={styles.syncSummaryMeta}>{syncSummary.reminderLine}</Text>
        </View>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          signedIn ? styles.secondaryButton : styles.signInButton,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        onPress={signedIn ? onSignOut : onSignIn}
        testID={primaryCtaTestID}
      >
        <Text
          style={signedIn ? styles.secondaryButtonText : styles.signInButtonText}
          numberOfLines={1}
        >
          {signedIn ? ACCOUNT_COPY.signOut : ACCOUNT_COPY.signIn}
        </Text>
      </Pressable>

      {deleted || signedIn ? <View style={styles.rule} /> : null}

      {deleted ? (
        <Text style={styles.noticeText}>{ACCOUNT_COPY.deletedNotice}</Text>
      ) : deletionPending ? (
        <>
          <Text style={styles.sectionBody} testID="settings-deletion-pending">{ACCOUNT_COPY.deletionPending}</Text>
          <Text style={styles.sectionBody}>{ACCOUNT_COPY.pendingExit}</Text>
          <Pressable
            style={styles.dangerButton}
            accessibilityRole="button"
            onPress={onConfirmDelete}
            disabled={deleting}
            testID="settings-delete-account-retry"
          >
            <Text style={styles.dangerButtonText}>{deleting ? ACCOUNT_COPY.deleting : ACCOUNT_COPY.continueDeletion}</Text>
          </Pressable>
          {deleteError ? <Text style={styles.errorText}>{deleteError}</Text> : null}
        </>
      ) : signedIn && !confirmOpen ? (
        <View style={styles.collapsedDeleteRow}>
          <Text style={styles.collapsedDeleteLabel} numberOfLines={1}>
            {ACCOUNT_COPY.deleteTitle}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.dangerGhostButton, pressed && styles.pressed]}
            accessibilityRole="button"
            onPress={() => setConfirmOpen(true)}
            testID="settings-delete-account-open"
          >
            <Text style={styles.dangerGhostButtonText} numberOfLines={1}>
              {ACCOUNT_COPY.deleteOpen}
            </Text>
          </Pressable>
        </View>
      ) : signedIn && confirmOpen ? (
        <>
          <Text style={styles.sectionTitle} numberOfLines={1}>
            {ACCOUNT_COPY.deleteTitle}
          </Text>
          <Text style={styles.sectionBody}>{ACCOUNT_COPY.deleteBody}</Text>
          <Text
            style={styles.sectionBody}
            testID="settings-delete-account-subscription-notice"
          >
            {ACCOUNT_COPY.subscriptionNotice}
          </Text>
          <Text style={styles.confirmPrompt}>{ACCOUNT_COPY.deleteConfirmPrompt}</Text>
          <TextInput
            testID="settings-delete-account-input"
            style={styles.confirmInput}
            value={confirmText}
            onChangeText={setConfirmText}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={DELETE_CONFIRM_TOKEN}
            editable={!deleting}
          />
          <Pressable
            style={({ pressed }) => [
              styles.dangerButton,
              (!armed || deleting) && styles.disabledButton,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            onPress={onConfirmDelete}
            disabled={!armed || deleting}
            testID="settings-delete-account-confirm"
          >
            <Text style={styles.dangerButtonText} numberOfLines={1}>
              {deleting ? ACCOUNT_COPY.deleting : ACCOUNT_COPY.deleteConfirmCta}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            onPress={() => {
              setConfirmOpen(false);
              setConfirmText('');
              setDeleteError(null);
            }}
            accessibilityRole="button"
            disabled={deleting}
            testID="settings-delete-account-cancel"
          >
            <Text style={styles.secondaryButtonText} numberOfLines={1}>
              {ACCOUNT_COPY.deleteCancel}
            </Text>
          </Pressable>
          {deleteError !== null ? (
            <>
              <Text style={styles.errorText}>{deleteError}</Text>
              <Pressable
                style={({ pressed }) => [
                  styles.secondaryButton,
                  deleting && styles.disabledButton,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                onPress={onConfirmDelete}
                disabled={deleting}
                testID="settings-delete-account-retry"
              >
                <Text style={styles.secondaryButtonText} numberOfLines={1}>
                  {ACCOUNT_COPY.retry}
                </Text>
              </Pressable>
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

export default AccountSection;

const styles = StyleSheet.create({
  sectionCard: {
    marginTop: spacing.sm,
    borderRadius: spacing.cardRadius,
    padding: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.12)',
  },
  sectionTitle: {
    fontSize: typography.body,
    fontWeight: '800',
    color: colors.ink,
  },
  sectionBody: {
    marginTop: 4,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
  },
  statusPill: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  statusDotSignedIn: {
    backgroundColor: colors.mint,
  },
  statusDotSignedOut: {
    backgroundColor: colors.gold,
  },
  metaText: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.inkSecondary,
  },
  syncSummaryBox: {
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: 'rgba(42,34,24,0.08)',
  },
  syncSummaryLine: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.inkSoft,
  },
  syncSummaryMeta: {
    marginTop: 2,
    fontSize: typography.caption,
    color: colors.inkSecondary,
    lineHeight: 17,
  },
  signInButton: {
    marginTop: spacing.sm,
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: colors.pokeBlue,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  signInButtonText: {
    fontSize: typography.button,
    fontWeight: '900',
    color: colors.ink,
  },
  secondaryButton: {
    marginTop: spacing.sm,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  secondaryButtonText: {
    fontSize: typography.button,
    fontWeight: '700',
    color: colors.ink,
  },
  rule: {
    marginVertical: spacing.sm,
    height: 1,
    backgroundColor: 'rgba(42,34,24,0.12)',
  },
  collapsedDeleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  collapsedDeleteLabel: {
    fontSize: typography.bodySmall,
    fontWeight: '700',
    color: colors.inkSecondary,
  },
  dangerGhostButton: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(180,35,24,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerGhostButtonText: {
    fontSize: typography.caption,
    fontWeight: '800',
    color: '#B42318',
  },
  confirmPrompt: {
    marginTop: spacing.xs,
    fontSize: typography.caption,
    fontWeight: '800',
    color: colors.ink,
  },
  dangerButton: {
    marginTop: spacing.sm,
    minHeight: 44,
    borderRadius: 999,
    backgroundColor: '#B42318',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerButtonText: {
    fontSize: typography.button,
    fontWeight: '800',
    color: colors.parchmentBg,
  },
  disabledButton: {
    opacity: 0.45,
  },
  confirmInput: {
    marginTop: spacing.sm,
    minHeight: 44,
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.18)',
    borderRadius: spacing.buttonRadius,
    paddingHorizontal: spacing.sm,
    fontSize: typography.body,
    color: colors.ink,
    backgroundColor: '#FFFFFF',
  },
  errorText: {
    marginTop: spacing.xs,
    fontSize: typography.caption,
    color: '#B42318',
  },
  noticeText: {
    marginTop: spacing.xs,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
  },
  pressed: {
    opacity: 0.9,
  },
});
