import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import CodeBlock from '../../../components/CodeBlock';
import type { CardExport } from '../../../types/deckExport';
import { splitKeyLine, type AnswerKeyLine } from '../../../content/answerKeyLine';
import { stripInlineCode } from '../../../content/inlineCode';
import { normalizeCodeLanguage, renderSimpleMarkdown } from '../session/reviewContentHelpers';
import { InlineCodeText } from './InlineCodeText';
import { cardSectionLabels, cardTextA11yProps, useCardTextLang, type CardTextLang } from './CardTextLang';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';

// Map dev shorthand → human-readable label.
export function friendlyCodeLanguage(raw: string): string {
  const lower = raw.toLowerCase().trim();
  const map: Record<string, string> = {
    cs: 'C#',
    csharp: 'C#',
    'c#': 'C#',
    ts: 'TypeScript',
    typescript: 'TypeScript',
    tsx: 'TSX',
    js: 'JavaScript',
    javascript: 'JavaScript',
    jsx: 'JSX',
    py: 'Python',
    python: 'Python',
    rb: 'Ruby',
    ruby: 'Ruby',
    go: 'Go',
    rs: 'Rust',
    rust: 'Rust',
    java: 'Java',
    kt: 'Kotlin',
    kotlin: 'Kotlin',
    swift: 'Swift',
    sql: 'SQL',
    sh: 'Shell',
    shell: 'Shell',
    bash: 'Bash',
    yml: 'YAML',
    yaml: 'YAML',
    json: 'JSON',
    cpp: 'C++',
    'c++': 'C++',
    c: 'C',
    php: 'PHP',
    md: 'Markdown',
    markdown: 'Markdown',
    xml: 'XML',
    html: 'HTML',
    css: 'CSS',
    toml: 'TOML',
    http: 'HTTP',
    text: 'Text',
  };
  return map[lower] ?? raw;
}

export const ANSWER_KEY_LINE_TEST_ID = 'answer-key-line';

// Spoken label for the highlighted key line: VoiceOver cannot see the highlight
// the rating hint points at, so the line says what it is before its text. A card
// shown in Chinese is spoken in Chinese, so its prefix is Chinese too.
export function keyLineA11yLabel(keyLine: string, lang?: CardTextLang): string {
  return lang === 'zh-CN' ? `重点句：${stripInlineCode(keyLine)}` : `Highlighted line, ${stripInlineCode(keyLine)}`;
}

// 2026-10-14 learning flow (B3): an answer that opens with 答： shows that line
// first, bold, in a tinted block with an accent rule, then the remaining lines
// exactly as the plain explanation renders them. It is the first thing read
// after the EXPLANATION caption, on screen and by VoiceOver.
function ExplanationWithKeyLine(props: { split: AnswerKeyLine; lang: CardTextLang }) {
  const { split, lang } = props;
  return (
    <View>
      <View style={styles.keyLineBlock} testID={ANSWER_KEY_LINE_TEST_ID}>
        <InlineCodeText
          style={styles.keyLineText}
          accessibilityLabel={keyLineA11yLabel(split.keyLine, lang)}
          text={split.keyLine}
        />
      </View>
      {split.rest ? <InlineCodeText style={styles.sectionBody} text={split.rest} /> : null}
    </View>
  );
}

// The answer renderer shared by the session's ReviewBody (after reveal), the
// study view (after Show answer) and CardDetail's "Show answer" toggle:
// EXPLANATION / CODING SAMPLE / REAL USAGE, in card order, separated by hairline
// dividers, with the empty-state hint when a card carries no answer body.
// Extracted from ReviewBody so every surface renders byte-for-byte the same
// sections — the same labels, order, CodeBlock wiring and empty hint — instead
// of drifting apart. The section labels follow the card's language
// (CardTextLangContext); the body text is whatever card the caller passes.
export function CardAnswerSections(props: { card: CardExport; testID?: string; onPressPrerequisite?: (uid: string) => void; prerequisiteLabels?: Readonly<Record<string, string>> }) {
  const { card, testID, onPressPrerequisite, prerequisiteLabels } = props;
  const lang = useCardTextLang();
  const labels = cardSectionLabels(lang);
  const [showEnglishChecklist, setShowEnglishChecklist] = useState(false);
  useEffect(() => setShowEnglishChecklist(false), [card.StableUid, lang]);

  const codeLanguageLabel = card.CodeLanguage
    ? friendlyCodeLanguage(card.CodeLanguage)
    : null;

  const sections: Array<{ key: string; label: string; node: React.ReactNode }> = [];
  if (card.Teaching) {
    const t = card.Teaching;
    const isZh = lang === 'zh-CN';
    const answer = isZh && t['zh-CN']?.answer ? t['zh-CN'].answer : t.answer;
    const keyPoint = isZh && t['zh-CN']?.keyPoint ? t['zh-CN'].keyPoint : t.keyPoint;
    const watchOut = isZh && t['zh-CN']?.watchOut ? t['zh-CN'].watchOut : t.watchOut;

    // 1. Conclusion & Key Point
    sections.push({
      key: 'teaching-answer',
      label: labels.explanation,
      node: (
        <View>
          <View style={styles.keyLineBlock} testID={ANSWER_KEY_LINE_TEST_ID}>
            <InlineCodeText
              style={styles.keyLineText}
              accessibilityLabel={keyLineA11yLabel(answer, lang)}
              text={(isZh ? '答：' : 'Answer: ') + answer}
            />
          </View>
          {keyPoint ? (
            <View style={styles.keyPointBlock}>
              <Text style={styles.keyPointLabel}>{isZh ? '考点：' : 'Key point: '}</Text>
              <InlineCodeText style={styles.sectionBody} text={keyPoint} />
            </View>
          ) : null}
        </View>
      ),
    });

    // 2. Self-Check Points (mustAnswer)
    if (t.mustAnswer && t.mustAnswer.length > 0) {
      const zhPoints = t['zh-CN']?.mustAnswer;
      const hasChineseChecklist = Array.isArray(zhPoints) && zhPoints.length === t.mustAnswer.length &&
        zhPoints.every((point) => typeof point === 'string' && point.trim().length > 0);
      const needsEnglishDisclosure = isZh && !hasChineseChecklist;
      const points = isZh && hasChineseChecklist ? zhPoints! : t.mustAnswer;
      sections.push({
        key: 'teaching-self-check',
        label: labels.selfCheck,
        node: (
          <View style={styles.selfCheckContainer} testID="teaching-self-check-list">
            {needsEnglishDisclosure ? (
              <>
                <Text style={styles.selfCheckText}>合上答案，试着说出结论和原因，再核对上方解析。</Text>
                <Pressable
                  testID="teaching-english-checklist-toggle"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showEnglishChecklist }}
                  style={styles.checklistToggle}
                  onPress={() => setShowEnglishChecklist((shown) => !shown)}
                >
                  <Text style={styles.checklistToggleText}>
                    {showEnglishChecklist ? '收起英文答题要点' : '查看英文答题要点'}
                  </Text>
                </Pressable>
              </>
            ) : null}
            {!needsEnglishDisclosure || showEnglishChecklist ? points.map((point, pIdx) => (
              <View key={pIdx} style={styles.selfCheckRow}>
                <Text style={styles.selfCheckCheckmark}>•</Text>
                <Text style={styles.selfCheckText} accessibilityLanguage={isZh && hasChineseChecklist ? 'zh-CN' : 'en-US'}>{point}</Text>
              </View>
            )) : null}
          </View>
        ),
      });
    }

    // 3. Watch out (if present)
    if (watchOut) {
      sections.push({
        key: 'teaching-watch-out',
        label: (labels as any).watchOut || (isZh ? '易错提醒' : 'WATCH OUT'),
        node: (
          <View style={styles.watchOutBlock} testID="teaching-watch-out">
            <Text style={styles.watchOutIcon}>⚠</Text>
            <InlineCodeText style={styles.watchOutText} text={watchOut} />
          </View>
        ),
      });
    }

    // 4. Prerequisites (if present)
    if (t.prerequisites && t.prerequisites.length > 0) {
      sections.push({
        key: 'teaching-prerequisites',
        label: (labels as any).prerequisites || (isZh ? '前置先修' : 'PREREQUISITES'),
        node: (
          <View style={styles.prereqContainer}>
            <Text style={styles.prereqHint}>
              {isZh
                ? `掌握该卡需先理解以下 ${t.prerequisites.length} 张基础卡：`
                : `Requires understanding ${t.prerequisites.length} foundational card(s) first:`}
            </Text>
            <View style={styles.prereqChipsRow}>
              {t.prerequisites.map((pUid, pIdx) => {
                const isInteractive = Boolean(onPressPrerequisite);
                const label = prerequisiteLabels?.[pUid] ?? (isZh ? `基础卡 ${pIdx + 1}` : `Foundation card ${pIdx + 1}`);
                return (
                  <Pressable
                    key={pIdx}
                    testID={`prereq-chip-${pUid}`}
                    accessibilityRole={isInteractive ? 'button' : undefined}
                    accessibilityLabel={isZh ? `先修卡：${label}` : `Prerequisite card: ${label}`}
                    disabled={!isInteractive}
                    style={({ pressed }) => [
                      styles.prereqChip,
                      isInteractive && styles.prereqChipInteractive,
                      pressed && isInteractive && styles.pressed,
                    ]}
                    onPress={() => onPressPrerequisite?.(pUid)}
                  >
                    <Text style={[styles.prereqChipText, isInteractive && styles.prereqChipTextInteractive]}>
                      {label}{isInteractive ? ' →' : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ),
      });
    }
  } else if (card.Explanation) {
    // Null for every answer that does not open with 答： (all English decks): rendered as before.
    const keySplit = splitKeyLine(card.Explanation);
    sections.push({
      key: 'explanation',
      label: labels.explanation,
      node: keySplit ? (
        <ExplanationWithKeyLine split={keySplit} lang={lang} />
      ) : (
        <InlineCodeText style={styles.sectionBody} text={card.Explanation} />
      ),
    });
  }
  if (card.CodeSnippet) {
    sections.push({
      key: 'code',
      label: labels.code,
      node: (
        <View style={styles.codeContainer}>
          <CodeBlock
            code={card.CodeSnippet}
            language={normalizeCodeLanguage(card.CodeLanguage || 'javascript')}
            label={codeLanguageLabel ?? undefined}
          />
        </View>
      ),
    });
  }
  if (card.RealWorldUsage) {
    sections.push({
      key: 'usage',
      label: labels.usage,
      node: <View style={styles.mdContainer}>{renderSimpleMarkdown(card.RealWorldUsage, styles)}</View>,
    });
  }

  // No nested ScrollView — the outer screen scroll handles overflow. Sections
  // render in order with hairline dividers between them so multi-section
  // answers (3+ blocks) read as a clean stack instead of a cramped column.
  return (
    <View testID={testID}>
      {sections.length === 0 ? (
        <Text style={styles.emptyAnswerHint} numberOfLines={2}>
          No answer body for this card yet.
        </Text>
      ) : (
        sections.map((section, index) => (
          <View key={section.key}>
            {index > 0 ? <View style={styles.sectionDivider} /> : null}
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionHeader} numberOfLines={1} {...cardTextA11yProps(lang)}>
                {section.label}
              </Text>
              {section.node}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

export default CardAnswerSections;

const styles = StyleSheet.create({
  emptyAnswerHint: {
    fontSize: typography.bodySmall,
    color: colors.inkMuted,
    fontStyle: 'italic',
    fontWeight: '600',
  },
  sectionBlock: {
    paddingVertical: spacing.sm,
  },
  // Hairline between sections — light enough to read as a separator,
  // dark enough to give each block visual breathing room.
  sectionDivider: {
    height: 1,
    backgroundColor: colors.hairline,
    marginHorizontal: 0,
  },
  sectionHeader: {
    fontSize: typography.caption,
    color: colors.gold,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.0,
    marginBottom: 8,
  },
  sectionBody: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.inkSoft,
    fontWeight: '500',
  },
  // The 答 line: a soft peach tint with a gold rule on the left, set apart from
  // the lines below it without leaving the card's palette.
  keyLineBlock: {
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    backgroundColor: colors.softPeach,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  keyLineText: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.ink,
    fontWeight: '800',
  },
  codeContainer: {
    marginTop: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  mdContainer: {
    marginTop: 2,
  },
  mdBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  mdBullet: {
    width: 18,
    fontSize: 14,
    color: colors.gold,
    lineHeight: 20,
    fontWeight: '900',
  },
  mdText: {
    flex: 1,
    fontSize: typography.body,
    color: colors.inkSoft,
    lineHeight: 22,
    fontWeight: '500',
  },
  keyPointBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
  },
  keyPointLabel: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.gold,
    fontWeight: '800',
  },
  selfCheckContainer: {
    backgroundColor: 'rgba(126, 157, 94, 0.08)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(126, 157, 94, 0.25)',
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 2,
  },
  selfCheckRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 3,
  },
  checklistToggle: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  checklistToggleText: { color: colors.pokeBlueDeep, fontSize: typography.bodySmall, fontWeight: '700' },
  selfCheckCheckmark: {
    color: colors.inkSecondary,
    fontWeight: '900',
    fontSize: 14,
    marginRight: 6,
    lineHeight: 20,
  },
  selfCheckText: {
    flex: 1,
    fontSize: typography.bodySmall,
    lineHeight: 20,
    color: colors.ink,
    fontWeight: '600',
  },
  watchOutBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(200, 136, 58, 0.08)',
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginTop: 2,
  },
  watchOutIcon: {
    color: colors.gold,
    fontWeight: '900',
    fontSize: 14,
    marginRight: 6,
    lineHeight: 20,
  },
  watchOutText: {
    flex: 1,
    fontSize: typography.bodySmall,
    lineHeight: 20,
    color: colors.inkSoft,
    fontWeight: '500',
  },
  prereqContainer: {
    marginTop: 2,
  },
  prereqHint: {
    fontSize: typography.caption,
    color: colors.inkMuted,
    fontWeight: '500',
    marginBottom: 6,
  },
  prereqChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pressed: {
    opacity: 0.75,
  },
  prereqChip: {
    backgroundColor: colors.softMist,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  prereqChipInteractive: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    backgroundColor: 'rgba(63, 183, 219, 0.12)',
    borderColor: 'rgba(44, 156, 192, 0.40)',
  },
  prereqChipTextInteractive: {
    color: colors.pokeBlueDeep,
    fontWeight: '800',
  },
  prereqChipText: {
    fontSize: 11,
    color: colors.inkMuted,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
});
