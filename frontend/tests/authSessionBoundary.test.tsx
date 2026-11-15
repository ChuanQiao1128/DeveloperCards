// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { clearTokens, saveTokens } from '../src/auth/tokenStore';

function login(email: string) {
  const idToken = `header.${btoa(JSON.stringify({ email, sub: email }))}.signature`;
  saveTokens({ accessToken: `${email}-access`, idToken, refreshToken: `${email}-refresh`, expiresIn: 3600 });
}
function Editor() {
  const { user } = useAuth();
  const [draft, setDraft] = useState('');
  return <><output>{user?.email ?? 'signed out'}</output><input aria-label="draft" value={draft} onChange={e => setDraft(e.target.value)} /></>;
}
afterEach(() => { cleanup(); clearTokens(); });
it('updates auth, clears query/mutation caches and remounts local drafts at every sign-in boundary', () => {
  login('A');
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><AuthProvider><Editor /></AuthProvider></QueryClientProvider>);
  client.setQueryData(['private'], 'A private data');
  client.getMutationCache().build(client, { mutationKey: ['A-write'] });
  fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'A unsaved draft' } });
  act(() => login('B'));
  expect(screen.getByRole('status').textContent).toBe('B');
  expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('');
  expect(client.getQueryData(['private'])).toBeUndefined();
  expect(client.getMutationCache().getAll()).toEqual([]);
  fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'B unsaved draft' } });
  act(() => { clearTokens(); login('B'); });
  expect(screen.getByRole('status').textContent).toBe('B');
  expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('');
  act(() => clearTokens());
  expect(screen.getByRole('status').textContent).toBe('signed out');
  client.clear();
});
