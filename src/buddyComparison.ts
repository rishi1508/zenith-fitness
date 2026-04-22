import type { Workout, Exercise, MuscleGroup, BuddyCompareStats } from './types';
import { computeWeekStreak } from './streakService';

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
  // Streak is now weekly — matches storage.calculateStats. Buddy compare
  // snapshot doesn't have access to the local freeze state, so we pass an
  // empty frozen set. Fine: the worst case is we under-count by the number
  // of frozen weeks, which is typically 0.
  const { current: currentStreak } = computeWeekStreak(completed, new Set());
  return {
    totalWorkouts: completed.length,
    currentStreak,
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

// ========== Snapshot for cross-user read ==========

/**
 * Build a self-contained comparison snapshot from the current user's own
 * workouts. Serialized onto userProfile so a buddy can read it without
 * needing access to raw workout docs.
 */
export function computeMyCompareStats(
  workouts: Workout[],
  exercises: Exercise[],
): BuddyCompareStats {
  const headline = computeHeadline(workouts);
  const groupByExId = new Map<string, MuscleGroup>();
  const groupByExName = new Map<string, MuscleGroup>();
  for (const e of exercises) {
    groupByExId.set(e.id, e.muscleGroup);
    groupByExName.set(e.name.trim().toLowerCase(), e.muscleGroup);
  }

  const volMap = computeMuscleGroupVolumes(workouts, groupByExId);
  const muscleGroupVolumes: Partial<Record<MuscleGroup, number>> = {};
  for (const [group, vol] of volMap) muscleGroupVolumes[group] = Math.round(vol);

  // Collect every unique exerciseId the user has actually done
  const seen = new Set<string>();
  const nameByExId = new Map<string, string>();
  for (const w of workouts) {
    if (!w.completed || w.type === 'rest') continue;
    for (const ex of w.exercises) {
      seen.add(ex.exerciseId);
      if (!nameByExId.has(ex.exerciseId)) nameByExId.set(ex.exerciseId, ex.exerciseName);
    }
  }

  const exerciseMaxes: BuddyCompareStats['exerciseMaxes'] = [];
  for (const exerciseId of seen) {
    const stat = computeSideStatForExercise(workouts, exerciseId);
    if (!stat) continue;
    const name = nameByExId.get(exerciseId) || exerciseId;
    // Prefer muscle group lookup by id, then by name (handles session workouts
    // where exerciseId is the host's, not the local library's id).
    const muscleGroup =
      groupByExId.get(exerciseId) ||
      groupByExName.get(name.trim().toLowerCase()) ||
      'other';
    exerciseMaxes.push({
      exerciseId,
      exerciseName: name,
      muscleGroup,
      maxWeight: stat.maxWeight,
      repsAtMax: stat.repsAtMax,
    });
  }

  // Recent workout summaries for buddy profile history view.
  const recent = [...workouts]
    .filter((w) => w.completed && w.type !== 'rest')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 20);
  const recentWorkouts: NonNullable<BuddyCompareStats['recentWorkouts']> = recent.map((w) => {
    let totalVolume = 0;
    const perEx: Array<{ name: string; setCount: number; maxWeight: number }> = [];
    for (const ex of w.exercises) {
      let setCount = 0;
      let maxWeight = 0;
      for (const s of ex.sets) {
        if (s.completed) {
          totalVolume += s.weight * s.reps;
          setCount++;
          if (s.weight > maxWeight) maxWeight = s.weight;
        }
      }
      if (setCount > 0) perEx.push({ name: ex.exerciseName, setCount, maxWeight });
    }
    // Firestore rejects `undefined` field values, so only include
    // `duration` when the workout has one.
    const summary: NonNullable<BuddyCompareStats['recentWorkouts']>[number] = {
      id: w.id,
      date: w.date,
      name: w.name,
      type: w.type,
      exerciseCount: w.exercises.length,
      totalVolume: Math.round(totalVolume),
      topExercises: perEx,
    };
    if (typeof w.duration === 'number') summary.duration = w.duration;
    return summary;
  });

  // Per-day activity volume for the last ~180 days. A small map (< 4KB
  // serialised even for a daily-lifter) the buddy profile heatmap can
  // render. Rest days are encoded as -1 so the consumer can tell them
  // apart from "no workout" days.
  const activityDays: Record<string, number> = {};
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 180);
  for (const w of workouts) {
    if (!w.completed) continue;
    const d = new Date(w.date);
    if (d < cutoff) continue;
    const ds = w.date.slice(0, 10);
    if (w.type === 'rest') {
      if (!(ds in activityDays)) activityDays[ds] = -1;
      continue;
    }
    let v = 0;
    for (const ex of w.exercises) {
      for (const s of ex.sets) if (s.completed) v += s.weight * s.reps;
    }
    activityDays[ds] = Math.max(activityDays[ds] || 0, 0) + v;
  }

  return {
    updatedAt: new Date().toISOString(),
    headline,
    muscleGroupVolumes,
    exerciseMaxes,
    recentWorkouts,
    activityDays,
  };
}

// ========== Profile-based comparison ==========

/**
 * Compute a comparison from two BuddyCompareStats snapshots (one per user).
 * Preferred over computeComparison when raw workout data isn't available
 * cross-user — the snapshots are stored on each user's public profile.
 */
export function computeComparisonFromStats(
  me: BuddyCompareStats,
  buddy: BuddyCompareStats,
): ComparisonResult {
  const headline = { me: me.headline, buddy: buddy.headline };

  // Match exercises by NAME (case-insensitive, trimmed) rather than by id.
  // Different users usually have different exerciseIds for the same exercise
  // (each created their own copy in their library), so id-matching treats
  // every shared exercise as an "exclusive" on both sides.
  const normName = (s: string) => s.trim().toLowerCase();
  const myByName = new Map<string, BuddyCompareStats['exerciseMaxes'][number]>();
  for (const e of me.exerciseMaxes) myByName.set(normName(e.exerciseName), e);
  const buddyByName = new Map<string, BuddyCompareStats['exerciseMaxes'][number]>();
  for (const e of buddy.exerciseMaxes) buddyByName.set(normName(e.exerciseName), e);

  const faceoffs: ExerciseFaceoff[] = [];
  for (const [key, myEx] of myByName) {
    const buddyEx = buddyByName.get(key);
    if (!buddyEx) continue;
    const meStat: SideStat = {
      maxWeight: myEx.maxWeight,
      repsAtMax: myEx.repsAtMax,
      est1RM: Math.round(myEx.maxWeight * (1 + myEx.repsAtMax / 30)),
    };
    const buddyStat: SideStat = {
      maxWeight: buddyEx.maxWeight,
      repsAtMax: buddyEx.repsAtMax,
      est1RM: Math.round(buddyEx.maxWeight * (1 + buddyEx.repsAtMax / 30)),
    };
    faceoffs.push({
      exerciseId: myEx.exerciseId,
      exerciseName: myEx.exerciseName || buddyEx.exerciseName,
      me: meStat,
      buddy: buddyStat,
      winner: compareSides(meStat, buddyStat),
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

  const exclusives: ExerciseExclusive[] = [];
  for (const [key, ex] of myByName) {
    if (buddyByName.has(key)) continue;
    exclusives.push({
      exerciseId: ex.exerciseId, exerciseName: ex.exerciseName, side: 'me',
      maxWeight: ex.maxWeight, repsAtMax: ex.repsAtMax,
    });
  }
  for (const [key, ex] of buddyByName) {
    if (myByName.has(key)) continue;
    exclusives.push({
      exerciseId: ex.exerciseId, exerciseName: ex.exerciseName, side: 'buddy',
      maxWeight: ex.maxWeight, repsAtMax: ex.repsAtMax,
    });
  }
  exclusives.sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));

  const allGroups = new Set<MuscleGroup>([
    ...Object.keys(me.muscleGroupVolumes) as MuscleGroup[],
    ...Object.keys(buddy.muscleGroupVolumes) as MuscleGroup[],
  ]);
  const muscleGroups: MuscleGroupFaceoff[] = [];
  for (const group of allGroups) {
    const meVolume = me.muscleGroupVolumes[group] || 0;
    const buddyVolume = buddy.muscleGroupVolumes[group] || 0;
    if (meVolume === 0 && buddyVolume === 0) continue;
    const total = meVolume + buddyVolume;
    const ratio = total > 0 ? Math.abs(meVolume - buddyVolume) / total : 0;
    const winner: 'me' | 'buddy' | 'tie' =
      ratio < 0.02 ? 'tie' : meVolume > buddyVolume ? 'me' : 'buddy';
    muscleGroups.push({ group, meVolume, buddyVolume, winner });
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
