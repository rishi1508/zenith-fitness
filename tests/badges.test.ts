import { describe, it, expect } from 'vitest';
import { BADGES, badgeById, earnedBadgeIds, mergeBadges, sessionVolume } from '../src/badges';
import type { PersonalRecord, Workout } from '../src/types';

const workout = (opts: { volume?: number; hour?: number; completed?: boolean; type?: string } = {}): Workout => {
  const d = new Date('2026-09-09T12:00:00+05:30');
  if (opts.hour !== undefined) d.setHours(opts.hour, 0, 0, 0);
  const reps = 10;
  const weight = (opts.volume ?? 1000) / reps;
  return {
    id: Math.random().toString(36).slice(2),
    name: 'S',
    date: d.toISOString(),
    startedAt: d.toISOString(),
    completed: opts.completed ?? true,
    type: opts.type ?? 'custom',
    exercises: [{ id: 'e', exerciseId: 'x', exerciseName: 'X', sets: [{ id: 's', weight, reps, completed: true }] }],
  } as unknown as Workout;
};

const base = { workouts: [], records: [], totalVolumeKg: 0, streakWeeks: 0 };

describe('badge definitions', () => {
  it('has unique ids and every one resolvable', () => {
    const ids = BADGES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(badgeById(id)).toBeDefined();
  });

  it('is a collection, not a checklist', () => {
    expect(BADGES.length).toBeLessThanOrEqual(24);
    expect(BADGES.length).toBeGreaterThanOrEqual(12);
  });

  it('gives every family a first tier reachable in week one', () => {
    // One session, one record, one tonne — all possible on day one.
    const day1 = earnedBadgeIds({ ...base, workouts: [workout({ volume: 1000 })], records: [{} as PersonalRecord], totalVolumeKg: 1000 });
    expect(day1).toContain('sessions-1');
    expect(day1).toContain('pr-first');
    expect(day1).toContain('volume-1t');
  });
});

describe('earnedBadgeIds', () => {
  it('counts only completed, non-rest sessions', () => {
    const ws = [workout(), workout({ completed: false }), workout({ type: 'rest' })];
    expect(earnedBadgeIds({ ...base, workouts: ws })).toContain('sessions-1');
    expect(earnedBadgeIds({ ...base, workouts: [workout({ completed: false })] })).not.toContain('sessions-1');
  });

  it('awards the big-day badge from a single session, not the total', () => {
    const many = Array.from({ length: 10 }, () => workout({ volume: 1000 }));
    expect(earnedBadgeIds({ ...base, workouts: many, totalVolumeKg: 10_000 })).not.toContain('session-5t');
    expect(earnedBadgeIds({ ...base, workouts: [workout({ volume: 5200 })], totalVolumeKg: 5200 })).toContain('session-5t');
  });

  it('reads the early-bird badge off the start time', () => {
    const early = Array.from({ length: 10 }, () => workout({ hour: 5 }));
    expect(earnedBadgeIds({ ...base, workouts: early })).toContain('early-10');
    const late = Array.from({ length: 10 }, () => workout({ hour: 7 }));
    expect(earnedBadgeIds({ ...base, workouts: late })).not.toContain('early-10');
  });

  it('tracks streak, nutrition and check-in thresholds', () => {
    expect(earnedBadgeIds({ ...base, streakWeeks: 12 })).toEqual(expect.arrayContaining(['streak-4', 'streak-12']));
    expect(earnedBadgeIds({ ...base, streakWeeks: 12 })).not.toContain('streak-52');
    expect(earnedBadgeIds({ ...base, loggedNutritionDays: 30 })).toContain('nutrition-30');
    expect(earnedBadgeIds({ ...base, checkins30d: 16 })).toContain('checkins-16');
  });

  it('derives the level badges from volume', () => {
    expect(earnedBadgeIds({ ...base, totalVolumeKg: 1_000_000 })).toContain('level-10');
    expect(earnedBadgeIds({ ...base, totalVolumeKg: 0 })).not.toContain('level-10');
  });

  it('gives nothing to an empty history', () => {
    expect(earnedBadgeIds(base)).toEqual([]);
  });
});

describe('mergeBadges', () => {
  const NOW = new Date('2026-09-10T08:00:00Z');

  it('keeps the date a badge was first earned', () => {
    const existing = [{ id: 'sessions-1', at: '2026-01-01T00:00:00.000Z' }];
    const { badges, added } = mergeBadges(existing, ['sessions-1', 'volume-1t'], NOW);
    expect(added).toEqual(['volume-1t']);
    expect(badges.find((b) => b.id === 'sessions-1')!.at).toBe('2026-01-01T00:00:00.000Z');
    expect(badges.find((b) => b.id === 'volume-1t')!.at).toBe(NOW.toISOString());
  });

  it('never takes one away', () => {
    const existing = [{ id: 'volume-100t', at: '2026-01-01T00:00:00.000Z' }];
    const { badges, added } = mergeBadges(existing, [], NOW);
    expect(added).toEqual([]);
    expect(badges.map((b) => b.id)).toEqual(['volume-100t']);
  });

  it('returns them in definition order, not the order they were earned', () => {
    const { badges } = mergeBadges([{ id: 'level-10', at: '2026-01-01T00:00:00.000Z' }], ['sessions-1'], NOW);
    expect(badges.map((b) => b.id)).toEqual(['sessions-1', 'level-10']);
  });
});

describe('sessionVolume', () => {
  it('counts completed sets only', () => {
    const w = {
      exercises: [{ sets: [
        { weight: 100, reps: 5, completed: true },
        { weight: 100, reps: 5, completed: false },
      ] }],
    } as unknown as Workout;
    expect(sessionVolume(w)).toBe(500);
  });
});
