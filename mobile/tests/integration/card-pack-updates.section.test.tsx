import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn(), check: vi.fn() }));
vi.mock('../../src/content/deckRepository', () => ({ getInstalledDeckInfo: mocks.read }));
vi.mock('../../src/content/cardPackUpdates', () => ({ checkAndUpdateCardPack: mocks.check }));
vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...p }: any) => React.createElement('View', p, children),
    Text: ({ children, ...p }: any) => React.createElement('Text', p, children),
    Pressable: ({ children, ...p }: any) => React.createElement('Pressable', p, children),
    StyleSheet: { create: (s: any) => s },
  };
});
import { CardPackUpdatesSection } from '../../src/features/gacha/settings/content/CardPackUpdatesSection';

let screen: renderer.ReactTestRenderer;
const old = { version: 'old-build', installedAtMs: 100 };
const updated = { installed: { version: 'new-build', installedAtMs: 200 }, latestVersion: 'new-build', checkedAtMs: 300 };
const element = (id: string) => screen.root.find((node) => typeof node.type === 'string' && node.props.testID === id);
const button = () => element('card-pack-check-updates');
const status = () => element('card-pack-update-status').children.join('');
const version = () => element('card-pack-installed-version').children.join('');
async function mount() {
  await act(async () => { screen = renderer.create(<CardPackUpdatesSection key="a" slug="aws" label="AWS Basics" />); });
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetAllMocks(); mocks.read.mockResolvedValue(old); mocks.check.mockResolvedValue(updated); });
afterEach(async () => { if (screen) await act(async () => { screen.unmount(); }); vi.unstubAllGlobals(); });

describe('card-pack update controls', () => {
  it('shows the installed version without claiming it is current or starting a network check', async () => {
    await mount();
    expect(version()).toBe('old-build');
    expect(status()).toBe('Check for the latest cards');
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it('shows updating, ignores duplicate presses, and confirms only the resulting installed version', async () => {
    let finish!: (value: typeof updated) => void;
    mocks.check.mockImplementation((_slug, progress) => { progress({ phase: 'updating', latestVersion: 'new-build' }); return new Promise((resolve) => { finish = resolve; }); });
    await mount();
    await act(async () => { button().props.onPress(); button().props.onPress(); });
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(status()).toBe('Updating card pack…');
    expect(button().props.disabled).toBe(true);
    expect(version()).toBe('old-build');
    await act(async () => { finish(updated); });
    expect(status()).toBe('Up to date');
    expect(version()).toBe('new-build');
  });

  it('keeps the known installed version after failure and allows an explicit retry', async () => {
    mocks.check.mockImplementationOnce((_slug, progress) => {
      progress({ phase: 'checked', latestVersion: 'new-build' });
      return Promise.reject(new Error('download failed'));
    });
    await mount();
    await act(async () => { button().props.onPress(); });
    expect(status()).toBe('Update not confirmed');
    expect(version()).toBe('old-build');
    expect(element('card-pack-latest-version').children.join('')).toBe('new-build');
    expect(button().props.disabled).toBe(false);
    await act(async () => { button().props.onPress(); });
    expect(status()).toBe('Up to date');
  });

  it('does not carry an old account result into a new keyed section', async () => {
    let finish!: (value: typeof updated) => void;
    mocks.check.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await mount();
    await act(async () => { button().props.onPress(); });
    mocks.read.mockResolvedValue({ version: 'account-b-build', installedAtMs: 100 });
    await act(async () => { screen.update(<CardPackUpdatesSection key="b" slug="aws" label="AWS Basics" />); });
    await act(async () => { finish(updated); });
    expect(version()).toBe('account-b-build');
    expect(status()).not.toBe('Up to date');
  });
});
