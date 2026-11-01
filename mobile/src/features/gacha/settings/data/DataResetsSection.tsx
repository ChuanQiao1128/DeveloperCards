import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';

export const DATA_RESETS_COPY = {
  title: 'Data & resets',
  body: 'Start over without losing your account. Owned cards stay unless you reset the deck itself.',
  reviewTitle: 'Review everything again',
  reviewBody: 'Makes every card you have studied, in every deck, due now. Your owned cards stay.',
  reviewCta: 'Make all learned cards due today',
  reviewBusy: 'Resetting...',
  deckTitle: 'Reset deck progress',
  deckBody:
    "Clear the active deck's study progress, owned cards and daily stats on this device. This cannot be undone.",
} as const;

/**
 * 2026-11-01 settings redesign: both "start over" actions in one place. The
 * schedule reset used to sit inside the Account card and the per-deck reset
 * inside Study; neither grouping matched what a learner is actually trying to
 * do ("make this deck feel new again").
 */
export function DataResetsSection(props: {
  resettingSchedule: boolean;
  onResetReviewSchedule: () => void;
  hasActiveDeck: boolean;
  onResetDeckProgress?: () => void;
}) {
  const { resettingSchedule, onResetReviewSchedule, hasActiveDeck, onResetDeckProgress } = props;
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {DATA_RESETS_COPY.title}
      </Text>
      <Text style={styles.sectionBody}>{DATA_RESETS_COPY.body}</Text>

      <View style={styles.rule} />

      <Text style={styles.sectionTitle} numberOfLines={1}>
        {DATA_RESETS_COPY.reviewTitle}
      </Text>
      <Text style={styles.sectionBody}>{DATA_RESETS_COPY.reviewBody}</Text>
      <Pressable
        style={({ pressed }) => [styles.secondaryButton, (pressed || resettingSchedule) && styles.pressed]}
        accessibilityRole="button"
        onPress={onResetReviewSchedule}
        disabled={resettingSchedule}
        testID="settings-reset-review-schedule"
      >
        <Text style={styles.secondaryButtonText} numberOfLines={1}>
          {resettingSchedule ? DATA_RESETS_COPY.reviewBusy : DATA_RESETS_COPY.reviewCta}
        </Text>
      </Pressable>

      {hasActiveDeck && onResetDeckProgress ? (
        <>
          <View style={styles.rule} />
          <Text style={styles.sectionTitle} numberOfLines={1}>
            {DATA_RESETS_COPY.deckTitle}
          </Text>
          <Text style={styles.sectionBody}>{DATA_RESETS_COPY.deckBody}</Text>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            accessibilityRole="button"
            onPress={onResetDeckProgress}
            testID="settings-reset-deck-progress"
          >
            <Text style={styles.secondaryButtonText} numberOfLines={1}>
              {DATA_RESETS_COPY.deckTitle}
            </Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

export default DataResetsSection;

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
  rule: {
    marginVertical: spacing.sm,
    height: 1,
    backgroundColor: 'rgba(42,34,24,0.12)',
  },
  secondaryButton: {
    marginTop: spacing.sm,
    minHeight: 44,
    borderRadius: spacing.buttonRadius,
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
  pressed: { opacity: 0.9 },
});
