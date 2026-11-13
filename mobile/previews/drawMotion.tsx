// Standalone, local-only entry: renders the real ceremony with sample cards.
// It never opens the wallet, signs in, or commits a draw. Not imported by index.ts.
import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { DrawCeremonyScreen } from '../src/screens/DrawCeremonyScreen';
import type { PeakRarity } from '../src/features/gacha/draw/ceremonyTimings';

type Scenario = PeakRarity | 'BATCH';
const SCENARIOS: Scenario[] = ['COM', 'RAR', 'LEG', 'BATCH'];
const QUESTIONS = [
  'Which volume mode keeps the complete primary dataset on premises?',
  'Why does a security group allow response traffic automatically?',
  'When should you choose a private endpoint instead of internet routing?',
  'What changes when a workload must survive an Availability Zone failure?',
  'How does a cache miss change the path of a read request?',
];

function Preview() {
  const [scenario, setScenario] = React.useState<Scenario>('LEG');
  const [run, setRun] = React.useState(0);
  const [done, setDone] = React.useState(false);
  const replay = React.useCallback((next: Scenario) => {
    setScenario(next);
    setDone(false);
    setRun((v) => v + 1);
  }, []);
  React.useEffect(() => {
    const open = ({ url }: { url: string }) => {
      const value = /scenario=(COM|RAR|LEG|BATCH)/.exec(url)?.[1] as Scenario | undefined;
      if (value) replay(value);
    };
    void Linking.getInitialURL().then((url) => { if (url) open({ url }); });
    const subscription = Linking.addEventListener('url', open);
    return () => subscription.remove();
  }, [replay]);
  const rarities: PeakRarity[] = scenario === 'BATCH' ? ['COM', 'RAR', 'COM', 'LEG', 'COM'] : [scenario];
  const result = {
    poolId: 'aws-saa-fundamentals', pityBefore: 0, pityAfter: 0, pityTriggered: false,
    highlightedRarity: (scenario === 'COM' ? null : scenario === 'BATCH' ? 'LEG' : scenario) as 'RAR' | 'LEG' | null,
    cards: rarities.map((rarity, index) => ({
      stableUid: `motion-preview-${index}`, rarity, question: QUESTIONS[index],
      difficulty: rarity === 'LEG' ? 9 : rarity === 'RAR' ? 5 : 2, rank: index + 1, tag: 'Sample card',
    })),
  };
  return (
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaProvider>
        <SafeAreaView edges={['top']} style={styles.fill}>
          <View style={styles.toolbar}>
            <Text style={styles.caption}>Motion preview · sample cards</Text>
            <View style={styles.choices}>
              {SCENARIOS.map((value) => (
                <Pressable key={value} accessibilityRole="button" onPress={() => replay(value)} style={[styles.choice, scenario === value && styles.selected]}>
                  <Text style={styles.label}>{value === 'BATCH' ? '5 cards' : value}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          {done ? (
            <View style={styles.complete}>
              <Text style={styles.title}>Ready to learn</Text>
              <Pressable accessibilityRole="button" onPress={() => replay(scenario)} style={styles.choice}><Text style={styles.label}>Replay opening</Text></Pressable>
            </View>
          ) : (
            <DrawCeremonyScreen key={run} navigation={{ replace: () => setDone(true) } as any} route={{ key: `preview-${run}`, name: 'DrawCeremony', params: {
              slug: 'aws-saa-fundamentals', deckTitle: 'AWS Architect Basics', drawResult: result,
              totalCards: 379, tapFlow: true, autoReveal: true,
            } } as any} />
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#FFF7EC' },
  toolbar: { paddingHorizontal: 20, paddingBottom: 8 },
  caption: { color: '#625542', fontSize: 12, marginBottom: 6 },
  choices: { flexDirection: 'row', gap: 8 },
  choice: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 12, backgroundColor: '#F0E6D6' },
  selected: { backgroundColor: '#E7C882' },
  label: { color: '#302719', fontSize: 14, fontWeight: '700' },
  complete: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 },
  title: { fontSize: 28, color: '#302719', fontWeight: '700' },
});

registerRootComponent(Preview);
