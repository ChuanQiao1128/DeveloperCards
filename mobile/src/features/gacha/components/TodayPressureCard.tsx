import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TodayCounts } from '../contracts';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';
import { isLargeFontScale, useFontScale } from '../../../theme/dynamicType';

export function TodayPressureCard(props: {
  counts: TodayCounts;
  selectedDeckTitle: string | null;
  totalCards?: number;
  masteredCount?: number;
  compact?: boolean;
}) {
  const { counts, selectedDeckTitle, totalCards, masteredCount = 0, compact } = props;
  const largeText = isLargeFontScale(useFontScale());
  const owned = counts.selectedOwned;
  const total = Math.max(owned, totalCards ?? owned);
  const metrics = [
    { id: 'normal', value: counts.selectedDue, label: 'Due for review', tone: styles.review },
    { id: 'elite', value: counts.selectedNew, label: 'New to learn', tone: styles.fresh },
  ];

  return (
    <View style={[styles.card, compact && styles.compact]} testID={compact ? 'home-today-compact' : 'home-pack-progress'}>
      <Text style={styles.title} testID="home-pack-unlocked">
        {`${owned} / ${total} cards unlocked`}
      </Text>
      <Text style={styles.subtitle}>{selectedDeckTitle ?? 'Choose a pack to begin'}</Text>
      {total > 0 ? (
        <View
          style={styles.track}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Cards unlocked"
          accessibilityValue={{ min: 0, max: total, now: owned }}
        >
          <View style={[styles.fill, { width: `${Math.min(1, owned / total) * 100}%` }]} />
        </View>
      ) : null}
      <Text style={styles.studied} testID="home-pack-studied">
        {`${counts.selectedMastered} studied at least once · ${masteredCount} mastered`}
      </Text>
      {owned === 0 ? (
        <Text style={styles.subtitle} testID="home-today-empty">Unlock your first cards to start learning.</Text>
      ) : counts.selectedDue + counts.selectedNew > 0 ? (
        <View style={[styles.row, largeText && styles.stack]} testID="home-today-count-grid">
          {metrics.map(metric => (
            <View key={metric.id} style={[styles.metric, metric.tone, largeText && styles.metricLarge]} testID={`home-today-count-${metric.id}`}>
              <Text style={styles.value}>{metric.value}</Text>
              <Text style={styles.label}>{metric.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: 'stretch', borderRadius: spacing.cardRadius, padding: spacing.sm,
    backgroundColor: colors.softCream, borderWidth: 1, borderColor: colors.hairline, marginVertical: spacing.xs },
  compact: { paddingVertical: spacing.xs },
  title: { color: colors.ink, fontSize: typography.title3, fontWeight: '800' },
  subtitle: { marginTop: 4, color: colors.inkSecondary, fontSize: typography.bodySmall },
  studied: { marginTop: spacing.xs, color: colors.inkSecondary, fontSize: typography.bodySmall },
  track: { height: 6, borderRadius: 3, marginTop: spacing.xs, overflow: 'hidden', backgroundColor: colors.pokeBlueFaint },
  fill: { height: '100%', backgroundColor: colors.pokeBlueDeep },
  row: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  stack: { flexDirection: 'column' },
  metric: { flex: 1, minWidth: 0, borderRadius: spacing.buttonRadius, padding: spacing.xs },
  metricLarge: { flex: undefined },
  review: { backgroundColor: colors.softLavender },
  fresh: { backgroundColor: colors.parchmentBgDeep },
  value: { color: colors.ink, fontSize: typography.title3, fontWeight: '800' },
  label: { marginTop: 2, color: colors.inkSecondary, fontSize: typography.bodySmall, fontWeight: '600' },
});

export default TodayPressureCard;
