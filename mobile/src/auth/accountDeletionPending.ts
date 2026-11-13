import AsyncStorage from '@react-native-async-storage/async-storage';

export type AccountDeletionStage = 'server_pending' | 'identity_pending' | 'local_pending';
const PREFIX = 'recallsmith:auth:deletionPending:';
export const ACTIVE_DELETION_SUB_KEY = 'recallsmith:auth:activeDeletionSub';
let writes: Promise<void> = Promise.resolve();

function write(change: () => Promise<void>): Promise<void> {
  const pending = writes.then(change);
  writes = pending.catch(() => {});
  return pending;
}

export function deletionPendingKey(sub: string): string {
  return `${PREFIX}${sub}`;
}

async function readStage(sub: string): Promise<AccountDeletionStage | null> {
  const value = await AsyncStorage.getItem(deletionPendingKey(sub));
  if (value === null) return null;
  // Unknown/interrupted formats must never bootstrap the account.
  return value === 'identity_pending' || value === 'local_pending' ? value : 'server_pending';
}

export async function readDeletionPending(sub: string): Promise<AccountDeletionStage | null> {
  await writes;
  return readStage(sub);
}

export async function readActiveDeletionPending(): Promise<{ sub: string; stage: AccountDeletionStage } | null> {
  await writes;
  const sub = await AsyncStorage.getItem(ACTIVE_DELETION_SUB_KEY);
  if (!sub) return null;
  const stage = await readStage(sub);
  return stage ? { sub, stage } : null;
}

export function persistDeletionPending(sub: string, stage: AccountDeletionStage): Promise<void> {
  return write(async () => {
    await AsyncStorage.setItem(deletionPendingKey(sub), stage);
    await AsyncStorage.setItem(ACTIVE_DELETION_SUB_KEY, sub);
  });
}

export function clearActiveDeletion(sub: string): Promise<void> {
  return write(async () => {
    if (await AsyncStorage.getItem(ACTIVE_DELETION_SUB_KEY) === sub)
      await AsyncStorage.removeItem(ACTIVE_DELETION_SUB_KEY);
  });
}

export function clearDeletionPending(sub: string): Promise<void> {
  return write(async () => {
    await AsyncStorage.removeItem(deletionPendingKey(sub));
    if (await AsyncStorage.getItem(ACTIVE_DELETION_SUB_KEY) === sub)
      await AsyncStorage.removeItem(ACTIVE_DELETION_SUB_KEY);
  });
}
