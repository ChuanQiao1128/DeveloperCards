import { describe, expect, it } from 'vitest';

import { buildCeremonyCues, cueTimesFromSchedule } from '../../src/features/gacha/draw/ceremonyCues';
import { resolveCeremonyTimings, type PeakRarity } from '../../src/features/gacha/draw/ceremonyTimings';

const RARITIES: PeakRarity[] = ['COM', 'RAR', 'LEG'];

describe('ceremonyCues', () => {
  it('keeps anticipation silent and puts one tactile commit at the tear', () => {
    for (const r of RARITIES) {
      const t = resolveCeremonyTimings({ isMulti: true, peakRarity: r, motionAvailable: true });
      const cues = buildCeremonyCues({ peakRarity: r, isMulti: true, timings: t, tapFlow: true });
      expect(cues.filter((c) => c.phase === 'approach' || c.phase === 'hold')).toEqual([]);
      expect(cues.filter((c) => c.action.kind === 'impact')).toEqual([
        { phase: 'tear-flip', offsetMs: 0, action: { kind: 'impact', style: 'light' } },
      ]);
      expect(cues).toContainEqual({ phase: 'tear-flip', offsetMs: 0, action: { kind: 'hit', name: 'tear' } });
      expect(cues).toContainEqual({ phase: 'tear-flip', offsetMs: Math.round(t.tearFlip * 0.5), action: { kind: 'hit', name: 'flyout' } });
      expect(cues.some((c) => c.action.kind === 'hit' && ['charge', 'burst'].includes(c.action.name))).toBe(false);
    }
  });

  it('reserves stingers for rare cards and delegates tap-flow stingers to the flip', () => {
    for (const peakRarity of RARITIES) {
      const timings = resolveCeremonyTimings({ isMulti: false, peakRarity, motionAvailable: true });
      const featured = buildCeremonyCues({ peakRarity, isMulti: false, timings, tapFlow: false });
      const tap = buildCeremonyCues({ peakRarity, isMulti: false, timings, tapFlow: true });
      expect(tap.some((c) => c.action.kind === 'hit' && c.action.name.startsWith('stinger'))).toBe(false);
      const stingers = featured.filter((c) => c.action.kind === 'hit' && c.action.name.startsWith('stinger'));
      expect(stingers).toHaveLength(peakRarity === 'COM' ? 0 : 1);
    }
  });

  it('reduce motion keeps only the stinger', () => {
    const t = resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: true });
    // Tap flow under RM: the spotlight crossfade plays the stinger, so the table cues are empty.
    expect(buildCeremonyCues({ peakRarity: 'LEG', isMulti: true, timings: t, tapFlow: true, reduceMotion: true })).toEqual([]);

    // Featured path under RM: only the peak stinger (+ success for LEG) — no charge / tear / burst.
    const rm = buildCeremonyCues({ peakRarity: 'LEG', isMulti: true, timings: t, tapFlow: false, reduceMotion: true });
    expect(rm).toContainEqual({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: 'stinger-leg' } });
    expect(rm).toContainEqual({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'success' } });
    expect(rm.some((c) => c.action.kind === 'hit' && c.action.name === 'burst')).toBe(false);
    expect(rm.some((c) => c.action.kind === 'hit' && c.action.name === 'charge')).toBe(false);

    // A COM featured RM pull is just its stinger, no success.
    const rmCom = buildCeremonyCues({
      peakRarity: 'COM',
      isMulti: false,
      timings: resolveCeremonyTimings({ isMulti: false, peakRarity: 'COM', motionAvailable: true }),
      tapFlow: false,
      reduceMotion: true,
    });
    expect(rmCom).toEqual([{ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: 'stinger-com' } }]);
  });

  it('turns a phase schedule into absolute cue times from one start', () => {
    const timings = resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: false });
    const cues = buildCeremonyCues({ peakRarity: 'LEG', isMulti: true, timings, tapFlow: false });

    // TEST_BASE multi (approach 620, hold 300, tearFlip 940, flashReveal 280), with the approach
    // entry prepended (the screen schedules cues from the tear, approach included).
    const entries = [
      { at: 0, phase: 'approach' as const },
      { at: 620, phase: 'hold' as const },
      { at: 920, phase: 'tear-flip' as const },
      { at: 1860, phase: 'flash-reveal' as const },
      { at: 2140, phase: 'settle' as const },
      { at: 2740, phase: 'tail' as const },
    ];
    const times = cueTimesFromSchedule(cues, entries);

    expect(times.some((t) => t.at === 0)).toBe(false);
    expect(times).toContainEqual({ at: 920, action: { kind: 'hit', name: 'tear' } });
    expect(times).toContainEqual({ at: 920 + Math.round(940 * 0.5), action: { kind: 'hit', name: 'flyout' } });
    expect(times).toContainEqual({ at: 1860, action: { kind: 'hit', name: 'stinger-leg' } });

    // The 'tail' entry has no cues; nothing lands at 2740.
    expect(times.some((t) => t.at === 2740)).toBe(false);

    // Stable-sorted ascending by `at`.
    const ats = times.map((t) => t.at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));

    // Within one moment (flash-reveal @1860) the build order holds: burst → stinger → success → impact.
    const atFlash = times.filter((t) => t.at === 1860).map((t) => (t.action.kind === 'hit' ? t.action.name : t.action.kind));
    expect(atFlash).toEqual(['stinger-leg']);
  });
});
