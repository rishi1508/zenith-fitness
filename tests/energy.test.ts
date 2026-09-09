import { describe, it, expect } from 'vitest';
import type { Exercise, HealthProfile, Workout } from '../src/types';
import {
  dayEnergy, metFor, restingKcalForDay, restingKcalPerHour, stepsActiveKcal, strideMetres, workoutEnergy,
} from '../src/energy';

const profile: HealthProfile = { sex: 'male', heightCm: 178, birthYear: 1998, activityLevel: 'moderate' };
const NOW = new Date('2026-09-09T06:00:00Z');
const WEIGHT = 78;

const ex = (over: Partial<Exercise> & { id: string; name: string }): Exercise => ({
  muscleGroup: 'chest', isCompound: false, ...over,
} as Exercise);

const setsOf = (n: number, reps: number, weight: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, reps, weight, completed: true }));

const workout = (exercises: Array<{ id: string; name: string; sets: ReturnType<typeof setsOf> }>, duration?: number) => ({
  exercises: exercises.map((e) => ({ id: e.id, exerciseId: e.id, exerciseName: e.name, sets: e.sets })),
  duration,
}) as Pick<Workout, 'exercises' | 'duration'>;

describe('MET selection', () => {
  it('uses an explicit met when the exercise carries one', () => {
    expect(metFor({ name: 'Anything', isCompound: false, met: 7.25 })).toBe(7.25);
  });
  it('knows the big lifts by name', () => {
    expect(metFor({ name: 'Barbell Squat', isCompound: true })).toBe(6.5);
    expect(metFor({ name: 'Pull-ups', isCompound: true })).toBe(8);
    expect(metFor({ name: 'jump rope', isCompound: false })).toBe(11);
  });
  it('derives from category and equipment otherwise', () => {
    expect(metFor({ name: 'Some machine press', isCompound: true, category: 'compound', equipment: 'machine' })).toBe(5);
    expect(metFor({ name: 'Some curl', isCompound: false, category: 'isolation', equipment: 'dumbbell' })).toBe(3.8);
    expect(metFor({ name: 'Unknown', isCompound: true })).toBe(5.5);
    expect(metFor({ name: 'Unknown', isCompound: false })).toBe(3.5);
  });
  it('never returns an absurd value', () => {
    const v = metFor({ name: 'x', isCompound: false, category: 'cardio', equipment: 'kettlebell' });
    expect(v).toBeGreaterThanOrEqual(2);
    expect(v).toBeLessThanOrEqual(12);
  });
});

describe('resting rate', () => {
  it('prices a MET-hour from the user own BMR', () => {
    // BMR 1758 for this profile → 73.25 kcal per hour.
    expect(restingKcalPerHour(profile, WEIGHT, NOW)).toBeCloseTo(1758 / 24, 1);
    expect(restingKcalForDay(profile, WEIGHT, NOW)).toBe(1758);
  });
  it('falls back to 1 kcal/kg/h without a profile', () => {
    expect(restingKcalPerHour({}, WEIGHT, NOW)).toBe(WEIGHT);
    expect(restingKcalForDay({}, WEIGHT, NOW)).toBeNull();
  });
});

describe('workout energy', () => {
  const library = [
    ex({ id: 'squat', name: 'Barbell Squat', isCompound: true, category: 'compound', equipment: 'barbell' }),
    ex({ id: 'curl', name: 'Bicep Curl', isCompound: false, category: 'isolation', equipment: 'dumbbell' }),
  ];

  it('is zero without a body weight', () => {
    expect(workoutEnergy(workout([{ id: 'squat', name: 'Barbell Squat', sets: setsOf(4, 5, 100) }]), { profile, weightKg: 0 }).activeKcal).toBe(0);
  });

  it('produces a believable number for a real session', () => {
    const w = workout([
      { id: 'squat', name: 'Barbell Squat', sets: setsOf(4, 5, 100) },
      { id: 'curl', name: 'Bicep Curl', sets: setsOf(3, 12, 15) },
    ], 75);
    const e = workoutEnergy(w, { profile, weightKg: WEIGHT, library, now: NOW });
    expect(e.minutes).toBe(75);
    // A 75-minute mixed session for a 78 kg lifter: a few hundred kcal above resting.
    expect(e.activeKcal).toBeGreaterThan(180);
    expect(e.activeKcal).toBeLessThan(450);
    expect(e.grossKcal).toBeGreaterThan(e.activeKcal);
  });

  it('charges the harder exercise more per minute', () => {
    const w = workout([
      { id: 'squat', name: 'Barbell Squat', sets: setsOf(3, 8, 100) },
      { id: 'curl', name: 'Bicep Curl', sets: setsOf(3, 8, 15) },
    ], 60);
    const e = workoutEnergy(w, { profile, weightKg: WEIGHT, library, now: NOW });
    const squat = e.perExercise.find((x) => x.exerciseId === 'squat')!;
    const curl = e.perExercise.find((x) => x.exerciseId === 'curl')!;
    expect(squat.activeKcal / squat.minutes).toBeGreaterThan(curl.activeKcal / curl.minutes);
    expect(e.perExercise.reduce((t, x) => t + x.activeKcal, 0)).toBe(e.activeKcal);
  });

  it('more volume in an exercise moves more of the session onto it', () => {
    const few = workoutEnergy(workout([
      { id: 'squat', name: 'Barbell Squat', sets: setsOf(2, 5, 100) },
      { id: 'curl', name: 'Bicep Curl', sets: setsOf(3, 12, 15) },
    ], 60), { profile, weightKg: WEIGHT, library, now: NOW });
    const many = workoutEnergy(workout([
      { id: 'squat', name: 'Barbell Squat', sets: setsOf(6, 5, 100) },
      { id: 'curl', name: 'Bicep Curl', sets: setsOf(3, 12, 15) },
    ], 60), { profile, weightKg: WEIGHT, library, now: NOW });
    const share = (e: typeof few) => e.perExercise.find((x) => x.exerciseId === 'squat')!.minutes;
    expect(share(many)).toBeGreaterThan(share(few));
    // Same clock time, so the session total should rise only modestly.
    expect(many.activeKcal).toBeGreaterThan(few.activeKcal);
  });

  it('ignores sets that were never completed', () => {
    const w = {
      duration: 40,
      exercises: [{
        id: 'a', exerciseId: 'squat', exerciseName: 'Barbell Squat',
        sets: [{ id: '1', reps: 0, weight: 0, completed: false }, { id: '2', reps: 5, weight: 100, completed: true }],
      }],
    } as Pick<Workout, 'exercises' | 'duration'>;
    const e = workoutEnergy(w, { profile, weightKg: WEIGHT, library, now: NOW });
    expect(e.perExercise).toHaveLength(1);
    expect(e.activeKcal).toBeGreaterThan(0);
  });

  it('caps a session someone left running overnight', () => {
    const e = workoutEnergy(workout([{ id: 'squat', name: 'Barbell Squat', sets: setsOf(3, 5, 100) }], 900),
      { profile, weightKg: WEIGHT, library, now: NOW });
    expect(e.minutes).toBe(240);
  });

  it('flags the estimate when the profile is incomplete', () => {
    const e = workoutEnergy(workout([{ id: 'squat', name: 'Barbell Squat', sets: setsOf(3, 5, 100) }], 45),
      { profile: {}, weightKg: WEIGHT, library, now: NOW });
    expect(e.estimated).toBe(true);
    expect(e.activeKcal).toBeGreaterThan(0);
  });
});

describe('steps', () => {
  it('scales the stride with height', () => {
    expect(strideMetres(178)).toBeCloseTo(0.739, 2);
    expect(strideMetres(undefined)).toBe(0.75);
  });
  it('gives a sane figure for a normal day', () => {
    const kcal = stepsActiveKcal(8000, profile, WEIGHT, NOW);
    expect(kcal).toBeGreaterThan(150);
    expect(kcal).toBeLessThan(350);
  });
  it('is zero for no steps', () => {
    expect(stepsActiveKcal(0, profile, WEIGHT, NOW)).toBe(0);
  });
});

describe('day ledger', () => {
  const base = { date: '2026-09-09', profile, weightKg: WEIGHT, now: NOW, library: [] as Exercise[] };

  it('adds resting and active without double counting', () => {
    const d = dayEnergy({ ...base, workouts: [], steps: 8000, intakeKcal: 2000 });
    expect(d.restingKcal).toBe(1758);
    expect(d.activeKcal).toBe(d.stepsKcal);
    expect(d.totalKcal).toBe(1758 + d.activeKcal);
    expect(d.balanceKcal).toBe(2000 - d.totalKcal!);
    expect(d.activeSource).toBe('estimated');
  });

  it('prefers the device when it saw more than we estimated', () => {
    const d = dayEnergy({ ...base, workouts: [], steps: 3000, deviceActiveKcal: 700 });
    expect(d.activeKcal).toBe(700);
    expect(d.activeSource).toBe('device');
  });

  it('keeps our estimate when the phone was in a locker', () => {
    const w = workout([{ id: 'squat', name: 'Barbell Squat', sets: setsOf(5, 5, 100) }], 70);
    const d = dayEnergy({ ...base, workouts: [w], steps: 2000, deviceActiveKcal: 40 });
    expect(d.activeSource).toBe('estimated');
    expect(d.activeKcal).toBe(d.workoutKcal + d.stepsKcal);
    expect(d.workoutKcal).toBeGreaterThan(100);
  });

  it('reports nothing rather than a guess when the profile is empty', () => {
    const d = dayEnergy({ ...base, profile: {}, workouts: [], steps: 5000 });
    expect(d.restingKcal).toBeNull();
    expect(d.totalKcal).toBeNull();
    expect(d.balanceKcal).toBeNull();
  });

  it('says so when there is no activity at all', () => {
    const d = dayEnergy({ ...base, workouts: [], steps: 0 });
    expect(d.activeKcal).toBe(0);
    expect(d.activeSource).toBe('none');
  });
});
