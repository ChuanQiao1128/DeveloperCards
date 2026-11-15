// src/auth/tokenStore.ts
import { clearSessionCaches } from '../lib/sessionCache';

export type StoredTokens = {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn: number;   // seconds
  expiresAt: number;   // epoch ms
};

export type SessionUser = {
  email?: string;
  username?: string;
  groups: string[];
};

const TOKEN_KEY = 'devcards:tokens';
const EXPIRY_SKEW_MS = 30_000;
let sessionGeneration = 0;
const sessionListeners = new Set<() => void>();

export class SessionChangedError extends Error {
  readonly code = 'SESSION_CHANGED';
  constructor() {
    super('The session changed. Please try again in the current session.');
    this.name = 'SessionChangedError';
  }
}

export function getSessionGeneration(): number {
  return sessionGeneration;
}

export function assertSessionGeneration(expected: number): void {
  if (expected !== sessionGeneration) throw new SessionChangedError();
}

export function subscribeSessionChanges(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
}

function sessionChanged(): void {
  sessionGeneration += 1;
  clearSessionCaches();
  for (const listener of sessionListeners) listener();
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;

    const b64url = parts[1];
    const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
    const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');

    const json = atob(b64);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readGroupsFromPayload(payload: Record<string, unknown> | null): string[] {
  if (!payload) return [];
  const raw = payload['cognito:groups'] ?? payload['groups'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  return [];
}

export function isExpired(tokens: StoredTokens): boolean {
  return Date.now() >= tokens.expiresAt - EXPIRY_SKEW_MS;
}

export function clearTokens(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionChanged();
}

/** Legacy name for clearTokens(). */
export function clearStoredTokens(): void {
  clearTokens();
}

/**
 * Whatever is in storage, whether or not the access token is still alive.
 *
 * Split out of getTokens because the refresh path needs the refresh token at
 * exactly the moment the access token is dead, and getTokens used to answer
 * that case by deleting the record. Malformed JSON is still cleared here:
 * there is nothing in it to revive a session with.
 */
export function readStoredTokens(): StoredTokens | null {
  const raw = sessionStorage.getItem(TOKEN_KEY);
  if (!raw) return null;

  const parsed = safeJsonParse<StoredTokens>(raw);
  if (!parsed || !parsed.accessToken || !parsed.idToken || !parsed.expiresAt) {
    clearTokens();
    return null;
  }

  return parsed;
}

/**
 * The session, if there is one that can still be used or still be revived.
 *
 * This used to wipe storage the moment the access token aged out, which threw
 * away the refresh token sitting beside it — the one value that could have
 * kept the session going — and so turned every one-hour expiry into a hard
 * sign-out that lost whatever was being edited. An expired access token with a
 * refresh token next to it is a session that needs one round trip, not a
 * session that is over: the record survives, and the request interceptor in
 * src/api/http.ts refreshes it before the next call goes out. Only a session
 * with no way back is deleted here.
 *
 * Read the non-null result as "there is a session", NOT as "this string is a
 * valid bearer token" — those stopped being the same answer here.
 */
export function getTokens(): StoredTokens | null {
  const parsed = readStoredTokens();
  if (!parsed) return null;

  if (isExpired(parsed) && !parsed.refreshToken) {
    clearTokens();
    return null;
  }

  return parsed;
}

/**
 * The bearer token, or null. Never returns an expired one.
 *
 * Say plainly what this is now: nothing in src/ calls it. It used to be how
 * src/api/http.ts filled the Authorization header, and that caller moved to
 * readStoredTokens() because deciding whether to refresh needs expiresAt and
 * refreshToken, not just the string. What it is kept for is the other half of
 * the split above — getTokens() is only allowed to hand back an expired
 * session because the accessor that produces a credential refuses one — and
 * tests/tokenStoreExpiry.test.ts holds it to that. getIdToken() below has had
 * no caller since before this change.
 */
export function getAccessToken(): string | null {
  const tokens = getTokens();
  if (!tokens || isExpired(tokens)) return null;
  return tokens.accessToken;
}

export function getIdToken(): string | null {
  const tokens = getTokens();
  if (!tokens || isExpired(tokens)) return null;
  return tokens.idToken;
}

export function saveTokens(input: {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn: number;
  expiresAt?: number;
}, refreshSession?: number): StoredTokens {
  // Refresh replaces credentials inside a session; sign-in creates a new one.
  if (refreshSession !== undefined) assertSessionGeneration(refreshSession);
  const expiresAt =
    typeof input.expiresAt === 'number'
      ? input.expiresAt
      : Date.now() + input.expiresIn * 1000;

  const stored: StoredTokens = {
    accessToken: input.accessToken,
    idToken: input.idToken,
    refreshToken: input.refreshToken,
    tokenType: input.tokenType,
    expiresIn: input.expiresIn,
    expiresAt,
  };

  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(stored));
  if (refreshSession === undefined) sessionChanged();
  return stored;
}

/**
 * Legacy name for saveTokens(). Accepts either shape:
 * 1) a StoredTokens that already carries expiresAt, or
 * 2) tokens + expiresIn, from which expiresAt is computed.
 */
export function setStoredTokens(input: StoredTokens | {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn: number;
  expiresAt?: number;
}): StoredTokens {
  return saveTokens(input);
}

/** Watch out: groups may live on the access token, not necessarily the id token. */
export function getUserGroups(tokens?: StoredTokens | null): string[] {
  const t = tokens ?? getTokens();
  if (!t) return [];

  const fromId = readGroupsFromPayload(decodeJwtPayload(t.idToken));
  if (fromId.length > 0) return fromId;

  return readGroupsFromPayload(decodeJwtPayload(t.accessToken));
}

export function getSessionUser(tokens?: StoredTokens | null): SessionUser | null {
  const t = tokens ?? getTokens();
  if (!t) return null;

  const payload = decodeJwtPayload(t.idToken) ?? decodeJwtPayload(t.accessToken);
  if (!payload) return null;

  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const username =
    typeof payload['cognito:username'] === 'string'
      ? (payload['cognito:username'] as string)
      : typeof payload.username === 'string'
        ? (payload.username as string)
        : undefined;

  return { email, username, groups: getUserGroups(t) };
}