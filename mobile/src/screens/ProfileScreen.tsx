import React, { useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import {
  getAuthIdentitySnapshot,
  subscribeAuthIdentitySnapshot,
  type AuthIdentitySnapshot,
} from '../auth/sessionBoundary';
import { getAudiencePreference, type AudiencePreference } from '../features/gacha/audience/audiencePrefs';
import { getAudiencePreferenceLabel } from '../features/gacha/audience/audienceRules';
import { loadStreakSnapshot, type StreakSnapshot } from '../features/gacha/streaks/streakTracker';

type Props = NativeStackScreenProps<RootStackParamList, 'Profile'>;

export function ProfileScreen({ navigation }: Props) {
  const [snapshot, setSnapshot] = useState<StreakSnapshot | null>(null);
  const [audience, setAudience] = useState<AudiencePreference | null>(null);
  const [auth, setAuth] = useState<AuthIdentitySnapshot>(() => getAuthIdentitySnapshot());

  useEffect(() => {
    setAuth(getAuthIdentitySnapshot());
    return subscribeAuthIdentitySnapshot(setAuth);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [loadedSnapshot, loadedAudience] = await Promise.all([
        loadStreakSnapshot(),
        getAudiencePreference(),
      ]);
      if (cancelled) return;
      setSnapshot(loadedSnapshot);
      setAudience(loadedAudience);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // An em dash while the read is in flight, not a zero. A zero is a claim
  // about the user ("you have no streak") and it would be wrong for exactly
  // the users who care most about the number.
  const pending = snapshot === null;
  const dailyStreak = pending ? '—' : String(snapshot.currentDailyStreak);
  const daysThisWeek = pending ? '—' : String(snapshot.weekCompletedDays);
  const signedIn = auth.status === 'signed_in';

  return (
    <AppInfoScreen
      eyebrow="Profile"
      headerAction={{ label: '← Back', onPress: () => navigation.goBack() }}
      title="Your study profile"
      body="Your streak, your week and the preferences that shape what you study."
      chips={['Streak', 'Progress']}
      stats={[
        { label: 'Daily streak', value: dailyStreak },
        { label: 'Days this week', value: daysThisWeek },
      ]}
      sections={[
        {
          title: 'Current setup',
          items: [
            {
              title: 'Account status',
              subtitle: signedIn
                ? `Signed in as ${auth.email ?? 'your account'} · Cloud sync on`
                : 'Local guest profile on this device',
            },
            { title: 'Audience', subtitle: audience ? getAudiencePreferenceLabel(audience) : '—' },
          ],
        },
        {
          title: 'Progress this week',
          items: [
            {
              title: 'Sessions that counted',
              subtitle: pending
                ? 'Reading your session history'
                : `${snapshot.totalQualifiedSessions} sessions have counted toward a streak`,
            },
            {
              title: 'Week posture',
              subtitle: pending
                ? 'Reading this week'
                : `${snapshot.weekCompletedDays} of 7 days completed this week · best streak ${snapshot.longestDailyStreak}`,
            },
          ],
        },
      ]}
      primaryLabel="Study settings"
      onPrimary={() => navigation.navigate('Settings')}
    />
  );
}

export default ProfileScreen;
