import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import AccountSection from '../features/gacha/settings/account/AccountSection';
import { useAuthStore } from './authStore';

// Mount only the recovery controls while deletion is pending, including after restart.
export function AccountDeletionGate({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const email = useAuthStore((s) => s.email);
  const signOutNow = useAuthStore((s) => s.signOutNow);
  if (status !== 'deletion_pending') return <>{children}</>;
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AccountSection signedIn deletionPending email={email} onSignIn={() => {}}
        onSignOut={() => { void signOutNow().catch(() => {}); }} />
    </SafeAreaView>
  );
}
