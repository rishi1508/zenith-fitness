import type { PersonalRecord, Workout } from './types';
import { levelForVolume } from './levels';

/**
 * Badges — the handful of things worth being told you have done.
 *
 * Rules of thumb, taken from what works in Strava, Hevy and Duolingo and
 * from what the audit's research said about day-one achievements:
 *
 *   - every badge is earned from data the app already has, so nothing has to
 *     be claimed, confirmed or self-reported;
 *   - the first tier of each family is reachable in the first week, because
 *     an achievement on day one roughly doubles thirty-day retention;
 *   - nothing punishes. There is no badge for *not* missing a session, and
 *     none of them can be lost once earned;
 *   - the count stays small. Forty badges is a checklist; fifteen is a
 *     collection.
 *
 * Pure: everything comes in as arguments, and `tests/badges.test.ts` owns the
 * thresholds.
 */

export type BadgeFamily = 'volume' | 'sessions' | 'streak' | 'strength' | 'habit' | 'level';

export interface BadgeDef {
  id: string;
  family: BadgeFamily;
  name: string;
  /** What it took, in the user's own terms. */
  detail: string;
  /** Which glyph the artwork draws. Resolved to a real icon in the UI layer
   *  (src/components/BadgeArt.tsx) so this module stays free of React. */
  iconKey: BadgeIcon;
  /** 1–4 within its family. Drives the pips around the badge. */
  tier: 1 | 2 | 3 | 4;
}

export type BadgeIcon =
  | 'weight' | 'mountain' | 'calendar' | 'flame' | 'trophy' | 'star'
  | 'salad' | 'building' | 'sunrise' | 'medal' | 'zap' | 'crown';

export interface EarnedBadge {
  id: string;
  /** ISO date the app first saw it earned. */
  at: string;
}

export interface BadgeInput {
  workouts: readonly Workout[];
  records: readonly PersonalRecord[];
  totalVolumeKg: number;
  /** Current streak in weeks, and the days/week it is measured at. */
  streakWeeks: number;
  /** Days of food logged, ever. */
  loggedNutritionDays?: number;
  /** Gym check-ins in the last 30 days. */
  checkins30d?: number;
}

export const BADGES: BadgeDef[] = [
  // Volume — the number that only ever goes up.
  { id: 'volume-1t', family: 'volume', name: 'First tonne', detail: '1 tonne lifted', iconKey: 'weight', tier: 1 },
  { id: 'volume-25t', family: 'volume', name: 'Quarter century', detail: '25 tonnes lifted', iconKey: 'weight', tier: 2 },
  { id: 'volume-100t', family: 'volume', name: 'Century', detail: '100 tonnes lifted', iconKey: 'mountain', tier: 3 },
  { id: 'volume-500t', family: 'volume', name: 'Half a kiloton', detail: '500 tonnes lifted', iconKey: 'mountain', tier: 4 },

  // Sessions — showing up.
  { id: 'sessions-1', family: 'sessions', name: 'Day one', detail: 'First session logged', iconKey: 'calendar', tier: 1 },
  { id: 'sessions-25', family: 'sessions', name: 'Regular', detail: '25 sessions', iconKey: 'calendar', tier: 2 },
  { id: 'sessions-100', family: 'sessions', name: 'Hundred club', detail: '100 sessions', iconKey: 'calendar', tier: 3 },
  { id: 'sessions-365', family: 'sessions', name: 'Lifer', detail: '365 sessions', iconKey: 'crown', tier: 4 },

  // Streak — weeks that met the commitment.
  { id: 'streak-4', family: 'streak', name: 'A month of weeks', detail: '4-week streak', iconKey: 'flame', tier: 1 },
  { id: 'streak-12', family: 'streak', name: 'A season', detail: '12-week streak', iconKey: 'flame', tier: 2 },
  { id: 'streak-52', family: 'streak', name: 'A year unbroken', detail: '52-week streak', iconKey: 'crown', tier: 4 },

  // Strength — the lifts themselves.
  { id: 'pr-first', family: 'strength', name: 'First record', detail: 'Set a personal record', iconKey: 'star', tier: 1 },
  { id: 'pr-25', family: 'strength', name: 'Record collector', detail: '25 personal records', iconKey: 'trophy', tier: 3 },
  { id: 'session-5t', family: 'strength', name: 'Big day', detail: '5 tonnes in one session', iconKey: 'zap', tier: 2 },

  // Habits — the things around the training.
  { id: 'nutrition-30', family: 'habit', name: 'Kitchen discipline', detail: '30 days of food logged', iconKey: 'salad', tier: 2 },
  { id: 'checkins-16', family: 'habit', name: 'Gym regular', detail: '16 check-ins in a month', iconKey: 'building', tier: 2 },
  { id: 'early-10', family: 'habit', name: 'Before the world', detail: '10 sessions started before 6am', iconKey: 'sunrise', tier: 2 },

  // Level — the composite one.
  { id: 'level-10', family: 'level', name: 'Level 10', detail: 'Reached experience level 10', iconKey: 'medal', tier: 2 },
  { id: 'level-25', family: 'level', name: 'Level 25', detail: 'Reached experience level 25', iconKey: 'medal', tier: 4 },
];

const BY_ID = new Map(BADGES.map((b) => [b.id, b]));

export function badgeById(id: string): BadgeDef | undefined {
  return BY_ID.get(id);
}

/** Volume of one session, kg, completed sets only. */
export function sessionVolume(workout: Workout): number {
  let total = 0;
  for (const ex of workout.exercises) {
    for (const s of ex.sets) if (s.completed) total += s.weight * s.reps;
  }
  return total;
}

/** Which badges the data says are earned right now. Order follows BADGES. */
export function earnedBadgeIds(input: BadgeInput): string[] {
  const sessions = input.workouts.filter((w) => w.completed && w.type !== 'rest');
  const tonnes = input.totalVolumeKg / 1000;
  const biggest = sessions.reduce((max, w) => Math.max(max, sessionVolume(w)), 0);
  const early = sessions.filter((w) => {
    const d = new Date(w.startedAt ?? w.date);
    return !Number.isNaN(d.getTime()) && d.getHours() < 6;
  }).length;
  const level = levelForVolume(input.totalVolumeKg).level;

  const hit: Record<string, boolean> = {
    'volume-1t': tonnes >= 1,
    'volume-25t': tonnes >= 25,
    'volume-100t': tonnes >= 100,
    'volume-500t': tonnes >= 500,
    'sessions-1': sessions.length >= 1,
    'sessions-25': sessions.length >= 25,
    'sessions-100': sessions.length >= 100,
    'sessions-365': sessions.length >= 365,
    'streak-4': input.streakWeeks >= 4,
    'streak-12': input.streakWeeks >= 12,
    'streak-52': input.streakWeeks >= 52,
    'pr-first': input.records.length >= 1,
    'pr-25': input.records.length >= 25,
    'session-5t': biggest >= 5000,
    'nutrition-30': (input.loggedNutritionDays ?? 0) >= 30,
    'checkins-16': (input.checkins30d ?? 0) >= 16,
    'early-10': early >= 10,
    'level-10': level >= 10,
    'level-25': level >= 25,
  };
  return BADGES.filter((b) => hit[b.id]).map((b) => b.id);
}

/**
 * Merges what is earned now with what was already recorded, keeping the
 * original date. A badge is never taken away — deleting an old workout
 * should not un-earn the first tonne you genuinely lifted.
 */
export function mergeBadges(
  existing: readonly EarnedBadge[],
  earnedNow: readonly string[],
  now = new Date(),
): { badges: EarnedBadge[]; added: string[] } {
  const byId = new Map(existing.map((b) => [b.id, b]));
  const added: string[] = [];
  for (const id of earnedNow) {
    if (byId.has(id)) continue;
    byId.set(id, { id, at: now.toISOString() });
    added.push(id);
  }
  const badges = BADGES.filter((b) => byId.has(b.id)).map((b) => byId.get(b.id)!);
  return { badges, added };
}
