import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  const element = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
  return { View: element('View'), Text: element('Text'), ScrollView: element('ScrollView'),
    Pressable: element('Pressable'), StyleSheet: { create: (value: any) => value },
    Platform: { OS: 'ios', select: (value: any) => value.ios ?? value.default } };
});
vi.mock('../../src/components/CodeBlock', () => ({ default: () => null }));
vi.mock('../../src/config/featureFlags', () => ({ getFeatureFlags: () => ({ cardSource: { enabled: false } }) }));

import { CardAnswerSections } from '../../src/features/gacha/components/CardAnswerSections';
import { CardTextLangContext } from '../../src/features/gacha/components/CardTextLang';
import { LearningStudyView } from '../../src/features/gacha/components/LearningStudyView';
import { ReviewBody } from '../../src/features/gacha/components/ReviewBody';
import { buildPrerequisiteLabels } from '../../src/features/gacha/components/prerequisiteLabels';
import { resolveGoalChoices } from '../../src/features/gacha/audience/useGoalAvailability';

const trees: renderer.ReactTestRenderer[] = [];
const card = {
  StableUid: 'one', Question: 'How do you manage a private instance?', Difficulty: 2, OrderInDeck: 1,
  Teaching: { schema: 'teaching-v1', answer: 'Use the instance role and Session Manager.',
    keyPoint: 'The agent connects to the management service.', mustAnswer: ['Attach the role', 'Use Session Manager'],
    prerequisites: ['base'],
    'zh-CN': { answer: '关联实例角色，再用Session Manager。', keyPoint: 'Agent连接管理服务。' } },
};
async function mount(node: React.ReactElement) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(node); });
  trees.push(tree);
  return tree;
}
const host = (tree: renderer.ReactTestRenderer, id: string) => tree.root.findAll(
  (node) => typeof node.type === 'string' && node.props.testID === id)[0];
const text = (tree: renderer.ReactTestRenderer) => tree.root.findAll((node) => (node.type as any) === 'Text')
  .map((node) => Array.isArray(node.props.children) ? node.props.children.join('') : node.props.children).join('\n');

afterEach(async () => { await act(async () => { for (const tree of trees.splice(0)) tree.unmount(); }); });

describe('teaching in the learner chosen language', () => {
  it('keeps unreviewed English points behind an explicit Chinese disclosure and resets on the next card', async () => {
    const view = (value: any) => <CardTextLangContext.Provider value="zh-CN"><CardAnswerSections card={value} /></CardTextLangContext.Provider>;
    const tree = await mount(view(card));
    expect(text(tree)).toContain('关联实例角色');
    expect(text(tree)).toContain('合上答案');
    expect(text(tree)).not.toContain('Attach the role');
    expect(text(tree)).not.toContain('✓');
    await act(async () => host(tree, 'teaching-english-checklist-toggle').props.onPress());
    expect(text(tree)).toContain('Attach the role');
    await act(async () => tree.update(view({ ...card, StableUid: 'two' })));
    expect(text(tree)).not.toContain('Attach the role');
  });

  it('uses a complete Chinese checklist and falls back when it is incomplete', async () => {
    const localized = { ...card, Teaching: { ...card.Teaching,
      'zh-CN': { ...card.Teaching['zh-CN'], mustAnswer: ['关联角色', '使用Session Manager'] } } };
    const tree = await mount(<CardTextLangContext.Provider value="zh-CN"><CardAnswerSections card={localized} /></CardTextLangContext.Provider>);
    expect(text(tree)).toContain('关联角色');
    expect(host(tree, 'teaching-english-checklist-toggle')).toBeUndefined();
    const incomplete = { ...localized, Teaching: { ...localized.Teaching,
      'zh-CN': { ...localized.Teaching['zh-CN'], mustAnswer: ['仅有一项'] } } };
    await act(async () => tree.update(<CardTextLangContext.Provider value="zh-CN"><CardAnswerSections card={incomplete} /></CardTextLangContext.Provider>));
    expect(text(tree)).not.toContain('仅有一项');
    expect(host(tree, 'teaching-english-checklist-toggle')).toBeTruthy();
  });

  it.each(['learning', 'review'])('opens a named prerequisite from the %s view', async (kind) => {
    const onPressPrerequisite = vi.fn();
    const props = { card, prerequisiteLabels: { base: 'Instance roles' }, onPressPrerequisite };
    const tree = await mount(kind === 'learning'
      ? <LearningStudyView {...props} deckSlug="aws" revealed />
      : <ReviewBody {...props} faceUp onFlip={() => {}} />);
    const chip = host(tree, 'prereq-chip-base');
    expect(chip.props.disabled).toBe(false);
    expect(chip.props.accessibilityLabel).toContain('Instance roles');
    await act(async () => chip.props.onPress());
    expect(onPressPrerequisite).toHaveBeenCalledWith('base');
  });

  it('uses the bilingual topic as a prerequisite name, preserving technical terms', () => {
    const cards = [{ ...card, Topic: 'EBS encryption / EBS 加密' }];
    expect(buildPrerequisiteLabels(cards, 'zh-CN').one).toBe('EBS 加密');
    expect(buildPrerequisiteLabels(cards).one).toBe('EBS encryption');
  });
});

describe('course availability', () => {
  it('disables coming, absent and retired courses but allows a newly published course', () => {
    const choices = resolveGoalChoices([
      { slug: 'aws-saa-fundamentals', availability: 'live', downloadMode: 'public' },
      { slug: 'aws-saa-c03', availability: 'coming', downloadMode: 'none' },
      { slug: 'claude-ccdv-f', availability: 'retired', downloadMode: 'none' },
    ] as any);
    expect(choices.map((choice) => choice.available)).toEqual([true, false, false]);
    expect(choices[1].availabilityLabel).toBe('Coming soon');
    const published = resolveGoalChoices([{ slug: 'claude-ccdv-f', availability: 'live', downloadMode: 'public' }] as any);
    expect(published.find((choice) => choice.deckSlug === 'claude-ccdv-f')?.available).toBe(true);
    expect(published.find((choice) => choice.deckSlug === 'aws-saa-fundamentals')?.available).toBe(false);
  });
});
