import { describe, it, expect } from 'vitest';
import {
  activityContextLine, formatActivityRange, formatNutritionRange, formatPhaseDetail,
  nutritionContextLines, phaseContextLine, phaseStatus, weightTrend,
} from '../src/zen/healthLines';
import type { ActivityDay, BodyWeightEntry, NutritionDay, NutritionTargets, PhaseSettings } from '../src/types';

function mkDay(date: string, kcal: number, protein: number, carbs: number, fat: number, waterMl = 0): NutritionDay {
  return {
    date,
    waterMl,
    updatedAt: `${date}T20:00:00.000Z`,
    entries: kcal === 0 ? [] : [{
      id: `e-${date}`, foodId: 'dish:dal', name: 'Dal', source: 'dish', meal: 'lunch',
      qty: 150, unit: 'g', grams: 150, macros: { kcal, protein, carbs, fat }, at: `${date}T13:00:00.000Z`, approx: true,
    }],
  };
}

const TARGETS: NutritionTargets = { kcal: 2300, protein: 160, carbs: 240, fat: 65, waterMl: 3000, mode: 'auto', updatedAt: '' };

describe('nutritionContextLines', () => {
  it('reports today against targets and the 7-day average', () => {
    const week = [
      mkDay('2026-09-01', 2100, 130, 210, 60),
      mkDay('2026-09-02', 0, 0, 0, 0),
      mkDay('2026-09-05', 1900, 120, 190, 55),
      mkDay('2026-09-07', 1850, 125, 180, 50),
    ];
    const lines = nutritionContextLines({ today: week[3], week, targets: TARGETS });
    expect(lines[0]).toBe('Nutrition today: 1850 kcal, P125 C180 F50 g vs target 2300 kcal, P160 C240 F65.');
    expect(lines[1]).toBe('Nutrition 7d: avg 1950 kcal, P125 C193 F55 g on 3 of 7 logged days.');
  });

  it('nudges when today is empty but targets exist', () => {
    const lines = nutritionContextLines({ today: mkDay('2026-09-07', 0, 0, 0, 0), week: [], targets: TARGETS });
    expect(lines).toEqual(['Nutrition today: nothing logged yet (target 2300 kcal, P160 C240 F65).']);
  });

  it('says nothing at all when there is neither food nor targets', () => {
    expect(nutritionContextLines({ today: mkDay('2026-09-07', 0, 0, 0, 0), week: [], targets: null })).toEqual([]);
  });
});

describe('activityContextLine', () => {
  const days: ActivityDay[] = [
    { date: '2026-09-05', steps: 9000, activeKcal: 400, sleepMin: 400, source: 'health-connect', updatedAt: '' },
    { date: '2026-09-06', steps: 7000, activeKcal: 300, sleepMin: 440, restingHr: 58, source: 'health-connect', updatedAt: '' },
  ];

  it('averages only the fields that are present', () => {
    expect(activityContextLine(days)).toBe('Activity 7d: avg 8000 steps, 350 active kcal, 7 h sleep, resting HR 58 over 2 recorded days.');
  });

  it('is null when nothing was recorded', () => {
    expect(activityContextLine([])).toBeNull();
    expect(activityContextLine([{ date: '2026-09-06', source: 'manual', updatedAt: '' }])).toBeNull();
  });
});

describe('weightTrend', () => {
  const now = new Date('2026-09-07T12:00:00');
  const entries: BodyWeightEntry[] = [
    { id: '1', date: '2026-08-24T07:00:00', weight: 80 },
    { id: '2', date: '2026-08-31T07:00:00', weight: 79.5 },
    { id: '3', date: '2026-09-07T07:00:00', weight: 79 },
  ];

  it('measures kg and % per week from the window ends', () => {
    const t = weightTrend(entries, now);
    expect(t?.days).toBe(14);
    expect(t?.samples).toBe(3);
    expect(t?.kgPerWeek).toBeCloseTo(-0.5, 5);
    expect(t?.pctPerWeek).toBeCloseTo(-0.6289, 3);
  });

  it('needs three weigh-ins spanning a week', () => {
    expect(weightTrend(entries.slice(0, 2), now)).toBeNull();
    expect(weightTrend([
      { id: '1', date: '2026-09-05T07:00:00', weight: 80 },
      { id: '2', date: '2026-09-06T07:00:00', weight: 79.8 },
      { id: '3', date: '2026-09-07T07:00:00', weight: 79.7 },
    ], now)).toBeNull();
  });

  it('ignores entries older than the window', () => {
    expect(weightTrend([{ id: '0', date: '2026-01-01T07:00:00', weight: 90 }, ...entries], now)?.samples).toBe(3);
  });
});

describe('phase lines', () => {
  const now = new Date('2026-09-07T12:00:00');
  const entries: BodyWeightEntry[] = [
    { id: '1', date: '2026-08-24T07:00:00', weight: 80 },
    { id: '2', date: '2026-08-31T07:00:00', weight: 79.5 },
    { id: '3', date: '2026-09-07T07:00:00', weight: 79 },
  ];
  const cut: PhaseSettings = { goal: 'cut', targetRatePctPerWeek: -0.5, startDate: '2026-08-01', startWeightKg: 81 };
  const trend = weightTrend(entries, now)!;

  it('calls a rate inside 1.5x of the cut target on track', () => {
    expect(phaseStatus(cut, trend)).toBe('on track');
  });

  it('flags too fast past 1.5x and stalled below 0.1 %/week', () => {
    expect(phaseStatus({ ...cut, targetRatePctPerWeek: -0.25 }, trend)).toBe('too fast');
    expect(phaseStatus(cut, { ...trend, pctPerWeek: -0.05 })).toBe('stalled');
    // Gaining while cutting is stalled, not "on track".
    expect(phaseStatus(cut, { ...trend, pctPerWeek: 0.4 })).toBe('stalled');
  });

  it('writes one line with goal, target, actual and status', () => {
    const line = phaseContextLine(cut, trend)!;
    expect(line).toContain('Phase: cut, target −0.5 %/week');
    expect(line).toContain('actual −0.63 %/week');
    expect(line).toContain('— on track.');
  });

  it('falls back to a plain trend line with no phase set', () => {
    expect(phaseContextLine(null, trend)).toBe('Body weight trend: −0.5 kg/week (−0.63 %/week over 14d, no phase set).');
    expect(phaseContextLine(null, null)).toBeNull();
  });

  it('says what is missing when there are too few weigh-ins', () => {
    expect(phaseContextLine(cut, null)).toContain('not enough weigh-ins');
  });
});

describe('data-request answers', () => {
  const days = [
    mkDay('2026-09-05', 2000, 120, 200, 60, 2000),
    mkDay('2026-09-06', 0, 0, 0, 0),
    mkDay('2026-09-07', 1800, 130, 180, 50),
  ];

  it('formats a nutrition range with per-day rows, an average and the targets', () => {
    const out = formatNutritionRange(days, '2026-09-05', '2026-09-07', TARGETS);
    expect(out).toContain('1900 kcal · P125 C190 F55 g.');
    expect(out).toContain('2000 kcal · P120 C200 F60 g · 1 item · 2 L water');
    expect(out).toContain('Average over 2 logged days');
    expect(out).toContain('Targets: 2300 kcal · P160 C240 F65 g.');
    expect(out).toContain('approximate');
    // The empty day (Sun 6 Sep) is skipped rather than logged as a zero.
    expect(out).not.toContain('6 Sep');
  });

  it('says so when a range has nothing logged', () => {
    expect(formatNutritionRange([], '2026-09-01', '2026-09-07', null)).toBe('No food logged between 2026-09-01 and 2026-09-07.');
  });

  it('formats an activity range with a trailing summary', () => {
    const out = formatActivityRange([
      { date: '2026-09-06', steps: 7000, sleepMin: 420, source: 'health-connect', updatedAt: '' },
      { date: '2026-09-07', steps: 9000, source: 'manual', updatedAt: '' },
    ], '2026-09-06', '2026-09-07');
    expect(out).toContain('7000 steps · 7 h sleep (health-connect)');
    expect(out).toContain('9000 steps (manual)');
    expect(out).toContain('Activity 7d: avg 8000 steps');
    expect(formatActivityRange([], '2026-09-06', '2026-09-07')).toBe('No activity recorded between 2026-09-06 and 2026-09-07.');
  });

  it('formats the phase detail from weights, intake and targets', () => {
    const out = formatPhaseDetail({
      phase: { goal: 'cut', targetRatePctPerWeek: -0.5, startDate: '2026-08-01', startWeightKg: 81 },
      targets: TARGETS,
      weights: [
        { id: '1', date: '2026-08-24T07:00:00', weight: 80 },
        { id: '2', date: '2026-08-31T07:00:00', weight: 79.5 },
        { id: '3', date: '2026-09-07T07:00:00', weight: 79 },
      ],
      nutritionDays: days,
      now: new Date('2026-09-07T12:00:00'),
    });
    expect(out).toContain('Goal: cut, target −0.5 %/week');
    expect(out).toContain('Trend: −0.5 kg/week (−0.63 %/week) from 3 weigh-ins over 14 days.');
    expect(out).toContain('Status: on track.');
    expect(out).toContain('Intake: 1900 kcal/day average across 2 logged days');
    expect(out).toContain('Targets (auto): 2300 kcal');
  });

  it('degrades gracefully with no phase, no weigh-ins and no targets', () => {
    const out = formatPhaseDetail({ phase: null, targets: null, weights: [], nutritionDays: [] });
    expect(out).toContain('No bulk/cut phase set');
    expect(out).toContain('not enough weigh-ins');
    expect(out).toContain('no food logged');
    expect(out).toContain('Targets: none set yet.');
  });
});
