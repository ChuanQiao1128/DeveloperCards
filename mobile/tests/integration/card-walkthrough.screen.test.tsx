import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveDeck, writeStorage, grant, recordFunnel } = vi.hoisted(() => ({
  resolveDeck: vi.fn(), writeStorage: vi.fn(), grant: vi.fn(), recordFunnel: vi.fn(),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async () => null), setItem: writeStorage, removeItem: writeStorage,
} }));
vi.mock('../../src/content/deckRepository', () => ({ resolveDeckBySlug: resolveDeck }));
vi.mock('../../src/features/gacha/rewards/deckWallet', () => ({ ensureDeckBootstrap: grant }));
vi.mock('../../src/telemetry/funnel', () => ({ recordFunnelEvent: recordFunnel }));
vi.mock('../../src/features/gacha/study/cardLangPrefs', () => ({ useCardLangPref: () => 'en', setCardLangPref: vi.fn() }));
vi.mock('../../src/features/gacha/study/useDeckTranslations', () => ({
  useDeckTranslations: () => ({ status: 'none' }), translationsForCard: () => undefined,
}));
vi.mock('../../src/components/CodeBlock', () => ({ default: () => null }));
vi.mock('../../src/config/featureFlags', () => ({ getFeatureFlags: () => ({ cardSource: { enabled: false } }) }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children) }));
vi.mock('react-native', () => {
  const React = require('react');
  const element = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
  return { View: element('View'), Text: element('Text'), ScrollView: element('ScrollView'),
    Pressable: element('Pressable'), StyleSheet: { create: (value: any) => value },
    Platform: { OS: 'ios', select: (value: any) => value.ios ?? value.default } };
});

import CardWalkthroughScreen from '../../src/screens/CardWalkthroughScreen';
const trees: renderer.ReactTestRenderer[] = [];
const navigation = { goBack: vi.fn(), navigate: vi.fn() };
const deck = () => ({ Slug: 'aws-saa-fundamentals', Title: 'Basics', Locale: 'en-US', Version: '1',
  Cards: Array.from({ length: 7 }, (_, i) => ({ StableUid: `c${7 - i}`, OrderInDeck: 7 - i,
    Question: `Question ${7 - i}`, Explanation: `Answer ${7 - i}`, Difficulty: 1,
    ...(i === 6 ? { Teaching: { schema: 'teaching-v1', answer: 'Answer 1', keyPoint: 'Why 1', mustAnswer: ['Answer 1'], prerequisites: ['c7'] } } : {}),
  })),
});
const host = (tree: renderer.ReactTestRenderer, id: string) => tree.root.findAll((node) => typeof node.type === 'string' && node.props.testID === id)[0];
const content = (tree: renderer.ReactTestRenderer) => JSON.stringify(tree.toJSON());
async function press(tree: renderer.ReactTestRenderer, id: string) { await act(async () => host(tree, id).props.onPress()); }
async function mount(slug = 'aws-saa-fundamentals') {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<CardWalkthroughScreen navigation={navigation as any} route={{ params: { slug } } as any} />); });
  trees.push(tree); return tree;
}
beforeEach(() => { vi.clearAllMocks(); resolveDeck.mockResolvedValue(deck()); });
afterEach(async () => { await act(async () => { for (const tree of trees.splice(0)) tree.unmount(); }); });

describe('optional reading walkthrough', () => {
  it('reads five ordered cards, consumes double taps once, and never changes study, rewards or onboarding', async () => {
    const tree = await mount();
    expect(content(tree)).toContain('Question 1');
    expect(host(tree, 'walkthrough-next')).toBeUndefined();
    for (let i = 1; i <= 5; i++) {
      expect(content(tree)).toContain(`Question ${i}`);
      await press(tree, 'walkthrough-reveal');
      const next = host(tree, i === 1 ? 'walkthrough-unclear' : 'walkthrough-next');
      await act(async () => { next.props.onPress(); next.props.onPress(); });
    }
    expect(host(tree, 'walkthrough-complete')).toBeTruthy();
    expect(content(tree)).toContain('1');
    expect(content(tree)).toContain('card still felt');
    expect(content(tree)).not.toContain('Question 6');
    expect(writeStorage).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
    expect(recordFunnel).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
    await press(tree, 'walkthrough-done');
    expect(navigation.goBack).toHaveBeenCalledOnce();
    const restarted = await mount();
    expect(content(restarted)).toContain('Question 1');
    expect(host(restarted, 'walkthrough-next')).toBeUndefined();
  });

  it('opens a foundation and returns to the same revealed card', async () => {
    const tree = await mount();
    await press(tree, 'walkthrough-reveal');
    await press(tree, 'prereq-chip-c7');
    expect(content(tree)).toContain('Question 7');
    expect(host(tree, 'walkthrough-next')).toBeUndefined();
    await press(tree, 'walkthrough-foundation-back');
    expect(content(tree)).toContain('Question 1');
    expect(host(tree, 'walkthrough-next')).toBeTruthy();
    expect(writeStorage).not.toHaveBeenCalled();
  });

  it('handles unavailable cards, retry and close without changing progress', async () => {
    resolveDeck.mockRejectedValueOnce(new Error('file unavailable'));
    const tree = await mount();
    expect(host(tree, 'walkthrough-retry')).toBeTruthy();
    await press(tree, 'walkthrough-retry');
    expect(content(tree)).toContain('Question 1');
    await press(tree, 'walkthrough-close');
    expect(navigation.goBack).toHaveBeenCalledOnce();
    expect(writeStorage).not.toHaveBeenCalled();
  });

  it('rejects other deck routes and deduplicates a short deck', async () => {
    const rejected = await mount('csharp-basics');
    expect(host(rejected, 'walkthrough-retry')).toBeTruthy();
    expect(resolveDeck).not.toHaveBeenCalled();
    const short = deck(); short.Cards = [short.Cards[6], short.Cards[6]];
    resolveDeck.mockResolvedValueOnce(short);
    const tree = await mount();
    await press(tree, 'walkthrough-reveal');
    await press(tree, 'walkthrough-next');
    expect(host(tree, 'walkthrough-complete')).toBeTruthy();
  });
});
