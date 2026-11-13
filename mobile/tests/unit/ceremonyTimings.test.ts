import { describe, expect, it } from 'vitest';

import {
  BURST_CAMERA_PUNCH,
  CHARGE_DIM,
  CHARGE_PULSE_FRACTION_OF_HOLD,
  CHARGE_PULSE_SCALE,
  CHARGE_SHAKE_DEG,
  CHARGE_SHAKE_MS,
  CHARGE_SHAKE_PX,
  DEVICE,
  FAST_FORWARD_FROM_HOLD_FRACTION,
  FAST_FORWARD_TEAR_FACTOR,
  FLASH_FADE_MS,
  FLASH_HOLD_MS,
  FLASH_RISE_MS,
  REDUCED_MOTION_FLASH_MS,
  REDUCED_MOTION_SETTLE_MS,
  SPILL_STAGGER_MS,
  SPILL_START_FRACTION,
  SPILL_TRAVEL_FRACTION,
  SWIPE_TRIGGER_DISTANCE,
  TELL_FRACTION_OF_HOLD,
  TEST_BASE,
  TO_TABLE_CAP_MS,
  chargePulseOffsets,
  compressTimings,
  getCeremonyTimingOverride,
  phaseDurations,
  resolveCeremonyTimings,
  setCeremonyTimingOverride,
  type PeakRarity,
} from '../../src/features/gacha/draw/ceremonyTimings';
import { SPOTLIGHT_ENTRANCE_MS, spotlightFlipPlan } from '../../src/features/gacha/draw/spotlightPlan';

const RARITIES: PeakRarity[] = ['COM', 'RAR', 'LEG'];

describe('ceremonyTimings', () => {
  it('TEST_BASE is byte-for-byte the pre-1.6 table', () => {
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: false })).toMatchObject({
      table: 'TEST_BASE',
      approach: 300,
      hold: 180,
      tearFlip: 360,
      flashReveal: 220,
      settleMs: 200,
      tableTailMs: 500,
    });
    expect(resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: false })).toMatchObject({
      approach: 620,
      hold: 300,
      tearFlip: 940,
      flashReveal: 280,
      settleMs: 300,
      tableTailMs: 500,
    });
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'COM', motionAvailable: false }).hold).toBe(140);
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'LEG', motionAvailable: false }).hold).toBe(220);
    expect(resolveCeremonyTimings({ isMulti: true, peakRarity: 'COM', motionAvailable: false }).hold).toBe(220);
    expect(resolveCeremonyTimings({ isMulti: true, peakRarity: 'RAR', motionAvailable: false }).hold).toBe(260);

    expect(
      phaseDurations(resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: false })),
    ).toEqual({
      swipe: 0,
      approach: 300,
      hold: 180,
      'tear-flip': 360,
      'flash-reveal': 220,
      settle: 200,
      'cards-on-table': 0,
    });
    expect(TEST_BASE.tapQueueMs).toBe(90);
  });

  it('keeps routine opening brief and reserves extra tension for rarer cards', () => {
    for (const isMulti of [false, true]) {
      const timings = RARITIES.map((peakRarity) => resolveCeremonyTimings({ isMulti, peakRarity, motionAvailable: true }));
      expect(timings[0].hold).toBeLessThan(timings[1].hold);
      expect(timings[1].hold).toBeLessThan(timings[2].hold);
      for (const t of timings) {
        expect(t.hold).toBeLessThan(300);
        expect(t.toTableMs).toBeLessThanOrEqual(1500);
      }
    }
  });

  it('DEVICE reaches the table under the ceilings', () => {
    for (const isMulti of [false, true]) {
      for (const peakRarity of RARITIES) {
        const resolved = resolveCeremonyTimings({ isMulti, peakRarity, motionAvailable: true });
        expect(resolved.toTableMs).toBeLessThanOrEqual(isMulti ? TO_TABLE_CAP_MS.multi : TO_TABLE_CAP_MS.single);
      }
    }
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'LEG', motionAvailable: true }).toTableMs).toBe(1280);
    expect(resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: true }).toTableMs).toBe(1500);
  });

  it('the single Legendary hero lands before TO_TABLE_CAP_MS.single', () => {
    const t = resolveCeremonyTimings({ isMulti: false, peakRarity: 'LEG', motionAvailable: true });
    const heroLandsMs = t.approach + t.hold + t.tearFlip + SPOTLIGHT_ENTRANCE_MS + spotlightFlipPlan('LEG', false).landMs;
    expect(heroLandsMs).toBeLessThanOrEqual(TO_TABLE_CAP_MS.single);
    expect(heroLandsMs).toBe(1690);
  });

  it('the silence beat fits after the colour tell', () => {
    for (const row of [DEVICE.single, DEVICE.multi]) {
      for (const r of RARITIES) {
        expect(DEVICE.beatMs[r]).toBeLessThanOrEqual(row.hold[r] * (1 - TELL_FRACTION_OF_HOLD));
      }
    }
    for (const r of RARITIES) {
      expect(TEST_BASE.beatMs[r]).toBe(0);
    }
  });

  it('compression retains the remaining beat and never lengthens the tear', () => {
    const t = resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: true });
    const compressed = compressTimings(t, t.hold - 40);
    expect(compressed.hold).toBe(40);
    expect(compressed.tearFlip).toBe(Math.round(t.tearFlip / FAST_FORWARD_TEAR_FACTOR));
    expect(compressed.toTableMs).toBeLessThan(t.toTableMs);
    expect(compressTimings(t, t.hold).hold).toBe(0);
    expect(t.hold).toBe(260);
  });

  it('the __DEV__ override reaches DEVICE only and clears with null', () => {
    setCeremonyTimingOverride({ single: { approach: 1000 } as never });
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: true }).approach).toBe(1000);
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: true }).hold).toBe(180);
    expect(resolveCeremonyTimings({ isMulti: true, peakRarity: 'RAR', motionAvailable: true }).approach).toBe(180);
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: false }).approach).toBe(300);
    expect(getCeremonyTimingOverride()).toEqual({ single: { approach: 1000 } });

    setCeremonyTimingOverride(null);
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: true }).approach).toBe(180);
    expect(getCeremonyTimingOverride()).toBeNull();

    try {
      (globalThis as { __DEV__?: boolean }).__DEV__ = false;
      setCeremonyTimingOverride({ single: { approach: 1234 } as never });
      expect(getCeremonyTimingOverride()).toBeNull();
    } finally {
      (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    }
  });

  it('exports the shared constants', () => {
    expect(REDUCED_MOTION_FLASH_MS).toBe(180);
    expect(REDUCED_MOTION_SETTLE_MS).toBe(240);
    expect(SWIPE_TRIGGER_DISTANCE).toBe(72);
    expect(TELL_FRACTION_OF_HOLD).toBe(0.6);
    expect(FAST_FORWARD_FROM_HOLD_FRACTION).toBe(0.6);
    expect(FAST_FORWARD_TEAR_FACTOR).toBe(1.6);
    expect(SPILL_STAGGER_MS).toBe(60);
    expect(SPILL_START_FRACTION).toBe(0.5);
    expect(SPILL_TRAVEL_FRACTION).toBeCloseTo(1 / 6);
    expect(CHARGE_DIM).toBe(0.55);
    expect(CHARGE_PULSE_FRACTION_OF_HOLD).toBe(0.5);
    expect(CHARGE_PULSE_SCALE).toBe(1.06);
    expect(CHARGE_SHAKE_PX).toBe(6);
    expect(CHARGE_SHAKE_DEG).toBe(3);
    expect(CHARGE_SHAKE_MS).toBe(120);
    expect(BURST_CAMERA_PUNCH).toBe(1.08);
    expect(FLASH_RISE_MS).toBe(50);
    expect(FLASH_HOLD_MS).toBe(40);
    expect(FLASH_FADE_MS).toBe(300);
    expect(Object.isFrozen(TEST_BASE)).toBe(true);
    expect(Object.isFrozen(DEVICE)).toBe(true);
  });
});
