import { describe, it, expect } from 'vitest';
import { buildAnalysis, epley1RM, weeklyTrend, TREND_BAND_PCT } from '../src/analysis/engine';
import type { AnalysisWindow } from '../src/analysis/engine';
import type { Exercise, MuscleGroup, Workout } from '../src/types';

/**
 * The engine is a pure function of (workouts, library, window, commitment,
 * now), so every test here fixes `now` and builds history backwards from it
 * in LOCAL time — the same clock the engine buckets weeks on.
 */

// A Wednesday, so a week (Sun–Sat) has days on both sides of it.
const NOW = new Date(2026, 8, 16, 18, 0, 0); // 16 Sep 2026, local
const DAY = 86_400_000;

function daysAgo(n: number, hour = 18): Date {
  const d = new Date(NOW.getTime() - n * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function exercise(id: string, name: string, muscleGroup: MuscleGroup): Exercise {
  return { id, name, muscleGroup, isCompound: true };
}

const LIBRARY: Exercise[] = [
  exercise('bench', 'Bench Press', 'chest'),
  exercise('row', 'Barbell Row', 'back'),
  exercise('squat', 'Squat', 'legs'),
  exercise('curl', 'Biceps Curl', 'biceps'),
  exercise('press', 'Overhead Press', 'shoulders'),
];

interface SetSpec { weight: number; reps: number; completed?: boolean }

function workout(
  ago: number,
  entries: Array<{ id: string; name?: string; sets: SetSpec[] }>,
  over: Partial<Workout> = {},
): Workout {
  const date = daysAgo(ago);
  return {
    id: `w${ago}`,
    date: date.toISOString(),
    name: 'Session',
    type: 'custom',
    completed: true,
    exercises: entries.map((e, i) => ({
      id: `we${ago}_${i}`,
      exerciseId: e.id,
      exerciseName: e.name ?? LIBRARY.find((x) => x.id === e.id)?.name ?? e.id,
      sets: e.sets.map((s, j) => ({
        id: `s${j}`, weight: s.weight, reps: s.reps, completed: s.completed ?? true,
      })),
    })),
    ...over,
  };
}

function run(workouts: Workout[], window: AnalysisWindow = '12w', commitment = 3) {
  return buildAnalysis({ workouts, exercises: LIBRARY, window, commitment, now: NOW });
}

/** Straight sets of bench on a given day. */
function bench(ago: number, weight: number, reps = 5): Workout {
  return workout(ago, [{ id: 'bench', sets: [{ weight, reps }, { weight, reps }] }]);
}

describe('epley1RM', () => {
  it('is the weight itself at one rep', () => {
    expect(epley1RM(100, 1)).toBeCloseTo(103.33, 2);
    expect(epley1RM(100, 0)).toBe(0);
  });

  it('follows weight x (1 + reps/30)', () => {
    expect(epley1RM(100, 5)).toBeCloseTo(116.667, 3);
    expect(epley1RM(80, 10)).toBeCloseTo(106.667, 3);
  });

  it('is zero for bodyweight work — there is no load to extrapolate', () => {
    expect(epley1RM(0, 12)).toBe(0);
  });
});

describe('weeklyTrend', () => {
  it('says nothing with fewer than four weeks', () => {
    expect(weeklyTrend([100, 200, 300])).toMatchObject({ direction: 'flat', changePct: null });
  });

  it('compares the older half with the newer half', () => {
    // first half mean 100, second half mean 200 → +100%
    const trend = weeklyTrend([100, 100, 200, 200]);
    expect(trend.direction).toBe('rising');
    expect(trend.changePct).toBe(100);
    expect(trend.firstHalf).toBe(100);
    expect(trend.secondHalf).toBe(200);
  });

  it('calls a fall a fall', () => {
    const trend = weeklyTrend([200, 200, 100, 100]);
    expect(trend.direction).toBe('falling');
    expect(trend.changePct).toBe(-50);
  });

  it('treats a change inside the noise band as flat', () => {
    const trend = weeklyTrend([1000, 1000, 1050, 1050]);
    expect(trend.changePct).toBe(5);
    expect(5).toBeLessThan(TREND_BAND_PCT);
    expect(trend.direction).toBe('flat');
  });

  it('drops the middle week so the halves are the same length', () => {
    // 5 weeks: halves are [100,100] and [300,300]; the 999 in the middle is ignored.
    const trend = weeklyTrend([100, 100, 999, 300, 300]);
    expect(trend.firstHalf).toBe(100);
    expect(trend.secondHalf).toBe(300);
  });
});

describe('buildAnalysis — window and gating', () => {
  it('needs three sessions before it says anything', () => {
    const report = run([bench(2, 80), bench(5, 80)]);
    expect(report.hasEnoughData).toBe(false);
    expect(report.actionables).toEqual([]);
  });

  it('keeps a 4-week window to the last four weeks', () => {
    const workouts = [bench(2, 80), bench(5, 80), bench(9, 80), bench(60, 60)];
    const four = run(workouts, '4w');
    const all = run(workouts, 'all');
    expect(four.sessions).toBe(3);
    expect(all.sessions).toBe(4);
    expect(four.load.weeks).toHaveLength(4);
  });

  it('leaves rest days and unfinished workouts out', () => {
    const report = run([
      bench(2, 80), bench(5, 80), bench(9, 80),
      workout(3, [{ id: 'bench', sets: [{ weight: 80, reps: 5 }] }], { type: 'rest' }),
      workout(4, [{ id: 'bench', sets: [{ weight: 80, reps: 5 }] }], { completed: false }),
    ]);
    expect(report.sessions).toBe(3);
  });

  it('only counts completed sets towards volume', () => {
    const report = run([
      workout(2, [{ id: 'bench', sets: [{ weight: 100, reps: 10 }, { weight: 100, reps: 10, completed: false }] }]),
      bench(5, 50, 10),
      bench(9, 50, 10),
    ]);
    // 1000 (completed set only) + 2 × 500 + 2 × 500
    expect(report.load.totalVolume).toBe(3000);
  });
});

describe('buildAnalysis — deload exclusion', () => {
  const normal = [bench(2, 100, 5), bench(5, 100, 5), bench(9, 100, 5)];
  const light = workout(3, [{ id: 'bench', sets: [{ weight: 60, reps: 5 }] }], { deload: true });

  it('drops workouts flagged as a deload week', () => {
    const withDeload = run([...normal, light]);
    expect(withDeload.sessions).toBe(3);
    expect(withDeload.load.totalVolume).toBe(3000);
  });

  it('keeps the same answer whether or not the deload week is in the list', () => {
    expect(run([...normal, light]).load.totalVolume).toBe(run(normal).load.totalVolume);
  });

  it('never lets a deload session set the strength trend', () => {
    const report = run([...normal, light]);
    const benchTrend = report.strength.exercises.find((e) => e.name === 'Bench Press');
    expect(benchTrend?.sessions).toBe(3);
    expect(benchTrend?.points.every((p) => p.weight === 100)).toBe(true);
  });
});

describe('buildAnalysis — strength', () => {
  it('tracks estimated one-rep max per session, oldest first', () => {
    const report = run([bench(21, 80), bench(14, 85), bench(7, 90)]);
    const ex = report.strength.exercises[0];
    expect(ex.name).toBe('Bench Press');
    expect(ex.points.map((p) => p.weight)).toEqual([80, 85, 90]);
    expect(ex.first).toBeCloseTo(93.3, 1);
    expect(ex.latest).toBeCloseTo(105, 1);
    expect(ex.status).toBe('improving');
    expect(ex.changePct).toBeGreaterThan(0);
  });

  it('calls a lift declining when the estimated max drops', () => {
    const report = run([bench(21, 100), bench(14, 95), bench(7, 90)]);
    expect(report.strength.exercises[0].status).toBe('declining');
  });

  it('flags a plateau after three sessions with no new best', () => {
    const report = run([bench(28, 100), bench(21, 100), bench(14, 100), bench(7, 100)]);
    const ex = report.strength.exercises[0];
    expect(ex.sessionsSinceBest).toBe(3);
    expect(ex.plateau).toBe(true);
    expect(ex.status).toBe('flat');
  });

  it('does not call three sessions a plateau — that is not enough history', () => {
    const report = run([bench(21, 100), bench(14, 100), bench(7, 100)]);
    expect(report.strength.exercises[0].plateau).toBe(false);
  });

  it('counts a personal best only when it beats every earlier session', () => {
    const report = run([bench(21, 80), bench(14, 90), bench(7, 85)]);
    expect(report.strength.prs.map((p) => p.weight)).toEqual([90, 80]);
  });

  it('does not count a best that was already set before the window', () => {
    const workouts = [bench(120, 120), bench(21, 100), bench(14, 105), bench(7, 110)];
    expect(run(workouts, '12w').strength.prs).toEqual([]);
    expect(run(workouts, 'all').strength.prs.map((p) => p.weight)).toEqual([120]);
  });

  it('shows the six most-trained exercises, busiest first', () => {
    const workouts = [
      bench(2, 80), bench(5, 80), bench(9, 80),
      workout(3, [{ id: 'squat', sets: [{ weight: 100, reps: 5 }] }]),
      workout(6, [{ id: 'squat', sets: [{ weight: 100, reps: 5 }] }]),
      workout(4, [{ id: 'curl', sets: [{ weight: 20, reps: 10 }] }]),
    ];
    const report = run(workouts);
    expect(report.strength.exercises.map((e) => e.name)).toEqual(['Bench Press', 'Squat']);
    // A single performance is a data point, not a line.
    expect(report.strength.exercises.some((e) => e.name === 'Biceps Curl')).toBe(false);
  });

  it('matches an exercise logged under a buddy\'s id by its name', () => {
    const report = run([
      bench(21, 80),
      workout(14, [{ id: 'host_xyz', name: 'Bench Press', sets: [{ weight: 85, reps: 5 }] }]),
      bench(7, 90),
    ]);
    expect(report.strength.exercises).toHaveLength(1);
    expect(report.strength.exercises[0].sessions).toBe(3);
  });
});

describe('buildAnalysis — muscle balance', () => {
  /** Enough chest work to clear the 1,000 kg floor, and a token amount of back. */
  const pushHeavy = [
    workout(2, [{ id: 'bench', sets: [{ weight: 100, reps: 10 }, { weight: 100, reps: 10 }] }]),
    workout(5, [{ id: 'bench', sets: [{ weight: 100, reps: 10 }, { weight: 100, reps: 10 }] }]),
    workout(9, [
      { id: 'bench', sets: [{ weight: 100, reps: 10 }] },
      { id: 'row', sets: [{ weight: 50, reps: 10 }] },
    ]),
  ];

  it('shares volume out by muscle group, biggest first', () => {
    const report = run(pushHeavy);
    expect(report.balance.groups[0].group).toBe('chest');
    expect(report.balance.groups.map((g) => g.group)).toEqual(['chest', 'back']);
    expect(report.balance.groups[0].share + report.balance.groups[1].share).toBeCloseTo(100, 0);
  });

  it('flags push running away from pull', () => {
    const report = run(pushHeavy);
    const flag = report.balance.flags.find((f) => f.kind === 'push-pull');
    expect(flag?.tag).toBe('pull');
    expect(flag?.detail).toContain('%');
  });

  it('flags the main groups that barely appear', () => {
    const neglected = run(pushHeavy).balance.flags.filter((f) => f.kind === 'neglected').map((f) => f.tag);
    expect(neglected).toContain('legs');
    expect(neglected).toContain('shoulders');
    expect(neglected).not.toContain('chest');
  });

  it('does not compare two sides that are both too small to judge', () => {
    const report = run([bench(2, 20, 5), bench(5, 20, 5), bench(9, 20, 5)]);
    expect(report.balance.flags.some((f) => f.kind === 'push-pull')).toBe(false);
  });

  it('keeps volume it cannot group out of the shares', () => {
    const report = run([
      workout(2, [{ id: 'mystery', name: 'Sled Push', sets: [{ weight: 100, reps: 10 }] }]),
      bench(5, 100, 10),
      bench(9, 100, 10),
    ]);
    expect(report.balance.unmatchedVolume).toBe(1000);
    expect(report.balance.groups.every((g) => g.group !== 'other')).toBe(true);
  });
});

describe('buildAnalysis — consistency', () => {
  it('measures adherence against the commitment, over finished weeks only', () => {
    // NOW is a Wednesday, so the Sun/Mon/Tue of each of the three finished
    // weeks before this one are 24/23/22, 17/16/15 and 10/9/8 days ago.
    const workouts: Workout[] = [24, 23, 22, 17, 16, 15, 10, 9, 8].map((ago) => bench(ago, 80));
    const report = run(workouts, '4w', 3);
    expect(report.consistency.weeksCounted).toBe(3);
    expect(report.consistency.trainingDays).toBe(9);
    expect(report.consistency.adherencePct).toBe(100);
    expect(report.consistency.weeksMet).toBe(3);
  });

  it('counts the longest run of empty days, including the days since the last session', () => {
    const report = run([bench(30, 80), bench(29, 80), bench(28, 80)]);
    // 27 days between the last session and today → 27 days with nothing in them.
    expect(report.consistency.daysSinceLast).toBe(28);
    expect(report.consistency.longestGapDays).toBe(27);
  });

  it('names the days of the week that get trained', () => {
    const report = run([bench(21, 80), bench(14, 80), bench(7, 80)]);
    expect(report.consistency.topDays[0].label).toBe('Wednesday');
    expect(report.consistency.topDays[0].count).toBe(3);
  });

  it('picks out the usual training hour', () => {
    const report = run([
      workout(2, [{ id: 'bench', sets: [{ weight: 80, reps: 5 }] }], { startedAt: daysAgo(2, 7).toISOString() }),
      workout(5, [{ id: 'bench', sets: [{ weight: 80, reps: 5 }] }], { startedAt: daysAgo(5, 7).toISOString() }),
      workout(9, [{ id: 'bench', sets: [{ weight: 80, reps: 5 }] }], { startedAt: daysAgo(9, 19).toISOString() }),
    ]);
    expect(report.consistency.topHour).toBe(7);
  });
});

describe('buildAnalysis — recovery', () => {
  it('spots a session that came in well under the usual load', () => {
    const workouts = [
      bench(24, 100, 10), bench(17, 100, 10), bench(10, 100, 10),
      workout(3, [
        { id: 'bench', sets: [{ weight: 40, reps: 5 }] },
        { id: 'squat', sets: [{ weight: 40, reps: 5 }] },
      ]),
      workout(6, [
        { id: 'bench', sets: [{ weight: 100, reps: 10 }] },
        { id: 'squat', sets: [{ weight: 100, reps: 10 }] },
      ]),
      workout(13, [
        { id: 'bench', sets: [{ weight: 100, reps: 10 }] },
        { id: 'squat', sets: [{ weight: 100, reps: 10 }] },
      ]),
    ];
    const light = run(workouts).recovery.lightSessions;
    expect(light).toHaveLength(1);
    expect(light[0].ratio).toBeLessThanOrEqual(0.7);
  });

  it('does not judge a session on a single exercise', () => {
    const report = run([bench(2, 20, 5), bench(5, 100, 10), bench(9, 100, 10), bench(13, 100, 10)]);
    expect(report.recovery.lightSessions).toEqual([]);
  });
});

describe('buildAnalysis — actionables', () => {
  it('puts showing up above everything else', () => {
    // One session a week against a 4-day commitment, ten days since the last
    // one, and push-heavy with it.
    const workouts = [10, 17, 24].map((ago) =>
      workout(ago, [{ id: 'bench', sets: [{ weight: 100, reps: 10 }, { weight: 100, reps: 10 }] }]));
    const report = run(workouts, '4w', 4);
    expect(report.actionables[0].kind).toBe('consistency');
    expect(report.actionables.map((a) => a.kind)).toContain('gap');
    // Ranked strictly by priority.
    const priorities = report.actionables.map((a) => a.priority);
    expect([...priorities].sort((a, b) => b - a)).toEqual(priorities);
  });

  it('never offers more than six', () => {
    const workouts = [
      workout(7, [{ id: 'bench', sets: [{ weight: 100, reps: 10 }, { weight: 100, reps: 10 }] }]),
      workout(14, [{ id: 'bench', sets: [{ weight: 100, reps: 10 }, { weight: 100, reps: 10 }] }]),
      workout(21, [{ id: 'bench', sets: [{ weight: 100, reps: 10 }, { weight: 100, reps: 10 }] }]),
      workout(28, [{ id: 'bench', sets: [{ weight: 100, reps: 10 }, { weight: 100, reps: 10 }] }]),
    ];
    expect(run(workouts, 'all', 5).actionables.length).toBeLessThanOrEqual(6);
  });

  it('turns a plateau into one concrete action with a question for Zen', () => {
    const workouts = [bench(28, 100), bench(21, 100), bench(14, 100), bench(7, 100)];
    const plateau = run(workouts, 'all', 1).actionables.find((a) => a.kind === 'plateau');
    expect(plateau?.title).toContain('Bench Press');
    expect(plateau?.ask).toContain('Bench Press');
    expect(plateau?.method).toBeTruthy();
    expect(plateau?.good).toBeTruthy();
  });

  it('says nothing at all when there is nothing to fix', () => {
    // Commitment of one, trained every other day, balanced, no plateau.
    const workouts = [
      workout(1, [{ id: 'bench', sets: [{ weight: 100, reps: 10 }] }, { id: 'row', sets: [{ weight: 100, reps: 10 }] }]),
      workout(3, [{ id: 'bench', sets: [{ weight: 95, reps: 10 }] }, { id: 'row', sets: [{ weight: 95, reps: 10 }] }]),
      workout(5, [{ id: 'bench', sets: [{ weight: 90, reps: 10 }] }, { id: 'row', sets: [{ weight: 90, reps: 10 }] }]),
    ];
    const report = run(workouts, '4w', 1);
    expect(report.actionables.filter((a) => a.kind === 'consistency')).toEqual([]);
    expect(report.actionables.filter((a) => a.kind === 'gap')).toEqual([]);
  });

  it('does not repeat itself when volume falls because sessions were missed', () => {
    const workouts = [
      workout(7, [{ id: 'bench', sets: [{ weight: 100, reps: 10 }, { weight: 100, reps: 10 }] }]),
      workout(14, [{ id: 'bench', sets: [{ weight: 100, reps: 10 }, { weight: 100, reps: 10 }] }]),
      workout(21, [{ id: 'bench', sets: [{ weight: 100, reps: 10 }, { weight: 100, reps: 10 }] }]),
    ];
    const kinds = run(workouts, '4w', 4).actionables.map((a) => a.kind);
    expect(kinds.filter((k) => k === 'consistency')).toHaveLength(1);
    expect(kinds).not.toContain('trend');
  });
});
