/**
 * Energy expenditure — how many calories the user actually burns.
 *
 * The model has three layers, kept separate so nothing is counted twice:
 *
 *   resting   BMR (Mifflin–St Jeor) spread over 24 h. Always present.
 *   workouts  What the logged training added ON TOP of resting.
 *   movement  Walking and everything else, from Health Connect when the
 *             phone/watch saw it, otherwise estimated from step count.
 *
 *   total = resting + active,  active = max(device active, our estimate)
 *
 * Everything above resting is "active", which is the same convention Health
 * Connect uses (`ACTIVE_CALORIES_BURNED` excludes basal), so the two can be
 * compared directly instead of double counting.
 *
 * Per-exercise cost comes from a MET value carried on the exercise itself
 * (`Exercise.met`), defaulting to a value derived from its category and
 * equipment. Session time is apportioned across exercises by how long their
 * sets and rests plausibly took, then each share is priced at that exercise's
 * MET — so a heavy squat block costs more than the same minutes of curls, and
 * more volume in an exercise moves its share up.
 *
 * Pure module: no storage, no React. Tested in `tests/energy.test.ts`.
 */
import type {
  Exercise, ExerciseCategory, ExerciseEquipment, HealthProfile, Workout, WorkoutExercise,
} from './types';
import { estimateBmr } from './health/targets';

// ---------------------------------------------------------------- MET table

/** Compendium-of-Physical-Activities style values for resistance work. */
export const DEFAULT_MET_BY_CATEGORY: Record<ExerciseCategory, number> = {
  compound: 5.5,
  isolation: 3.5,
  core: 4.0,
  cardio: 8.0,
  other: 4.0,
};

/** Free-weight compounds move the whole body and cost more than a machine. */
const EQUIPMENT_MET_DELTA: Partial<Record<ExerciseEquipment, number>> = {
  barbell: 0.5,
  dumbbell: 0.3,
  kettlebell: 0.8,
  bodyweight: 0.5,
  machine: -0.5,
  cable: -0.3,
  band: -0.5,
};

/** Named exercises whose real cost differs from what the category implies. */
const MET_BY_NAME: Record<string, number> = {
  'barbell squat': 6.5, 'back squat': 6.5, 'front squat': 6.5, 'machine squat': 5.5,
  deadlift: 6.5, 'romanian deadlift': 6.0, 'sumo deadlift': 6.5,
  'walking lunges': 6.0, 'walking lunges (dumbbell)': 6.0, lunges: 5.5,
  burpees: 9.0, 'jump rope': 11.0, 'box jumps': 8.0, 'kettlebell swing': 9.0,
  'pull-ups': 8.0, 'pull ups': 8.0, 'chin-ups': 8.0, dips: 7.0, 'push-ups': 6.0,
  'bench press': 5.0, 'incline bench press': 5.0, 'overhead press': 5.5,
  'standing overhead barbell press': 5.5, 'leg press machine': 5.0, 'leg press': 5.0,
  plank: 3.5, 'hanging leg raise': 4.5, 'cable crunch': 3.5,
  treadmill: 8.0, running: 9.8, cycling: 7.0, rowing: 7.0, elliptical: 5.0, 'stair climber': 9.0,
};

/** Enough of an exercise to price it. */
export type MetInput = Pick<Exercise, 'name' | 'isCompound'> & Partial<Pick<Exercise, 'category' | 'equipment' | 'met'>>;

/** The MET this exercise should be priced at. */
export function metFor(exercise: MetInput): number {
  if (typeof exercise.met === 'number' && exercise.met > 0) return exercise.met;
  const named = MET_BY_NAME[exercise.name.trim().toLowerCase()];
  if (named) return named;
  const category: ExerciseCategory = exercise.category ?? (exercise.isCompound ? 'compound' : 'isolation');
  const base = DEFAULT_MET_BY_CATEGORY[category] ?? 4.0;
  const delta = exercise.equipment ? EQUIPMENT_MET_DELTA[exercise.equipment] ?? 0 : 0;
  return Math.round(Math.min(12, Math.max(2, base + delta)) * 10) / 10;
}

// ------------------------------------------------------------ resting rate

/** Fallback when the profile is incomplete: 1 MET ≈ 1 kcal per kg per hour. */
const FALLBACK_KCAL_PER_KG_HOUR = 1;

/**
 * What one MET-hour costs THIS person, in kcal. Derived from their own BMR so
 * height, age and sex all move the number; falls back to the classic
 * 1 kcal/kg/h when the profile is not filled in.
 */
export function restingKcalPerHour(profile: HealthProfile, weightKg: number, now?: Date): number {
  const bmr = weightKg > 0 ? estimateBmr(profile, weightKg, now) : null;
  if (bmr != null && bmr > 0) return bmr / 24;
  return Math.max(0, weightKg) * FALLBACK_KCAL_PER_KG_HOUR;
}

/** Whole-day resting burn (BMR). Null when we cannot estimate it honestly. */
export function restingKcalForDay(profile: HealthProfile, weightKg: number, now?: Date): number | null {
  const bmr = weightKg > 0 ? estimateBmr(profile, weightKg, now) : null;
  return bmr != null ? Math.round(bmr) : null;
}

// --------------------------------------------------------------- workouts

/** Seconds a working set takes: roughly 3 s per rep, floor of 20 s. */
function setSeconds(reps: number): number {
  return Math.max(20, Math.min(120, reps * 3));
}

/** Rest between sets when the user has not told us: longer for heavy work. */
function restSeconds(met: number): number {
  if (met >= 6) return 150;
  if (met >= 4.5) return 120;
  return 75;
}

export interface ExerciseEnergy {
  exerciseId: string;
  exerciseName: string;
  met: number;
  /** Minutes of the session attributed to this exercise. */
  minutes: number;
  /** Calories burned ABOVE resting. */
  activeKcal: number;
  /** Total volume (kg) that drove the share. */
  volumeKg: number;
}

export interface WorkoutEnergy {
  /** Calories above resting for the whole session. */
  activeKcal: number;
  /** Including the resting burn over the same minutes — the bigger number a
   *  watch would show. Shown as a secondary figure only. */
  grossKcal: number;
  minutes: number;
  perExercise: ExerciseEnergy[];
  /** True when we had to guess the body weight or the profile. */
  estimated: boolean;
}

const EMPTY_ENERGY: WorkoutEnergy = { activeKcal: 0, grossKcal: 0, minutes: 0, perExercise: [], estimated: true };

/** Completed sets only — an untouched set costs nothing. */
function loggedSets(ex: WorkoutExercise) {
  return ex.sets.filter((s) => s.completed && s.reps > 0);
}

/**
 * Calories for one logged workout.
 *
 * `durationMin` (the real elapsed time, when the app recorded it) is the
 * ground truth for how long the session took; the per-exercise estimate only
 * decides how that time is split. Without it we fall back to the estimate.
 */
export function workoutEnergy(
  workout: Pick<Workout, 'exercises' | 'duration'>,
  opts: { profile: HealthProfile; weightKg: number; library?: Exercise[]; now?: Date },
): WorkoutEnergy {
  const { profile, weightKg, library = [], now } = opts;
  if (!(weightKg > 0)) return EMPTY_ENERGY;

  const byId = new Map(library.map((e) => [e.id, e]));
  const byName = new Map(library.map((e) => [e.name.trim().toLowerCase(), e]));

  const rows = workout.exercises.map((ex) => {
    const sets = loggedSets(ex);
    const def = byId.get(ex.exerciseId) ?? byName.get(ex.exerciseName.trim().toLowerCase());
    const met = metFor(def ?? { name: ex.exerciseName, isCompound: false });
    const seconds = sets.reduce((t, s) => t + setSeconds(s.reps) + restSeconds(met), 0);
    const volumeKg = sets.reduce((t, s) => t + s.reps * Math.max(0, s.weight), 0);
    return { ex, met, seconds, volumeKg, sets: sets.length };
  }).filter((r) => r.sets > 0);

  if (rows.length === 0) return { ...EMPTY_ENERGY, estimated: !profile.sex };

  const estimatedSeconds = rows.reduce((t, r) => t + r.seconds, 0);
  // Trust the clock when we have it, but ignore absurd values (a session left
  // running overnight) by capping at four hours.
  const actualMinutes = workout.duration && workout.duration > 0 ? Math.min(workout.duration, 240) : null;
  const totalMinutes = actualMinutes ?? estimatedSeconds / 60;
  const perHour = restingKcalPerHour(profile, weightKg, now);

  const perExercise: ExerciseEnergy[] = rows.map((r) => {
    const share = estimatedSeconds > 0 ? r.seconds / estimatedSeconds : 1 / rows.length;
    const minutes = totalMinutes * share;
    const hours = minutes / 60;
    return {
      exerciseId: r.ex.exerciseId,
      exerciseName: r.ex.exerciseName,
      met: r.met,
      minutes: Math.round(minutes * 10) / 10,
      activeKcal: Math.round(Math.max(0, r.met - 1) * perHour * hours),
      volumeKg: Math.round(r.volumeKg),
    };
  });

  const activeKcal = perExercise.reduce((t, e) => t + e.activeKcal, 0);
  return {
    activeKcal,
    grossKcal: Math.round(activeKcal + perHour * (totalMinutes / 60)),
    minutes: Math.round(totalMinutes),
    perExercise,
    estimated: !(profile.sex && profile.heightCm && profile.birthYear),
  };
}

// ---------------------------------------------------------------- movement

/** Metres per step for an adult of `heightCm`, or a 0.75 m default. */
export function strideMetres(heightCm?: number): number {
  return heightCm && heightCm > 0 ? Math.max(0.5, Math.min(0.95, heightCm * 0.415 / 100)) : 0.75;
}

const WALKING_MET = 3.3;
const WALKING_SPEED_MS = 1.33; // ~4.8 km/h, an ordinary pace

/** Calories above resting for a day's step count. */
export function stepsActiveKcal(steps: number, profile: HealthProfile, weightKg: number, now?: Date): number {
  if (!(steps > 0) || !(weightKg > 0)) return 0;
  const metres = steps * strideMetres(profile.heightCm);
  const hours = metres / WALKING_SPEED_MS / 3600;
  return Math.round((WALKING_MET - 1) * restingKcalPerHour(profile, weightKg, now) * hours);
}

// ------------------------------------------------------------- day ledger

export interface DayEnergy {
  date: string;
  /** BMR for the day; null when the profile is too thin to estimate it. */
  restingKcal: number | null;
  /** From logged workouts. */
  workoutKcal: number;
  /** From step count. */
  stepsKcal: number;
  /** What the phone or watch measured, if anything. */
  deviceActiveKcal: number | null;
  /** The figure we stand behind: the larger of measured and estimated. */
  activeKcal: number;
  /** resting + active; null when resting is unknown. */
  totalKcal: number | null;
  /** Which side won, so the UI can say where the number came from. */
  activeSource: 'device' | 'estimated' | 'none';
  /** Calories eaten, when the diary has anything. */
  intakeKcal: number;
  /** intake − total. Negative is a deficit. Null without a total. */
  balanceKcal: number | null;
}

export function dayEnergy(input: {
  date: string;
  profile: HealthProfile;
  weightKg: number;
  workouts: Array<Pick<Workout, 'exercises' | 'duration'>>;
  library?: Exercise[];
  steps?: number;
  deviceActiveKcal?: number;
  intakeKcal?: number;
  now?: Date;
}): DayEnergy {
  const { date, profile, weightKg, workouts, library, steps, deviceActiveKcal, intakeKcal = 0, now } = input;

  const workoutKcal = workouts.reduce(
    (t, w) => t + workoutEnergy(w, { profile, weightKg, library, now }).activeKcal, 0,
  );
  const stepsKcal = stepsActiveKcal(steps ?? 0, profile, weightKg, now);
  const estimated = workoutKcal + stepsKcal;
  const device = typeof deviceActiveKcal === 'number' && deviceActiveKcal > 0 ? Math.round(deviceActiveKcal) : null;

  // A phone left in a locker sees none of the session, so our estimate is the
  // floor; a watch worn all day usually sees more than we can infer, so it
  // wins. Taking the larger avoids both double counting and under-reporting.
  const activeKcal = Math.max(device ?? 0, estimated);
  const activeSource: DayEnergy['activeSource'] =
    activeKcal === 0 ? 'none' : (device !== null && device >= estimated ? 'device' : 'estimated');

  const restingKcal = restingKcalForDay(profile, weightKg, now);
  const totalKcal = restingKcal != null ? restingKcal + activeKcal : null;

  return {
    date,
    restingKcal,
    workoutKcal,
    stepsKcal,
    deviceActiveKcal: device,
    activeKcal,
    totalKcal,
    activeSource,
    intakeKcal: Math.round(intakeKcal),
    balanceKcal: totalKcal != null ? Math.round(intakeKcal) - totalKcal : null,
  };
}
