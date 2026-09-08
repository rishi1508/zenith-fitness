import { describe, it, expect } from 'vitest';
import { levelForVolume, stepKgFor, thresholdKgFor, formatVolume, levelTitle, MAX_LEVEL } from '../src/levels';

describe('experience levels', () => {
  it('starts everyone at level 1', () => {
    expect(levelForVolume(0).level).toBe(1);
    expect(levelForVolume(-5).level).toBe(1);
    expect(levelForVolume(1_499).level).toBe(1);
  });

  it('uses the owner-specified first two steps', () => {
    expect(stepKgFor(1)).toBe(1_500);
    expect(stepKgFor(2)).toBe(2_500);
    expect(levelForVolume(1_500).level).toBe(2);
    expect(levelForVolume(3_999).level).toBe(2);
    expect(levelForVolume(4_000).level).toBe(3);
  });

  it('gets harder every level', () => {
    for (let l = 1; l < 30; l++) expect(stepKgFor(l + 1)).toBeGreaterThan(stepKgFor(l));
  });

  it('thresholds are cumulative and monotonic', () => {
    expect(thresholdKgFor(1)).toBe(0);
    expect(thresholdKgFor(2)).toBe(1_500);
    expect(thresholdKgFor(3)).toBe(4_000);
    for (let l = 2; l < 40; l++) expect(thresholdKgFor(l + 1)).toBeGreaterThan(thresholdKgFor(l));
  });

  it('reports progress within the level', () => {
    const p = levelForVolume(2_750); // level 2 spans 1 500 → 4 000
    expect(p.level).toBe(2);
    expect(p.startKg).toBe(1_500);
    expect(p.nextKg).toBe(4_000);
    expect(p.remainingKg).toBe(1_250);
    expect(p.fraction).toBeCloseTo(0.5, 2);
  });

  it('puts a multi-year lifter in the twenties, not the hundreds', () => {
    // ~1 200 t is roughly 150 sessions at 8 t — the owner's own history.
    const p = levelForVolume(1_200_000);
    expect(p.level).toBeGreaterThanOrEqual(18);
    expect(p.level).toBeLessThanOrEqual(23);
  });

  it('caps out instead of looping forever', () => {
    const p = levelForVolume(1e18);
    expect(p.level).toBe(MAX_LEVEL);
    expect(p.nextKg).toBeNull();
    expect(p.fraction).toBe(1);
  });

  it('formats volume for humans', () => {
    expect(formatVolume(0)).toBe('0 kg');
    expect(formatVolume(940)).toBe('940 kg');
    expect(formatVolume(1_500)).toBe('1.5 t');
    expect(formatVolume(1_204_000)).toBe('1204 t');
  });

  it('gives every level a title', () => {
    expect(levelTitle(1)).toBe('Beginner');
    expect(levelTitle(20)).toBe('Advanced');
    expect(levelTitle(99)).toBe('Legend');
  });
});
