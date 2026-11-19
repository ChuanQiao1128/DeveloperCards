import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  slug: 'aws-saa-fundamentals' as string | null,
  load: vi.fn(),
  loadCheckpoint: vi.fn(),
  focus: null as null | (() => void),
}));

vi.mock('react-native', () => {
  const host = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
  return {
    ...Object.fromEntries(['View', 'Text', 'ScrollView', 'Pressable', 'ActivityIndicator'].map(name => [name, host(name)])),
    AppState: { addEventListener: () => ({ remove: () => {} }) },
    StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1, absoluteFill: {} },
  };
});
vi.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => () => void) => React.useEffect(() => {
    let blur = effect();
    fixture.focus = () => {
      blur();
      blur = effect();
    };
    return () => blur();
  }, [effect]),
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
vi.mock('../../src/features/domains/domainProgressDeck', () => ({ resolveDomainProgressSlug: async () => fixture.slug }));
vi.mock('../../src/features/domains/loadDomainProgress', () => ({ loadDomainProgress: fixture.load }));
vi.mock('../../src/features/gacha/session/sessionCheckpoint', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/features/gacha/session/sessionCheckpoint')>(),
  loadSessionCheckpoint: fixture.loadCheckpoint,
}));
vi.mock('../../src/features/gacha/session/sessionNavigation', () => ({ captureSessionNavigation: async () => null }));
vi.mock('../../src/premium/premiumStore', () => ({ usePremiumUser: () => false }));
vi.mock('../../src/review/storage', () => ({ captureProgressUserSub: async () => 'anon' }));

import ReviewOverviewScreen from '../../src/screens/ReviewOverviewScreen';
import { computeDomainProgress } from '../../src/features/domains/domainProgress';
import { notifyProgressChanged } from '../../src/sync/progressChanges';
import type { CardExport } from '../../src/types/deckExport';

const slug = 'aws-saa-fundamentals';
const now = new Date(2026, 10, 20, 12);
const domainNumbers = [1, 1, 2, 3, 4];
const cards: CardExport[] = domainNumbers.map((domain, index) => ({
  StableUid: `card-${index}`, OrderInDeck: index + 1, Difficulty: 1, Question: '?', Topic: null,
  Tags: { domain: String(domain) },
}));

function snapshot(learned: number) {
  const progress = cards.slice(0, learned).map(card => ({
    stableUid: card.StableUid, stage: 5,
    lastReviewedAt: now.getTime() - 86_400_000,
    nextReviewAt: now.getTime() - 1000,
  }));
  return {
    now, progress, owned: null, userSub: 'anon', deck: { Cards: cards, Version: '1', Title: 'AWS SAA' },
    domains: computeDomainProgress(slug, cards, progress, null, [], now),
  };
}

async function renderScreen() {
  let tree!: renderer.ReactTestRenderer;
  const navigate = vi.fn();
  await act(async () => {
    tree = renderer.create(<ReviewOverviewScreen navigation={{ navigate } as any} route={{ name: 'ReviewOverview', key: 'review' }} />);
  });
  const byId = (id: string) => tree.root.find(node => typeof node.type === 'string' && node.props.testID === id);
  return { tree, navigate, byId };
}

const text = (node: renderer.ReactTestInstance) => node.findAllByType('Text' as any)
  .map(item => [item.props.children].flat().join('')).join('\n');

describe('Review overview', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    fixture.slug = slug;
    fixture.load.mockReset().mockResolvedValue(snapshot(1));
    fixture.loadCheckpoint.mockReset().mockResolvedValue(null);
  });

  it('shows the four domain proportions and opens details for the tapped domain', async () => {
    const { byId, navigate } = await renderScreen();
    expect(text(byId('review-domain-d1'))).toContain('50%');
    expect(text(byId('review-domain-d1'))).toContain('1/2 learned');
    expect(text(byId('review-domain-d1'))).toContain('1 mastered · 1 due');
    for (const key of ['d2', 'd3', 'd4']) expect(text(byId(`review-domain-${key}`))).toContain('0%');
    expect(text(byId('review-due-today'))).toBe('1 due today');
    act(() => byId('review-domain-d2').props.onPress());
    expect(navigate).toHaveBeenCalledWith('DomainProgress', { slug, domainKey: 'd2' });
    act(() => byId('review-start').props.onPress());
    expect(navigate).toHaveBeenCalledWith('SessionCard', { slug });
  });

  it('updates statistics and offers to continue a matching checkpoint on return', async () => {
    const { byId, navigate } = await renderScreen();
    expect(text(byId('review-start'))).toBe('Start review');
    fixture.load.mockResolvedValue(snapshot(2));
    fixture.loadCheckpoint.mockResolvedValue({ currentUid: 'card-1' });
    await act(async () => fixture.focus?.());
    expect(text(byId('review-domain-d1'))).toContain('100%');
    expect(text(byId('review-start'))).toBe('Continue review');
    expect(fixture.loadCheckpoint).toHaveBeenLastCalledWith('anon', slug, expect.objectContaining({
      context: JSON.stringify([slug, 'mixed', 0, '', null, false]),
    }));
    act(() => byId('review-start').props.onPress());
    expect(navigate).toHaveBeenCalledWith('SessionCard', { slug });
  });

  it('keeps the standard session entry on a fresh installation', async () => {
    fixture.slug = null;
    const { byId, navigate, tree } = await renderScreen();
    expect(text(tree.root)).toContain('Open a card pack to see its progress.');
    expect(text(tree.root)).not.toContain('0%');
    act(() => byId('review-start').props.onPress());
    expect(navigate).toHaveBeenCalledWith('SessionCard', {});
  });

  it('refreshes the open review overview when the active pack receives progress', async () => {
    const { byId, tree } = await renderScreen();
    fixture.load.mockResolvedValue(snapshot(2));
    await act(async () => notifyProgressChanged({ userSub: 'other-account', deckSlug: slug }));
    expect(text(byId('review-domain-d1'))).toContain('50%');
    await act(async () => notifyProgressChanged({ userSub: 'anon', deckSlug: slug }));
    expect(text(byId('review-domain-d1'))).toContain('100%');
    await act(async () => tree.unmount());
  });
});
