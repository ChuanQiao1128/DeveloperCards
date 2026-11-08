// Kept free of authStore imports: API, Me/Profile and auth share this boundary without a cycle
// or pulling native Amplify/AsyncStorage modules into lightweight screen tests.
let generation = 0;

export type AuthIdentitySnapshot = {
  status: 'unknown' | 'anonymous' | 'signed_in';
  email: string | null;
  sessionExpired: boolean;
  isPremium?: boolean;
};

let identitySnapshot: AuthIdentitySnapshot = {
  status: 'anonymous',
  email: null,
  sessionExpired: false,
  isPremium: false,
};

const identityListeners = new Set<(snapshot: AuthIdentitySnapshot) => void>();

export function getAuthIdentitySnapshot(): AuthIdentitySnapshot {
  return identitySnapshot;
}

export function setAuthIdentitySnapshot(next: Partial<AuthIdentitySnapshot>): void {
  const merged: AuthIdentitySnapshot = {
    status: next.status ?? identitySnapshot.status,
    email: next.email !== undefined ? next.email : identitySnapshot.email,
    sessionExpired: next.sessionExpired ?? identitySnapshot.sessionExpired,
    isPremium: next.isPremium ?? identitySnapshot.isPremium ?? false,
  };
  if (
    identitySnapshot.status === merged.status &&
    identitySnapshot.email === merged.email &&
    identitySnapshot.sessionExpired === merged.sessionExpired &&
    identitySnapshot.isPremium === merged.isPremium
  ) {
    return;
  }
  identitySnapshot = merged;
  for (const listener of identityListeners) {
    listener(identitySnapshot);
  }
}

export function subscribeAuthIdentitySnapshot(
  listener: (snapshot: AuthIdentitySnapshot) => void,
): () => void {
  identityListeners.add(listener);
  return () => {
    identityListeners.delete(listener);
  };
}

export function getAuthSessionGeneration(): number {
  return generation;
}

export function invalidateAuthSession(): void {
  generation += 1;
}

/** Identity comparison only; the server remains responsible for JWT verification. */
export function accessTokenSubject(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = typeof globalThis.atob === 'function'
      ? globalThis.atob(padded)
      : typeof Buffer !== 'undefined' ? Buffer.from(padded, 'base64').toString('utf8') : null;
    const sub = json ? JSON.parse(json)?.sub : null;
    return typeof sub === 'string' && sub.trim() ? sub.trim() : null;
  } catch {
    return null;
  }
}
