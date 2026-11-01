import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';
import { ToggleRow } from '../feedback/FeedbackSection';
import type { StudyPrefs } from '../../study/studyPrefs';
import type { StudyGoal } from '../../../goal/studyGoal';
import type { CardDisplayLang } from '../../../../content/localizeCard';
import { StudyGoalRow } from './StudyGoalRow';
import { CardLangRow } from './CardLangRow';

export const STUDY_COPY = {
  title: 'Study',
  fourButtonsLabel: 'Show all four rating buttons',
  fourButtonsBody: 'Rate cards with Again, Hard, Good and Easy instead of Forgot and Remembered.',
  // 2026-11-01 settings redesign: the reset moved to DataResetsSection
  // (settings/data), which groups both start-over actions.
} as const;

export function StudySection(props: {
  prefs: StudyPrefs;
  onToggleFourButtons: (value: boolean) => void;
  /** U4: the study goal row. Omitted, the section shows only the rating-button toggle. */
  goal?: { value: StudyGoal | null; fallbackDeckSlug: string | null; onSaved: (goal: StudyGoal | null) => void };
  /** Card translations: the remembered card language. Omitted, the section shows no language row. */
  cardLang?: { value: CardDisplayLang; onSelect: (next: CardDisplayLang) => void };
  /** Reset the active deck's local study progress. Omitted, the section shows no reset row. */
  onResetDeckProgress?: () => void;
}) {
  const { prefs, onToggleFourButtons, goal, cardLang, onResetDeckProgress } = props;
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {STUDY_COPY.title}
      </Text>
      {goal ? <StudyGoalRow goal={goal.value} fallbackDeckSlug={goal.fallbackDeckSlug} onSaved={goal.onSaved} /> : null}
      <ToggleRow
        testID="settings-four-buttons-toggle"
        label={STUDY_COPY.fourButtonsLabel}
        body={STUDY_COPY.fourButtonsBody}
        value={prefs.fourButtons}
        onPress={() => onToggleFourButtons(!prefs.fourButtons)}
      />
      {cardLang ? <CardLangRow value={cardLang.value} onSelect={cardLang.onSelect} /> : null}
      {onResetDeckProgress ? (
        <Pressable
          testID="settings-reset-deck-progress"
          accessibilityRole="button"
          accessibilityLabel={STUDY_COPY.resetDeckLabel}
          onPress={onResetDeckProgress}
          style={({ pressed }) => [styles.resetRow, pressed && styles.pressed]}
        >
          <Text style={styles.resetLabel}>{STUDY_COPY.resetDeckLabel}</Text>
          <Text style={styles.resetBody}>{STUDY_COPY.resetDeckBody}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default StudySection;

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
  resetRow: {
    marginTop: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  resetLabel: {
    fontSize: typography.bodySmall,
    fontWeight: '700',
    color: colors.ink,
  },
  resetBody: {
    marginTop: 2,
    fontSize: typography.caption,
    color: colors.inkSecondary,
    lineHeight: 17,
  },
  pressed: {
    opacity: 0.9,
  },
});
