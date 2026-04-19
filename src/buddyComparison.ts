import type { Workout, Exercise, MuscleGroup } from './types';

// ========== Public types ==========

export interface SideStat {
  maxWeight: number;
  repsAtMax: number;
  est1RM: number; // Epley: weight × (1 + reps/30), rounded
}

export interface HeadlineStats {
  totalWorkouts: number;
  currentStreak: number;
  totalVolume: number;
  avgVolumePerSession: number;
}

export interface ExerciseFaceoff {
  exerciseId: string;
  exerciseName: string;
  me: SideStat;
  buddy: SideStat;
  winner: 'me' | 'buddy' | 'tie';
}

export interface ExerciseExclusive {
  exerciseId: string;
  exerciseName: string;
  side: 'me' | 'buddy';
  maxWeight: number;
  repsAtMax: number;
}

export interface MuscleGroupFaceoff {
  group: MuscleGroup;
  meVolume: number;
  buddyVolume: number;
  winner: 'me' | 'buddy' | 'tie'; // within 2% counts as tie
}

export interface ComparisonResult {
  headline: { me: HeadlineStats; buddy: HeadlineStats };
  muscleGroups: MuscleGroupFaceoff[];
  exercises: ExerciseFaceoff[];
  exclusives: ExerciseExclusive[];
  verdict: { meLeads: number; buddyLeads: number; ties: number };
}

// ========== Internals ==========

function compareSides(me: SideStat, buddy: SideStat): 'me' | 'buddy' | 'tie' {
  if (me.maxWeight > buddy.maxWeight) return 'me';
  if (buddy.maxWeight > me.maxWeight) return 'buddy';
  if (me.repsAtMax > buddy.repsAtMax) return 'me';
  if (buddy.repsAtMax > me.repsAtMax) return 'buddy';
  return 'tie';
}

function computeCurrentStreak(workouts: Workout[]): number {
  const completed = workouts.filter((w) => w.completed && w.type !== 'rest');
  const uniqueDates = Array.from(
    new Set(completed.map((w) => new Date(w.date).toDateString())),
  ).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < uniqueDates.length; i++) {
    const d = new Date(uniqueDates[i]);
    d.setHours(0, 0, 0, 0);
    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    if (d.getTime() === expected.getTime()) streak++;
    else break;
  }
  return streak;
}

function computeSideStatForExercise(
  workouts: Workout[],
  exerciseId: string,
): SideStat | null {
  let maxWeight = 0;
  let repsAtMax = 0;
  let hasData = false;

  for (const w of workouts) {
    if (!w.completed || w.type === 'rest') continue;
    for (const ex of w.exercises) {
      if (ex.exerciseId !== exerciseId) continue;
      for (const s of ex.sets) {
        if (!s.completed || s.weight <= 0 || s.reps <= 0) continue;
        hasData = true;
        if (
          s.weight > maxWeight ||
          (s.weight === maxWeight && s.reps > repsAtMax)
        ) {
          maxWeight = s.weight;
          repsAtMax = s.reps;
        }
      }
    }
  }

  if (!hasData) return null;
  return {
    maxWeight,
    repsAtMax,
    est1RM: Math.round(maxWeight * (1 + repsAtMax / 30)),
  };
}

function computeHeadline(workouts: Workout[]): HeadlineStats {
  const completed = workouts.filter((w) => w.completed && w.type !== 'rest');
  let totalVolume = 0;
  for (const w of completed) {
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        if (s.completed) totalVolume += s.weight * s.reps;
      }
    }
  }
  return {
    totalWorkouts: completed.length,
    currentStreak: computeCurrentStreak(workouts),
    totalVolume: Math.round(totalVolume),
    avgVolumePerSession: completed.length
      ? Math.round(totalVolume / completed.length)
      : 0,
  };
}

function computeMuscleGroupVolumes(
  workouts: Workout[],
  groupByExId: Map<string, MuscleGroup>,
): Map<MuscleGroup, number> {
  const result = new Map<MuscleGroup, number>();
  for (const w of workouts) {
    if (!w.completed || w.type === 'rest') continue;
    for (const ex of w.exercises) {
      const group = groupByExId.get(ex.exerciseId);
      if (!group) continue;
      for (const s of ex.sets) {
        if (!s.completed) continue;
        const volume = s.weight * s.reps;
        result.set(group, (result.get(group) || 0) + volume);
      }
    }
  }
  return result;
}

// ========== Public entry point ==========

export function computeComparison(
  myWorkouts: Workout[],
  buddyWorkouts: Workout[],
  exercises: Exercise[],
): ComparisonResult {
  const headline = {
    me: computeHeadline(myWorkouts),
    buddy: computeHeadline(buddyWorkouts),
  };

  // Collect exercise IDs and names from both sides
  const myExerciseIds = new Set<string>();
  const buddyExerciseIds = new Set<string>();
  const nameByExId = new Map<string, string>();

  for (const w of myWorkouts) {
    for (const ex of w.exercises) {
      myExerciseIds.add(ex.exerciseId);
      if (!nameByExId.has(ex.exerciseId)) nameByExId.set(ex.exerciseId, ex.exerciseName);
    }
  }
  for (const w of buddyWorkouts) {
    for (const ex of w.exercises) {
      buddyExerciseIds.add(ex.exerciseId);
      if (!nameByExId.has(ex.exerciseId)) nameByExId.set(ex.exerciseId, ex.exerciseName);
    }
  }

  // Exercise face-off (only shared exercises both have completed sets for)
  const shared = Array.from(myExerciseIds).filter((id) => buddyExerciseIds.has(id));
  const faceoffs: ExerciseFaceoff[] = [];
  for (const exerciseId of shared) {
    const me = computeSideStatForExercise(myWorkouts, exerciseId);
    const buddy = computeSideStatForExercise(buddyWorkouts, exerciseId);
    if (!me || !buddy) continue;
    faceoffs.push({
      exerciseId,
      exerciseName: nameByExId.get(exerciseId) || exerciseId,
      me,
      buddy,
      winner: compareSides(me, buddy),
    });
  }

  faceoffs.sort((a, b) => {
    if (a.winner === 'tie' && b.winner !== 'tie') return 1;
    if (b.winner === 'tie' && a.winner !== 'tie') return -1;
    if (a.winner === 'tie' && b.winner === 'tie') {
      return a.exerciseName.localeCompare(b.exerciseName);
    }
    const gapA = Math.abs(a.me.maxWeight - a.buddy.maxWeight);
    const gapB = Math.abs(b.me.maxWeight - b.buddy.maxWeight);
    return gapB - gapA;
  });

  const meLeads = faceoffs.filter((f) => f.winner === 'me').length;
  const buddyLeads = faceoffs.filter((f) => f.winner === 'buddy').length;
  const ties = faceoffs.filter((f) => f.winner === 'tie').length;

  // Exclusives — exercises only one side has logged
  const exclusives: ExerciseExclusive[] = [];
  for (const id of myExerciseIds) {
    if (buddyExerciseIds.has(id)) continue;
    const stat = computeSideStatForExercise(myWorkouts, id);
    if (!stat) continue;
    exclusives.push({
      exerciseId: id,
      exerciseName: nameByExId.get(id) || id,
      side: 'me',
      maxWeight: stat.maxWeight,
      repsAtMax: stat.repsAtMax,
    });
  }
  for (const id of buddyExerciseIds) {
    if (myExerciseIds.has(id)) continue;
    const stat = computeSideStatForExercise(buddyWorkouts, id);
    if (!stat) continue;
    exclusives.push({
      exerciseId: id,
      exerciseName: nameByExId.get(id) || id,
      side: 'buddy',
      maxWeight: stat.maxWeight,
      repsAtMax: stat.repsAtMax,
    });
  }
  exclusives.sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));

  // Muscle group showdown
  const groupByExId = new Map<string, MuscleGroup>();
  for (const e of exercises) groupByExId.set(e.id, e.muscleGroup);
  const myVol = computeMuscleGroupVolumes(myWorkouts, groupByExId);
  const buddyVol = computeMuscleGroupVolumes(buddyWorkouts, groupByExId);
  const allGroups = new Set<MuscleGroup>([...myVol.keys(), ...buddyVol.keys()]);
  const muscleGroups: MuscleGroupFaceoff[] = [];
  for (const group of allGroups) {
    const meVolume = myVol.get(group) || 0;
    const buddyVolume = buddyVol.get(group) || 0;
    if (meVolume === 0 && buddyVolume === 0) continue;
    const total = meVolume + buddyVolume;
    const ratio = total > 0 ? Math.abs(meVolume - buddyVolume) / total : 0;
    const winner: 'me' | 'buddy' | 'tie' =
      ratio < 0.02 ? 'tie' : meVolume > buddyVolume ? 'me' : 'buddy';
    muscleGroups.push({
      group,
      meVolume: Math.round(meVolume),
      buddyVolume: Math.round(buddyVolume),
      winner,
    });
  }
  const GROUP_ORDER: MuscleGroup[] = [
    'chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core', 'full_body', 'other',
  ];
  muscleGroups.sort(
    (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group),
  );

  return {
    headline,
    muscleGroups,
    exercises: faceoffs,
    exclusives,
    verdict: { meLeads, buddyLeads, ties },
  };
}
