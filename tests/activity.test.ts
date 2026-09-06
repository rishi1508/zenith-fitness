import { describe, it, expect } from 'vitest';
import type { ActivityDay, ActivitySession } from '../src/types';
import {
  addSessionToDay, estimateWorkoutKcal, formatSleep, hasReadings, mergeActivityDay, sameActivityDay, summariseActivity,
} from '../src/activity/aggregate';

function day(date: string, patch: Partial<ActivityDay> = {}): ActivityDay {
  return { date, source: 'manual', updatedAt: '2026-09-06T00:00:00.000Z', ...patch };
}

const hcSession: ActivitySession = {
  id: 'hc-1', type: 'running', startAt: '2026-09-07T06:00:00.000Z', durationMin: 30, kcal: 240, source: 'health-connect',
};
const zenithSession: ActivitySession = {
  id: 'w-1', type: 'strengthTraining', startAt: '2026-09-07T18:00:00.000Z', durationMin: 62, source: 'zenith',
};

describe('mergeActivityDay', () => {
  it('takes every Health Connect value on a fresh day', () => {
    const merged = mergeActivityDay(day('2026-09-07'), { steps: 8421, activeKcal: 512, sleepMin: 431, sessions: [hcSession] });
    expect(merged).toMatchObject({ steps: 8421, activeKcal: 512, sleepMin: 431, source: 'health-connect' });
    expect(merged?.sessions).toEqual([hcSession]);
  });

  it('overwrites manual values it has data for and keeps the rest as mixed', () => {
    const existing = day('2026-09-07', { steps: 6000, sleepMin: 400, source: 'manual' });
    const merged = mergeActivityDay(existing, { steps: 8421 });
    expect(merged).toMatchObject({ steps: 8421, sleepMin: 400, source: 'mixed' });
  });

  it('stays health-connect when nothing manual survives', () => {
    const existing = day('2026-09-07', { steps: 100, sleepMin: 60, source: 'health-connect' });
    expect(mergeActivityDay(existing, { steps: 8421 })?.source).toBe('health-connect');
  });

  it('keeps Zenith sessions and replaces Health Connect ones', () => {
    const existing = day('2026-09-07', {
      source: 'health-connect',
      sessions: [zenithSession, { ...hcSession, id: 'stale', durationMin: 5 }],
    });
    const merged = mergeActivityDay(existing, { steps: 1, sessions: [hcSession] });
    expect(merged?.sessions?.map((s) => s.id)).toEqual(['hc-1', 'w-1']);
    expect(merged?.source).toBe('mixed');
  });

  it('never emits undefined fields (Firestore rejects them)', () => {
    const merged = mergeActivityDay(day('2026-09-07'), { steps: 10 })!;
    expect(Object.values(merged).every((v) => v !== undefined)).toBe(true);
    expect('sleepMin' in merged).toBe(false);
  });

  it('returns null when the sync found nothing for the day', () => {
    expect(mergeActivityDay(day('2026-09-07', { steps: 6000 }), {})).toBeNull();
    expect(mergeActivityDay(day('2026-09-07'), { sessions: [] })).toBeNull();
  });
});

describe('sameActivityDay', () => {
  it('ignores updatedAt so a repeat sync writes nothing', () => {
    const existing = day('2026-09-07', { steps: 8421, source: 'health-connect', sessions: [hcSession] });
    const merged = mergeActivityDay(existing, { steps: 8421, sessions: [hcSession] })!;
    expect(sameActivityDay(merged, { ...existing, updatedAt: '2026-09-07T09:00:00.000Z' })).toBe(true);
  });

  it('spots a changed metric, source or session', () => {
    const base = day('2026-09-07', { steps: 8421, source: 'health-connect' });
    expect(sameActivityDay(base, { ...base, steps: 8422 })).toBe(false);
    expect(sameActivityDay(base, { ...base, source: 'mixed' })).toBe(false);
    expect(sameActivityDay(base, { ...base, sessions: [hcSession] })).toBe(false);
  });
});

describe('addSessionToDay', () => {
  it('appends in start order and marks a synced day mixed', () => {
    const existing = day('2026-09-07', { source: 'health-connect', sessions: [hcSession] });
    const next = addSessionToDay(existing, zenithSession);
    expect(next.sessions?.map((s) => s.id)).toEqual(['hc-1', 'w-1']);
    expect(next.source).toBe('mixed');
  });

  it('replaces a session with the same id (idempotent re-write)', () => {
    const existing = day('2026-09-07', { sessions: [zenithSession] });
    const next = addSessionToDay(existing, { ...zenithSession, durationMin: 70 });
    expect(next.sessions).toHaveLength(1);
    expect(next.sessions?.[0].durationMin).toBe(70);
  });
});

describe('summariseActivity', () => {
  const days = [
    day('2026-09-01', { steps: 10000, activeKcal: 500, sleepMin: 420, restingHr: 58, sessions: [hcSession] }),
    day('2026-09-02', { steps: 6000, activeKcal: 300, sleepMin: 400, restingHr: 60 }),
    day('2026-09-03', { steps: 8000 }),
    day('2026-09-04'),
  ];

  it('averages only the days that carry each metric', () => {
    expect(summariseActivity(days)).toEqual({
      avgSteps: 8000,
      avgActiveKcal: 400,
      avgSleepMin: 410,
      avgRestingHr: 59,
      daysWithData: 3,
      sessions: 1,
    });
  });

  it('returns nulls, not NaN, with no data at all', () => {
    expect(summariseActivity([day('2026-09-01')])).toEqual({
      avgSteps: null, avgActiveKcal: null, avgSleepMin: null, avgRestingHr: null, daysWithData: 0, sessions: 0,
    });
    expect(summariseActivity([])).toMatchObject({ daysWithData: 0, sessions: 0 });
  });
});

describe('helpers', () => {
  it('hasReadings ignores an empty session list', () => {
    expect(hasReadings({ sessions: [] })).toBe(false);
    expect(hasReadings({ steps: 0 })).toBe(true);
  });

  it('estimates kcal at ~5 METs and refuses to guess without a body weight', () => {
    expect(estimateWorkoutKcal(60, 78)).toBe(390);
    expect(estimateWorkoutKcal(30, 78)).toBe(195);
    expect(estimateWorkoutKcal(60, undefined)).toBeUndefined();
    expect(estimateWorkoutKcal(0, 78)).toBeUndefined();
  });

  it('formats sleep minutes', () => {
    expect(formatSleep(431)).toBe('7h 11m');
    expect(formatSleep(45)).toBe('45m');
    expect(formatSleep(480)).toBe('8h 00m');
  });
});
