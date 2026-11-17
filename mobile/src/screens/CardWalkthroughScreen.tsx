import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import type { CardExport, DeckExport } from '../types/deckExport';
import { isOrderedDeck } from '../features/gacha/draw/orderedDeckPolicy';
import { pickStarterUids } from '../features/gacha/starter/starterGate';
import { normalizeMcq } from '../features/gacha/mcq/normalizeMcq';
import LearningStudyView from '../features/gacha/components/LearningStudyView';
import { CardLangToggle } from '../features/gacha/components/CardLangToggle';
import { CardTextLangContext } from '../features/gacha/components/CardTextLang';
import { buildPrerequisiteLabels } from '../features/gacha/components/prerequisiteLabels';
import { rankCardsByOrder } from '../features/gacha/library/cardRank';
import { cardTranslationFor, hasCompleteTranslation, localizeForDisplay } from '../content/localizeCard';
import { TranslationAvailability } from '../features/gacha/study/TranslationAvailability';
import { translationsForCard, useDeckTranslations } from '../features/gacha/study/useDeckTranslations';
import { setCardLangPref, useCardLangPref } from '../features/gacha/study/cardLangPrefs';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

type Props = NativeStackScreenProps<RootStackParamList, 'CardWalkthrough'>;
type Loaded = { status: 'loading' } | { status: 'unavailable' } | { status: 'ready'; deck: DeckExport; cards: CardExport[] };

// A replayable reading preview. It never starts a session, writes progress, or calls onboarding/rewards.
export default function CardWalkthroughScreen({ navigation, route }: Props) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [unclear, setUnclear] = useState<string[]>([]);
  const [foundations, setFoundations] = useState<string[]>([]);
  const scroll = useRef<ScrollView>(null);
  const advancedUid = useRef<string | null>(null);
  const lang = useCardLangPref();
  const deck = loaded.status === 'ready' ? loaded.deck : null;
  const translations = useDeckTranslations(deck?.Slug, deck?.Version);

  useEffect(() => {
    let cancelled = false;
    setLoaded({ status: 'loading' });
    setIndex(0); setRevealed(false); setUnclear([]); setFoundations([]);
    advancedUid.current = null;
    void (async () => {
      if (!isOrderedDeck(route.params.slug)) return null;
      const { resolveDeckBySlug } = await import('../content/deckRepository');
      return resolveDeckBySlug(route.params.slug);
    })().then((result) => {
      if (cancelled) return;
      const qa = result?.Cards.filter((card) => normalizeMcq(card.Mcq) === null) ?? [];
      const cards = pickStarterUids(qa).map((uid) => qa.find((card) => card.StableUid === uid)!);
      setLoaded(result && cards.length ? { status: 'ready', deck: result, cards } : { status: 'unavailable' });
    }).catch(() => { if (!cancelled) setLoaded({ status: 'unavailable' }); });
    return () => { cancelled = true; };
  }, [route.params.slug, attempt]);

  const cards = loaded.status === 'ready' ? loaded.cards : [];
  const foundation = foundations.length ? deck?.Cards.find((card) => card.StableUid === foundations[foundations.length - 1]) : null;
  const card = foundation ?? cards[index];
  const translation = card && deck ? cardTranslationFor(translationsForCard(translations, card.StableUid), deck.Locale) : null;
  const display = card ? localizeForDisplay({ card, mcq: null, shownOrder: [], translation, lang }) : null;
  const textLang = display?.lang === 'zh-CN' ? 'zh-CN' : undefined;
  const translationPending = lang === 'zh-CN' && translations.status === 'loading';
  const complete = loaded.status === 'ready' && index >= cards.length;

  function advance(stillUnclear: boolean) {
    if (!card || !revealed || foundation || complete || advancedUid.current === card.StableUid) return;
    advancedUid.current = card.StableUid;
    if (stillUnclear) setUnclear((previous) => previous.includes(card.StableUid) ? previous : [...previous, card.StableUid]);
    setIndex((previous) => previous + 1);
    setRevealed(false);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }

  const button = (label: string, testID: string, onPress: () => void, primary = false) => (
    <Pressable accessibilityRole="button" testID={testID} onPress={onPress}
      style={({ pressed }) => [styles.button, primary && styles.primary, pressed && styles.pressed]}>
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe} testID="screen-card-walkthrough">
      <ScrollView ref={scroll} contentContainerStyle={styles.content}>
        {button('Close walkthrough', 'walkthrough-close', () => navigation.goBack())}
        <Text style={styles.title}>{complete ? 'A first look, complete' : 'Try learning with cards'}</Text>
        <Text style={styles.body}>This walkthrough does not change your study progress. Close it any time; a new walkthrough starts from the beginning.</Text>
        {loaded.status === 'loading' ? <Text style={styles.body} accessibilityLiveRegion="polite">Loading cards…</Text> : null}
        {loaded.status === 'unavailable' ? <View>
          <Text style={styles.body}>These cards are not available on this phone. Open the AWS Architect Basics pack from Home to download it, then try again.</Text>
          {button('Retry', 'walkthrough-retry', () => setAttempt((value) => value + 1))}
        </View> : null}
        {complete ? <View testID="walkthrough-complete">
          <Text style={styles.body}>You have read {cards.length} cards. Reviewing later is how you check what you remember.</Text>
          {unclear.length ? <Text style={styles.body}>{unclear.length} {unclear.length === 1 ? 'card still felt' : 'cards still felt'} unclear. That is a useful place to start when you study.</Text> : null}
          <Text style={styles.body}>To save your learning and schedule reviews, start a study session from Home.</Text>
          {button('Back to Home', 'walkthrough-done', () => navigation.goBack(), true)}
        </View> : card && deck && display ? <View>
          <Text style={styles.progress}>{foundation ? 'Background card' : `Card ${index + 1} of ${cards.length}`}</Text>
          {hasCompleteTranslation(card, null, translation) ? <View style={styles.languageRow}>
            <CardLangToggle lang={lang} onChange={(next) => { void setCardLangPref(next); }} />
          </View> : null}
          <TranslationAvailability state={translations} />
          {translationPending ? <Text style={styles.body}>Loading Chinese text…</Text> : (
            <CardTextLangContext.Provider value={textLang}>
              <LearningStudyView key={card.StableUid} card={display.card} deckSlug={deck.Slug}
                rank={rankCardsByOrder(deck.Cards).get(card.StableUid)}
                caption={foundation ? 'FOUNDATION' : 'WALKTHROUGH'} revealed={!!foundation || revealed}
                prerequisiteLabels={buildPrerequisiteLabels(deck.Cards, textLang)}
                onPressPrerequisite={(uid) => {
                  if (uid === card.StableUid || foundations.includes(uid) || !deck.Cards.some((entry) => entry.StableUid === uid)) return;
                  setFoundations((previous) => [...previous, uid]);
                  scroll.current?.scrollTo({ y: 0, animated: false });
                }} />
            </CardTextLangContext.Provider>
          )}
          {!translationPending ? foundation
            ? button('Back to walkthrough card', 'walkthrough-foundation-back', () => setFoundations((previous) => previous.slice(0, -1)))
            : revealed ? <View>
              {button('Continue', 'walkthrough-next', () => advance(false), true)}
              {button('Still unclear · continue', 'walkthrough-unclear', () => advance(true))}
            </View> : button('Show answer', 'walkthrough-reveal', () => setRevealed(true), true)
            : null}
        </View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.parchmentBg },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  title: { fontSize: typography.title2, fontWeight: '800', color: colors.ink, marginVertical: spacing.md },
  body: { fontSize: typography.body, lineHeight: 22, color: colors.inkSecondary, marginBottom: spacing.md },
  progress: { fontSize: typography.bodySmall, fontWeight: '700', color: colors.inkSecondary, marginBottom: spacing.sm },
  languageRow: { flexDirection: 'row', marginBottom: spacing.sm },
  button: { minHeight: 48, padding: spacing.sm, justifyContent: 'center', alignItems: 'center', marginVertical: spacing.xs },
  buttonText: { fontSize: typography.body, fontWeight: '700', color: colors.inkSecondary, textAlign: 'center' },
  primary: { backgroundColor: colors.ink, borderRadius: 12, marginTop: spacing.md },
  primaryText: { color: colors.softCream },
  pressed: { opacity: 0.75 },
});
