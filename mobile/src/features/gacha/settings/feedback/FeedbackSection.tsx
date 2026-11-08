import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';
import type { FeedbackPrefs } from '../feedbackPrefs';

export const FEEDBACK_COPY = {
  title: 'Sound & haptics',
  soundLabel: 'Sound effects',
  soundBody: 'Pack opening sounds. They stay quiet when your ringer is on silent.',
  hapticsLabel: 'Haptics',
  hapticsBody: 'A light tap when you reveal, pick and rate cards.',
} as const;

type ToggleRowProps = {
  testID: string;
  label: string;
  body: string;
  value: boolean;
  onPress: () => void;
};

// Switch-track row without RN's native Switch so per-file RN mocks in the test
// suite work out of the box. Renders a 64x32pt track with a 22pt thumb and an
// explicit On/Off label for both sighted users and screen readers.
export function ToggleRow({ testID, label, body, value, onPress }: ToggleRowProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.rowBody}>{body}</Text>
      </View>
      <View style={[styles.pill, value ? styles.pillOn : styles.pillOff]}>
        {value ? (
          <>
            <Text style={[styles.pillText, styles.pillTextOn]} numberOfLines={1}>
              On
            </Text>
            <View style={styles.thumbOn} pointerEvents="none" />
          </>
        ) : (
          <>
            <View style={styles.thumbOff} pointerEvents="none" />
            <Text style={[styles.pillText, styles.pillTextOff]} numberOfLines={1}>
              Off
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

export function FeedbackSection(props: {
  style?: any;
  prefs: FeedbackPrefs;
  onToggle: (key: keyof FeedbackPrefs, value: boolean) => void;
}) {
  const { prefs, onToggle } = props;
  return (
    <View style={[styles.sectionCard, props.style]}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {FEEDBACK_COPY.title}
      </Text>
      <ToggleRow
        testID="settings-sound-effects-toggle"
        label={FEEDBACK_COPY.soundLabel}
        body={FEEDBACK_COPY.soundBody}
        value={prefs.soundEffects}
        onPress={() => onToggle('soundEffects', !prefs.soundEffects)}
      />
      <ToggleRow
        testID="settings-haptics-toggle"
        label={FEEDBACK_COPY.hapticsLabel}
        body={FEEDBACK_COPY.hapticsBody}
        value={prefs.haptics}
        onPress={() => onToggle('haptics', !prefs.haptics)}
      />
    </View>
  );
}

export default FeedbackSection;

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
  row: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  rowText: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  rowLabel: {
    fontSize: typography.bodySmall,
    fontWeight: '700',
    color: colors.ink,
  },
  rowBody: {
    marginTop: 2,
    fontSize: typography.caption,
    color: colors.inkSecondary,
    lineHeight: 17,
  },
  pill: {
    minWidth: 64,
    minHeight: 32,
    paddingHorizontal: 5,
    paddingVertical: 4,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    gap: 6,
  },
  pillOn: {
    backgroundColor: colors.pokeBlue,
    borderColor: colors.pokeBlueDeep,
  },
  pillOff: {
    backgroundColor: 'rgba(42,34,24,0.08)',
    borderColor: colors.hairline,
  },
  thumbOn: {
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  thumbOff: {
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  pillText: {
    fontSize: typography.caption,
    fontWeight: '900',
    letterSpacing: 0.3,
    paddingHorizontal: 4,
  },
  pillTextOn: {
    color: colors.ink,
  },
  pillTextOff: {
    color: colors.inkSecondary,
  },
  pressed: {
    opacity: 0.9,
  },
});
