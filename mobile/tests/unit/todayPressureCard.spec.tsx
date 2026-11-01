import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodayCounts } from '../../src/features/gacha/contracts';

const viewport = vi.hoisted(() => ({ width: 390, fontScale: 1 }));
beforeEach(() => { viewport.width = 390; viewport.fontScale = 1; });

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    useWindowDimensions: () => ({ width: viewport.width, height: 844, scale: 3, fontScale: viewport.fontScale }),
    StyleSheet: { create: (styles: any) => styles },
  };
});

import TodayPressureCard from '../../src/features/gacha/components/TodayPressureCard';

function counts(overrides: Partial<TodayCounts> = {}): TodayCounts {
  return {
    totalDueAllDecks: 0,
    selectedDue: 0,
    selectedNew: 0,
    selectedMastered: 0,
    selectedOwned: 0,
    normalCount: 0,
    eliteCount: 0,
    bossCount: 0,
    ...overrides,
  };
}

async function render(c: TodayCounts, compact = false) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<TodayPressureCard counts={c} selectedDeckTitle="AWS Architect Basics" totalCards={347} masteredCount={3} compact={compact} />);
  });
  return tree;
}

const texts = (tree: renderer.ReactTestRenderer) => tree.root.findAll(node => (node.type as any) === 'Text').map(node => String(node.props.children)).join('\n');

describe('course progress', () => {
  it.each([true, false])('distinguishes a finished batch from the full course, compact=%s', async compact => {
    const tree = await render(counts({ selectedOwned: 18, selectedMastered: 18 }), compact);
    expect(texts(tree)).toContain('18 / 347 cards unlocked');
    expect(texts(tree)).toContain('18 studied at least once · 3 mastered');
    const progress = tree.root.findAll(node => (node.type as any) === 'View' && node.props.accessibilityRole === 'progressbar')[0];
    expect(progress.props.accessibilityValue).toEqual({ min: 0, max: 347, now: 18 });
    expect(texts(tree)).not.toContain('Collection complete');
  });

  it('keeps due and unstudied cards separate from total progress', async () => {
    const tree = await render(counts({ selectedOwned: 23, selectedMastered: 18, selectedDue: 2, selectedNew: 5, totalDueAllDecks: 99 }));
    const value = (id: string) => tree.root.findByProps({ testID: id }).findAll(node => (node.type as any) === 'Text').map(node => String(node.props.children));
    expect(value('home-today-count-normal')).toEqual(['2', 'Due for review']);
    expect(value('home-today-count-elite')).toEqual(['5', 'New to learn']);
    expect(texts(tree)).not.toContain('99');
  });

  it.each([true, false])('leaves labels and progress unrestricted at accessibility sizes, compact=%s', async compact => {
    viewport.fontScale = 3.2;
    const tree = await render(counts({ selectedOwned: 18, selectedMastered: 18, selectedDue: 1 }), compact);
    for (const text of tree.root.findAll(node => (node.type as any) === 'Text')) {
      expect(text.props.numberOfLines).toBeUndefined();
      expect(text.props.allowFontScaling).not.toBe(false);
      expect(text.props.maxFontSizeMultiplier).toBeUndefined();
    }
    const row = tree.root.findByProps({ testID: 'home-today-count-grid' });
    expect(row.props.style).toContainEqual(expect.objectContaining({ flexDirection: 'column' }));
  });

  it('only shows first-card guidance for an empty collection', async () => {
    const empty = await render(counts());
    expect(texts(empty)).toContain('0 / 347 cards unlocked');
    expect(empty.root.findAll(node => (node.type as any) === 'Text' && node.props.testID === 'home-today-empty')).toHaveLength(1);
    const held = await render(counts({ selectedOwned: 1 }));
    expect(held.root.findAllByProps({ testID: 'home-today-empty' })).toHaveLength(0);
  });
});
