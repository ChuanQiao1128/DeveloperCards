import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

type Section = {
  title: string;
  body?: string;
  items?: Array<{ title: string; subtitle?: string }>;
};

type Stat = {
  label: string;
  value: string;
  sublabel?: string;
};

export function AppInfoScreen(props: {
  eyebrow: string;
  title: string;
  body: string;
  sections?: Section[];
  stats?: Stat[];
  chips?: string[];
  primaryLabel?: string;
  secondaryLabel?: string;
  tertiaryLabel?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
  onTertiary?: () => void;
  cosmic?: boolean;
  footer?: React.ReactNode;
  headerAction?: { label: string; onPress: () => void };
}) {
  const cosmic = props.cosmic ?? false;
  const gradient: [string, string, ...string[]] = cosmic
    ? [colors.cosmicBgDeep, colors.cosmicBg, '#171B45']
    : [colors.parchmentBg, '#F6EEE0', colors.parchmentBgDeep];
  const titleColor = cosmic ? colors.cosmicInk : colors.ink;
  const bodyColor = cosmic ? '#D9D0AE' : colors.inkSecondary;
  const eyebrowColor = cosmic ? colors.glowGold : colors.inkSecondary;
  const statValueColor = cosmic ? colors.glowGold : colors.ink;
  const chipBg = cosmic ? 'rgba(232,184,90,0.14)' : '#EFE6CC';
  const chipText = cosmic ? colors.cosmicInk : colors.inkSoft;
  const cardBg = cosmic ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.9)';
  const cardBorder = cosmic ? 'rgba(232,184,90,0.18)' : 'rgba(42,34,24,0.06)';
  const itemBorder = cosmic ? 'rgba(245,236,196,0.08)' : 'rgba(42,34,24,0.06)';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: cosmic ? colors.cosmicBgDeep : colors.parchmentBg }]}>
      <LinearGradient colors={gradient} style={styles.gradient}>
        {props.headerAction ? (
          <View style={styles.headerRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={props.headerAction.label}
              onPress={props.headerAction.onPress}
              style={({ pressed }) => [
                styles.headerButton,
                { backgroundColor: cosmic ? 'rgba(255,255,255,0.14)' : colors.softCream },
                pressed && styles.headerButtonPressed,
              ]}
            >
              <Text style={[styles.headerButtonText, { color: cosmic ? colors.cosmicInk : colors.inkSoft }]} numberOfLines={1}>
                {props.headerAction.label}
              </Text>
            </Pressable>
          </View>
        ) : null}
        <ScrollView contentContainerStyle={styles.container}>
          <View style={[styles.heroCard, { backgroundColor: cosmic ? 'rgba(255,255,255,0.06)' : 'rgba(255,250,240,0.9)', borderColor: cardBorder }]}>
            <Text style={[styles.eyebrow, { color: eyebrowColor }]}>{props.eyebrow}</Text>
            <Text style={[styles.title, { color: titleColor }]}>{props.title}</Text>
            <View style={[styles.heroDivider, { backgroundColor: cosmic ? colors.glowGold : colors.gold }]} />
            <Text style={[styles.body, { color: bodyColor }]}>{props.body}</Text>

            {(props.chips ?? []).length ? (
              <View style={styles.chipsRow}>
                {(props.chips ?? []).map((chip) => (
                  <View key={chip} style={[styles.heroChip, { backgroundColor: chipBg }]}>
                    <Text style={[styles.heroChipText, { color: chipText }]}>{chip}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {(props.stats ?? []).length ? (
              <View style={styles.statsRow}>
                {(props.stats ?? []).map((stat) => (
                  <View key={stat.label} style={[styles.statCard, { backgroundColor: cosmic ? 'rgba(255,255,255,0.05)' : '#FFF7EA', borderColor: cardBorder }]}>
                    <Text style={[styles.statValue, { color: statValueColor }]}>{stat.value}</Text>
                    <Text style={[styles.statLabel, { color: bodyColor }]}>{stat.label}</Text>
                    {stat.sublabel ? (
                      <Text style={[styles.statSublabel, { color: bodyColor }]}>
                        {stat.sublabel}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {(props.sections ?? []).map((section) => (
            <View key={section.title} style={[styles.sectionCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              <Text style={[styles.sectionTitle, { color: titleColor }]}>{section.title}</Text>
              {section.body ? <Text style={[styles.sectionBody, { color: bodyColor }]}>{section.body}</Text> : null}
              {(section.items ?? []).map((item) => (
                <View key={`${section.title}-${item.title}`} style={[styles.itemRow, { borderTopColor: itemBorder }]}>
                  <Text style={[styles.itemTitle, { color: titleColor }]}>{item.title}</Text>
                  {item.subtitle ? <Text style={[styles.itemSubtitle, { color: bodyColor }]}>{item.subtitle}</Text> : null}
                </View>
              ))}
            </View>
          ))}

          {props.primaryLabel ? (
            <Pressable style={[styles.primaryButton, cosmic && styles.primaryButtonCosmic]} accessibilityRole="button" onPress={props.onPrimary}>
              <Text style={[styles.primaryButtonText, cosmic && styles.primaryButtonTextCosmic]}>{props.primaryLabel}</Text>
            </Pressable>
          ) : null}
          {props.secondaryLabel ? (
            <Pressable style={[styles.secondaryButton, cosmic && styles.secondaryButtonCosmic]} accessibilityRole="button" onPress={props.onSecondary}>
              <Text style={[styles.secondaryButtonText, cosmic && styles.secondaryButtonTextCosmic]}>{props.secondaryLabel}</Text>
            </Pressable>
          ) : null}
          {props.tertiaryLabel ? (
            <Pressable style={[styles.tertiaryButton, cosmic && styles.tertiaryButtonCosmic]} accessibilityRole="button" onPress={props.onTertiary}>
              <Text style={[styles.tertiaryButtonText, cosmic && styles.tertiaryButtonTextCosmic]}>{props.tertiaryLabel}</Text>
            </Pressable>
          ) : null}

          {props.footer ? <View style={styles.footerWrap}>{props.footer}</View> : null}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  gradient: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  headerButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonPressed: { opacity: 0.85 },
  headerButtonText: { fontSize: typography.bodySmall, fontWeight: '800' },
  container: { paddingHorizontal: spacing.screenPadding, paddingTop: spacing.screenPadding, paddingBottom: spacing.xl + 84 },
  heroCard: {
    borderRadius: 28,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    borderWidth: 1,
    shadowColor: '#2A2218',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  eyebrow: { fontSize: typography.caption, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.6 },
  title: { marginTop: spacing.sm, fontSize: 30, lineHeight: 36, fontWeight: '900' },
  heroDivider: { width: 48, height: 3, borderRadius: 999, marginTop: spacing.md },
  body: { marginTop: spacing.md, fontSize: typography.body, lineHeight: 22 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  heroChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  heroChipText: { fontSize: typography.caption, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  statCard: { flex: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1 },
  statValue: { fontSize: 24, lineHeight: 28, fontWeight: '900' },
  statLabel: { marginTop: 6, fontSize: typography.caption, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  statSublabel: { marginTop: 4, fontSize: typography.caption, fontWeight: '700', lineHeight: 15 },
  sectionCard: { marginTop: spacing.md, borderRadius: 24, padding: spacing.md, borderWidth: 1 },
  sectionTitle: { fontSize: 18, lineHeight: 22, fontWeight: '800' },
  sectionBody: { marginTop: spacing.xs, fontSize: typography.bodySmall, lineHeight: 19 },
  itemRow: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1 },
  itemTitle: { fontSize: typography.bodySmall, lineHeight: 18, fontWeight: '700' },
  itemSubtitle: { marginTop: 4, fontSize: typography.caption, lineHeight: 16 },
  primaryButton: {
    marginTop: spacing.lg,
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: colors.pokeBlue,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    shadowColor: 'rgba(44,156,192,0.4)',
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  primaryButtonCosmic: { backgroundColor: colors.glowGold, shadowColor: 'rgba(232,184,90,0.5)' },
  primaryButtonText: { color: colors.ink, fontSize: typography.button, fontWeight: '900', letterSpacing: 0.4 },
  primaryButtonTextCosmic: { color: colors.ink },
  secondaryButton: {
    marginTop: spacing.sm,
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  secondaryButtonCosmic: { backgroundColor: 'transparent', borderColor: 'rgba(245,236,196,0.22)' },
  secondaryButtonText: { color: colors.inkSoft, fontSize: typography.bodySmall, fontWeight: '800', letterSpacing: 0.3 },
  secondaryButtonTextCosmic: { color: colors.cosmicInk },
  tertiaryButton: {
    marginTop: spacing.sm,
    minHeight: 48,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  tertiaryButtonCosmic: { borderColor: 'rgba(245,236,196,0.18)' },
  tertiaryButtonText: { color: colors.inkSoft, fontSize: typography.bodySmall, fontWeight: '800', letterSpacing: 0.3 },
  tertiaryButtonTextCosmic: { color: colors.glowGold },
  footerWrap: { marginTop: spacing.md },
});

export default AppInfoScreen;
