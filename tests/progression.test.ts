import { describe, it, expect } from 'vitest';
import {
  buildProgression, collectExerciseSessions, formatKg, formatSet, lastTopSetByExercise, topSet, WEIGHT_STEP_KG,
} from '../src/progression';
import type { ExerciseSession } from '../src/progression';
import type { Workout } from '../src/types';

/** A session of straight sets: same weight, one reps entry per set. */
function session(date: string, weight: number, reps: number[]): ExerciseSession {
  return { date, sets: reps.map((r) => ({ weight, reps: r })) };
}

/** A completed workout holding one exercise. */
function workout(date: string, exerciseId: string, sets: Array<[number, number, boolean?]>, over: Partial<Workout> = {}): Workout {
  return {
    id: `w_${date}_${exerciseId}`,
    date,
    name: 'Push',
    type: 'push',
    completed: true,
    exercises: [{
      id: `we_${date}`,
      exerciseId,
      exerciseName: 'Bench Press',
      sets: sets.map(([weight, reps, completed], i) => ({
        id: `s${i}`, weight, reps, completed: completed ?? true,
      })),
    }],
    ...over,
  };
}

describe('collectExerciseSessions', () => {
  const history: Workout[] = [
    workout('2026-09-01T10:00:00.000Z', 'bench', [[80, 5], [80, 5]]),
    workout('2026-09-08T10:00:00.000Z', 'bench', [[82.5, 5], [82.5, 5]]),
    workout('2026-08-25T10:00:00.000Z', 'bench', [[77.5, 5]]),
  ];

  it('returns sessions newest first', () => {
    const sessions = collectExerciseSessions(history, 'bench');
    expect(sessions.map((s) => s.sets[0].weight)).toEqual([82.5, 80, 77.5]);
  });

  it('ignores in-progress and rest workouts', () => {
    const noisy: Workout[] = [
      ...history,
      workout('2026-09-09T10:00:00.000Z', 'bench', [[85, 5]], { completed: false }),
      workout('2026-09-07T10:00:00.000Z', 'bench', [[999, 1]], { type: 'rest' }),
    ];
    expect(collectExerciseSessions(noisy, 'bench')[0].sets[0].weight).toBe(82.5);
  });

  it('drops sets that were never ticked off or logged with no reps', () => {
    const partial = [workout('2026-09-08T10:00:00.000Z', 'bench', [[80, 5], [80, 0], [80, 4, false]])];
    expect(collectExerciseSessions(partial, 'bench')[0].sets).toEqual([{ weight: 80, reps: 5 }]);
  });

  it('skips sessions where nothing was completed', () => {
    const skipped = [workout('2026-09-08T10:00:00.000Z', 'bench', [[80, 5, false]])];
    expect(collectExerciseSessions(skipped, 'bench')).toEqual([]);
  });

  it('falls back to the name when the id came from a buddy session', () => {
    const hosted = [workout('2026-09-08T10:00:00.000Z', 'host_bench_id', [[70, 8]])];
    expect(collectExerciseSessions(hosted, 'my_bench_id', 'bench press')).toHaveLength(1);
    expect(collectExerciseSessions(hosted, 'my_bench_id')).toHaveLength(0);
  });

  it('stops at the lookback limit', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      workout(`2026-0${(i % 9) + 1}-01T10:00:00.000Z`, 'bench', [[60 + i, 5]]));
    expect(collectExerciseSessions(many, 'bench', undefined, 3)).toHaveLength(3);
  });
});

describe('topSet', () => {
  it('picks the heaviest set, breaking ties on reps', () => {
    expect(topSet([{ weight: 60, reps: 12 }, { weight: 80, reps: 5 }, { weight: 80, reps: 6 }]))
      .toEqual({ weight: 80, reps: 6 });
  });

  it('has no answer for an empty session', () => {
    expect(topSet([])).toBeNull();
  });
});

describe('buildProgression', () => {
  it('says nothing about an exercise that has never been logged', () => {
    const p = buildProgression({ sessions: [], equipment: 'barbell' });
    expect(p).toEqual({ lastSets: [], last: null, sessionCount: 0, suggestion: null });
  });

  it('shows last time but suggests nothing after a single session', () => {
    const p = buildProgression({
      sessions: [session('2026-09-08T10:00:00.000Z', 60, [8, 8, 8])],
      equipment: 'barbell',
    });
    expect(p.last).toEqual({ weight: 60, reps: 8 });
    expect(p.sessionCount).toBe(1);
    expect(p.suggestion).toBeNull();
  });

  it('adds 2.5 kg to a barbell lift after a clean session', () => {
    const p = buildProgression({
      sessions: [
        session('2026-09-08T10:00:00.000Z', 80, [5, 5, 5]),
        session('2026-09-01T10:00:00.000Z', 77.5, [5, 5, 5]),
      ],
      equipment: 'barbell',
    });
    expect(p.suggestion).toMatchObject({ kind: 'add-weight', weight: 82.5, reps: 5 });
    expect(p.suggestion?.why).toContain('82.5 kg');
  });

  it('treats machines and cables like the barbell', () => {
    const sessions = [
      session('2026-09-08T10:00:00.000Z', 50, [10, 10]),
      session('2026-09-01T10:00:00.000Z', 47.5, [10, 10]),
    ];
    for (const equipment of ['machine', 'cable'] as const) {
      expect(buildProgression({ sessions, equipment }).suggestion)
        .toMatchObject({ kind: 'add-weight', weight: 50 + WEIGHT_STEP_KG });
    }
  });

  it('assumes a weight step when the equipment is unknown', () => {
    const p = buildProgression({
      sessions: [
        session('2026-09-08T10:00:00.000Z', 40, [10, 10]),
        session('2026-09-01T10:00:00.000Z', 37.5, [10, 10]),
      ],
    });
    expect(p.suggestion).toMatchObject({ kind: 'add-weight', weight: 42.5 });
  });

  it('adds a rep instead of a plate on dumbbells', () => {
    const p = buildProgression({
      sessions: [
        session('2026-09-08T10:00:00.000Z', 22.5, [10, 10, 10]),
        session('2026-09-01T10:00:00.000Z', 22.5, [9, 9, 9]),
      ],
      equipment: 'dumbbell',
    });
    expect(p.suggestion).toMatchObject({ kind: 'add-rep', weight: 22.5, reps: 11 });
    expect(p.suggestion?.why).toContain('one more rep');
  });

  it('adds a rep on bodyweight work, where there is no plate to add', () => {
    const p = buildProgression({
      sessions: [
        { date: '2026-09-08T10:00:00.000Z', sets: [{ weight: 0, reps: 12 }, { weight: 0, reps: 12 }] },
        { date: '2026-09-01T10:00:00.000Z', sets: [{ weight: 0, reps: 11 }, { weight: 0, reps: 11 }] },
      ],
      equipment: 'bodyweight',
    });
    expect(p.suggestion).toMatchObject({ kind: 'add-rep', weight: 0, reps: 13 });
  });

  it('adds a rep even to a barbell lift logged unloaded', () => {
    const p = buildProgression({
      sessions: [
        { date: '2026-09-08T10:00:00.000Z', sets: [{ weight: 0, reps: 8 }] },
        { date: '2026-09-01T10:00:00.000Z', sets: [{ weight: 0, reps: 8 }] },
      ],
      equipment: 'barbell',
    });
    expect(p.suggestion?.kind).toBe('add-rep');
  });

  it('holds the weight when one set fell short', () => {
    const p = buildProgression({
      sessions: [
        session('2026-09-08T10:00:00.000Z', 100, [5, 5, 3]),
        session('2026-09-01T10:00:00.000Z', 97.5, [5, 5, 5]),
      ],
      equipment: 'barbell',
      targetReps: 5,
    });
    expect(p.suggestion).toMatchObject({ kind: 'hold', weight: 100, reps: 5 });
    expect(p.suggestion?.why).toContain('fell short');
  });

  it('measures a missed session against the plan target, not the best set', () => {
    // Every set matched the best set (6), but the plan asked for 8.
    const p = buildProgression({
      sessions: [
        session('2026-09-08T10:00:00.000Z', 60, [6, 6, 6]),
        session('2026-09-01T10:00:00.000Z', 60, [8, 8, 8]),
      ],
      equipment: 'barbell',
      targetReps: 8,
    });
    expect(p.suggestion).toMatchObject({ kind: 'hold', weight: 60, reps: 8 });
  });

  it('reads a rep fall-off as a miss when there is no plan target', () => {
    const p = buildProgression({
      sessions: [
        { date: '2026-09-08T10:00:00.000Z', sets: [{ weight: 90, reps: 6 }, { weight: 90, reps: 4 }] },
        { date: '2026-09-01T10:00:00.000Z', sets: [{ weight: 90, reps: 6 }, { weight: 90, reps: 6 }] },
      ],
      equipment: 'barbell',
    });
    expect(p.suggestion).toMatchObject({ kind: 'hold', weight: 90, reps: 6 });
  });

  it('builds on the deload week instead of jumping back to the old top set', () => {
    // Three heavy weeks, then a deliberate back-off week at 70 %.
    const p = buildProgression({
      sessions: [
        session('2026-09-08T10:00:00.000Z', 70, [5, 5, 5]), // deload, all reps hit
        session('2026-09-01T10:00:00.000Z', 100, [5, 5, 5]),
        session('2026-08-25T10:00:00.000Z', 97.5, [5, 5, 5]),
      ],
      equipment: 'barbell',
      targetReps: 5,
    });
    expect(p.suggestion).toMatchObject({ kind: 'add-weight', weight: 72.5 });
    expect(p.suggestion!.weight).toBeLessThan(100);
  });

  it('never suggests going backwards after a hard week', () => {
    const p = buildProgression({
      sessions: [
        session('2026-09-08T10:00:00.000Z', 100, [5, 2, 1]),
        session('2026-09-01T10:00:00.000Z', 100, [5, 5, 5]),
      ],
      equipment: 'barbell',
      targetReps: 5,
    });
    expect(p.suggestion!.weight).toBe(100);
  });

  it('reports the top set of the last session, not its first', () => {
    const p = buildProgression({
      sessions: [
        { date: '2026-09-08T10:00:00.000Z', sets: [{ weight: 60, reps: 10 }, { weight: 90, reps: 10 }] },
        { date: '2026-09-01T10:00:00.000Z', sets: [{ weight: 60, reps: 10 }, { weight: 85, reps: 10 }] },
      ],
      equipment: 'barbell',
    });
    expect(p.last).toEqual({ weight: 90, reps: 10 });
    expect(p.suggestion).toMatchObject({ weight: 92.5 });
  });
});

describe('formatting', () => {
  it('never prints a trailing zero', () => {
    expect(formatKg(80)).toBe('80');
    expect(formatKg(82.5)).toBe('82.5');
    expect(formatKg(2.5000001)).toBe('2.5');
  });

  it('names an unloaded set for what it is', () => {
    expect(formatSet({ weight: 80, reps: 5 })).toBe('80 kg × 5');
    expect(formatSet({ weight: 0, reps: 12 })).toBe('Bodyweight × 12');
  });
});

describe('lastTopSetByExercise', () => {
  const w = (date: string, exerciseId: string, name: string, sets: Array<[number, number]>) => ({
    id: date, date, name: 'W', type: 'custom', completed: true, startedAt: date,
    exercises: [{
      id: 'e', exerciseId, exerciseName: name,
      sets: sets.map(([weight, reps], i) => ({ id: `${date}-${i}`, weight, reps, completed: true })),
    }],
  }) as unknown as Workout;

  it('keeps the newest session and indexes by id and name', () => {
    const map = lastTopSetByExercise([
      w('2026-09-01T10:00:00Z', 'bench', 'Bench Press', [[60, 8], [70, 5]]),
      w('2026-09-08T10:00:00Z', 'bench', 'Bench Press', [[80, 5], [75, 6]]),
    ]);
    expect(map.get('bench')).toEqual({ weight: 80, reps: 5 });
    expect(map.get('bench press')).toEqual({ weight: 80, reps: 5 });
  });

  it('skips rest days and unlogged sets', () => {
    const rest = { id: 'r', date: '2026-09-09T10:00:00Z', name: 'Rest Day', type: 'rest', completed: true, exercises: [] } as unknown as Workout;
    const map = lastTopSetByExercise([w('2026-09-01T10:00:00Z', 'squat', 'Back Squat', [[100, 5]]), rest]);
    expect(map.get('squat')).toEqual({ weight: 100, reps: 5 });
    expect(map.size).toBe(2);
  });
});
