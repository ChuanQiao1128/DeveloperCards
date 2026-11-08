import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme/colors';

export const OTP_SLOT_COUNT = 6;

/**
 * Single-surface 6-digit OTP slot display. The caller renders the native
 * oneTimeCode TextInput as an invisible overlay inside `children` so taps,
 * keyboard entry, paste, and iOS AutoFill all operate on one unified control.
 */
export function OtpCodeSlots(props: {
  code: string;
  length?: number;
  children?: React.ReactNode;
}) {
  const total = props.length ?? OTP_SLOT_COUNT;
  const clean = String(props.code || '').replace(/\s/g, '');
  const activeIndex = Math.min(clean.length, total - 1);

  return (
    <View style={styles.container} testID="otp-code-slots">
      <View
        style={styles.row}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {Array.from({ length: total }).map((_, idx) => {
          const char = clean[idx] ?? '';
          const isFilled = char.length > 0;
          const isCurrent = idx === activeIndex && clean.length < total;
          return (
            <View
              key={idx}
              style={[
                styles.slot,
                isFilled && styles.slotFilled,
                isCurrent && styles.slotCurrent,
              ]}
            >
              <Text style={[styles.digit, !isFilled && styles.digitPlaceholder]}>
                {isFilled ? char : '·'}
              </Text>
            </View>
          );
        })}
      </View>
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    marginTop: 8,
    minHeight: 52,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  slot: {
    flex: 1,
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotFilled: {
    borderColor: colors.gold,
    backgroundColor: '#FFFDF8',
  },
  slotCurrent: {
    borderWidth: 2,
    borderColor: colors.pokeBlueDeep,
  },
  digit: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.ink,
  },
  digitPlaceholder: {
    color: colors.inkSecondary,
    fontWeight: '700',
  },
});

export default OtpCodeSlots;
