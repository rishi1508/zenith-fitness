import { describe, it, expect } from 'vitest';
import { estimateBmr, estimateMaintenanceKcal, computeTargets } from '../src/health/targets';

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
});
