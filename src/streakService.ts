import type { StreakState, Workout } from './types';
import * as storage from './storage';

const STREAK_KEY = 'zenith_streak';
export const MAX_FREEZES = 2;

/**
 * How many actual WORKOUT DAYS (days the user logged at least one
 * non-rest, completed workout) it takes to earn a streak freeze.
 *
 * Earlier this counted CALENDAR DAYS instead, which meant inactive
 * users still accrued freezes just by opening the app over a month —
 * defeating the purpose of the freeze as a reward for consistent
 * training. Switching to workout-days makes the freeze proportional
 * to effort.
 *
 * 15 workout days ≈ 5 weeks of training at 3 sessions / week. Tuned to
 * feel earned but not punishing.
 */
export const WORKOUTS_TO_EARN_FREEZE = 15;

/** @deprecated kept for back-compat with older imports — same value
 *  as WORKOUTS_TO_EARN_FREEZE now that the basis switched from
 *  calendar days to workout days. */
export const DAYS_TO_EARN_FREEZE = WORKOUTS_TO_EARN_FREEZE;

const today = () => new Date().toISOString().slice(0, 10);

function isoDate(d: Date): string {
  // Use local-time midnight so that rendering and comparison work the same
  // whether the user is on UTC or IST or anything else. Uses a tz-offset
  // trick to get a YYYY-MM-DD string for the user's local day.
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD of the Sunday that starts the week containing `d`. */
export function weekStartISO(d: Date): string {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - copy.getDay()); // getDay() 0 = Sun
  return isoDate(copy);
}

/** Collapses every non-rest completed workout to its week-start. */
export function activeWeekSet(workouts: Workout[]): Set<string> {
  const out = new Set<string>();
  for (const w of workouts) {
    if (!w.completed || w.type === 'rest') continue;
    out.add(weekStartISO(new Date(w.date)));
  }
  return out;
}

/** Returns the set of YYYY-MM-DD local dates the user logged a
 *  non-rest, completed workout. Used by the freeze-earn ticker. */
function workoutDateSet(workouts: Workout[]): Set<string> {
  const out = new Set<string>();
  for (const w of workouts) {
    if (!w.completed || w.type === 'rest') continue;
    try { out.add(isoDate(new Date(w.date))); } catch { /* ignore bad date */ }
  }
  return out;
}

/** Adds `n` days to a YYYY-MM-DD and returns a YYYY-MM-DD. */
function addDays(yyyymmdd: string, n: number): string {
  const d = new Date(yyyymmdd + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function normalizeFrozenWeeks(dates: string[]): string[] {
  // Legacy entries were per-day. Snap any non-Sunday entry to its
  // containing week-start so the weekly logic treats it sensibly.
  const out = new Set<string>();
  for (const d of dates) {
    try { out.add(weekStartISO(new Date(d + 'T00:00:00'))); } catch { /* ignore */ }
  }
  return Array.from(out);
}

function getRaw(): StreakState {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StreakState;
      return {
        ...parsed,
        freezeConsumedDates: normalizeFrozenWeeks(parsed.freezeConsumedDates || []),
      };
    }
  } catch { /* ignore */ }
  // Initial state — grant 1 freeze to brand-new users
  return {
    freezes: 1,
    freezeConsumedDates: [],
    lastProcessedDate: today(),
    streakDaysSinceFreezeGain: 0,
  };
}

function setRaw(next: StreakState): void {
  try { localStorage.setItem(STREAK_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}

/**
 * Compute the current + longest weekly streak.
 *
 * A week counts as "active" if it has at least one completed, non-rest
 * workout OR it's in the frozen set (rescued by a freeze). We walk from
 * the current week backwards, stopping at the first inactive week.
 *
 * The current incomplete week never counts as a miss: if the user hasn't
 * worked out yet this week (and it's still Wed), we don't penalise them
 * — we start counting from last week instead.
 */
export function computeWeekStreak(
  workouts: Workout[],
  frozenWeeks: ReadonlySet<string>,
): { current: number; longest: number } {
  const activeThisWeek = activeWeekSet(workouts);
  const allWeeks = new Set<string>([...activeThisWeek, ...frozenWeeks]);

  // current streak — walk backwards from this week
  const thisWS = weekStartISO(new Date());
  let cursor = allWeeks.has(thisWS) ? thisWS : addDays(thisWS, -7);
  let current = 0;
  let guard = 520; // ~10 years
  while (guard-- > 0 && allWeeks.has(cursor)) {
    current++;
    cursor = addDays(cursor, -7);
  }

  // longest streak — walk through every sorted active week and count runs
  const sorted = Array.from(allWeeks).sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const ws of sorted) {
    if (prev !== null && ws === addDays(prev, 7)) run++;
    else run = 1;
    longest = Math.max(longest, run);
    prev = ws;
  }
  return { current, longest };
}

/**
 * Run once on app mount. Two responsibilities:
 *
 *  1. Rescue every inactive completed week between `lastProcessedDate`
 *     and the start of this week using a stored freeze (if any).
 *
 *  2. Tick the freeze-earn counter ONCE PER WORKOUT DAY in the
 *     processing window — i.e. each YYYY-MM-DD on which the user
 *     logged at least one non-rest workout. Every
 *     WORKOUTS_TO_EARN_FREEZE workout-days awards one freeze (capped
 *     at MAX_FREEZES). Earlier this ticked on every CALENDAR day the
 *     streak was alive, which let totally inactive users farm freezes
 *     simply by maintaining a frozen streak — undermining the "earned
 *     by training" intent.
 *
 * Idempotent: calling twice on the same day is a no-op.
 */
export function settleStreak(): StreakState {
  const state = { ...getRaw() };
  const todayStr = today();
  if (state.lastProcessedDate === todayStr) return state;

  const workouts = storage.getWorkouts();
  const activeWeeks = activeWeekSet(workouts);
  const frozenWeeks = new Set<string>(state.freezeConsumedDates);
  const workoutDays = workoutDateSet(workouts);

  // 1) Rescue every inactive completed week in the processing window.
  const thisWS = weekStartISO(new Date());
  const lastProcWS = weekStartISO(new Date(state.lastProcessedDate + 'T00:00:00'));
  let weekCursor = lastProcWS;
  while (weekCursor < thisWS) {
    if (!activeWeeks.has(weekCursor) && !frozenWeeks.has(weekCursor)) {
      if (state.freezes > 0) {
        state.freezes -= 1;
        state.freezeConsumedDates.push(weekCursor);
        frozenWeeks.add(weekCursor);
      }
      // No freeze available → week is a miss. computeWeekStreak then
      // resets current streak to 0, which is the correct behaviour.
    }
    weekCursor = addDays(weekCursor, 7);
  }

  // 2) Workout-day ticker. We walk from the day AFTER lastProcessedDate
  //    through TODAY inclusive, and increment ONLY on dates the user
  //    actually trained. This ensures freezes accrue from real effort,
  //    not from sitting on a frozen streak indefinitely.
  let dayCursor = new Date(state.lastProcessedDate + 'T00:00:00');
  const todayDate = new Date(todayStr + 'T00:00:00');
  dayCursor.setDate(dayCursor.getDate() + 1);

  while (dayCursor <= todayDate) {
    const ds = isoDate(dayCursor);
    if (workoutDays.has(ds)) {
      state.streakDaysSinceFreezeGain += 1;
      if (state.streakDaysSinceFreezeGain >= WORKOUTS_TO_EARN_FREEZE && state.freezes < MAX_FREEZES) {
        state.freezes += 1;
        state.streakDaysSinceFreezeGain = 0;
      }
    }
    dayCursor.setDate(dayCursor.getDate() + 1);
  }

  state.lastProcessedDate = todayStr;
  setRaw(state);
  return state;
}

/** Read-only accessor. */
export function getStreakState(): StreakState {
  return getRaw();
}

/**
 * How many more WORKOUT DAYS the user needs before they earn another
 * freeze. Returns 0 if they're already at the cap.
 */
export function workoutsUntilNextFreeze(state: StreakState): number {
  if (state.freezes >= MAX_FREEZES) return 0;
  return Math.max(0, WORKOUTS_TO_EARN_FREEZE - state.streakDaysSinceFreezeGain);
}

/** @deprecated alias kept for back-compat — same value as
 *  workoutsUntilNextFreeze now that the basis is workout-days. */
export const daysUntilNextFreeze = workoutsUntilNextFreeze;

/** True if the user has any non-rest workout in the current week. */
export function isStreakActiveThisWeek(): boolean {
  const ws = weekStartISO(new Date());
  const active = activeWeekSet(storage.getWorkouts());
  return active.has(ws);
}

/** Back-compat alias — old call sites still import this name. */
export function isStreakActiveToday(): boolean {
  return isStreakActiveThisWeek();
}
