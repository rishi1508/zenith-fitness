import { describe, it, expect } from 'vitest';
import { estimateBmr, estimateMaintenanceKcal, computeTargets, normalizeTargets, roundWaterMl } from '../src/health/targets';
import type { NutritionTargets } from '../src/types';

describe('targets', () => {
  const profile = { sex: 'male' as const, heightCm: 178, birthYear: 1998, activityLevel: 'moderate' as const };
  it('mifflin-st jeor for a 28-year-old 78 kg male', () => {
    expect(estimateBmr(profile, 78, new Date('2026-09-07'))).toBe(1758);
    expect(estimateMaintenanceKcal(profile, 78, new Date('2026-09-07'))).toBe(2725);
  });
  it('returns null without sex/height/birth year', () => {
    expect(estimateBmr({}, 78)).toBeNull();
  });
  it('cut at -0.5 %/week removes ~430 kcal/day and sets protein 2.2 g/kg', () => {
    const t = computeTargets({ maintenanceKcal: 2750, weightKg: 78, goal: 'cut', targetRatePctPerWeek: -0.5 });
    expect(t.kcal).toBe(2320);
    expect(t.protein).toBe(172);
    expect(t.fat).toBe(64);
    expect(t.carbs).toBe(264);
    expect(t.waterMl).toBe(2750);
  });
  it('carries the maintenance basis through for display, and omits it when not given', () => {
    const base = { maintenanceKcal: 2750, weightKg: 78, goal: 'cut' as const, targetRatePctPerWeek: -0.5 };
    expect(computeTargets({ ...base, maintenanceBasis: 'adaptive' })).toMatchObject({ kcal: 2320, maintenanceBasis: 'adaptive' });
    expect(computeTargets(base)).not.toHaveProperty('maintenanceBasis');
  });
});

describe('water target rounding', () => {
  it('rounds to whole 250 ml glasses, never below one', () => {
    expect(roundWaterMl(2600)).toBe(2500);
    expect(roundWaterMl(2730)).toBe(2750);
    expect(roundWaterMl(2875)).toBe(3000);
    expect(roundWaterMl(100)).toBe(250);
    expect(roundWaterMl(0)).toBe(250);
    expect(roundWaterMl(-500)).toBe(250);
    expect(roundWaterMl(Number.NaN)).toBe(250);
  });

  it('normalises targets saved before the rounding existed', () => {
    const saved: NutritionTargets = {
      kcal: 2320, protein: 172, carbs: 264, fat: 64, waterMl: 2600,
      mode: 'auto', updatedAt: '2026-08-01T00:00:00.000Z',
    };
    expect(normalizeTargets(saved).waterMl).toBe(2500);
    // Everything else is left exactly as it was.
    expect(normalizeTargets(saved)).toMatchObject({ kcal: 2320, protein: 172, mode: 'auto' });
  });

  it('returns the same object when the target is already whole glasses', () => {
    const clean: NutritionTargets = {
      kcal: 2320, protein: 172, carbs: 264, fat: 64, waterMl: 2750,
      mode: 'manual', updatedAt: '2026-09-01T00:00:00.000Z',
    };
    expect(normalizeTargets(clean)).toBe(clean);
  });
});
