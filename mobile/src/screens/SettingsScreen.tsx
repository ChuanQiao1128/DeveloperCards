import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { getCurrentAppVersion } from '../config/remoteConfig';
import { useFeatureFlags } from '../config/featureFlags';
import { isDebugMenuAvailable } from '../config/debugMenu';
import { useAuthStore } from '../auth/authStore';
import { SUPPORT_LINKS } from '../content/supportLinks';
import {
  DEFAULT_REMINDER_PREFS,
  getReminderPrefs,
  setReminderPrefs,
  refreshDailyRemindersFromCache,
  getNotificationPermissionState,
  requestNotificationPermission,
  type ReminderPrefs,
  type NotificationPermissionState,
} from '../notifications/reminders';
import { buildReminderPlanVM } from '../features/gacha/reminders/reminderPlanner';
import { loadStreakSnapshot, type StreakSnapshot } from '../features/gacha/streaks/streakTracker';
import type { AudiencePreference } from '../features/gacha/audience/audiencePrefs';
import {
  loadAudiencePreference,
  saveAudiencePreference,
} from '../features/gacha/settings/content/audienceActions';
import {
  confirmResetReviewSchedule,
  runResetReviewSchedule,
} from '../features/gacha/settings/account/accountActions';
import AccountSection from '../features/gacha/settings/account/AccountSection';
import ContentSection from '../features/gacha/settings/content/ContentSection';
import RemindersSection from '../features/gacha/settings/reminders/RemindersSection';
import { FeedbackSection } from '../features/gacha/settings/feedback/FeedbackSection';
import {
  getFeedbackPrefsSync,
  loadFeedbackPrefs,
  setFeedbackPref,
  type FeedbackPrefs,
} from '../features/gacha/settings/feedbackPrefs';
import { StudySection } from '../features/gacha/settings/study/StudySection';
import { goalDeckLabel } from '../features/gacha/settings/study/studyGoalEditor';
import { resetSingleDeckProgress } from '../features/gacha/deckReset';
import { loadCardLangPref, setCardLangPref, useCardLangPref } from '../features/gacha/study/cardLangPrefs';
import { getStudyGoal, type StudyGoal } from '../features/goal/studyGoal';
import { loadActiveDeckSlug } from '../content/activeDeck';
import {
  getStudyPrefsSync,
  loadStudyPrefs,
  setStudyPrefs,
  type StudyPrefs,
} from '../features/gacha/study/studyPrefs';
import { PrivacySection } from '../features/gacha/settings/privacy/PrivacySection';
import { DataResetsSection } from '../features/gacha/settings/data/DataResetsSection';
import {
  getPrivacyPrefsSync,
  loadPrivacyPrefs,
  setPrivacyPref,
  type PrivacyPrefs,
} from '../features/gacha/settings/privacyPrefs';
import { clearFunnelQueue } from '../telemetry/funnel';
import AboutSection from '../features/gacha/settings/about/AboutSection';
import DebugSection from '../features/gacha/settings/debug/DebugSection';
import { createDebugTapCounter } from '../features/gacha/settings/debug/debugTapCounter';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;
type SettingsLoadState = 'loading' | 'ready' | 'error';

const PREMIUM_COPY = {
  title: 'Premium',
  body: 'Unlock premium tracks and keep upgrades in one place.',
  action: 'Open premium',
} as const;

function normalizeUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url.trim()}`;
}

async function openExternalLink(url: string): Promise<void> {
  const safeUrl = normalizeUrl(url);
  try {
    const supported = await Linking.canOpenURL(safeUrl);
    if (!supported) {
      Alert.alert('Cannot open link', 'Please try again later.');
      return;
    }
    await Linking.openURL(safeUrl);
  } catch {
    Alert.alert('Cannot open link', 'Please try again later.');
  }
}

export function SettingsScreen({ navigation }: Props) {
  const appVersion = getCurrentAppVersion();
  const featureFlags = useFeatureFlags();
  const paywallHidden = featureFlags.paywall.hidden === true;

  const status = useAuthStore((state) => state.status);
  const authUserSub = useAuthStore((state) => state.userSub);
  const currentUserRef = useRef(authUserSub);
  currentUserRef.current = authUserSub;
  const authLoading = useAuthStore((state) => state.loading);
  const email = useAuthStore((state) => state.email);
  const signOutNow = useAuthStore((state) => state.signOutNow);
  const signedIn = status === 'signed_in';

  const [loadState, setLoadState] = useState<SettingsLoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [audience, setAudience] = useState<AudiencePreference>('both');
  const [audienceSaving, setAudienceSaving] = useState(false);
  const [reminderPrefs, setReminderPrefsState] = useState<ReminderPrefs>(DEFAULT_REMINDER_PREFS);
  const [reminderPermission, setReminderPermission] = useState<NotificationPermissionState | 'unknown'>('unknown');
  const [reminderBusy, setReminderBusy] = useState(false);
  const [streak, setStreak] = useState<StreakSnapshot | null>(null);
  const [streakOwner, setStreakOwner] = useState(authUserSub);
  const [resetting, setResetting] = useState(false);
  const [feedbackPrefs, setFeedbackPrefs] = useState<FeedbackPrefs>(() => getFeedbackPrefsSync());
  const [studyPrefs, setStudyPrefsState] = useState<StudyPrefs>(() => getStudyPrefsSync());
  const cardLang = useCardLangPref();
  const [privacyPrefs, setPrivacyPrefsState] = useState<PrivacyPrefs>(() => getPrivacyPrefsSync());
  const [studyGoal, setStudyGoalState] = useState<StudyGoal | null>(null);
  const [activeDeckSlug, setActiveDeckSlugState] = useState<string | null>(null);

  const hasLoadedRef = useRef(false);

  const reminderPlan = useMemo(() => buildReminderPlanVM(reminderPrefs), [reminderPrefs]);

  const refresh = useCallback(async () => {
    const owner = authUserSub;
    if (!hasLoadedRef.current) {
      setLoadState('loading');
      setLoadError(null);
    }
    try {
      const [nextAudience, nextPrefs, nextStreak, nextFeedback, nextStudy, nextPrivacy, nextGoal, nextActiveDeck] = await Promise.all([
        loadAudiencePreference(),
        getReminderPrefs(),
        loadStreakSnapshot(),
        loadFeedbackPrefs(),
        loadStudyPrefs(),
        loadPrivacyPrefs(),
        getStudyGoal(),
        loadActiveDeckSlug(),
        loadCardLangPref(),
      ]);

      if (currentUserRef.current !== owner) return;

      setStudyGoalState(nextGoal);
      setActiveDeckSlugState(nextActiveDeck);

      setFeedbackPrefs(nextFeedback);
      setPrivacyPrefsState(nextPrivacy);
      setStudyPrefsState(nextStudy);
      setAudience(nextAudience);
      setReminderPrefsState(nextPrefs ?? DEFAULT_REMINDER_PREFS);
      setStreak(nextStreak ?? null);
      setStreakOwner(owner);
      setLoadState('ready');
      hasLoadedRef.current = true;

      try {
        const permission = await getNotificationPermissionState();
        if (currentUserRef.current === owner) setReminderPermission(permission);
      } catch {
        if (currentUserRef.current === owner) setReminderPermission('undetermined');
      }
    } catch {
      if (currentUserRef.current !== owner) return;
      if (!hasLoadedRef.current) {
        setLoadError('Unable to load settings right now.');
        setLoadState('error');
      } else {
        console.warn('Settings background refresh failed; keeping current values.');
      }
    }
  }, [authUserSub]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const onSelectAudience = useCallback(async (next: AudiencePreference) => {
    if (audienceSaving || next === audience) return;

    setAudienceSaving(true);
    try {
      const saved = await saveAudiencePreference(next);
      setAudience(saved);
    } catch {
      Alert.alert('Update failed', 'Unable to update audience preference right now.');
    } finally {
      setAudienceSaving(false);
    }
  }, [audience, audienceSaving]);

  const onTurnOnReminders = useCallback(async () => {
    if (reminderBusy) return;
    setReminderBusy(true);
    try {
      const next = await requestNotificationPermission();
      setReminderPermission(next);
      if (next === 'granted') {
        await refreshDailyRemindersFromCache();
      }
    } finally {
      setReminderBusy(false);
    }
  }, [reminderBusy]);

  const onOpenReminderSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch {
      Alert.alert('Cannot open settings', 'Please open iOS Settings > DeveloperCards > Notifications.');
    }
  }, []);

  const applyReminderPatch = useCallback(async (patch: Partial<ReminderPrefs>) => {
    try {
      const saved = await setReminderPrefs(patch);
      setReminderPrefsState(saved);
      await refreshDailyRemindersFromCache();
    } catch {
      Alert.alert('Update failed', 'Unable to update reminders right now.');
    }
  }, []);

  const onToggleMorning = useCallback(
    (enabled: boolean) => {
      void applyReminderPatch({ morningEnabled: enabled });
    },
    [applyReminderPatch],
  );

  const onToggleEvening = useCallback(
    (enabled: boolean) => {
      void applyReminderPatch({ eveningEnabled: enabled });
    },
    [applyReminderPatch],
  );

  const onSelectMorningTime = useCallback(
    (time: string) => {
      void applyReminderPatch({ morningTime: time });
    },
    [applyReminderPatch],
  );

  const onSelectEveningTime = useCallback(
    (time: string) => {
      void applyReminderPatch({ eveningTime: time });
    },
    [applyReminderPatch],
  );

  const onResetReviewSchedule = useCallback(() => {
    void confirmResetReviewSchedule({
      onConfirm: async () => {
        setResetting(true);
        try {
          await runResetReviewSchedule(new Date());
          await refresh();
        } finally {
          setResetting(false);
        }
      },
    });
  }, [refresh]);

  const onToggleFeedback = useCallback((key: keyof FeedbackPrefs, value: boolean) => {
    setFeedbackPrefs((prev) => ({ ...prev, [key]: value }));
    void setFeedbackPref(key, value).then((saved) => setFeedbackPrefs(saved));
  }, []);

  const onToggleFourButtons = useCallback((value: boolean) => {
    setStudyPrefsState({ fourButtons: value });
    void setStudyPrefs({ fourButtons: value }).then((saved) => setStudyPrefsState(saved));
  }, []);

  const onToggleShareUsageCounts = useCallback((value: boolean) => {
    setPrivacyPrefsState({ shareUsageCounts: value });
    void setPrivacyPref('shareUsageCounts', value).then((saved) => setPrivacyPrefsState(saved));
    if (!value) clearFunnelQueue();
  }, []);

  const onSignIn = useCallback(() => {
    navigation.navigate('SignIn');
  }, [navigation]);

  const debugMenuAvailable = useMemo(() => isDebugMenuAvailable(), []);
  const debugTaps = useRef(createDebugTapCounter());
  const onVersionPress = useCallback(() => {
    if (debugTaps.current.tap()) navigation.navigate('DebugMenu');
  }, [navigation]);

  const activeDeckLabel = activeDeckSlug ? goalDeckLabel(activeDeckSlug) : null;

  const onResetDeckProgress = useCallback(() => {
    if (!activeDeckSlug) return;
    const label = goalDeckLabel(activeDeckSlug);
    Alert.alert(
      'Reset deck progress?',
      `This clears study progress, owned cards and daily stats for ${label} on this device. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await resetSingleDeckProgress(activeDeckSlug);
                Alert.alert('Progress reset', 'The active deck\u2019s progress on this device has been cleared.');
              } catch (e: any) {
                Alert.alert('Reset failed', e?.message ?? String(e));
              }
            })();
          },
        },
      ],
    );
  }, [activeDeckSlug]);

  const onSignOut = useCallback(async () => {
    await signOutNow();
    await refresh();
  }, [refresh, signOutNow]);

  const currentAccount = streakOwner === authUserSub;
  const momentumDays = currentAccount ? streak?.currentDailyStreak ?? 0 : '—';
  const totalSessions = currentAccount ? streak?.totalQualifiedSessions ?? 0 : '—';

  if (!hasLoadedRef.current && (authLoading || status === 'unknown' || loadState === 'loading')) {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-settings-root">
        <LinearGradient
          colors={[colors.parchmentBg, colors.parchmentBgDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={colors.gold} />
            <Text style={styles.loadingText} numberOfLines={1}>
              Loading settings...
            </Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (loadState === 'error') {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-settings-root">
        <LinearGradient
          colors={[colors.parchmentBg, colors.parchmentBgDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.centerState}>
            <Text style={styles.errorTitle} numberOfLines={2}>
              Settings unavailable
            </Text>
            <Text style={styles.errorBody} numberOfLines={2}>
              {loadError ?? 'Unable to load settings right now.'}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              onPress={() => void refresh()}
              testID="screen-settings-primary-cta"
            >
              <Text style={styles.retryText} numberOfLines={1}>
                Retry
              </Text>
            </Pressable>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} testID="screen-settings-root">
      <LinearGradient
        colors={[colors.parchmentBg, colors.parchmentBgDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.headerBar}>
          <View style={styles.headerRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backText} numberOfLines={1}>
                ← Back
              </Text>
            </Pressable>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.eyebrow} numberOfLines={1}>
                Settings
              </Text>
            </View>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

          {/* Group 1: Account & Subscription */}
          <Text style={styles.groupHeading}>Account & subscription</Text>
          <View style={styles.insetGroupCard}>
            <AccountSection
              signedIn={signedIn}
              email={email}
              onSignIn={onSignIn}
              onSignOut={() => void onSignOut()}
              primaryCtaTestID="screen-settings-primary-cta"
              syncSummary={{
                sessionsLine: `${momentumDays} days streak · ${totalSessions} sessions that counted`,
                reminderLine: reminderPlan.statusLine,
              }}
              style={styles.groupedSection}
            />
            {paywallHidden ? null : (
              <>
                <View style={styles.groupDivider} />
                <View style={styles.groupedSection}>
                  <Text style={styles.sectionTitle} numberOfLines={1}>
                    {PREMIUM_COPY.title}
                  </Text>
                  <Text style={styles.sectionBody}>
                    {PREMIUM_COPY.body}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                    onPress={() => navigation.navigate('Paywall')}
                  >
                    <Text style={styles.secondaryButtonText} numberOfLines={1}>
                      {PREMIUM_COPY.action}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>

          {/* Group 2: Study Preferences */}
          <Text style={styles.groupHeading}>Study preferences</Text>
          <View style={styles.insetGroupCard}>
            <StudySection
              prefs={studyPrefs}
              onToggleFourButtons={onToggleFourButtons}
              goal={{ value: studyGoal, fallbackDeckSlug: activeDeckSlug, onSaved: setStudyGoalState }}
              cardLang={{ value: cardLang, onSelect: (next) => void setCardLangPref(next) }}
              style={styles.groupedSection}
            />
            <View style={styles.groupDivider} />
            <ContentSection
              audience={audience}
              saving={audienceSaving}
              onSelect={(next) => void onSelectAudience(next)}
              style={styles.groupedSection}
            />
          </View>

          {/* Group 3: Reminders & Audio */}
          <Text style={styles.groupHeading}>Reminders & audio</Text>
          <View style={styles.insetGroupCard}>
            <RemindersSection
              permission={reminderPermission}
              prefs={reminderPrefs}
              busy={reminderBusy}
              onTurnOn={() => void onTurnOnReminders()}
              onOpenSettings={() => void onOpenReminderSettings()}
              onToggleMorning={onToggleMorning}
              onToggleEvening={onToggleEvening}
              onSelectMorningTime={onSelectMorningTime}
              onSelectEveningTime={onSelectEveningTime}
              style={styles.groupedSection}
            />
            <View style={styles.groupDivider} />
            <FeedbackSection prefs={feedbackPrefs} onToggle={onToggleFeedback} style={styles.groupedSection} />
          </View>

          {/* Group 4: Privacy & Data Resets */}
          <Text style={styles.groupHeading}>Privacy & data resets</Text>
          <View style={styles.insetGroupCard}>
            <PrivacySection prefs={privacyPrefs} onToggleShare={onToggleShareUsageCounts} style={styles.groupedSection} />
            <View style={styles.groupDivider} />
            <DataResetsSection
              resettingSchedule={resetting}
              onResetReviewSchedule={onResetReviewSchedule}
              hasActiveDeck={activeDeckSlug !== null}
              activeDeckLabel={activeDeckLabel}
              onResetDeckProgress={activeDeckSlug ? onResetDeckProgress : undefined}
              style={styles.groupedSection}
            />
          </View>

          {/* About / Support Footer */}
          <AboutSection
            appVersion={appVersion}
            onSupport={() => void openExternalLink(SUPPORT_LINKS.support)}
            onPrivacy={() => void openExternalLink(SUPPORT_LINKS.privacy)}
            onVersionPress={debugMenuAvailable ? onVersionPress : undefined}
          />

          {__DEV__ ? <DebugSection onOpenDebug={() => navigation.navigate('DebugMenu')} /> : null}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default SettingsScreen;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.parchmentBg,
  },
  gradient: {
    flex: 1,
  },
  headerBar: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  container: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: 4,
    paddingBottom: spacing.xl,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.sm,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
  },
  errorTitle: {
    fontSize: typography.title3,
    color: colors.ink,
    fontWeight: '800',
    textAlign: 'center',
  },
  errorBody: {
    marginTop: spacing.xs,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.sm,
    minHeight: 44,
    borderRadius: 999,
    backgroundColor: colors.pokeBlue,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  retryText: {
    color: colors.ink,
    fontSize: typography.button,
    fontWeight: '900',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  backButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    backgroundColor: colors.softCream,
    borderWidth: 1,
    borderColor: colors.hairline,
    justifyContent: 'center',
    marginRight: 12,
  },
  backText: {
    fontSize: typography.bodySmall,
    color: colors.inkSoft,
    fontWeight: '800',
  },
  headerTitleWrap: {
    flex: 1,
  },
  eyebrow: {
    fontSize: typography.title2,
    color: colors.ink,
    fontWeight: '900',
  },
  insetGroupCard: {
    borderRadius: 24,
    backgroundColor: colors.softCream,
    borderWidth: 1,
    borderColor: colors.hairline,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    overflow: 'hidden',
  },
  groupedSection: {
    marginTop: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderRadius: 0,
    padding: spacing.md,
  },
  groupDivider: {
    height: 1,
    backgroundColor: colors.hairline,
    marginHorizontal: spacing.md,
  },
  groupHeading: {
    marginTop: spacing.md,
    marginBottom: 4,
    paddingHorizontal: 4,
    fontSize: typography.caption,
    fontWeight: '900',
    color: colors.inkSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1.0,
  },
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
  metaText: {
    marginTop: spacing.xs,
    fontSize: typography.caption,
    color: colors.inkSecondary,
    lineHeight: 17,
  },
  secondaryButton: {
    marginTop: spacing.sm,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: typography.button,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.9,
  },
});
