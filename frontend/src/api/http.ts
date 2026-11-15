// src/api/http.ts
import axios from 'axios';
import { refreshTokens, TokenRefreshError } from '../auth/cognito';
import {
  assertSessionGeneration,
  clearStoredTokens,
  getSessionGeneration,
  readStoredTokens,
  saveTokens,
  type StoredTokens,
} from '../auth/tokenStore';

declare module 'axios' {
  interface AxiosRequestConfig {
    _sessionGeneration?: number;
  }
}

const rawBase = import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_BASE ?? '';
const baseURL = typeof rawBase === 'string' ? rawBase.trim() : '';
const client = axios.create({ baseURL: /^https?:\/\//i.test(baseURL) ? baseURL : '', timeout: 15_000 });

// Axios schedules async interceptors after invocation. Stamp at invocation so a
// logout/login in that gap cannot silently dispatch A's request using B's token.
const configIndex: Record<string, number> = {
  request: 0, get: 1, delete: 1, head: 1, options: 1,
  post: 2, put: 2, patch: 2, postForm: 2, putForm: 2, patchForm: 2,
};
function bindSession(args: unknown[], index: number): unknown[] {
  // request(url, config) and the callable instance also accept a URL first.
  if (index === 0 && typeof args[0] === 'string') index = 1;
  args[index] = { ...(args[index] as object | undefined), _sessionGeneration: getSessionGeneration() };
  return args;
}
export const http = new Proxy(client, {
  apply(target, thisArg, args) {
    return Reflect.apply(target, thisArg, bindSession(args, 0));
  },
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver);
    const index = typeof property === 'string' ? configIndex[property] : undefined;
    return index === undefined ? value : (...args: unknown[]) => Reflect.apply(value, target, bindSession(args, index));
  },
});

const REFRESH_LEAD_MS = 60_000;
const refreshes = new Map<number, Promise<StoredTokens | null>>();

function refreshOnce(refreshToken: string, session: number): Promise<StoredTokens | null> {
  const existing = refreshes.get(session);
  if (existing) return existing;
  const pending = refreshTokens(refreshToken)
    .then(resp => saveTokens({
      accessToken: resp.access_token,
      idToken: resp.id_token,
      refreshToken: resp.refresh_token ?? refreshToken,
      tokenType: resp.token_type,
      expiresIn: resp.expires_in,
    }, session))
    .catch(err => {
      assertSessionGeneration(session);
      if (err instanceof TokenRefreshError && err.kind === 'permanent') return null;
      throw err instanceof TokenRefreshError ? err : new TokenRefreshError('temporary');
    })
    .finally(() => { refreshes.delete(session); });
  refreshes.set(session, pending);
  return pending;
}

let redirectedSession: number | null = null;
function endSession(reason: string, session: number): void {
  assertSessionGeneration(session);
  if (redirectedSession === session && !readStoredTokens()) return;
  clearStoredTokens();
  if (typeof window === 'undefined') return;
  redirectedSession = getSessionGeneration();
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/login?next=${next}&error=${reason}`);
}

http.interceptors.request.use(async cfg => {
  const session = cfg._sessionGeneration!;
  assertSessionGeneration(session);
  const stored = readStoredTokens();
  // A malformed storage record can itself end the session while being read.
  assertSessionGeneration(session);
  if (!stored) return cfg;
  let usable: StoredTokens | null = stored;
  if (Date.now() >= stored.expiresAt - REFRESH_LEAD_MS) {
    usable = stored.refreshToken ? await refreshOnce(stored.refreshToken, session) : null;
    assertSessionGeneration(session);
    if (!usable) {
      endSession('session_expired', session);
      throw new Error('Your session expired. Please sign in again.');
    }
  }
  cfg.headers.Authorization = `Bearer ${usable.accessToken}`;
  return cfg;
});

http.interceptors.response.use(
  res => {
    assertSessionGeneration(res.config._sessionGeneration!);
    return res;
  },
  err => {
    const session = err?.config?._sessionGeneration;
    if (typeof session === 'number') {
      assertSessionGeneration(session);
      if (err?.response?.status === 401) endSession('unauthorized', session);
    }
    return Promise.reject(err);
  },
);
