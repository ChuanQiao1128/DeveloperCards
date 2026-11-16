// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { fetchLearner, fetchLearners, fetchOperations, parseConsoleData } from '../src/api/consoleOperations';
import { clearTokens, saveTokens } from '../src/auth/tokenStore';
import { detail, envelope, learners, operations } from './support/consoleOperationsFixture';
const get = vi.hoisted(() => vi.fn());
vi.mock('../src/api/http', () => ({ http: { get } }));
beforeEach(() => { get.mockReset(); });
afterEach(() => { clearTokens(); });
it('keeps explicit unknown metrics, raw access and evaluated download decisions separate', () => {
  expect(parseConsoleData('operations', operations)).toEqual(operations);
  expect(parseConsoleData('detail', detail)).toEqual(detail);
  expect(parseConsoleData('learners', learners)).toEqual(learners);
});
it('rejects malformed, missing, out-of-range and unbounded source fields instead of inventing zero or free', () => {
  for (const bad of [ { ...operations, database: { ...operations.database, reachable: undefined } }, { ...operations, synthetic: { ...operations.synthetic, state: 'healthy' } } ]) expect(() => parseConsoleData('operations', bad)).toThrow();
  expect(() => parseConsoleData('detail', { ...detail, progress: { ...detail.progress, uniqueReceivedEventCount: -1 } })).toThrow();
  expect(() => parseConsoleData('detail', { ...detail, entitlements: { ...detail.entitlements, revenueCat: { ...detail.entitlements.revenueCat, expiresAtMs: 1e100 } } })).toThrow();
  expect(() => parseConsoleData('learners', { ...learners, items: Array(101).fill(learners.items[0]) })).toThrow();
  expect(() => parseConsoleData('learners', { ...learners, scope: 'all_registrations' })).toThrow();
});
it('sends literal search and opaque cursors with cancellation, without encoding them into browser state', async () => {
  get.mockResolvedValue(envelope(learners));
  const controller = new AbortController();
  await fetchLearners('  a%_\\@example.invalid  ', 'opaque-cursor', controller.signal);
  expect(get).toHaveBeenCalledWith('/api/v1/admin/learners', expect.objectContaining({ signal: controller.signal, params: { query: 'a%_\\@example.invalid', cursor: 'opaque-cursor', limit: 25 } }));
  get.mockResolvedValue(envelope(detail));
  await fetchLearner('subject space', 'deck-cursor');
  expect(get).toHaveBeenLastCalledWith('/api/v1/admin/learners/subject%20space', expect.objectContaining({ params: { deckCursor: 'deck-cursor', deckLimit: 25 } }));
});
it('sanitizes untrusted backend messages while retaining safe error code and trace reference', async () => {
  get.mockRejectedValue({ response: { status: 503, data: { error: { code: 'SERVICE_UNAVAILABLE', message: 'secret@example.invalid SQL token' }, traceId: 'safe-trace' } } });
  await expect(fetchOperations()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', traceId: 'safe-trace' });
  await expect(fetchOperations()).rejects.not.toThrow('secret@example.invalid');
});
it.each(['success', 'forbidden'])('rejects delayed earlier-identity %s without affecting the new session', async outcome => {
  let resolve!: (value: unknown) => void;
  let reject!: (value: unknown) => void;
  get.mockImplementation(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
  const pending = fetchLearners('');
  saveTokens({ accessToken: 'B', idToken: 'B', expiresIn: 3600 });
  if (outcome === 'success') resolve(envelope(learners));
  else reject({ response: { status: 403, data: { error: { code: 'FORBIDDEN' } } } });
  await expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(sessionStorage.getItem('devcards:tokens')).toContain('B');
});
