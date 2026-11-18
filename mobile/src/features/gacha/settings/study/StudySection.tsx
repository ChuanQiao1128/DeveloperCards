import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';
import type { StudyGoal } from '../../../goal/studyGoal';
import type { CardDisplayLang } from '../../../../content/localizeCard';
import { StudyGoalRow } from './StudyGoalRow';
import { CardLangRow } from './CardLangRow';

export const STUDY_COPY = {
  title: 'Study',
  // 2026-11-01 settings redesign: the reset moved to DataResetsSection
  // (settings/data), which groups both start-over actions.
} as const;

export function StudySection(props: {
  style?: any;
  /** U4: the study goal row. */
  goal?: { value: StudyGoal | null; fallbackDeckSlug: string | null; onSaved: (goal: StudyGoal | null) => void };
  /** Card translations: the remembered card language. Omitted, the section shows no language row. */
  cardLang?: { value: CardDisplayLang; onSelect: (next: CardDisplayLang) => void };
}) {
  const { goal, cardLang } = props;
  return (
    <View style={[styles.sectionCard, props.style]}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {STUDY_COPY.title}
      </Text>
      {goal ? <StudyGoalRow goal={goal.value} fallbackDeckSlug={goal.fallbackDeckSlug} onSaved={goal.onSaved} /> : null}
      {cardLang ? <CardLangRow value={cardLang.value} onSelect={cardLang.onSelect} /> : null}
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
});
