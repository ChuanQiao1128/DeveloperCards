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

import { StudySection, STUDY_COPY } from '../../src/features/gacha/settings/study/StudySection';
import { CARD_LANG_ROW_COPY } from '../../src/features/gacha/settings/study/CardLangRow';

function render() {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<StudySection />);
  });
  return tree;
}

describe('StudySection', () => {
  it('shows the Study section without a control to return to two ratings', () => {
    const tree = render();
    expect(tree.root.findAll((node) => node.props?.testID === 'settings-four-buttons-toggle')).toHaveLength(0);
    const texts = tree.root.findAll((node) => (node.type as any) === 'Text').map((node) => node.props.children);
    expect(texts).toContain(STUDY_COPY.title);
    expect(texts).not.toContain('Show all four rating buttons');
  });

  it('shows the card language row only when the screen passes it', () => {
    expect(render().root.findAll((node) => node.props?.testID === 'settings-card-lang-row')).toHaveLength(0);

    const onSelect = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <StudySection cardLang={{ value: 'en', onSelect }} />,
      );
    });
    const choice = (id: string) => tree.root.find((node) => (node.type as any) === 'Pressable' && node.props?.testID === id);
    const texts = tree.root.findAll((node) => (node.type as any) === 'Text').map((node) => node.props.children);
    expect(texts).toContain(CARD_LANG_ROW_COPY.label);
    expect(CARD_LANG_ROW_COPY.label).toBe('Card language');
    expect(texts).toEqual(expect.arrayContaining(['English', '中文']));
    expect(choice('settings-card-lang-en').props.accessibilityRole).toBe('radio');
    expect(choice('settings-card-lang-en').props.accessibilityState).toEqual({ checked: true });
    expect(choice('settings-card-lang-zh').props.accessibilityState).toEqual({ checked: false });
    expect(choice('settings-card-lang-zh').props.accessibilityLabel).toBe('Chinese');

    act(() => choice('settings-card-lang-en').props.onPress());
    expect(onSelect).not.toHaveBeenCalled();
    act(() => choice('settings-card-lang-zh').props.onPress());
    expect(onSelect).toHaveBeenCalledWith('zh-CN');
  });

});
