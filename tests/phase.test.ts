import { describe, it, expect } from 'vitest';
import {
  weightTrend, classifyPhase, adaptiveMaintenance, evaluateGoal, weeksElapsed, plannedWeights, planDrift,
} from '../src/phase';
import type { BodyWeightEntry, NutritionDay, PhaseSettings } from '../src/types';

const NOW = new Date(2026, 8, 7); // 7 Sep 2026, local midnight

function iso(daysAgo: number): string {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo);
  const m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Daily weigh-ins, newest first (the order storage.getBodyWeightEntries returns). */
function series(days: number, startWeight: number, kgPerDay: number, noise: (i: number) => number = () => 0): BodyWeightEntry[] {
  const out: BodyWeightEntry[] = [];
  for (let i = 0; i < days; i++) {
    const daysAgo = days - 1 - i; // i = 0 is the oldest
    out.push({ id: `bw_${i}`, date: iso(daysAgo), weight: startWeight + kgPerDay * i + noise(i) });
  }
  return out.reverse();
}

function nutritionDays(count: number, kcal: number): NutritionDay[] {
  return Array.from({ length: count }, (_, i) => ({
    date: iso(count - 1 - i),
    entries: [{
      id: `e${i}`, foodId: 'f', name: 'Day total', source: 'user' as const, meal: 'lunch' as const,
      qty: 1, unit: 'serving', grams: 100, macros: { kcal, protein: 0, carbs: 0, fat: 0 }, at: iso(count - 1 - i),
    }],
    waterMl: 0,
    updatedAt: iso(count - 1 - i),
  }));
}

const CUT: PhaseSettings = { goal: 'cut', targetRatePctPerWeek: -0.5, startDate: iso(42), startWeightKg: 80 };
const BULK: PhaseSettings = { goal: 'bulk', targetRatePctPerWeek: 0.25, startDate: iso(42), startWeightKg: 70 };
const MAINTAIN: PhaseSettings = { goal: 'maintain', targetRatePctPerWeek: 0, startDate: iso(42) };

describe('weightTrend', () => {
  it('reads a clean −0.5 %/week cut (80 kg losing 0.4 kg/week for 8 weeks)', () => {
    const entries = series(56, 83.2, -0.4 / 7);
    const t = weightTrend(entries, { now: NOW });
    expect(t.status).toBe('ok');
    expect(t.points).toHaveLength(14);
    expect(t.rateKgPerWeek).toBeCloseTo(-0.4, 2);
    expect(t.ratePctPerWeek).toBeCloseTo(-0.5, 1);
    expect(t.latestEma).toBeCloseTo(80.6, 1); // the EMA lags the raw 80.0 by ~10 days of trend
    expect(t.startEma).toBeGreaterThan(t.latestEma!);
  });

  it('smooths noisy daily weights back to the underlying rate', () => {
    // ±0.6 kg of water-weight swing on top of a 0.4 kg/week loss.
    const entries = series(56, 83.2, -0.4 / 7, (i) => [0.6, -0.5, 0.2, -0.6, 0.5, -0.2, 0][i % 7]);
    const t = weightTrend(entries, { now: NOW });
    expect(t.status).toBe('ok');
    // ±0.6 kg of daily swing leaves well under 0.1 kg/week of error.
    expect(Math.abs(t.rateKgPerWeek - -0.4)).toBeLessThan(0.1);
    // The raw points keep the noise; only the EMA is smooth.
    const rawSwing = Math.max(...t.points.map((p) => p.weight)) - Math.min(...t.points.map((p) => p.weight));
    const emaSwing = Math.max(...t.points.map((p) => p.ema)) - Math.min(...t.points.map((p) => p.ema));
    expect(rawSwing).toBeGreaterThan(emaSwing);
  });

  it('averages several weigh-ins on the same day', () => {
    const entries: BodyWeightEntry[] = [
      { id: 'a', date: iso(0), weight: 80.6 },
      { id: 'b', date: iso(0), weight: 80.0 },
      { id: 'c', date: iso(4), weight: 81 },
      { id: 'd', date: iso(8), weight: 81.5 },
      { id: 'e', date: iso(12), weight: 82 },
    ];
    const t = weightTrend(entries, { now: NOW });
    expect(t.points).toHaveLength(4);
    expect(t.points[3].date).toBe(iso(0));
    expect(t.points[3].weight).toBeCloseTo(80.3, 5);
  });

  it('is insufficient below 4 points', () => {
    const t = weightTrend([
      { id: 'a', date: iso(0), weight: 80 },
      { id: 'b', date: iso(6), weight: 81 },
      { id: 'c', date: iso(12), weight: 82 },
    ], { now: NOW });
    expect(t.status).toBe('insufficient');
    expect(t.rateKgPerWeek).toBe(0);
    expect(t.ratePctPerWeek).toBe(0);
    expect(t.latestEma).not.toBeNull(); // still usable as "current weight"
  });

  it('is insufficient when 4+ points span less than a week', () => {
    const t = weightTrend(series(5, 80, 0), { now: NOW });
    expect(t.points).toHaveLength(5);
    expect(t.status).toBe('insufficient');
  });

  it('returns an empty trend with no entries', () => {
    const t = weightTrend([], { now: NOW });
    expect(t).toMatchObject({ status: 'insufficient', points: [], latestEma: null, startEma: null });
  });

  it('honours the window and ignores future-dated entries', () => {
    const entries = series(120, 90, -0.05);
    entries.unshift({ id: 'future', date: iso(-3), weight: 1 });
    expect(weightTrend(entries, { days: 30, now: NOW }).points).toHaveLength(30);
    expect(weightTrend(entries, { days: 90, now: NOW }).points).toHaveLength(90);
    expect(weightTrend(entries, { days: 90, now: NOW }).points.every((p) => p.date <= iso(0))).toBe(true);
  });

  it('does not depend on the input order', () => {
    const entries = series(30, 80, 0.05);
    const shuffled = [...entries].sort((a, b) => a.id.localeCompare(b.id));
    expect(weightTrend(shuffled, { now: NOW }).rateKgPerWeek).toBeCloseTo(weightTrend(entries, { now: NOW }).rateKgPerWeek, 10);
  });

  it('handles gaps between weigh-ins (weekly logger)', () => {
    const entries: BodyWeightEntry[] = [0, 7, 14, 21, 28].map((d, i) => ({ id: `w${i}`, date: iso(d), weight: 80 + d * (0.4 / 7) }));
    const t = weightTrend(entries, { days: 30, now: NOW });
    expect(t.status).toBe('ok');
    expect(t.rateKgPerWeek).toBeCloseTo(-0.4, 1);
  });
});

describe('classifyPhase', () => {
  it('splits bulk / cut / maintain at ±0.25 %/week', () => {
    expect(classifyPhase(0.6)).toBe('bulk');
    expect(classifyPhase(0.26)).toBe('bulk');
    expect(classifyPhase(0.25)).toBe('maintain');
    expect(classifyPhase(0)).toBe('maintain');
    expect(classifyPhase(-0.25)).toBe('maintain');
    expect(classifyPhase(-0.26)).toBe('cut');
    expect(classifyPhase(-1.2)).toBe('cut');
  });
});

describe('adaptiveMaintenance', () => {
  const trend = weightTrend(series(56, 83.2, -0.4 / 7), { now: NOW }); // −0.4 kg/week

  it('uses measured intake minus the deficit the trend implies', () => {
    const m = adaptiveMaintenance({ nutritionDays: nutritionDays(14, 2200), trend, fallbackKcal: 2725 });
    expect(m.basis).toBe('adaptive');
    expect(m.loggedDays).toBe(14);
    expect(m.kcal).toBeGreaterThan(2630); // 2200 + 0.4 × 7700 / 7 ≈ 2640
    expect(m.kcal).toBeLessThan(2650);
  });

  it('falls back to the formula below 10 logged days', () => {
    const m = adaptiveMaintenance({ nutritionDays: nutritionDays(9, 2200), trend, fallbackKcal: 2725 });
    expect(m).toEqual({ kcal: 2725, basis: 'formula', loggedDays: 9 });
  });

  it('ignores empty days when counting', () => {
    const days = nutritionDays(12, 2200);
    days[0].entries = [];
    days[1].entries = [];
    days[2].entries = [];
    expect(adaptiveMaintenance({ nutritionDays: days, trend, fallbackKcal: 2725 }).basis).toBe('formula');
    expect(adaptiveMaintenance({ nutritionDays: days, trend, fallbackKcal: 2725 }).loggedDays).toBe(9);
  });

  it('falls back to the formula when the trend is unreadable', () => {
    const thin = weightTrend([{ id: 'a', date: iso(0), weight: 80 }], { now: NOW });
    expect(adaptiveMaintenance({ nutritionDays: nutritionDays(20, 2200), trend: thin, fallbackKcal: 2725 }).basis).toBe('formula');
  });

  it('reports no basis when there is neither intake nor a profile', () => {
    expect(adaptiveMaintenance({ nutritionDays: [], trend, fallbackKcal: null })).toEqual({ kcal: null, basis: 'none', loggedDays: 0 });
  });
});

describe('weeksElapsed', () => {
  it('counts fractional weeks from the start date', () => {
    expect(weeksElapsed({ ...CUT, startDate: iso(21) }, NOW)).toBeCloseTo(3, 5);
    expect(weeksElapsed({ ...CUT, startDate: iso(10) }, NOW)).toBeCloseTo(10 / 7, 5);
    expect(weeksElapsed({ ...CUT, startDate: iso(0) }, NOW)).toBe(0);
  });
  it('never goes negative for a future start date', () => {
    expect(weeksElapsed({ ...CUT, startDate: iso(-14) }, NOW)).toBe(0);
  });
});

describe('evaluateGoal', () => {
  it('calls a clean −0.5 %/week cut on track', () => {
    const trend = weightTrend(series(56, 83.2, -0.4 / 7), { now: NOW });
    const r = evaluateGoal(CUT, trend, weeksElapsed(CUT, NOW));
    expect(r.status).toBe('on-track');
    expect(r.suggestedKcalDelta).toBe(0);
    expect(r.headline).toMatch(/Losing 0\.4\d kg a week/);
    expect(r.guidance).toContain('−0.50 %/week');
  });

  it('flags a stalled cut after three weeks', () => {
    const trend = weightTrend(series(56, 80, 0, (i) => (i % 2 ? 0.15 : -0.15)), { now: NOW });
    const r = evaluateGoal(CUT, trend, weeksElapsed(CUT, NOW));
    expect(r.status).toBe('stalled');
    expect(r.suggestedKcalDelta).toBe(-200);
    expect(r.headline).toMatch(/^Stalled — the trend is flat at 80\.0 kg$/);
    expect(r.guidance).toMatch(/^6 weeks into this cut\. Cut about 200 kcal a day \(or add steps\)/);
  });

  it('does not call a young flat cut stalled', () => {
    const trend = weightTrend(series(56, 80, 0), { now: NOW });
    const young: PhaseSettings = { ...CUT, startDate: iso(9) };
    expect(evaluateGoal(young, trend, weeksElapsed(young, NOW)).status).not.toBe('stalled');
  });

  it('flags a too-fast bulk and suggests eating less', () => {
    const trend = weightTrend(series(56, 68, 1.0 / 7), { now: NOW }); // ~+1 kg/week on a +0.25 % target
    const r = evaluateGoal(BULK, trend, weeksElapsed(BULK, NOW));
    expect(r.status).toBe('too-fast');
    expect(r.suggestedKcalDelta).toBe(-200);
    expect(r.headline).toMatch(/Gaining 1\.0\d kg a week/);
    expect(r.headline).toContain('+0.25 %/week');
  });

  it('flags a too-fast cut and suggests eating more', () => {
    const trend = weightTrend(series(56, 90, -1.2 / 7), { now: NOW }); // ~−1.5 %/week vs a −0.5 % target
    const r = evaluateGoal(CUT, trend, weeksElapsed(CUT, NOW));
    expect(r.status).toBe('too-fast');
    expect(r.suggestedKcalDelta).toBe(200);
    expect(r.guidance).toMatch(/Add about 200 kcal a day/);
  });

  it('uses the gentler ±150 step for a mild overshoot', () => {
    const trend = weightTrend(series(56, 82, -0.66 / 7), { now: NOW }); // ~−0.85 %/week vs −0.5 %
    expect(evaluateGoal(CUT, trend, weeksElapsed(CUT, NOW))).toMatchObject({ status: 'too-fast', suggestedKcalDelta: 150 });
  });

  it('flags a too-slow cut after two weeks', () => {
    const trend = weightTrend(series(56, 80.8, -0.13 / 7), { now: NOW }); // ~−0.16 %/week vs −0.5 %
    const r = evaluateGoal(CUT, trend, weeksElapsed(CUT, NOW));
    expect(r.status).toBe('too-slow');
    expect(r.suggestedKcalDelta).toBe(-150);
    expect(r.headline).toContain('slower than');
    expect(r.guidance).toContain('6 weeks in');
  });

  it('steps 200 kcal when a cut is barely moving but not yet stalled', () => {
    const trend = weightTrend(series(56, 80.4, -0.09 / 7), { now: NOW }); // ~−0.11 %/week vs −0.5 %
    expect(evaluateGoal(CUT, trend, weeksElapsed(CUT, NOW))).toMatchObject({ status: 'too-slow', suggestedKcalDelta: -200 });
  });

  it('holds fire in the first two weeks of a phase', () => {
    const trend = weightTrend(series(56, 80.8, -0.13 / 7), { now: NOW });
    const young: PhaseSettings = { ...CUT, startDate: iso(8) };
    const r = evaluateGoal(young, trend, weeksElapsed(young, NOW));
    expect(r).toMatchObject({ status: 'on-track', suggestedKcalDelta: 0 });
    expect(r.guidance).toMatch(/Too early to judge/);
  });

  it('flags a maintain phase that is drifting up', () => {
    const trend = weightTrend(series(56, 72, 0.5 / 7), { now: NOW });
    const r = evaluateGoal(MAINTAIN, trend, weeksElapsed(MAINTAIN, NOW));
    expect(r.status).toBe('too-fast');
    expect(r.suggestedKcalDelta).toBe(-150);
  });

  it('accepts a flat maintain phase', () => {
    const trend = weightTrend(series(56, 72, 0.05 / 7), { now: NOW });
    const r = evaluateGoal(MAINTAIN, trend, weeksElapsed(MAINTAIN, NOW));
    expect(r).toMatchObject({ status: 'on-track', suggestedKcalDelta: 0 });
    expect(r.headline).toMatch(/Holding steady at 7\d\.\d kg/);
  });

  it('asks for the missing weigh-ins when the trend is unreadable', () => {
    const trend = weightTrend([{ id: 'a', date: iso(0), weight: 80 }, { id: 'b', date: iso(7), weight: 81 }], { now: NOW });
    const r = evaluateGoal(CUT, trend, weeksElapsed(CUT, NOW));
    expect(r).toMatchObject({ status: 'insufficient', suggestedKcalDelta: 0 });
    expect(r.guidance).toContain('2 more weigh-ins');
  });

  it('explains a short span rather than a missing count', () => {
    const trend = weightTrend(series(5, 80, -0.05), { now: NOW });
    const r = evaluateGoal(CUT, trend, weeksElapsed(CUT, NOW));
    expect(r.status).toBe('insufficient');
    expect(r.guidance).toContain('less than 7 days');
  });
});

describe('plannedWeights', () => {
  const settings = { goal: 'bulk', targetRatePctPerWeek: 0.5, startDate: '2026-09-01', startWeightKg: 80 } as PhaseSettings;

  it('starts at the phase weight and compounds weekly', () => {
    const [d0, d7, d14] = plannedWeights(settings, ['2026-09-01', '2026-09-08', '2026-09-15'], 80);
    expect(d0).toBe(80);
    expect(d7).toBeCloseTo(80.4, 1);
    expect(d14).toBeCloseTo(80.8, 1);
  });

  it('falls the other way on a cut', () => {
    const cut = { ...settings, goal: 'cut', targetRatePctPerWeek: -0.5 } as PhaseSettings;
    const [, week1] = plannedWeights(cut, ['2026-09-01', '2026-09-08'], 80);
    expect(week1).toBeCloseTo(79.6, 1);
  });

  it('has nothing to say before the phase began', () => {
    expect(plannedWeights(settings, ['2026-08-20'], 80)).toEqual([null]);
  });

  it('measures the gap between the scale and the plan', () => {
    // A week in at 81.4 kg when the plan wanted 80.4.
    expect(planDrift(settings, '2026-09-08', 81.4, 80)).toBeCloseTo(1.0, 1);
    expect(planDrift(settings, '2026-09-08', 79.4, 80)).toBeCloseTo(-1.0, 1);
    expect(planDrift(settings, '2026-08-01', 80, 80)).toBeNull();
  });
});
