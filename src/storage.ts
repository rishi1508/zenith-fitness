import type { Workout, WorkoutTemplate, Exercise, PersonalRecord, UserStats } from './types';

const STORAGE_KEYS = {
  WORKOUTS: 'zenith_workouts',
  TEMPLATES: 'zenith_templates',
  EXERCISES: 'zenith_exercises',
  RECORDS: 'zenith_records',
  SETTINGS: 'zenith_settings',
};

// Generic storage helpers
function getItem<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function setItem<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('[Storage] Failed to save:', key, e);
    return false;
  }
}

// Workouts
export function getWorkouts(): Workout[] {
  return getItem<Workout[]>(STORAGE_KEYS.WORKOUTS, []);
}

export function saveWorkout(workout: Workout): void {
  const workouts = getWorkouts();
  const index = workouts.findIndex(w => w.id === workout.id);
  if (index >= 0) {
    workouts[index] = workout;
  } else {
    workouts.unshift(workout);
  }
  setItem(STORAGE_KEYS.WORKOUTS, workouts);
}

export function deleteWorkout(id: string): void {
  const workouts = getWorkouts().filter(w => w.id !== id);
  setItem(STORAGE_KEYS.WORKOUTS, workouts);
}

export function getWorkoutsByDate(date: string): Workout[] {
  return getWorkouts().filter(w => w.date.startsWith(date));
}

// Templates
export function getTemplates(): WorkoutTemplate[] {
  return getItem<WorkoutTemplate[]>(STORAGE_KEYS.TEMPLATES, defaultTemplates);
}

export function saveTemplate(template: WorkoutTemplate): void {
  const templates = getTemplates();
  const index = templates.findIndex(t => t.id === template.id);
  if (index >= 0) {
    templates[index] = template;
  } else {
    templates.push(template);
  }
  setItem(STORAGE_KEYS.TEMPLATES, templates);
}

export function deleteTemplate(id: string): void {
  const templates = getTemplates().filter(t => t.id !== id);
  setItem(STORAGE_KEYS.TEMPLATES, templates);
}

export function resetToDefaultTemplates(): void {
  setItem(STORAGE_KEYS.TEMPLATES, defaultTemplates);
}

export function getDefaultTemplateIds(): string[] {
  return defaultTemplates.map(t => t.id);
}

// Exercises
export function getExercises(): Exercise[] {
  return getItem<Exercise[]>(STORAGE_KEYS.EXERCISES, defaultExercises);
}

// Personal Records
export function getPersonalRecords(): PersonalRecord[] {
  return getItem<PersonalRecord[]>(STORAGE_KEYS.RECORDS, []);
}

export function checkAndUpdatePR(exerciseId: string, exerciseName: string, weight: number, reps: number): boolean {
  const records = getPersonalRecords();
  const existing = records.find(r => r.exerciseId === exerciseId);
  
  // Simple 1RM estimation: weight * (1 + reps/30)
  const estimated1RM = weight * (1 + reps / 30);
  const existingEstimated1RM = existing ? existing.weight * (1 + existing.reps / 30) : 0;
  
  if (estimated1RM > existingEstimated1RM) {
    const newRecord: PersonalRecord = {
      exerciseId,
      exerciseName,
      weight,
      reps,
      date: new Date().toISOString(),
    };
    
    if (existing) {
      const index = records.findIndex(r => r.exerciseId === exerciseId);
      records[index] = newRecord;
    } else {
      records.push(newRecord);
    }
    
    setItem(STORAGE_KEYS.RECORDS, records);
    return true;
  }
  
  return false;
}

// Stats
export function calculateStats(): UserStats {
  const allWorkouts = getWorkouts().filter(w => w.completed);
  const workoutOnly = allWorkouts.filter(w => w.type !== 'rest');
  
  if (workoutOnly.length === 0) {
    return {
      totalWorkouts: 0,
      currentStreak: 0,
      longestStreak: 0,
      thisWeekWorkouts: 0,
    };
  }
  
  // Sort by date descending
  const sorted = [...workoutOnly].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  
  // This week's workouts (excluding rest days)
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  
  const thisWeekWorkouts = sorted.filter(w => 
    new Date(w.date) >= weekStart
  ).length;
  
  // Calculate streaks (include rest days for continuity)
  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;
  
  // Include both workout AND rest days for streak calculation
  const activeDates = new Set(allWorkouts.map(w => w.date.split('T')[0]));
  const today = new Date().toISOString().split('T')[0];
  
  // Check current streak with iteration guard (max 1 year)
  let checkDate = new Date();
  let maxIterations = 365;
  while (maxIterations-- > 0) {
    const dateStr = checkDate.toISOString().split('T')[0];
    if (activeDates.has(dateStr)) {
      currentStreak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else if (dateStr === today) {
      // Today hasn't been worked out yet, check yesterday
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }
  
  // Calculate longest streak
  const allDates = Array.from(activeDates).sort();
  for (let i = 0; i < allDates.length; i++) {
    if (i === 0) {
      tempStreak = 1;
    } else {
      const prev = new Date(allDates[i - 1]);
      const curr = new Date(allDates[i]);
      const diffDays = Math.floor((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays === 1) {
        tempStreak++;
      } else {
        tempStreak = 1;
      }
    }
    longestStreak = Math.max(longestStreak, tempStreak);
  }
  
  return {
    totalWorkouts: workoutOnly.length,
    currentStreak,
    longestStreak,
    thisWeekWorkouts,
    lastWorkoutDate: sorted[0]?.date,
  };
}

// Default exercises for Rishi's workout style
const defaultExercises: Exercise[] = [
  // Chest
  { id: 'bench-press', name: 'Bench Press', muscleGroup: 'chest', isCompound: true },
  { id: 'incline-bench', name: 'Incline Bench Press', muscleGroup: 'chest', isCompound: true },
  { id: 'dumbbell-fly', name: 'Dumbbell Fly', muscleGroup: 'chest', isCompound: false },
  { id: 'cable-crossover', name: 'Cable Crossover', muscleGroup: 'chest', isCompound: false },
  { id: 'push-ups', name: 'Push-ups', muscleGroup: 'chest', isCompound: true },
  
  // Back
  { id: 'deadlift', name: 'Deadlift', muscleGroup: 'back', isCompound: true },
  { id: 'barbell-row', name: 'Barbell Row', muscleGroup: 'back', isCompound: true },
  { id: 'lat-pulldown', name: 'Lat Pulldown', muscleGroup: 'back', isCompound: true },
  { id: 'seated-row', name: 'Seated Cable Row', muscleGroup: 'back', isCompound: true },
  { id: 'pull-ups', name: 'Pull-ups', muscleGroup: 'back', isCompound: true },
  
  // Shoulders
  { id: 'ohp', name: 'Overhead Press', muscleGroup: 'shoulders', isCompound: true },
  { id: 'lateral-raise', name: 'Lateral Raise', muscleGroup: 'shoulders', isCompound: false },
  { id: 'front-raise', name: 'Front Raise', muscleGroup: 'shoulders', isCompound: false },
  { id: 'face-pull', name: 'Face Pull', muscleGroup: 'shoulders', isCompound: false },
  { id: 'reverse-fly', name: 'Reverse Fly', muscleGroup: 'shoulders', isCompound: false },
  
  // Biceps
  { id: 'barbell-curl', name: 'Barbell Curl', muscleGroup: 'biceps', isCompound: false },
  { id: 'dumbbell-curl', name: 'Dumbbell Curl', muscleGroup: 'biceps', isCompound: false },
  { id: 'hammer-curl', name: 'Hammer Curl', muscleGroup: 'biceps', isCompound: false },
  { id: 'preacher-curl', name: 'Preacher Curl', muscleGroup: 'biceps', isCompound: false },
  
  // Triceps
  { id: 'tricep-pushdown', name: 'Tricep Pushdown', muscleGroup: 'triceps', isCompound: false },
  { id: 'skull-crusher', name: 'Skull Crusher', muscleGroup: 'triceps', isCompound: false },
  { id: 'overhead-extension', name: 'Overhead Extension', muscleGroup: 'triceps', isCompound: false },
  { id: 'dips', name: 'Dips', muscleGroup: 'triceps', isCompound: true },
  
  // Legs
  { id: 'squat', name: 'Squat', muscleGroup: 'legs', isCompound: true },
  { id: 'leg-press', name: 'Leg Press', muscleGroup: 'legs', isCompound: true },
  { id: 'romanian-dl', name: 'Romanian Deadlift', muscleGroup: 'legs', isCompound: true },
  { id: 'leg-curl', name: 'Leg Curl', muscleGroup: 'legs', isCompound: false },
  { id: 'leg-extension', name: 'Leg Extension', muscleGroup: 'legs', isCompound: false },
  { id: 'calf-raise', name: 'Calf Raise', muscleGroup: 'legs', isCompound: false },
  { id: 'lunges', name: 'Lunges', muscleGroup: 'legs', isCompound: true },
  
  // Core
  { id: 'plank', name: 'Plank', muscleGroup: 'core', isCompound: false },
  { id: 'crunches', name: 'Crunches', muscleGroup: 'core', isCompound: false },
  { id: 'leg-raise', name: 'Hanging Leg Raise', muscleGroup: 'core', isCompound: false },
  { id: 'cable-crunch', name: 'Cable Crunch', muscleGroup: 'core', isCompound: false },
];

// Default templates based on Rishi's 4-day full body split
const defaultTemplates: WorkoutTemplate[] = [
  {
    id: 'day1-full-body',
    name: 'Day 1 - Full Body A',
    type: 'full_body',
    exercises: [
      { exerciseId: 'squat', exerciseName: 'Squat', defaultSets: 4, defaultReps: 8 },
      { exerciseId: 'bench-press', exerciseName: 'Bench Press', defaultSets: 4, defaultReps: 8 },
      { exerciseId: 'barbell-row', exerciseName: 'Barbell Row', defaultSets: 4, defaultReps: 8 },
      { exerciseId: 'ohp', exerciseName: 'Overhead Press', defaultSets: 3, defaultReps: 10 },
      { exerciseId: 'barbell-curl', exerciseName: 'Barbell Curl', defaultSets: 3, defaultReps: 12 },
      { exerciseId: 'tricep-pushdown', exerciseName: 'Tricep Pushdown', defaultSets: 3, defaultReps: 12 },
    ],
  },
  {
    id: 'day2-full-body',
    name: 'Day 2 - Full Body B',
    type: 'full_body',
    exercises: [
      { exerciseId: 'deadlift', exerciseName: 'Deadlift', defaultSets: 4, defaultReps: 6 },
      { exerciseId: 'incline-bench', exerciseName: 'Incline Bench Press', defaultSets: 4, defaultReps: 8 },
      { exerciseId: 'lat-pulldown', exerciseName: 'Lat Pulldown', defaultSets: 4, defaultReps: 10 },
      { exerciseId: 'lateral-raise', exerciseName: 'Lateral Raise', defaultSets: 3, defaultReps: 15 },
      { exerciseId: 'leg-curl', exerciseName: 'Leg Curl', defaultSets: 3, defaultReps: 12 },
      { exerciseId: 'calf-raise', exerciseName: 'Calf Raise', defaultSets: 4, defaultReps: 15 },
    ],
  },
  {
    id: 'day3-full-body',
    name: 'Day 3 - Full Body C',
    type: 'full_body',
    exercises: [
      { exerciseId: 'leg-press', exerciseName: 'Leg Press', defaultSets: 4, defaultReps: 10 },
      { exerciseId: 'dumbbell-fly', exerciseName: 'Dumbbell Fly', defaultSets: 3, defaultReps: 12 },
      { exerciseId: 'seated-row', exerciseName: 'Seated Cable Row', defaultSets: 4, defaultReps: 10 },
      { exerciseId: 'face-pull', exerciseName: 'Face Pull', defaultSets: 3, defaultReps: 15 },
      { exerciseId: 'hammer-curl', exerciseName: 'Hammer Curl', defaultSets: 3, defaultReps: 12 },
      { exerciseId: 'skull-crusher', exerciseName: 'Skull Crusher', defaultSets: 3, defaultReps: 12 },
    ],
  },
  {
    id: 'day4-full-body',
    name: 'Day 4 - Full Body D',
    type: 'full_body',
    exercises: [
      { exerciseId: 'romanian-dl', exerciseName: 'Romanian Deadlift', defaultSets: 4, defaultReps: 10 },
      { exerciseId: 'push-ups', exerciseName: 'Push-ups', defaultSets: 3, defaultReps: 15 },
      { exerciseId: 'pull-ups', exerciseName: 'Pull-ups', defaultSets: 4, defaultReps: 8 },
      { exerciseId: 'ohp', exerciseName: 'Overhead Press', defaultSets: 3, defaultReps: 10 },
      { exerciseId: 'leg-extension', exerciseName: 'Leg Extension', defaultSets: 3, defaultReps: 12 },
      { exerciseId: 'plank', exerciseName: 'Plank', defaultSets: 3, defaultReps: 60 },
    ],
  },
  {
    id: 'arms-weak',
    name: 'Day 5 - Arms & Weak Points',
    type: 'arms',
    exercises: [
      { exerciseId: 'barbell-curl', exerciseName: 'Barbell Curl', defaultSets: 4, defaultReps: 10 },
      { exerciseId: 'tricep-pushdown', exerciseName: 'Tricep Pushdown', defaultSets: 4, defaultReps: 10 },
      { exerciseId: 'hammer-curl', exerciseName: 'Hammer Curl', defaultSets: 3, defaultReps: 12 },
      { exerciseId: 'overhead-extension', exerciseName: 'Overhead Extension', defaultSets: 3, defaultReps: 12 },
      { exerciseId: 'preacher-curl', exerciseName: 'Preacher Curl', defaultSets: 3, defaultReps: 12 },
      { exerciseId: 'dips', exerciseName: 'Dips', defaultSets: 3, defaultReps: 10 },
    ],
  },
];
