import type { StreakState, Workout } from './types';
import * as storage from './storage';

const STREAK_KEY = 'zenith_streak';
export const MAX_FREEZES = 2;
const DAYS_TO_EARN_FREEZE = 30;

const today = () => new Date().toISOString().slice(0, 10);

function isoDate(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function getRaw(): StreakState {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (raw) return JSON.parse(raw) as StreakState;
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
 * Run once on app mount. Walks the days between `lastProcessedDate` and
 * today, consuming a freeze for each missed day (if one is available)
 * and awarding a new freeze for every DAYS_TO_EARN_FREEZE consecutive
 * non-missed days — up to MAX_FREEZES.
 *
 * Idempotent: calling twice on the same day is a no-op.
 */
export function settleStreak(): StreakState {
  const state = { ...getRaw() };
  const todayStr = today();
  if (state.lastProcessedDate === todayStr) return state;

  // Collect "active" dates: any completed workout OR rest day already
  // on the workouts list counts. freezeConsumedDates also count.
  const workouts = storage.getWorkouts();
  const activeDates = new Set<string>(
    workouts
      .filter((w: Workout) => w.completed)
      .map((w: Workout) => w.date.slice(0, 10)),
  );
  for (const d of state.freezeConsumedDates) activeDates.add(d);

  let cursor = new Date(state.lastProcessedDate + 'T00:00:00');
  const todayDate = new Date(todayStr + 'T00:00:00');
  cursor.setDate(cursor.getDate() + 1); // start day AFTER lastProcessed

  while (cursor <= todayDate) {
    const ds = isoDate(cursor);
    if (activeDates.has(ds)) {
      state.streakDaysSinceFreezeGain += 1;
      if (state.streakDaysSinceFreezeGain >= DAYS_TO_EARN_FREEZE && state.freezes < MAX_FREEZES) {
        state.freezes += 1;
        state.streakDaysSinceFreezeGain = 0;
      }
    } else if (ds !== todayStr) {
      // Missed day that isn't today — consume a freeze if available
      if (state.freezes > 0) {
        state.freezes -= 1;
        state.freezeConsumedDates.push(ds);
        activeDates.add(ds);
        // Day still counts toward the freeze-earn streak (user didn't miss effectively)
        state.streakDaysSinceFreezeGain += 1;
        if (state.streakDaysSinceFreezeGain >= DAYS_TO_EARN_FREEZE && state.freezes < MAX_FREEZES) {
          state.freezes += 1;
          state.streakDaysSinceFreezeGain = 0;
        }
      } else {
        // No freeze left — reset the earn-progress
        state.streakDaysSinceFreezeGain = 0;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
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

/** Is `yyyyMmDd` inside the user's current contiguous streak (workouts +
 *  rest days + freezes)? Used to pick the inactive vs. active streak
 *  icon on the Home header. */
export function isStreakActiveToday(): boolean {
  const state = getRaw();
  const workouts = storage.getWorkouts();
  const logged = new Set(workouts.filter((w) => w.completed).map((w) => w.date.slice(0, 10)));
  for (const d of state.freezeConsumedDates) logged.add(d);
  const t = today();
  if (logged.has(t)) return true;
  // Yesterday must be logged / frozen for the streak to still be "going" today
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return logged.has(isoDate(y));
}
