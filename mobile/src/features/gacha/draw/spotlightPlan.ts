// spotlightPlan — the pure sizing/timing/cue model for the single-pull RevealSpotlight
// (I04). No React / react-native imports: everything here is deterministic and unit
// tested, so RevealSpotlight (motion) and DrawResultScreen (layout) can read the same
// numbers, and I05/I06 can build the multi-pull sequence and the sound choreography on
// this exact API. Type-only imports keep it OTA-safe.

import { stingerForRarity } from '../../../components/ceremonyAudio';
import type { CeremonyCueAction } from './ceremonyCues';
import type { PeakRarity } from './ceremonyTimings';

/**
 * The spotlight card size for a window: a 5:7 card that is at most 86 % of the width, at
 * most 62 % of the height, and never wider than 440 pt (so it does not balloon on a tablet).
 */
export function spotlightCardSize(win: { width: number; height: number }, reservedHeight = 0): { width: number; height: number } {
  const available = Math.max(140, win.height - reservedHeight);
  const width = Math.floor(Math.min(0.86 * win.width, (0.62 * win.height) / 1.4, available / 1.4, 440));
  const height = Math.round(width * 1.4);
  return { width, height };
}

/** Face fonts scaled to the card width (a floor keeps the smallest cards legible). */
export function revealFaceMetrics(cardWidth: number): {
  questionFontSize: number;
  questionLineHeight: number;
  chipFontSize: number;
  serialFontSize: number;
} {
  const w = cardWidth;
  const questionFontSize = Math.max(12, Math.round(0.045 * w));
  const questionLineHeight = Math.round(questionFontSize * 1.2);
  const chipFontSize = Math.max(11, Math.round(0.036 * w));
  const serialFontSize = Math.max(9, Math.round(0.028 * w));
  return { questionFontSize, questionLineHeight, chipFontSize, serialFontSize };
}

/** DrawResult's featured card width, sized from the window (was a fixed 260 pt). */
export function resultFeaturedCardWidth(windowWidth: number): number {
  return Math.round(Math.min(Math.max(windowWidth * 0.78, 260), 380));
}

export const SPOTLIGHT_ENTRANCE_MS = 260;
export const SPOTLIGHT_FLIP_MS = Object.freeze({ COM: 260, RAR: 360, LEG: 480 });
export const SPOTLIGHT_LEG_SHAKE_MS = 0;
export const SPOTLIGHT_LEG_EDGE_PAUSE_MS = 90;
export const SPOTLIGHT_RM_FADE_MS = 180;
export const SPOTLIGHT_SCRIM = '#17151D';
export const SPOTLIGHT_SCRIM_OPACITY = 0.82;
export const SPOTLIGHT_COPY = Object.freeze({
  readFull: 'Tap to read full question',
  close: 'Close',
  tapToReveal: 'Tap to reveal',
});

/**
 * The flip choreography, all times relative to the flip request (the tap or the autoFlip
 * timer) except `entranceMs`, which is measured from the spotlight becoming visible.
 */
export type SpotlightFlipPlan = {
  entranceMs: number;
  shakeMs: number;
  flipStartMs: number;
  flipMs: number;
  edgePauseMs: number;
  midpointMs: number;
  landMs: number;
};

export function spotlightFlipPlan(rarity: PeakRarity, reduceMotion: boolean): SpotlightFlipPlan {
  if (reduceMotion) {
    return { entranceMs: 180, shakeMs: 0, flipStartMs: 0, flipMs: 180, edgePauseMs: 0, midpointMs: 90, landMs: 180 };
  }
  if (rarity === 'LEG') {
    // A single gold edge pause; stillness replaces the old pre-flip shake.
    return { entranceMs: 260, shakeMs: 0, flipStartMs: 0, flipMs: 480, edgePauseMs: 90, midpointMs: 330, landMs: 570 };
  }
  if (rarity === 'RAR') {
    return { entranceMs: 260, shakeMs: 0, flipStartMs: 0, flipMs: 360, edgePauseMs: 0, midpointMs: 180, landMs: 360 };
  }
  return { entranceMs: 260, shakeMs: 0, flipStartMs: 0, flipMs: 260, edgePauseMs: 0, midpointMs: 130, landMs: 260 };
}

/** One flip sound/haptic cue, `at` ms after the flip request. */
export type SpotlightCue = { at: number; action: CeremonyCueAction };

/** The flyout sound fires this long after the spotlight enters (I06 hero flyout). */
export const SPOTLIGHT_FLYOUT_CUE_MS = 100;

/**
 * The entrance cue list, measured from the spotlight becoming visible: the card flies out with
 * the flyout foley. Reduce Motion crossfades in silently.
 */
export function spotlightEntranceCues(reduceMotion: boolean): SpotlightCue[] {
  if (reduceMotion) return [];
  return [{ at: SPOTLIGHT_FLYOUT_CUE_MS, action: { kind: 'hit', name: 'flyout' } }];
}

/**
 * The flip cue list, stable-sorted ascending by `at` (ties keep their build order). The soft
 * touch impact fires at the request, the flip sound at flip start, and the rarity's own stinger
 * at the midpoint for EVERY rarity (I06 — COM included), with the success/heavy at landing.
 */
export function spotlightFlipCues(rarity: PeakRarity, plan: SpotlightFlipPlan): SpotlightCue[] {
  const cues: SpotlightCue[] = [];
  cues.push({ at: plan.flipStartMs, action: { kind: 'hit', name: 'flip' } });
  if (rarity !== 'COM') {
    cues.push({ at: plan.midpointMs, action: { kind: 'impact', style: rarity === 'LEG' ? 'medium' : 'light' } });
    cues.push({ at: plan.midpointMs, action: { kind: 'hit', name: stingerForRarity(rarity) } });
  }
  return cues
    .map((cue, index) => ({ cue, index }))
    .sort((a, b) => a.cue.at - b.cue.at || a.index - b.index)
    .map(({ cue }) => cue);
}
