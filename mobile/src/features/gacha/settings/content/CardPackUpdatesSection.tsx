import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { getInstalledDeckInfo, type InstalledDeckInfo } from '../../../../content/deckRepository';
import { checkAndUpdateCardPack } from '../../../../content/cardPackUpdates';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';

type Phase = 'loading' | 'idle' | 'checking' | 'updating' | 'current' | 'error';

export function CardPackUpdatesSection(props: { slug: string; label: string; style?: any }) {
  const [installed, setInstalled] = useState<InstalledDeckInfo | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [checkedAtMs, setCheckedAtMs] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const request = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const id = ++request.current;
    void getInstalledDeckInfo(props.slug).then((info) => {
      if (!mounted.current || id !== request.current) return;
      setInstalled(info);
      setPhase('idle');
    }).catch(() => {
      if (!mounted.current || id !== request.current) return;
      setPhase('error');
      setError('Could not read the installed version. Try checking again.');
    });
    return () => { mounted.current = false; request.current += 1; };
  }, [props.slug]);

  const check = async () => {
    if (busy.current) return;
    busy.current = true;
    const id = ++request.current;
    const current = () => mounted.current && id === request.current;
    setError(null);
    setPhase('checking');
    try {
      const result = await checkAndUpdateCardPack(props.slug, (progress) => {
        if (!current()) return;
        setLatestVersion(progress.latestVersion);
        if (progress.phase === 'updating') setPhase('updating');
      });
      if (!current()) return;
      setInstalled(result.installed);
      setLatestVersion(result.latestVersion);
      setCheckedAtMs(result.checkedAtMs);
      setPhase('current');
    } catch (cause) {
      if (!current()) return;
      setError(cause instanceof Error ? cause.message : 'Could not check for updates. Try again.');
      setPhase('error');
    } finally {
      busy.current = false;
    }
  };

  const pending = phase === 'checking' || phase === 'updating' || phase === 'loading';
  const status = phase === 'loading' ? 'Reading installed version…'
    : phase === 'checking' ? 'Checking for updates…'
    : phase === 'updating' ? 'Updating card pack…'
    : phase === 'current' ? 'Up to date'
    : phase === 'error' ? 'Update not confirmed'
    : 'Check for the latest cards';

  return (
    <View style={props.style} testID="card-pack-updates">
      <Text style={styles.title}>{props.label}</Text>
      <Text style={styles.body}>Get the latest cards while keeping your learning progress.</Text>
      <Text style={styles.label}>Installed version</Text>
      <Text style={styles.version} selectable testID="card-pack-installed-version">
        {installed?.version ?? (phase === 'loading' ? 'Reading…' : 'Not installed')}
      </Text>
      {installed?.installedAtMs ? <Text style={styles.meta}>Downloaded {new Date(installed.installedAtMs).toLocaleString()}</Text> : null}
      <Text style={styles.label}>Latest available version</Text>
      <Text style={styles.version} selectable testID="card-pack-latest-version">{latestVersion ?? 'Not checked'}</Text>
      <Text style={styles.status} accessibilityLiveRegion="polite" testID="card-pack-update-status">{status}</Text>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error} Check your connection and try again.</Text> : null}
      {checkedAtMs ? <Text style={styles.meta}>Last checked {new Date(checkedAtMs).toLocaleString()}</Text> : null}
      <Pressable
        testID="card-pack-check-updates"
        accessibilityRole="button"
        accessibilityState={{ disabled: pending, busy: pending }}
        disabled={pending}
        onPress={() => void check()}
        style={({ pressed }) => [styles.button, (pressed || pending) && styles.disabled]}
      >
        <Text style={styles.buttonText}>{phase === 'updating' ? 'Updating…' : phase === 'checking' ? 'Checking…' : 'Check for updates'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.body, fontWeight: '800', color: colors.ink },
  body: { marginTop: spacing.xs, fontSize: typography.bodySmall, color: colors.inkSecondary },
  label: { marginTop: spacing.sm, fontSize: typography.caption, color: colors.inkSecondary },
  version: { marginTop: spacing.xs, fontSize: typography.bodySmall, color: colors.ink },
  meta: { marginTop: spacing.xs, fontSize: typography.caption, color: colors.inkSecondary },
  status: { marginTop: spacing.sm, fontSize: typography.bodySmall, fontWeight: '700', color: colors.ink },
  error: { marginTop: spacing.xs, fontSize: typography.bodySmall, color: colors.inkSecondary },
  button: { marginTop: spacing.sm, minHeight: 44, borderRadius: spacing.buttonRadius, backgroundColor: colors.pokeBlue, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: typography.button, fontWeight: '700', color: colors.ink },
  disabled: { opacity: 0.65 },
});
