import type { Workout, WorkoutTemplate, Exercise, PersonalRecord, UserStats, WorkoutSet } from './types';

const STORAGE_KEYS = {
  WORKOUTS: 'zenith_workouts',
  TEMPLATES: 'zenith_templates',
  EXERCISES: 'zenith_exercises',
  RECORDS: 'zenith_records',
  SETTINGS: 'zenith_settings',
  LAST_TEMPLATE: 'zenith_last_template',
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

// Last Used Template
export function getLastUsedTemplateId(): string | null {
  return getItem<string | null>(STORAGE_KEYS.LAST_TEMPLATE, null);
}

export function setLastUsedTemplateId(templateId: string): void {
  setItem(STORAGE_KEYS.LAST_TEMPLATE, templateId);
}

// Missing Days Detection
export function getMissingDays(): string[] {
  const workouts = getWorkouts();
  if (workouts.length === 0) return [];
  
  // Find the most recent activity date
  const sortedDates = workouts
    .map(w => w.date.split('T')[0])
    .sort()
    .reverse();
  
  const lastActivityDate = new Date(sortedDates[0]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Get all logged dates (as YYYY-MM-DD strings)
  const loggedDates = new Set(sortedDates);
  
  // Find missing days between last activity and yesterday (not today - user might workout later)
  const missingDays: string[] = [];
  const checkDate = new Date(lastActivityDate);
  checkDate.setDate(checkDate.getDate() + 1); // Start from day after last activity
  
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  while (checkDate <= yesterday) {
    const dateStr = checkDate.toISOString().split('T')[0];
    if (!loggedDates.has(dateStr)) {
      missingDays.push(dateStr);
    }
    checkDate.setDate(checkDate.getDate() + 1);
  }
  
  return missingDays;
}

export function backfillRestDays(dates: string[]): void {
  dates.forEach(dateStr => {
    const restWorkout: Workout = {
      id: crypto.randomUUID(),
      date: new Date(dateStr + 'T12:00:00').toISOString(),
      name: 'Rest Day',
      type: 'rest',
      exercises: [],
      completed: true,
      completedAt: new Date(dateStr + 'T12:00:00').toISOString(),
    };
    saveWorkout(restWorkout);
  });
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
      totalVolume: 0,
      avgVolumePerSession: 0,
    };
  }
  
  // Calculate total volume
  const totalVolume = workoutOnly.reduce((total, workout) => {
    return total + workout.exercises.reduce((exTotal, exercise) => {
      return exTotal + exercise.sets.reduce((setTotal, set) => {
        if (set.completed && set.weight > 0 && set.reps > 0) {
          return setTotal + (set.weight * set.reps);
        }
        return setTotal;
      }, 0);
    }, 0);
  }, 0);
  
  const avgVolumePerSession = workoutOnly.length > 0 ? Math.round(totalVolume / workoutOnly.length) : 0;
  
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
    totalVolume,
    avgVolumePerSession,
  };
}

// Google Sheets Import
// Expected format: Date, Exercise, Set1 Reps, Set1 Weight, Set2 Reps, Set2 Weight, Set3 Reps, Set3 Weight, Volume
// Date format: DD-MMM-YY (e.g., 31-Jan-26)

export interface ImportResult {
  success: boolean;
  workoutsImported: number;
  exercisesFound: number;
  errors: string[];
}

export async function importFromGoogleSheetsUrl(url: string): Promise<ImportResult> {
  const errors: string[] = [];
  
  try {
    // Convert Google Sheets URL to CSV export URL
    // From: https://docs.google.com/spreadsheets/d/SHEET_ID/edit...
    // To: https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=csv
    const sheetIdMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch) {
      return { success: false, workoutsImported: 0, exercisesFound: 0, errors: ['Invalid Google Sheets URL'] };
    }
    
    const sheetId = sheetIdMatch[1];
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    
    const response = await fetch(csvUrl);
    if (!response.ok) {
      return { success: false, workoutsImported: 0, exercisesFound: 0, errors: ['Failed to fetch sheet. Make sure it\'s publicly accessible (Anyone with link can view).'] };
    }
    
    const csvText = await response.text();
    return importFromCSV(csvText);
  } catch (e) {
    errors.push(`Network error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    return { success: false, workoutsImported: 0, exercisesFound: 0, errors };
  }
}

export function importFromCSV(csvText: string): ImportResult {
  const errors: string[] = [];
  const lines = csvText.split('\n').map(line => line.trim()).filter(line => line);
  
  if (lines.length < 2) {
    return { success: false, workoutsImported: 0, exercisesFound: 0, errors: ['CSV has no data rows'] };
  }
  
  // Skip header row
  const dataLines = lines.slice(1);
  
  // Group rows by date (multiple exercises per workout)
  const workoutsByDate = new Map<string, { date: Date; exercises: Map<string, { sets: WorkoutSet[] }> }>();
  const exercisesFound = new Set<string>();
  
  for (const line of dataLines) {
    // Parse CSV (handle quoted values)
    const values = parseCSVLine(line);
    if (values.length < 8) {
      errors.push(`Skipping malformed row: ${line.substring(0, 50)}...`);
      continue;
    }
    
    const [dateStr, exerciseName, set1Reps, set1Weight, set2Reps, set2Weight, set3Reps, set3Weight] = values;
    
    // Parse date (DD-MMM-YY format like "31-Jan-26")
    const date = parseDateString(dateStr);
    if (!date) {
      errors.push(`Invalid date format: ${dateStr}`);
      continue;
    }
    
    const dateKey = date.toISOString().split('T')[0];
    exercisesFound.add(exerciseName);
    
    // Create or get workout for this date
    if (!workoutsByDate.has(dateKey)) {
      workoutsByDate.set(dateKey, { date, exercises: new Map() });
    }
    
    const workout = workoutsByDate.get(dateKey)!;
    
    // Create or get exercise
    if (!workout.exercises.has(exerciseName)) {
      workout.exercises.set(exerciseName, { sets: [] });
    }
    
    const exercise = workout.exercises.get(exerciseName)!;
    
    // Add sets (only if they have data)
    const addSet = (repsStr: string, weightStr: string) => {
      const reps = parseInt(repsStr) || 0;
      const weight = parseFloat(weightStr) || 0;
      if (reps > 0 || weight > 0) {
        exercise.sets.push({
          id: crypto.randomUUID(),
          reps,
          weight,
          completed: true,
        });
      }
    };
    
    addSet(set1Reps, set1Weight);
    addSet(set2Reps, set2Weight);
    addSet(set3Reps, set3Weight);
  }
  
  // Convert to Workout objects and save
  const existingWorkouts = getWorkouts();
  const existingDates = new Set(existingWorkouts.map(w => w.date.split('T')[0]));
  let importedCount = 0;
  
  for (const [dateKey, workoutData] of workoutsByDate) {
    // Skip if workout already exists for this date
    if (existingDates.has(dateKey)) {
      errors.push(`Skipping ${dateKey}: workout already exists`);
      continue;
    }
    
    const exercises = Array.from(workoutData.exercises.entries()).map(([name, data]) => ({
      id: crypto.randomUUID(),
      exerciseId: name.toLowerCase().replace(/\s+/g, '-'),
      exerciseName: name,
      sets: data.sets,
    }));
    
    if (exercises.length === 0) continue;
    
    const workout: Workout = {
      id: crypto.randomUUID(),
      date: workoutData.date.toISOString(),
      name: `Imported Workout`,
      type: 'imported',
      exercises,
      completed: true,
      completedAt: workoutData.date.toISOString(),
    };
    
    saveWorkout(workout);
    importedCount++;
    
    // Update PRs for imported exercises
    for (const ex of exercises) {
      for (const set of ex.sets) {
        if (set.weight > 0 && set.reps > 0) {
          checkAndUpdatePR(ex.exerciseId, ex.exerciseName, set.weight, set.reps);
        }
      }
    }
  }
  
  return {
    success: importedCount > 0 || errors.length === 0,
    workoutsImported: importedCount,
    exercisesFound: exercisesFound.size,
    errors,
  };
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  
  return values;
}

function parseDateString(dateStr: string): Date | null {
  // Handle DD-MMM-YY format (e.g., "31-Jan-26")
  const match = dateStr.match(/^(\d{1,2})-(\w{3})-(\d{2})$/);
  if (match) {
    const [, day, monthStr, year] = match;
    const months: Record<string, number> = {
      'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
      'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    };
    const month = months[monthStr];
    if (month !== undefined) {
      const fullYear = 2000 + parseInt(year);
      return new Date(fullYear, month, parseInt(day));
    }
  }
  
  // Try standard date parsing as fallback
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// Export workouts to CSV (for manual Google Sheets paste)
export function exportToCSV(): string {
  const workouts = getWorkouts().filter(w => w.completed && w.type !== 'rest');
  const rows: string[] = ['Date,Exercise,Set 1 Reps,Set 1 Weight,Set 2 Reps,Set 2 Weight,Set 3 Reps,Set 3 Weight,Volume'];
  
  for (const workout of workouts.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())) {
    for (const exercise of workout.exercises) {
      const date = new Date(workout.date);
      const dateStr = `${date.getDate()}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][date.getMonth()]}-${String(date.getFullYear()).slice(-2)}`;
      
      const sets = exercise.sets.filter(s => s.completed);
      const volume = sets.reduce((sum, s) => sum + (s.weight * s.reps), 0);
      
      const row = [
        dateStr,
        exercise.exerciseName,
        sets[0]?.reps || '',
        sets[0]?.weight || '',
        sets[1]?.reps || '',
        sets[1]?.weight || '',
        sets[2]?.reps || '',
        sets[2]?.weight || '',
        volume || '',
      ];
      
      rows.push(row.join(','));
    }
  }
  
  return rows.join('\n');
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
