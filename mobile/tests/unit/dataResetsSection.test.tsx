// 2026-11-01 settings redesign: both start-over actions live in one
// DataResetsSection card (moved out of AccountSection and StudySection).
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles },
  };
});

import { DataResetsSection, DATA_RESETS_COPY } from '../../src/features/gacha/settings/data/DataResetsSection';

function render(props?: Partial<Parameters<typeof DataResetsSection>[0]>) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <DataResetsSection
        resettingSchedule={false}
        onResetReviewSchedule={vi.fn()}
        hasActiveDeck={false}
        {...props}
      />,
    );
  });
  return tree;
}

const pressable = (tree: renderer.ReactTestRenderer, testID: string) =>
  tree.root.find((node) => (node.type as any) === 'Pressable' && node.props?.testID === testID);

describe('DataResetsSection', () => {
  it('always shows the review-schedule reset and calls its handler', () => {
    const onResetReviewSchedule = vi.fn();
    const tree = render({ onResetReviewSchedule });
    const cta = pressable(tree, 'settings-reset-review-schedule');
    expect(cta.props.accessibilityRole).toBe('button');
    act(() => cta.props.onPress());
    expect(onResetReviewSchedule).toHaveBeenCalledTimes(1);
  });

  it('shows the deck reset only for an active deck', () => {
    const withoutDeck = render();
    expect(withoutDeck.root.findAll((node) => node.props?.testID === 'settings-reset-deck-progress')).toHaveLength(0);

    const onResetDeck = vi.fn();
    const tree = render({ hasActiveDeck: true, onResetDeckProgress: onResetDeck });
    const cta = pressable(tree, 'settings-reset-deck-progress');
    act(() => cta.props.onPress());
    expect(onResetDeck).toHaveBeenCalledTimes(1);
  });

  it('marks the schedule reset busy while running', () => {
    const tree = render({ resettingSchedule: true });
    const texts = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => node.props.children);
    expect(texts).toContain(DATA_RESETS_COPY.reviewBusy);
  });
});
