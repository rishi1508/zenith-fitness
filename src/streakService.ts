import type { StreakState, Workout } from './types';
import * as storage from './storage';

const STREAK_KEY = 'zenith_streak';
export const MAX_FREEZES = 2;
export const DAYS_TO_EARN_FREEZE = 30;

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
 * Run once on app mount. For every past week between `lastProcessedDate`
 * and the start of this week: if the user didn't work out at all that
 * week AND it isn't already frozen, consume one freeze to "rescue" it.
 * Separately, tick `streakDaysSinceFreezeGain` for each day the streak
 * is alive; every DAYS_TO_EARN_FREEZE consecutive alive days grants a
 * new freeze up to MAX_FREEZES.
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

  // 1) Rescue every inactive completed week in the processing window.
  //    "Completed" = week-start strictly less than this week's start.
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
      // If no freeze available, the week is a miss. `computeWeekStreak`
      // then returns 0 for current, which is correct.
    }
    weekCursor = addDays(weekCursor, 7);
  }

  // 2) Freeze-earn ticker: tick every day while the streak is alive.
  //    A day is "streak alive" if the week containing it is either active
  //    or frozen. If the streak ever breaks, the ticker resets.
  const allWeeks = new Set<string>([...activeWeeks, ...frozenWeeks]);
  let dayCursor = new Date(state.lastProcessedDate + 'T00:00:00');
  const todayDate = new Date(todayStr + 'T00:00:00');
  dayCursor.setDate(dayCursor.getDate() + 1);

  while (dayCursor <= todayDate) {
    const dayWS = weekStartISO(dayCursor);
    // Current week gets the benefit of the doubt — even if empty, we
    // keep the ticker going until the week is over.
    const alive = allWeeks.has(dayWS) || dayWS === thisWS;
    if (alive) {
      state.streakDaysSinceFreezeGain += 1;
      if (state.streakDaysSinceFreezeGain >= DAYS_TO_EARN_FREEZE && state.freezes < MAX_FREEZES) {
        state.freezes += 1;
        state.streakDaysSinceFreezeGain = 0;
      }
    } else {
      state.streakDaysSinceFreezeGain = 0;
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

export function daysUntilNextFreeze(state: StreakState): number {
  if (state.freezes >= MAX_FREEZES) return 0;
  return Math.max(0, DAYS_TO_EARN_FREEZE - state.streakDaysSinceFreezeGain);
}

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
