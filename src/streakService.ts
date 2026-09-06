import type { Workout, WeeklyPlan, StreakSettings, UserProfile } from './types';

/**
 * N★ weekly streak — a pure function of workout history.
 *
 * The streak counts consecutive Sun–Sat weeks in which the user trained on
 * at least `level` distinct days (`level` = the days/week they committed
 * to). Rest days never count. The current, unfinished week is never a
 * miss: it joins the streak the moment it qualifies and only breaks it
 * once the week is over.
 *
 * Freezes rescue a failed week. Everyone starts with one; another is
 * earned on every 30th workout day (banked up to 2, extra milestones are
 * simply lost while at the cap). A freeze is spent automatically, at the
 * end of a failed week, and only when there is a streak to protect.
 *
 * Everything here is REPLAYED from the first workout each time it is
 * asked for. There is no incremental state to drift, nothing to migrate,
 * and every device computes the same answer from the same history. The
 * previous implementation kept a ticking counter in localStorage that was
 * stamped "processed today" on app open — before the day's workout was
 * logged — so it never saw a workout day and never earned a freeze.
 */

export const MAX_FREEZES = 2;
export const STARTING_FREEZES = 1;
export const WORKOUTS_TO_EARN_FREEZE = 30;
export const MIN_COMMITMENT = 1;
export const MAX_COMMITMENT = 6;
export const DEFAULT_COMMITMENT = 3;

// ---------- date helpers (all LOCAL time) ----------

/** Local YYYY-MM-DD. `Date.toISOString()` is UTC and shifts the date for
 *  anyone east of Greenwich — never use it for calendar logic. */
export function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** YYYY-MM-DD of the Sunday that starts the week containing `d`. */
export function weekStartISO(d: Date): string {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - copy.getDay()); // getDay() 0 = Sun
  return localIso(copy);
}

/** Adds `n` days to a YYYY-MM-DD and returns a YYYY-MM-DD. */
export function addDays(yyyymmdd: string, n: number): string {
  const d = new Date(yyyymmdd + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localIso(d);
}

/** Local dates (YYYY-MM-DD) on which the user logged ≥1 completed,
 *  non-rest workout. Two sessions on one day count once. */
export function workoutDaySet(workouts: Workout[]): Set<string> {
  const out = new Set<string>();
  for (const w of workouts) {
    if (!w.completed || w.type === 'rest') continue;
    const d = new Date(w.date);
    if (!Number.isNaN(d.getTime())) out.add(localIso(d));
  }
  return out;
}

/** Number of distinct workout days per week (keyed by week-start). */
export function workoutDaysPerWeek(days: Iterable<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const ds of days) {
    const ws = weekStartISO(new Date(ds + 'T00:00:00'));
    out.set(ws, (out.get(ws) ?? 0) + 1);
  }
  return out;
}

// ---------- commitment ----------

export function clampCommitment(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_COMMITMENT;
  return Math.min(MAX_COMMITMENT, Math.max(MIN_COMMITMENT, Math.round(n)));
}

/** The days/week the user committed to. Explicit setting wins; otherwise
 *  the active plan's non-rest day count; otherwise DEFAULT_COMMITMENT. */
export function resolveCommitment(settings: StreakSettings, activePlan: WeeklyPlan | null | undefined): number {
  if (settings.commitment != null) return clampCommitment(settings.commitment);
  if (activePlan && activePlan.days.length > 0) {
    const trainingDays = activePlan.days.filter((d) => !d.isRestDay && d.exercises.length > 0).length;
    if (trainingDays > 0) return clampCommitment(trainingDays);
  }
  return DEFAULT_COMMITMENT;
}

// ---------- the replay ----------

export interface StreakResult {
  /** Days/week this result was computed for. */
  level: number;
  /** Consecutive qualifying (or frozen) weeks, including this week if it
   *  already qualifies. */
  current: number;
  longest: number;
  /** Freezes in the bank right now. */
  freezes: number;
  /** Week-starts that were rescued by a freeze. */
  frozenWeeks: Set<string>;
  /** Week-starts that make up the current streak (active + frozen). */
  streakWeeks: Set<string>;
  /** Distinct workout days per week-start, for calendar rendering. */
  weekDays: Map<string, number>;
  thisWeekDays: number;
  thisWeekQualified: boolean;
  /** True when the remaining days of this week (today included) are not
   *  enough to reach `level` — the week will need a freeze or will break
   *  the streak. */
  thisWeekAtRisk: boolean;
  daysNeededThisWeek: number;
  totalWorkoutDays: number;
  /** Workout days logged toward the next freeze (0–29). */
  freezeProgress: number;
  workoutsUntilNextFreeze: number;
}

export function computeStreak(workouts: Workout[], level: number, now: Date = new Date()): StreakResult {
  const lvl = clampCommitment(level);
  const days = Array.from(workoutDaySet(workouts)).sort();
  const weekDays = workoutDaysPerWeek(days);
  const thisWS = weekStartISO(now);

  let freezes = STARTING_FREEZES;
  let total = 0;
  let run = 0;
  let longest = 0;
  let runWeeks: string[] = [];
  const frozenWeeks = new Set<string>();

  const earn = (count: number) => {
    for (let i = 0; i < count; i++) {
      total += 1;
      if (total % WORKOUTS_TO_EARN_FREEZE === 0 && freezes < MAX_FREEZES) freezes += 1;
    }
  };

  if (days.length > 0) {
    let ws = weekStartISO(new Date(days[0] + 'T00:00:00'));
    let guard = 60 * 52; // ~60 years of weeks — protects against bad dates
    while (ws < thisWS && guard-- > 0) {
      const d = weekDays.get(ws) ?? 0;
      earn(d);
      if (d >= lvl) {
        run += 1;
        runWeeks.push(ws);
      } else if (run > 0 && freezes > 0) {
        freezes -= 1;
        frozenWeeks.add(ws);
        run += 1;
        runWeeks.push(ws);
      } else {
        run = 0;
        runWeeks = [];
      }
      longest = Math.max(longest, run);
      ws = addDays(ws, 7);
    }
  }

  const thisWeekDays = weekDays.get(thisWS) ?? 0;
  earn(thisWeekDays);
  const thisWeekQualified = thisWeekDays >= lvl;
  const current = thisWeekQualified ? run + 1 : run;
  longest = Math.max(longest, current);
  const streakWeeks = new Set<string>(current > 0 ? runWeeks : []);
  if (thisWeekQualified) streakWeeks.add(thisWS);

  const remainingDays = 7 - now.getDay(); // today included
  const daysNeededThisWeek = Math.max(0, lvl - thisWeekDays);
  const thisWeekAtRisk = !thisWeekQualified && daysNeededThisWeek > remainingDays;

  const freezeProgress = total % WORKOUTS_TO_EARN_FREEZE;
  return {
    level: lvl,
    current,
    longest,
    freezes,
    frozenWeeks,
    streakWeeks,
    weekDays,
    thisWeekDays,
    thisWeekQualified,
    thisWeekAtRisk,
    daysNeededThisWeek,
    totalWorkoutDays: total,
    freezeProgress,
    workoutsUntilNextFreeze: WORKOUTS_TO_EARN_FREEZE - freezeProgress,
  };
}

// ---------- what to show ----------

export interface StreakSummary {
  /** The level the user committed to (drives the freeze bank). */
  committed: StreakResult;
  /** What the header pill shows: the committed level, or a higher level
   *  whose streak is just as long ("show whichever is higher"). */
  shown: StreakResult;
  /** Every level 1..6, for the ladder in the modal. */
  ladder: StreakResult[];
}

export function computeStreakSummary(workouts: Workout[], commitment: number, now: Date = new Date()): StreakSummary {
  const ladder: StreakResult[] = [];
  for (let n = MIN_COMMITMENT; n <= MAX_COMMITMENT; n++) ladder.push(computeStreak(workouts, n, now));
  const committed = ladder[clampCommitment(commitment) - 1];
  let shown = committed;
  for (let n = committed.level + 1; n <= MAX_COMMITMENT; n++) {
    const r = ladder[n - 1];
    if (r.current >= 1 && r.current >= committed.current) shown = r;
  }
  return { committed, shown, ladder };
}

/** "4★" for level ≥ 2; a 1-day-a-week streak is just a streak, no star. */
export function levelLabel(level: number): string {
  return level >= 2 ? `${level}★` : '';
}

// ---------- buddies ----------

export interface BuddyStreak {
  weeks: number;
  level: number;
  longest: number;
}

/**
 * A buddy's streak as seen from OUR device. Clients running the N★ model
 * publish `currentStreak` + `streakLevel` on their public profile, so we
 * trust those. Older clients only publish a per-day activity map — for
 * them we replay a 1-day/week streak from `compareStats.activityDays`
 * (~180 days of history, so `longest` is a floor, not the truth).
 */
export function buddyStreakFromProfile(
  profile: Pick<UserProfile, 'currentStreak' | 'streakLevel' | 'compareStats'> | null | undefined,
  now: Date = new Date(),
): BuddyStreak {
  if (!profile) return { weeks: 0, level: 1, longest: 0 };
  const activity = profile.compareStats?.activityDays;
  const synthetic: Workout[] = activity
    ? Object.entries(activity)
      .filter(([, v]) => v > 0)
      .map(([ds]) => ({
        id: ds, date: ds + 'T12:00:00', name: '', type: 'custom', exercises: [], completed: true,
      }))
    : [];
  if (profile.streakLevel != null) {
    const level = clampCommitment(profile.streakLevel);
    const replay = synthetic.length ? computeStreak(synthetic, level, now) : null;
    const weeks = profile.currentStreak ?? 0;
    return { weeks, level, longest: Math.max(weeks, replay?.longest ?? 0) };
  }
  if (synthetic.length === 0) return { weeks: 0, level: 1, longest: 0 };
  const r = computeStreak(synthetic, 1, now);
  return { weeks: r.current, level: 1, longest: r.longest };
}

/** "12 week streak · 4★" / "12 week streak" / "1 week streak". */
export function formatStreak(s: { weeks: number; level: number }): string {
  const base = `${s.weeks} week streak`;
  return s.level >= 2 ? `${base} · ${s.level}★` : base;
}
