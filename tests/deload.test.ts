import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeDeloadSuggestion, deloadTargetFor, deloadWeekEndsAt, deloadZenPrompt,
  endDeloadWeek, excludeDeloadWorkouts, formatVolumeKg, isDeloadWeekActive, startDeloadWeek,
} from '../src/deloadDetector';
import { collectExerciseSessions, lastTopSetByExercise } from '../src/progression';
import type { Workout } from '../src/types';

/** A completed workout holding one exercise of straight-ish sets. */
function workout(
  date: string,
  exerciseId: string,
  sets: Array<[number, number]>,
  over: Partial<Workout> = {},
  exerciseName = 'Bench Press',
): Workout {
  return {
    id: `w_${date}_${exerciseId}`,
    date,
    name: 'Push',
    type: 'push',
    completed: true,
    exercises: [{
      id: `we_${date}_${exerciseId}`,
      exerciseId,
      exerciseName,
      sets: sets.map(([weight, reps], i) => ({ id: `s${i}`, weight, reps, completed: true })),
    }],
    ...over,
  };
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString();
}

/** localStorage stand-in — vitest runs in node, which has none. */
function installMemoryStorage(): void {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => { map.set(k, String(v)); },
      removeItem: (k: string) => { map.delete(k); },
      clear: () => { map.clear(); },
    },
  });
}

describe('deloadTargetFor', () => {
  it('takes 60 % of the best set and keeps its reps', () => {
    const history = [workout(daysAgo(3), 'bench', [[75, 6], [70, 6]])];
    expect(deloadTargetFor('bench', 'Bench Press', history)).toEqual({ weight: 45, reps: 6 });
  });

  it('rounds to the nearest 2.5 kg', () => {
    // 77.5 × 0.6 = 46.5 → 47.5, the nearest pair of plates.
    const history = [workout(daysAgo(3), 'bench', [[77.5, 5]])];
    expect(deloadTargetFor('bench', 'Bench Press', history)).toEqual({ weight: 47.5, reps: 5 });
  });

  it('never drops below one 2.5 kg step', () => {
    const history = [workout(daysAgo(3), 'curl', [[2, 12]])];
    expect(deloadTargetFor('curl', 'Curl', history)).toEqual({ weight: 2.5, reps: 12 });
  });

  it('leaves bodyweight work at bodyweight', () => {
    const history = [workout(daysAgo(3), 'pullup', [[0, 10]])];
    expect(deloadTargetFor('pullup', 'Pull Up', history)).toEqual({ weight: 0, reps: 10 });
  });

  it('picks the best set by weight × reps, not by weight alone', () => {
    // 60 × 12 = 720 beats 80 × 3 = 240.
    const history = [workout(daysAgo(3), 'row', [[80, 3], [60, 12]])];
    expect(deloadTargetFor('row', 'Row', history)).toEqual({ weight: 35, reps: 12 });
  });

  it('only looks at the last three sessions', () => {
    const history = [
      workout(daysAgo(28), 'bench', [[100, 5]]), // 4th newest — ignored
      workout(daysAgo(21), 'bench', [[70, 5]]),
      workout(daysAgo(14), 'bench', [[70, 5]]),
      workout(daysAgo(7), 'bench', [[70, 5]]),
    ];
    expect(deloadTargetFor('bench', 'Bench Press', history)).toEqual({ weight: 42.5, reps: 5 });
  });

  it('ignores deload sessions, so a second easy week scales off normal training', () => {
    const history = [
      workout(daysAgo(10), 'bench', [[75, 6]]),
      workout(daysAgo(3), 'bench', [[45, 6]], { deload: true }),
    ];
    expect(deloadTargetFor('bench', 'Bench Press', history)).toEqual({ weight: 45, reps: 6 });
  });

  it('matches on name when the id came from a buddy session', () => {
    const history = [workout(daysAgo(3), 'hosts-own-id', [[75, 6]])];
    expect(deloadTargetFor('my-id', 'Bench Press', history)).toEqual({ weight: 45, reps: 6 });
  });

  it('is null when the exercise has never been logged', () => {
    expect(deloadTargetFor('squat', 'Squat', [])).toBeNull();
    expect(deloadTargetFor('squat', 'Squat', [workout(daysAgo(3), 'bench', [[75, 6]])])).toBeNull();
  });

  it('ignores in-progress and rest workouts', () => {
    const history = [
      workout(daysAgo(3), 'bench', [[200, 5]], { completed: false }),
      workout(daysAgo(4), 'bench', [[200, 5]], { type: 'rest' }),
      workout(daysAgo(5), 'bench', [[75, 6]]),
    ];
    expect(deloadTargetFor('bench', 'Bench Press', history)).toEqual({ weight: 45, reps: 6 });
  });
});

describe('excludeDeloadWorkouts', () => {
  it('drops only the flagged ones', () => {
    const a = workout(daysAgo(3), 'bench', [[75, 6]]);
    const b = workout(daysAgo(4), 'bench', [[45, 6]], { deload: true });
    expect(excludeDeloadWorkouts([a, b])).toEqual([a]);
  });

  it('treats deload: false the same as absent', () => {
    const a = workout(daysAgo(3), 'bench', [[75, 6]], { deload: false });
    expect(excludeDeloadWorkouts([a])).toEqual([a]);
  });
});

describe('deload weeks and the analytics that read history', () => {
  const rising: Workout[] = [
    workout(daysAgo(24), 'bench', [[50, 20]]),  // 1 000 kg, oldest week in the window
    workout(daysAgo(17), 'bench', [[50, 40]]),  // 2 000 kg
    workout(daysAgo(10), 'bench', [[50, 60]]),  // 3 000 kg
    workout(daysAgo(3), 'bench', [[50, 80]]),   // 4 000 kg, this week
  ];

  it('recommends a deload after three rising weeks', () => {
    const out = computeDeloadSuggestion(rising);
    expect(out.weeklyVolumes).toEqual([1000, 2000, 3000, 4000]);
    expect(out.risingStreak).toBe(3);
    expect(out.recommend).toBe(true);
    expect(out.targetVolume).toBe(2400);
  });

  it('does not suggest another deload during a deload week', () => {
    const inDeload = rising.map((w, i) => (i === 3 ? { ...w, deload: true } : w));
    const out = computeDeloadSuggestion(inDeload);
    expect(out.weeklyVolumes).toEqual([1000, 2000, 3000, 0]);
    expect(out.risingStreak).toBe(0);
    expect(out.recommend).toBe(false);
  });

  it('keeps deload sessions out of "last time" comparisons', () => {
    const history = [
      workout(daysAgo(10), 'bench', [[75, 6]]),
      workout(daysAgo(3), 'bench', [[45, 6]], { deload: true }),
    ];
    const sessions = collectExerciseSessions(history, 'bench', 'Bench Press');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sets[0].weight).toBe(75);
  });

  it('keeps deload sessions out of the last-top-set index', () => {
    const history = [
      workout(daysAgo(10), 'bench', [[75, 6]]),
      workout(daysAgo(3), 'bench', [[45, 6]], { deload: true }),
    ];
    expect(lastTopSetByExercise(history).get('bench')).toEqual({ weight: 75, reps: 6 });
  });
});

describe('the deload week flag', () => {
  beforeEach(() => { installMemoryStorage(); });

  it('is off until it is started', () => {
    expect(isDeloadWeekActive()).toBe(false);
    expect(deloadWeekEndsAt()).toBeNull();
  });

  it('runs for seven days from the moment it starts', () => {
    const start = new Date('2026-09-13T08:00:00.000Z');
    startDeloadWeek(start);

    expect(isDeloadWeekActive(start)).toBe(true);
    expect(deloadWeekEndsAt(start)?.toISOString()).toBe('2026-09-20T08:00:00.000Z');
    // Still running on day six, done on day eight.
    expect(isDeloadWeekActive(new Date('2026-09-19T08:00:00.000Z'))).toBe(true);
    expect(isDeloadWeekActive(new Date('2026-09-21T08:00:00.000Z'))).toBe(false);
  });

  it('expires on its own without anyone clearing it', () => {
    startDeloadWeek(new Date('2026-09-01T08:00:00.000Z'));
    expect(isDeloadWeekActive(new Date('2026-09-30T08:00:00.000Z'))).toBe(false);
    expect(deloadWeekEndsAt(new Date('2026-09-30T08:00:00.000Z'))).toBeNull();
  });

  it('can be ended early', () => {
    const start = new Date('2026-09-13T08:00:00.000Z');
    startDeloadWeek(start);
    endDeloadWeek();
    expect(isDeloadWeekActive(start)).toBe(false);
  });

  it('survives nothing gracefully when storage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: undefined });
    expect(() => startDeloadWeek()).not.toThrow();
    expect(isDeloadWeekActive()).toBe(false);
    expect(() => endDeloadWeek()).not.toThrow();
  });
});

describe('deload copy helpers', () => {
  it('formats volume in kg a lifter can picture', () => {
    expect(formatVolumeKg(12_400)).toBe('12,400 kg');
  });

  it('pre-fills the Zen question with the user\'s own streak', () => {
    expect(deloadZenPrompt(3)).toBe(
      'My training volume has risen 3 weeks in a row and the app suggests a deload week. '
      + 'Explain what that means for me and how to run it.',
    );
  });
});
