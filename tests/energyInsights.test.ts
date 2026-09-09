import { describe, it, expect } from 'vitest';
import type { DayEnergy } from '../src/energy';
import type { NutritionTargets, PhaseSettings } from '../src/types';
import { buildEnergyInsights, targetDailyBalance } from '../src/health/energyInsights';

const day = (over: Partial<DayEnergy> & { date: string }): DayEnergy => ({
  restingKcal: 1750, workoutKcal: 0, stepsKcal: 200, deviceActiveKcal: null,
  activeKcal: 200, totalKcal: 1950, activeSource: 'estimated', intakeKcal: 2000, balanceKcal: 50,
  ...over,
});

const mk = (n: number, f: (i: number) => Partial<DayEnergy>): DayEnergy[] =>
  Array.from({ length: n }, (_, i) => day({ date: `2026-09-0${i + 1}`, ...f(i) }));

const cut: PhaseSettings = { goal: 'cut', targetRatePctPerWeek: -0.5, startDate: '2026-09-01' };
const bulk: PhaseSettings = { goal: 'bulk', targetRatePctPerWeek: 0.25, startDate: '2026-09-01' };
const targets: NutritionTargets = { kcal: 2300, protein: 170, carbs: 250, fat: 64, waterMl: 3000, mode: 'auto', updatedAt: '' };

describe('target balance', () => {
  it('turns a rate into a daily calorie number', () => {
    expect(targetDailyBalance(cut, 78)).toBe(-429);
    expect(targetDailyBalance(bulk, 78)).toBe(215);
    expect(targetDailyBalance(null, 78)).toBe(0);
  });
});

describe('insights', () => {
  const ids = (list: ReturnType<typeof buildEnergyInsights>) => list.map((i) => i.id);

  it('asks for food logs before anything else', () => {
    const list = buildEnergyInsights({ days: mk(7, () => ({ intakeKcal: 0 })), phase: cut, targets, weightKg: 78 });
    expect(ids(list)).toEqual(['no-intake']);
  });

  it('asks for the profile when resting burn is unknown', () => {
    const list = buildEnergyInsights({ days: mk(5, () => ({ restingKcal: null, totalKcal: null })), phase: cut, targets, weightKg: 78 });
    expect(ids(list)).toEqual(['no-profile']);
  });

  it('confirms when the deficit matches the cut', () => {
    // goal −429/day: intake 1950, out 2379
    const list = buildEnergyInsights({ days: mk(7, () => ({ intakeKcal: 1950, totalKcal: 2379 })), phase: cut, targets, weightKg: 78 });
    expect(ids(list)).toContain('on-track');
    expect(list[0].tone).toBe('good');
  });

  it('says how much to cut, in calories and in steps', () => {
    const list = buildEnergyInsights({ days: mk(7, () => ({ intakeKcal: 2400, totalKcal: 2379 })), phase: cut, targets, weightKg: 78 });
    const over = list.find((i) => i.id === 'over-goal')!;
    expect(over.tone).toBe('warn');
    expect(over.headline).toMatch(/450 kcal a day more/);
    expect(over.detail).toMatch(/steps a day/);
  });

  it('tells a bulker to eat more', () => {
    const list = buildEnergyInsights({ days: mk(7, () => ({ intakeKcal: 2200, totalKcal: 2600 })), phase: bulk, targets, weightKg: 78 });
    const under = list.find((i) => i.id === 'under-goal')!;
    expect(under.headline).toMatch(/short of your bulk/);
    expect(under.tone).toBe('warn');
  });

  it('spots under-eating on training days', () => {
    const days = [
      day({ date: '1', workoutKcal: 300, intakeKcal: 1800, totalKcal: 2300 }),
      day({ date: '2', workoutKcal: 300, intakeKcal: 1750, totalKcal: 2300 }),
      day({ date: '3', workoutKcal: 0, intakeKcal: 2300, totalKcal: 1950 }),
      day({ date: '4', workoutKcal: 0, intakeKcal: 2250, totalKcal: 1950 }),
    ];
    expect(ids(buildEnergyInsights({ days, phase: cut, targets, weightKg: 78 }))).toContain('under-fuelled-training');
  });

  it('flags low protein with a concrete fix', () => {
    const list = buildEnergyInsights({
      days: mk(7, () => ({ intakeKcal: 1950, totalKcal: 2379 })), phase: cut, targets, weightKg: 78,
      proteinTargetG: 170, avgProteinG: 95,
    });
    const p = list.find((i) => i.id === 'low-protein')!;
    expect(p.detail).toMatch(/dal|paneer|whey/);
  });

  it('suggests steps when the day is sedentary on a cut', () => {
    const list = buildEnergyInsights({ days: mk(7, () => ({ intakeKcal: 1950, totalKcal: 2379, stepsKcal: 60 })), phase: cut, targets, weightKg: 78 });
    expect(ids(list)).toContain('low-steps');
  });

  it('admits when coverage is partial', () => {
    const days = [...mk(3, () => ({ intakeKcal: 1950, totalKcal: 2379 })), ...mk(4, () => ({ intakeKcal: 0 }))];
    expect(ids(buildEnergyInsights({ days, phase: cut, targets, weightKg: 78 }))).toContain('partial-logging');
  });
});
