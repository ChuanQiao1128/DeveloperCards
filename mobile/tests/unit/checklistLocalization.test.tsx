import React from 'react';
import { readFileSync } from 'node:fs';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => {
  const React = require('react');
  const element = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
  return { View: element('View'), Text: element('Text'), ScrollView: element('ScrollView'),
    Pressable: element('Pressable'), StyleSheet: { create: (value: any) => value },
    Platform: { OS: 'ios', select: (value: any) => value.ios ?? value.default } };
});
vi.mock('../../src/components/CodeBlock', () => ({ default: () => null }));
vi.mock('../../src/config/featureFlags', () => ({ getFeatureFlags: () => ({ cardSource: { enabled: false } }) }));

import { chineseAnswerChecklist } from '../../src/content/checklistLocalization';
import type { CardExport } from '../../src/types/deckExport';
import { CardAnswerSections } from '../../src/features/gacha/components/CardAnswerSections';
import { CardTextLangContext } from '../../src/features/gacha/components/CardTextLang';
import { LearningStudyView } from '../../src/features/gacha/components/LearningStudyView';
import { ReviewBody } from '../../src/features/gacha/components/ReviewBody';

const load = (name: string) => JSON.parse(readFileSync(new URL(
  `../../../exports/aws-checklist-zh-20261114/${name}`, import.meta.url), 'utf8'));
const source = load('source-public-deck.json');
const candidate = load('public-deck.candidate.json');
function card(row = source.cards[0]): CardExport {
  return { StableUid: row.stableUid, Question: row.question, OrderInDeck: row.orderInDeck,
    Difficulty: row.difficulty, Teaching: JSON.parse(JSON.stringify(row.teaching)) };
}

describe('Chinese checklist bundled with the 2.1.0 OTA', () => {
  it('matches all 379 existing cards and all 757 reviewed translations without mutating content', () => {
    const original = JSON.stringify(source);
    let count = 0;
    source.cards.forEach((row: any, index: number) => {
      const c = card(row);
      const before = JSON.stringify(c);
      const points = chineseAnswerChecklist(c);
      expect(points).toEqual(candidate.cards[index].teaching['zh-CN'].mustAnswer);
      count += points!.length;
      expect(JSON.stringify(c)).toBe(before);
    });
    expect(count).toBe(757);
    expect(JSON.stringify(source)).toBe(original);
  });

  it('prefers a complete server translation and rejects an incomplete one', () => {
    const c = card();
    c.Teaching!['zh-CN']!.mustAnswer = c.Teaching!.mustAnswer.map(() => '服务器更新的要点');
    expect(chineseAnswerChecklist(c)).toBe(c.Teaching!['zh-CN']!.mustAnswer);
    c.Teaching!['zh-CN']!.mustAnswer = [''];
    expect(chineseAnswerChecklist(c)).toEqual(candidate.cards[0].teaching['zh-CN'].mustAnswer);
  });

  it.each(['changed', 'reordered', 'added', 'removed', 'unknown uid', 'prototype uid', 'malformed'])(
    'refuses an unverified translation after %s', (kind) => {
      const c = card(source.cards.find((row: any) => row.teaching.mustAnswer.length > 1));
      switch (kind) {
        case 'changed': c.Teaching!.mustAnswer[0] += ' '; break;
        case 'reordered': c.Teaching!.mustAnswer.reverse(); break;
        case 'added': c.Teaching!.mustAnswer.push('Another requirement'); break;
        case 'removed': c.Teaching!.mustAnswer.pop(); break;
        case 'unknown uid': c.StableUid = 'unknown'; break;
        case 'prototype uid': c.StableUid = '__proto__'; break;
        case 'malformed': c.Teaching!.mustAnswer = [42] as any; break;
      }
      expect(chineseAnswerChecklist(c)).toBeNull();
    });

  it.each(['detail', 'learning', 'review'])('renders the cached old deck in Chinese in %s', async (kind) => {
    const c = card();
    expect(c.Teaching!['zh-CN']!.mustAnswer).toBeUndefined();
    const node = kind === 'learning' ? <LearningStudyView card={c} deckSlug="aws-saa-fundamentals" revealed />
      : kind === 'review' ? <ReviewBody card={c} faceUp onFlip={() => {}} />
      : <CardAnswerSections card={c} />;
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<CardTextLangContext.Provider value="zh-CN">{node}</CardTextLangContext.Provider>); });
    const list = tree.root.findAll(n => typeof n.type === 'string' && n.props.testID === 'teaching-self-check-list')[0];
    const rendered = list.findAll(n => typeof n.type === 'string' && n.type === 'Text').map(n => String(n.props.children)).join('\n');
    expect(rendered).toContain(candidate.cards[0].teaching['zh-CN'].mustAnswer[0]);
    expect(tree.root.findAll(n => typeof n.type === 'string' && n.props.testID === 'teaching-english-checklist-toggle')).toHaveLength(0);
    await act(async () => tree.unmount());
  });
});
