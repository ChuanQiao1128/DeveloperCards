import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ change: undefined as undefined | ((next: string) => void), remove: vi.fn() }));
vi.mock('react-native', () => ({ AppState: { addEventListener: (_: string, callback: (next: string) => void) => { state.change = callback; return { remove: state.remove }; } } }));
import { useResendCooldown } from '../../src/auth/useResendCooldown';

let tree: renderer.ReactTestRenderer;
let value: ReturnType<typeof useResendCooldown>;
function Harness({ sentAt }: { sentAt?: number }) { value = useResendCooldown(sentAt); return null; }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T00:00:00Z'));
  state.remove.mockClear();
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); vi.useRealTimers(); });

it('includes time elapsed since the initial send and catches up on foreground without ticking timers', async () => {
  await act(async () => { tree = renderer.create(<Harness sentAt={Date.now() - 20_000} />); });
  expect(value.cooldownSec).toBe(40);
  vi.setSystemTime(Date.now() + 61_000);
  await act(async () => { state.change?.('active'); });
  expect(value.cooldownSec).toBe(0);
  expect(state.remove).toHaveBeenCalledOnce();
});

it('starts only after a successful send and removes its listener on unmount', async () => {
  await act(async () => { tree = renderer.create(<Harness />); });
  expect(value.cooldownSec).toBe(0);
  await act(async () => value.startCooldown());
  expect(value.cooldownSec).toBe(60);
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(value.cooldownSec).toBe(55);
  await act(async () => tree.unmount());
  expect(state.remove).toHaveBeenCalledOnce();
});
