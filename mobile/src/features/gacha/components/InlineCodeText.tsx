import React, { useState } from 'react';
import * as RN from 'react-native';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextProps, TextStyle } from 'react-native';

import { splitInlineCode, stripInlineCode } from '../../../content/inlineCode';
import { useCardTextLang } from './CardTextLang';
import { parseFrontHelp, termHelpMatches, type FrontHelpEntry } from '../../../content/frontHelp';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';

export const INLINE_CODE_TEST_ID = 'inline-code';

// Vitest supplies react-native without Platform / useColorScheme / StyleSheet.flatten —
// guarded lookup so suites that mock a minimal react-native keep rendering (MistakeBookScreen pattern).
function readRN<T = any>(key: string, fallback: T): T {
  try {
    const value = (RN as any)[key];
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}

const useColorScheme: () => string | null | undefined = readRN('useColorScheme', () => 'light');
const platformOS: string = readRN<{ OS?: string } | null>('Platform', null)?.OS ?? 'ios';

// The monospace family CodeBlock uses.
export const INLINE_CODE_FONT = platformOS === 'ios' ? 'Menlo' : 'monospace';

// Code is set a touch smaller than the prose around it so the wider monospace
// glyphs sit level with the sentence.
const CODE_SCALE = 0.9;

const CODE_BACKGROUND = {
  light: 'rgba(67,42,18,0.08)',
  dark: 'rgba(255,255,255,0.14)',
} as const;

// Last fontSize set in a (possibly nested) style array — StyleSheet.flatten without
// relying on it, since test mocks of react-native leave it out.
function fontSizeOf(style: unknown): number | undefined {
  if (!style || typeof style !== 'object') return undefined;
  if (Array.isArray(style)) {
    let size: number | undefined;
    for (const entry of style) size = fontSizeOf(entry) ?? size;
    return size;
  }
  const size = (style as TextStyle).fontSize;
  return typeof size === 'number' ? size : undefined;
}

export function inlineCodeStyle(parent: StyleProp<TextStyle>, scheme: string | null | undefined): TextStyle {
  const parentSize = fontSizeOf(parent);
  return {
    fontFamily: INLINE_CODE_FONT,
    ...(typeof parentSize === 'number' ? { fontSize: Math.round(parentSize * CODE_SCALE * 10) / 10 } : null),
    fontWeight: 'normal',
    backgroundColor: scheme === 'dark' ? CODE_BACKGROUND.dark : CODE_BACKGROUND.light,
    // Nested <Text> stays in the parent's line box, so the span wraps with the
    // sentence; the padding and radius only show where the platform honours them.
    paddingHorizontal: 3,
    borderRadius: 4,
  };
}

/** The code-span style for prose in `parent` style, in the current colour scheme. */
export function useInlineCodeStyle(parent: StyleProp<TextStyle>, codeStyle?: StyleProp<TextStyle>): StyleProp<TextStyle> {
  const scheme = useColorScheme();
  return [inlineCodeStyle(parent, scheme), codeStyle];
}

/**
 * The children for a <Text> holding `text`: the string itself when it has no
 * well-formed span (so plain text renders exactly as before), otherwise the
 * prose strings with each span as a nested monospace <Text> — no backticks.
 */
export function inlineCodeNodes(text: string | null | undefined, spanStyle: StyleProp<TextStyle>): React.ReactNode {
  const segments = typeof text === 'string' ? splitInlineCode(text) : [];
  if (!segments.some((segment) => segment.kind === 'code')) return text;
  return segments.map((segment, index) =>
    segment.kind === 'code' ? (
      <Text key={index} style={spanStyle} testID={INLINE_CODE_TEST_ID}>
        {segment.value}
      </Text>
    ) : (
      segment.value
    ),
  );
}

export type InlineCodeTextProps = Omit<TextProps, 'children'> & {
  /** Card text; null renders an empty <Text>, as `{null}` did. */
  text: string | null | undefined;
  /** Style for the code segments, merged over the monospace defaults. */
  codeStyle?: StyleProp<TextStyle>;
  termHelp?: unknown;
};

function TermHelpText({ text, entries, spanStyle, textProps, lang }: {
  text: string;
  entries: FrontHelpEntry[];
  spanStyle: StyleProp<TextStyle>;
  textProps: TextProps;
  lang: ReturnType<typeof useCardTextLang>;
}) {
  const [selected, setSelected] = useState<FrontHelpEntry | null>(null);
  const used = new Set<FrontHelpEntry>();
  const parts = splitInlineCode(text).map((part, index) => {
    if (part.kind === 'code') return <Text key={index} style={spanStyle} testID={INLINE_CODE_TEST_ID}>{part.value}</Text>;
    const matches = termHelpMatches(part.value, entries.filter(entry => !used.has(entry)));
    let cursor = 0;
    const pieces: React.ReactNode[] = [];
    for (const { entry, offset } of matches) {
      pieces.push(part.value.slice(cursor, offset));
      pieces.push(
        <Text key={entry.term} style={helpStyles.link} accessibilityRole="button"
          testID={`term-help-${entry.term}`} onPress={() => setSelected(entry)}>
          {entry.term}
        </Text>,
      );
      used.add(entry);
      cursor = offset + entry.term.length;
    }
    pieces.push(part.value.slice(cursor));
    return <React.Fragment key={index}>{pieces}</React.Fragment>;
  });
  const close = () => setSelected(null);
  const chinese = lang === 'zh-CN';
  const buttons = [...used];
  const actions = buttons.map((entry, i) => ({
    name: `termHelp${i}`, label: chinese ? `解释 ${entry.term}` : `Explain ${entry.term}`,
  }));
  return (
    <>
      <Text {...textProps} accessibilityLabel={textProps.accessibilityLabel ?? stripInlineCode(text)}
        accessibilityActions={[...(textProps.accessibilityActions ?? []), ...actions]}
        onAccessibilityAction={event => {
          const index = actions.findIndex(action => action.name === event.nativeEvent.actionName);
          if (index >= 0) setSelected(buttons[index]);
          else textProps.onAccessibilityAction?.(event);
        }}>
        {parts}
      </Text>
      {selected ? (
        <Modal transparent animationType="fade" onRequestClose={close}>
          <View style={helpStyles.overlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} />
            <View style={helpStyles.panel} accessibilityViewIsModal onAccessibilityEscape={close}>
              <Text style={helpStyles.title} accessibilityRole="header" accessibilityLanguage={lang}>{selected.term}</Text>
              <ScrollView style={helpStyles.definitionScroll}>
                <Text style={helpStyles.definition} accessibilityLanguage={lang}>{selected.definition}</Text>
              </ScrollView>
              <Pressable style={helpStyles.close} accessibilityRole="button" onPress={close} testID="term-help-close">
                <Text style={helpStyles.definition}>{chinese ? '关闭' : 'Close'}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const helpStyles = StyleSheet.create({
  link: { color: colors.ink, textDecorationLine: 'underline' },
  overlay: { flex: 1, backgroundColor: 'rgba(42,34,24,0.34)', justifyContent: 'flex-end', alignItems: 'center', padding: spacing.md },
  panel: { width: '100%', maxWidth: 480, maxHeight: '70%', backgroundColor: colors.softCream, borderRadius: spacing.cardRadius, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  definitionScroll: { flexGrow: 0 },
  title: { color: colors.ink, fontSize: 19, fontWeight: '700' },
  definition: { color: colors.ink, fontSize: 16, lineHeight: 23 },
  close: { minHeight: 44, alignSelf: 'flex-end', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: spacing.buttonRadius, backgroundColor: colors.pokeBlueFaint },
});

// Card text with markdown inline code spans (`List<int>`) rendered as nested
// <Text>: prose in the parent style, each span in monospace on a subtle
// background, no backticks. Text without a span renders exactly as a plain
// <Text>{text}</Text> would. The spoken label is the text without backticks,
// unless the caller passes its own. Inside a card shown in Chinese (CardTextLangContext) the
// text is spoken as zh-CN unless the caller sets accessibilityLanguage; elsewhere no such prop is
// added at all.
export function InlineCodeText(props: InlineCodeTextProps) {
  const { text, codeStyle, termHelp, ...rest } = props;
  const lang = useCardTextLang();
  const spanStyle = useInlineCodeStyle(rest.style, codeStyle);
  const nodes = inlineCodeNodes(text, spanStyle);
  const textProps = lang && rest.accessibilityLanguage === undefined ? { ...rest, accessibilityLanguage: lang } : rest;
  const entries = parseFrontHelp(termHelp);
  if (text && entries?.length) return (
    <TermHelpText key={text + JSON.stringify(entries)} text={text} entries={entries}
      spanStyle={spanStyle} textProps={textProps} lang={lang} />
  );

  if (nodes === text) return <Text {...textProps}>{text}</Text>;
  return (
    <Text {...textProps} accessibilityLabel={rest.accessibilityLabel ?? stripInlineCode(text as string)}>
      {nodes}
    </Text>
  );
}

export default InlineCodeText;
