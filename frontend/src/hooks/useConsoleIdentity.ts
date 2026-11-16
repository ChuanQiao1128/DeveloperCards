import { useSyncExternalStore } from 'react';
import { getSessionGeneration, subscribeSessionChanges } from '../auth/tokenStore';
import { isSuperAdmin, readSessionUser } from '../auth/sessionUser';

export function useConsoleIdentity() {
  const generation = useSyncExternalStore(subscribeSessionChanges, getSessionGeneration);
  const user = readSessionUser();
  return { generation, sub: user?.sub ?? null, allowed: !!user?.sub && isSuperAdmin(user), user };
}
