// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { useCreateCard, useDeleteCard, useUpdateCard } from '../src/hooks/useCards';
import { http } from '../src/api/http';
import { clearTokens, getSessionGeneration, readStoredTokens, saveTokens } from '../src/auth/tokenStore';
import { QueryKeys } from '../src/api/queryClient';

const cognito = vi.hoisted(() => ({ refreshTokens: vi.fn() }));
vi.mock('../src/auth/cognito', async original => ({ ...await original<typeof import('../src/auth/cognito')>(), ...cognito }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const card = { id: 101, deckId: 7, stableUid: 'uid', question: 'A edit', version: 2 };
const envelope = { success: true, data: card, error: null, traceId: '' };
function login(who: string, expiresIn = 3600) {
  saveTokens({ accessToken: `${who}-access`, idToken: `${who}-id`, refreshToken: `${who}-refresh`, expiresIn });
}
let client: QueryClient;
let originalAdapter: typeof http.defaults.adapter;
let sent: ReturnType<typeof vi.fn<AxiosAdapter>>;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  clearTokens(); login('A'); cognito.refreshTokens.mockReset();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false, networkMode: 'always' } } });
  originalAdapter = http.defaults.adapter;
  sent = vi.fn<AxiosAdapter>(async (config: InternalAxiosRequestConfig) => ({ config, data: envelope, status: 200, statusText: 'OK', headers: {} }));
  http.defaults.adapter = sent;
});
afterEach(() => { cleanup(); client.clear(); clearTokens(); http.defaults.adapter = originalAdapter; vi.restoreAllMocks(); });
const kinds = ['create', 'update', 'delete'] as const;
function useWrite(kind: typeof kinds[number]) {
  const create = useCreateCard(); const update = useUpdateCard(); const remove = useDeleteCard();
  // Same structural shape at the public boundary, no mutation internals mocked.
  return kind === 'create' ? create : kind === 'update' ? update : remove;
}
const variables = { id: 101, cardId: 101, deckId: 7, expectedVersion: 1, question: 'A edit' };

describe('card mutation dispatch is bound before TanStack scheduling', () => {
  for (const kind of kinds) for (const method of ['mutateAsync', 'mutate'] as const) {
    it(`does not dispatch queued A ${kind} through ${method} after immediate B sign-in`, async () => {
      const { result } = renderHook(() => useWrite(kind), { wrapper });
      const success = vi.fn(); const error = vi.fn(); const settled = vi.fn();
      let outcome: Promise<unknown> | undefined;
      act(() => {
        if (method === 'mutateAsync') outcome = result.current.mutateAsync(variables, { onSuccess: success, onError: error, onSettled: settled }).catch(e => e);
        else result.current.mutate(variables, { onSuccess: success, onError: error, onSettled: settled });
        expect(sent).not.toHaveBeenCalled();
        login('B');
      });
      if (outcome) expect(await outcome).toMatchObject({ code: 'SESSION_CHANGED' });
      else await waitFor(() => expect(result.current.isError).toBe(true));
      expect(sent).not.toHaveBeenCalled();
      expect(readStoredTokens()?.accessToken).toBe('B-access');
      expect(success).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(settled).not.toHaveBeenCalled();
    });
  }
});

describe('old mutation completions cannot affect B', () => {
  for (const kind of kinds) for (const stage of ['onSuccess', 'onSettled'] as const) {
    it(`ignores A ${kind} released after the global ${stage} await`, async () => {
      const entered = deferred<void>(); const release = deferred<void>();
      client = new QueryClient({
        defaultOptions: { mutations: { retry: false, networkMode: 'always' } },
        mutationCache: new MutationCache({ [stage]: async () => { entered.resolve(); await release.promise; } }),
      });
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      const { result } = renderHook(() => useWrite(kind), { wrapper });
      const success = vi.fn(); const error = vi.fn(); const settled = vi.fn();
      const outcome = result.current.mutateAsync(variables, { onSuccess: success, onError: error, onSettled: settled }).catch(e => e);
      await entered.promise;
      expect(sent).toHaveBeenCalledTimes(1);
      expect(sent.mock.calls[0][0].headers.get('Authorization')).toBe('Bearer A-access');
      act(() => { login('B'); });
      const bCard = { ...card, question: 'B fresh row' };
      client.setQueryData(QueryKeys.cards(7), [bCard]); client.setQueryData(QueryKeys.card(101), bCard);
      invalidate.mockClear();
      await act(async () => { release.resolve(); await outcome; });
      expect(await outcome).toMatchObject({ code: 'SESSION_CHANGED' });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.data).toBeUndefined();
      expect(client.getQueryData(QueryKeys.cards(7))).toEqual([bCard]);
      expect(client.getQueryData(QueryKeys.card(101))).toEqual(bCard);
      expect(client.getQueryState(QueryKeys.cards(7))?.isInvalidated).toBe(false);
      expect(client.getQueryState(QueryKeys.card(101))?.isInvalidated).toBe(false);
      expect(invalidate).not.toHaveBeenCalled();
      expect(success).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(settled).not.toHaveBeenCalled();
    });
  }
  it('keeps result/variables/callback shapes and permits ordinary credential refresh inside the same session', async () => {
    login('A', -60);
    cognito.refreshTokens.mockResolvedValue({ access_token: 'A-refreshed', id_token: 'A-refreshed-id', expires_in: 3600, token_type: 'Bearer' });
    const session = getSessionGeneration();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateCard(), { wrapper });
    const success = vi.fn();
    const written = await result.current.mutateAsync(variables, { onSuccess: success });
    expect(written).toEqual({ result: envelope, deckId: 7, id: 101 });
    expect(getSessionGeneration()).toBe(session);
    expect(sent.mock.calls[0][0].headers.get('Authorization')).toBe('Bearer A-refreshed');
    expect(cognito.refreshTokens).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(success).toHaveBeenCalledTimes(1);
    expect(success.mock.calls[0][1]).toBe(variables);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.variables).toBe(variables);
  });
});
