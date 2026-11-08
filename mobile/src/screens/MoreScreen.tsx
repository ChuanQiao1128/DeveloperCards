import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import {
  getAuthIdentitySnapshot,
  subscribeAuthIdentitySnapshot,
  type AuthIdentitySnapshot,
} from '../auth/sessionBoundary';
import { SUPPORT_LINKS } from '../content/supportLinks';
import { loadStreakSnapshot, type StreakSnapshot } from '../features/gacha/streaks/streakTracker';
import { listDrawStateSlugs, loadDrawState } from '../features/gacha/draw/drawStateStore';
import {
  describeGoalDate,
  goalDeckLabel,
} from '../features/gacha/settings/study/studyGoalEditor';
import { resolveDomainProgressSlug } from '../features/domains/domainProgressDeck';
import appJson from '../../app.json';
import { useFeatureFlags } from '../config/featureFlags';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

type Props = NativeStackScreenProps<RootStackParamList, 'More'>;

export const MORE_LINKS = {
  support: SUPPORT_LINKS.support,
  privacy: SUPPORT_LINKS.privacy,
} as const;

export const MORE_BYLINE = 'Made by Time Awake in Auckland';

export function MoreScreen({ navigation }: Props) {
  const [snapshot, setSnapshot] = useState<StreakSnapshot | null>(null);
  const [collected, setCollected] = useState<number | null>(null);
  const [domainsSlug, setDomainsSlug] = useState<string | null>(null);
  const [goalLine, setGoalLine] = useState<string>('Study goal: Not set');
  const [mistakeCount, setMistakeCount] = useState<number>(0);
  const [auth, setAuth] = useState<AuthIdentitySnapshot>(() => getAuthIdentitySnapshot());

  // Read defensively: some suites mock the flags without the mistakeBook key.
  const flags = useFeatureFlags();
  const showMistakeBook = flags.mistakeBook?.enabled !== false;
  // V11: default-off, so only an explicit true shows the row.
  const showReports = flags.cardReport?.enabled === true;

  useEffect(() => {
    setAuth(getAuthIdentitySnapshot());
    return subscribeAuthIdentitySnapshot(setAuth);
  }, []);

  // Load stats once at mount and again on every focus. Once tab hops reuse the
  // mounted More (pop-navigation, MSHELL-01), a mount-only effect would leave
  // the streak/collection numbers stale after a review or a draw.
  useEffect(() => {
    let cancelled = false;
    const loadDomainsSlug = async () => {
      const slug = await resolveDomainProgressSlug();
      if (!cancelled) setDomainsSlug(slug);
    };
    const loadExtraContext = async () => {
      try {
        const { getStudyGoal } = await import('../features/goal/studyGoal');
        const goal = await getStudyGoal();
        if (!cancelled) {
          setGoalLine(
            goal
              ? `Goal: ${goalDeckLabel(goal.deckSlug)} · ${describeGoalDate(goal.examDate, Date.now())}`
              : 'Study goal: Not set',
          );
        }
      } catch {
        if (!cancelled) setGoalLine('Study goal: Not set');
      }
      try {
        const { activeMistakes, loadMistakeBook } = await import('../features/gacha/mistakes/mistakeBook');
        const book = await loadMistakeBook();
        const count = activeMistakes(book, { now: Date.now() }).length;
        if (!cancelled) setMistakeCount(count);
      } catch {
        if (!cancelled) setMistakeCount(0);
      }
      try {
        const { getIsPremiumUser } = await import('../premium/premiumStore');
        const isPrem = await getIsPremiumUser();
        if (!cancelled && typeof isPrem === 'boolean') {
          setAuth((prev) => (prev.isPremium === isPrem ? prev : { ...prev, isPremium: isPrem }));
        }
      } catch {
        // ignore in test environments
      }
    };
    const load = async () => {
      void loadDomainsSlug();
      void loadExtraContext();
      const [loadedSnapshot, collectedCount] = await Promise.all([
        loadStreakSnapshot(),
        (async () => {
          try {
            const slugs = await listDrawStateSlugs();
            const records = await Promise.all(slugs.map(loadDrawState));
            return records.reduce((sum, record) => sum + record.owned.length, 0);
          } catch {
            return 0;
          }
        })(),
      ]);
      if (cancelled) return;
      setSnapshot(loadedSnapshot);
      setCollected(collectedCount);
    };
    void load();
    const unsubscribe = navigation.addListener?.('focus', () => {
      setAuth(getAuthIdentitySnapshot());
      void load();
    });
    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [navigation]);

  // An em dash while the reads are in flight, never a fake number.
  const dayStreak = snapshot === null ? '—' : String(snapshot.currentDailyStreak);
  const cardsCollected = collected === null ? '—' : String(collected);
  const signedIn = auth.status === 'signed_in';
  const weekSummaryLine =
    snapshot === null
      ? 'Reading weekly streak'
      : `${snapshot.weekCompletedDays} of 7 days this week · Best streak ${snapshot.longestDailyStreak}`;
  const mistakeSummaryLine =
    mistakeCount > 0
      ? `${mistakeCount} ${mistakeCount === 1 ? 'card' : 'cards'} active in Mistake Book`
      : 'Mistake Book clear';

  const openLink = (url: string) => {
    void Linking.openURL(url).catch(() => undefined);
  };

  return (
    <AppInfoScreen
      eyebrow="Me"
      title="Your profile and support"
      body="Your streak and collection at a glance, plus settings, help, privacy and a way to reach me."
      stats={[
        {
          label: 'Day streak',
          value: dayStreak,
          sublabel:
            snapshot === null
              ? undefined
              : `This week: ${snapshot.weekCompletedDays}/7 days · Best: ${snapshot.longestDailyStreak}`,
        },
        {
          label: 'Cards collected',
          value: cardsCollected,
          sublabel: collected === null ? undefined : 'Active collection',
        },
      ]}
      footer={
        <View>
          <View style={styles.accountCard} testID="more-account-card">
            <View style={styles.accountHeader}>
              <View style={styles.statusGroup}>
                <View style={[styles.statusDot, signedIn ? styles.statusDotOnline : styles.statusDotGuest]} />
                <Text style={styles.accountBadgeText}>
                  {signedIn ? 'Cloud sync active' : auth.sessionExpired ? 'Session expired' : 'Local guest mode'}
                </Text>
              </View>
              <View style={[styles.planBadge, auth.isPremium && styles.planBadgePremium]}>
                <Text style={styles.planBadgeText} testID="more-plan-badge">
                  {auth.isPremium ? 'Premium active' : 'Free tier'}
                </Text>
              </View>
            </View>
            <Text style={styles.accountTitle}>
              {signedIn ? `Signed in as ${auth.email ?? 'your account'}` : 'Back up your study progress'}
            </Text>
            <Text style={styles.accountSubtitle}>
              {signedIn
                ? 'Your streak, review schedule and collected cards sync across your devices.'
                : 'Sign in with email to keep your streak and collected cards safe across devices.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              testID="more-account-cta"
              style={({ pressed }) => [
                signedIn ? styles.accountSecondaryBtn : styles.accountPrimaryBtn,
                pressed && styles.pressed,
              ]}
              onPress={() => navigation.navigate(signedIn ? 'Settings' : 'SignIn')}
            >
              <Text style={signedIn ? styles.accountSecondaryBtnText : styles.accountPrimaryBtnText}>
                {signedIn ? 'Account & sync' : 'Sign in or create account'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.snapshotCard} testID="more-study-snapshot">
            <Text style={styles.snapshotTitle} testID="more-week-summary">
              {weekSummaryLine}
            </Text>
            <Text style={styles.snapshotMeta} testID="more-goal-summary">
              {goalLine}
            </Text>
            {showMistakeBook ? (
              <Text style={styles.snapshotMeta} testID="more-mistakes-summary">
                {mistakeSummaryLine}
              </Text>
            ) : null}
          </View>

          <Text style={styles.groupHeading}>Study tools</Text>
          <View style={styles.card}>
            <Pressable
              accessibilityRole="button"
              testID="more-row-profile"
              style={({ pressed }) => [styles.row, styles.rowFirst, pressed && styles.pressed]}
              onPress={() => navigation.navigate('Profile')}
            >
              <View style={styles.rowTextWrap}>
                <Text style={styles.rowTitle}>Profile</Text>
                <Text style={styles.rowSubtitle}>Streak, week and audience</Text>
              </View>
              <View style={styles.chevron} pointerEvents="none" />
            </Pressable>
            {showMistakeBook ? (
              <Pressable
                accessibilityRole="button"
                testID="more-row-mistakes"
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                onPress={() => navigation.navigate('MistakeBook')}
              >
                <View style={styles.rowTextWrap}>
                  <Text style={styles.rowTitle}>Mistake Book</Text>
                  <Text style={styles.rowSubtitle}>Cards you missed, plus related review</Text>
                </View>
                <View style={styles.chevron} pointerEvents="none" />
              </Pressable>
            ) : null}
            {domainsSlug ? (
              <Pressable
                accessibilityRole="button"
                testID="more-row-domains"
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                onPress={() => navigation.navigate('DomainProgress', { slug: domainsSlug })}
              >
                <View style={styles.rowTextWrap}>
                  <Text style={styles.rowTitle}>Progress by domain</Text>
                  <Text style={styles.rowSubtitle}>Cards learned in each exam area</Text>
                </View>
                <View style={styles.chevron} pointerEvents="none" />
              </Pressable>
            ) : null}
            {showReports ? (
              <Pressable
                accessibilityRole="button"
                testID="more-row-reports"
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                onPress={() => navigation.navigate('MyReports')}
              >
                <View style={styles.rowTextWrap}>
                  <Text style={styles.rowTitle}>My reports</Text>
                  <Text style={styles.rowSubtitle}>Problems you reported on cards</Text>
                </View>
                <View style={styles.chevron} pointerEvents="none" />
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.groupHeading}>Preferences & support</Text>
          <View style={styles.card}>
            <Pressable
              accessibilityRole="button"
              testID="more-row-settings"
              style={({ pressed }) => [styles.row, styles.rowFirst, pressed && styles.pressed]}
              onPress={() => navigation.navigate('Settings')}
            >
              <View style={styles.rowTextWrap}>
                <Text style={styles.rowTitle}>Settings</Text>
                <Text style={styles.rowSubtitle}>Reminders, account, premium</Text>
              </View>
              <View style={styles.chevron} pointerEvents="none" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              testID="more-row-help"
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => navigation.navigate('HelpFAQ')}
            >
              <View style={styles.rowTextWrap}>
                <Text style={styles.rowTitle}>Help</Text>
                <Text style={styles.rowSubtitle}>Draws, rare cards, offline, devices</Text>
              </View>
              <View style={styles.chevron} pointerEvents="none" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Privacy policy, opens in browser"
              testID="more-row-privacy"
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => openLink(MORE_LINKS.privacy)}
            >
              <View style={styles.rowTextWrap}>
                <Text style={styles.rowTitle}>Privacy</Text>
                <Text style={styles.rowSubtitle}>Privacy policy</Text>
              </View>
              <View style={styles.externalBadge} pointerEvents="none" testID="more-external-icon-privacy">
                <View style={styles.externalArrowStem} />
                <View style={styles.externalArrowHead} />
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Support, opens in browser"
              testID="more-row-support"
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => openLink(MORE_LINKS.support)}
            >
              <View style={styles.rowTextWrap}>
                <Text style={styles.rowTitle}>Support</Text>
                <Text style={styles.rowSubtitle}>Report a wrong card or ask a question</Text>
              </View>
              <View style={styles.externalBadge} pointerEvents="none" testID="more-external-icon-support">
                <View style={styles.externalArrowStem} />
                <View style={styles.externalArrowHead} />
              </View>
            </Pressable>
          </View>

          <Text testID="more-byline" style={styles.byline}>
            {MORE_BYLINE}
          </Text>
          <Text testID="more-version" style={styles.version}>
            {`Version ${appJson.expo.version}`}
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  accountCard: {
    borderRadius: 24,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.softCream,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  accountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  statusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  statusDotOnline: {
    backgroundColor: colors.mint,
  },
  statusDotGuest: {
    backgroundColor: colors.gold,
  },
  accountBadgeText: {
    fontSize: typography.caption,
    fontWeight: '800',
    color: colors.inkSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  planBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.parchmentBgDeep,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  planBadgePremium: {
    backgroundColor: colors.pokeBlueFaint,
    borderColor: colors.pokeBlueDeep,
  },
  planBadgeText: {
    fontSize: typography.caption,
    fontWeight: '800',
    color: colors.ink,
  },
  accountTitle: {
    marginTop: 6,
    fontSize: typography.title3,
    fontWeight: '900',
    color: colors.ink,
  },
  accountSubtitle: {
    marginTop: 4,
    fontSize: typography.bodySmall,
    lineHeight: 19,
    color: colors.inkSecondary,
  },
  accountPrimaryBtn: {
    marginTop: spacing.sm,
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: colors.pokeBlue,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  accountPrimaryBtnText: {
    fontSize: typography.bodySmall,
    fontWeight: '900',
    color: colors.ink,
    letterSpacing: 0.3,
  },
  accountSecondaryBtn: {
    marginTop: spacing.sm,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  accountSecondaryBtnText: {
    fontSize: typography.bodySmall,
    fontWeight: '800',
    color: colors.inkSoft,
  },
  snapshotCard: {
    marginTop: spacing.sm,
    borderRadius: 20,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.softCream,
  },
  snapshotTitle: {
    fontSize: typography.bodySmall,
    fontWeight: '800',
    color: colors.ink,
  },
  snapshotMeta: {
    marginTop: 4,
    fontSize: typography.caption,
    lineHeight: 17,
    fontWeight: '600',
    color: colors.inkSecondary,
  },
  groupHeading: {
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: 4,
    fontSize: typography.caption,
    fontWeight: '900',
    color: colors.inkSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1.0,
  },
  card: {
    borderRadius: 24,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.softCream,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  row: {
    minHeight: 52,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  rowFirst: {
    borderTopWidth: 0,
  },
  rowTextWrap: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  rowTitle: {
    fontSize: typography.body,
    lineHeight: 20,
    fontWeight: '800',
    color: colors.ink,
  },
  rowSubtitle: {
    marginTop: 2,
    fontSize: typography.caption,
    lineHeight: 16,
    color: colors.inkSecondary,
  },
  titleWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: 'rgba(170,54,54,0.28)',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.danger,
  },
  chevron: {
    width: 8,
    height: 8,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderColor: colors.inkSecondary,
    transform: [{ rotate: '45deg' }],
    marginRight: 6,
  },
  externalBadge: {
    width: 14,
    height: 14,
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  externalArrowStem: {
    position: 'absolute',
    width: 2,
    height: 10,
    backgroundColor: colors.inkSecondary,
    transform: [{ rotate: '45deg' }],
  },
  externalArrowHead: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 6,
    height: 6,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderColor: colors.inkSecondary,
  },
  pressed: {
    opacity: 0.85,
  },
  byline: {
    marginTop: spacing.md,
    textAlign: 'center',
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
    fontWeight: '600',
  },
  version: {
    marginTop: spacing.xs,
    textAlign: 'center',
    fontSize: typography.caption,
    color: colors.inkSecondary,
  },
});

export default MoreScreen;
