import React, { useCallback, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { getAuthIdentitySnapshot, getAuthSessionGeneration, subscribeAuthIdentitySnapshot } from '../auth/sessionBoundary';
import { SkiaModule, skiaAvailable } from '../components/ceremony/reanimatedGuard';
import type { DomainProgress } from '../features/domains/domainProgress';
import { resolveDomainProgressSlug } from '../features/domains/domainProgressDeck';
import { loadDomainProgress } from '../features/domains/loadDomainProgress';
import { countDueToday } from '../features/gacha/planner/sessionPlanner';
import { checkpointProgressStamp, loadSessionCheckpoint, studyCheckpointContext } from '../features/gacha/session/sessionCheckpoint';
import { captureSessionNavigation } from '../features/gacha/session/sessionNavigation';
import type { RootStackParamList } from '../navigation/types';
import { usePremiumUser } from '../premium/premiumStore';
import { captureProgressUserSub } from '../review/storage';
import { subscribeProgressChanges } from '../sync/progressChanges';
import { a11y } from '../theme/a11y';
import { colors } from '../theme/colors';
import { CHROME_MAX_FONT_SCALE, isLargeFontScale, useFontScale } from '../theme/dynamicType';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

type Props = NativeStackScreenProps<RootStackParamList, 'ReviewOverview'>;
type Overview = {
  slug: string;
  title: string;
  domains: DomainProgress[];
  dueToday: number;
  canResume: boolean;
  generation: number;
};

const saaTitles: Record<string, string> = {
  d1: 'Secure', d2: 'Resilient', d3: 'High performance', d4: 'Cost optimization',
};
const segments = [
  { label: 'Mastered', color: colors.inkSecondary },
  { label: 'Learning', color: colors.glowGold },
  { label: 'Unstudied', color: colors.parchmentBgDeep },
];
const { Canvas, Circle, Path } = SkiaModule ?? {};

function RingArc({ center, radius, fraction, color }: {
  center: number; radius: number; fraction: number; color: string;
}) {
  if (fraction <= 0) return null;
  const strokeWidth = 7;
  if (fraction >= 1) {
    return <Circle cx={center} cy={center} r={radius} color={color} style="stroke" strokeWidth={strokeWidth} />;
  }
  const angle = fraction * 2 * Math.PI;
  const x = center + Math.sin(angle) * radius;
  const y = center - Math.cos(angle) * radius;
  const path = `M ${center} ${center - radius} A ${radius} ${radius} 0 ${fraction > 0.5 ? 1 : 0} 1 ${x} ${y}`;
  return <Path path={path} color={color} style="stroke" strokeWidth={strokeWidth} />;
}

function DomainRing({ domain, size }: { domain: DomainProgress; size: number }) {
  const learned = domain.learned / domain.total;
  const mastered = domain.mastered / domain.total;
  const center = size / 2;
  const radius = center - 4;
  return (
    <View style={[styles.ring, !skiaAvailable && styles.ringFallback, { width: size, height: size }]} pointerEvents="none"
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {skiaAvailable ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <RingArc center={center} radius={radius} fraction={1} color={segments[2].color} />
          <RingArc center={center} radius={radius} fraction={learned} color={segments[1].color} />
          <RingArc center={center} radius={radius} fraction={mastered} color={segments[0].color} />
        </Canvas>
      ) : null}
      <Text style={styles.percent} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>{Math.round(learned * 100)}%</Text>
      <Text style={styles.ringCaption} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>Learned</Text>
    </View>
  );
}

export default function ReviewOverviewScreen({ navigation }: Props) {
  const [result, setResult] = useState<Overview | 'empty' | 'error' | null>(null);
  const [retry, setRetry] = useState(0);
  const identity = useSyncExternalStore(subscribeAuthIdentitySnapshot, getAuthIdentitySnapshot);
  const isPremiumUser = usePremiumUser();
  const fontScale = useFontScale();
  const largeText = isLargeFontScale(fontScale);
  const ringSize = 78 * Math.max(1, Math.min(fontScale, CHROME_MAX_FONT_SCALE));

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    const generation = getAuthSessionGeneration();
    const current = () => !cancelled && generation === getAuthSessionGeneration();
    let watching: { slug: string; userSub: string } | null = null;
    const refresh = () => { if (current()) setRetry(value => value + 1); };
    const unsubscribe = subscribeProgressChanges(({ userSub, deckSlug }) => {
      if (watching?.userSub === userSub && watching.slug === deckSlug) refresh();
    });
    const appState = AppState?.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    setResult(null);
    async function load() {
      try {
        const slug = await resolveDomainProgressSlug();
        if (!current()) return;
        if (slug) {
          const userSub = await captureProgressUserSub(true);
          if (!current()) return;
          watching = { slug, userSub };
        }
        const snapshot = slug ? await loadDomainProgress(slug, { hydrateCached: true }) : null;
        if (!current()) return;
        if (!slug || !snapshot) {
          setResult('empty');
          return;
        }
        const { deck, now, progress, owned, domains, userSub: sub } = snapshot;
        const checkpoint = await (async () => {
          try {
            return await loadSessionCheckpoint(sub, slug, {
              deckVersion: deck.Version,
              context: studyCheckpointContext({ slug, isPremiumUser }),
              progressStamp: checkpointProgressStamp(progress, owned),
              navigation: await captureSessionNavigation(deck),
            });
          } catch {
            // SessionCard owns recovery if the saved position cannot be read.
            return null;
          }
        })();
        if (!current() || await captureProgressUserSub(true) !== sub || !current()) return;
        setResult({
          slug, title: deck.Title, domains, generation,
          dueToday: countDueToday(progress, now, owned),
          canResume: checkpoint !== null &&
            (owned === null || owned.has(checkpoint.currentUid)) &&
            deck.Cards.some(card => card.StableUid === checkpoint.currentUid),
        });
      } catch {
        if (current()) setResult('error');
      }
    }
    void load();
    return () => {
      cancelled = true;
      unsubscribe();
      appState?.remove();
    };
  }, [identity, isPremiumUser, retry]));

  const overview = result && typeof result === 'object' && result.generation === getAuthSessionGeneration() ? result : null;
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <LinearGradient colors={[colors.softCream, colors.softPeach, colors.softLavender]} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text accessibilityRole="header" style={styles.title}>Review</Text>
          <View style={styles.today}>
            <Text accessibilityRole="header" style={styles.heading}>Today’s review</Text>
            {overview ? (
              <Text style={styles.note} testID="review-due-today">
                {overview.dueToday === 0 ? 'No cards due today' : `${overview.dueToday} due today`}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              testID="review-start"
              style={({ pressed }) => [styles.start, pressed && styles.pressed]}
              onPress={() => overview
                ? navigation.navigate('SessionCard', { slug: overview.slug })
                : navigation.navigate('SessionCard', {})}
            >
              <Text style={styles.startLabel}>{overview?.canResume ? 'Continue review' : 'Start review'}</Text>
            </Pressable>
          </View>

          <View style={styles.domainHeader}>
            <Text accessibilityRole="header" style={styles.heading}>Progress by domain</Text>
            {overview ? <Text style={styles.note}>{overview.title}</Text> : null}
          </View>
          {overview?.domains.length ? (
            <>
              <View style={styles.grid}>
                {overview.domains.map(domain => (
                  <Pressable
                    key={domain.key}
                    accessibilityRole="button"
                    accessibilityLabel={`${domain.title}, ${domain.learned} of ${domain.total} learned, ${domain.mastered} mastered, ${domain.dueNow} due now`}
                    accessibilityHint="Shows domain details and practice"
                    testID={`review-domain-${domain.key}`}
                    style={({ pressed }) => [styles.tile, !largeText && styles.halfTile, pressed && styles.pressed]}
                    onPress={() => navigation.navigate('DomainProgress', { slug: overview.slug, domainKey: domain.key })}
                  >
                    <Text style={styles.domainTitle}>{overview.slug.startsWith('aws-saa-') ? saaTitles[domain.key] ?? domain.title : domain.title}</Text>
                    <DomainRing domain={domain} size={ringSize} />
                    <Text style={styles.tileNote}>{`${domain.learned}/${domain.total} learned`}</Text>
                    <Text style={styles.tileNote}>{`${domain.mastered} mastered · ${domain.dueNow} due`}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.legend}>
                {segments.map(({ label, color }) => (
                  <View key={label} style={styles.legendItem}>
                    <View style={[styles.swatch, { backgroundColor: color }]} />
                    <Text style={styles.note}>{label}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : result === 'error' ? (
            <View style={styles.state}>
              <Text style={styles.note}>Couldn’t load your progress.</Text>
              <Pressable accessibilityRole="button" style={styles.retry} onPress={() => setRetry(value => value + 1)}>
                <Text style={styles.startLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : result === 'empty' || overview ? (
            <Text style={styles.note}>Open a card pack to see its progress.</Text>
          ) : (
            <ActivityIndicator accessibilityLabel="Loading domain progress" color={colors.inkSecondary} />
          )}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.softCream },
  content: { padding: spacing.screenPadding, gap: spacing.sm },
  title: { color: colors.ink, fontSize: typography.title1, fontWeight: '800' },
  heading: { color: colors.ink, fontSize: typography.title3, fontWeight: '700' },
  today: { gap: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, paddingBottom: spacing.md },
  note: { color: colors.inkMuted, fontSize: typography.bodySmall },
  start: {
    alignItems: 'center', justifyContent: 'center', minHeight: a11y.minTouch,
    padding: spacing.sm, borderRadius: spacing.buttonRadius, backgroundColor: colors.pokeBlueFaint,
  },
  startLabel: { color: colors.ink, fontSize: typography.button, fontWeight: '700' },
  domainHeader: { gap: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tile: {
    width: '100%', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingHorizontal: spacing.xs, paddingVertical: spacing.sm, minHeight: a11y.minTouch,
    backgroundColor: colors.softCream, borderRadius: spacing.cardRadius,
    borderWidth: 1, borderColor: colors.hairline,
  },
  halfTile: { width: '48%', flexGrow: 1, flexShrink: 0 },
  domainTitle: { color: colors.ink, fontSize: typography.body, fontWeight: '700', textAlign: 'center' },
  ring: { alignItems: 'center', justifyContent: 'center', marginVertical: 4 },
  ringFallback: { borderWidth: 4, borderRadius: 100, borderColor: colors.parchmentBgDeep },
  percent: { color: colors.ink, fontSize: typography.title3, fontWeight: '800', fontVariant: ['tabular-nums'] },
  ringCaption: { color: colors.inkMuted, fontSize: typography.caption },
  tileNote: { color: colors.inkMuted, fontSize: typography.bodySmall, textAlign: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.sm, rowGap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 9, height: 9, borderRadius: 5, borderWidth: 1, borderColor: colors.hairline },
  state: { alignItems: 'flex-start' },
  retry: { justifyContent: 'center', minHeight: a11y.minTouch, paddingRight: spacing.sm },
  pressed: { opacity: 0.75 },
});
