import type { Workout, WorkoutTemplate, Exercise, PersonalRecord, UserStats, WorkoutSet, WeeklyPlan, DayPlan, BodyWeightEntry } from './types';

const STORAGE_KEYS = {
  WORKOUTS: 'zenith_workouts',
  TEMPLATES: 'zenith_templates',
  EXERCISES: 'zenith_exercises',
  RECORDS: 'zenith_records',
  SETTINGS: 'zenith_settings',
  LAST_TEMPLATE: 'zenith_last_template',
  WEEKLY_PLANS: 'zenith_weekly_plans',
  ACTIVE_PLAN: 'zenith_active_plan',
  LAST_DAY: 'zenith_last_day', // Last used day number in active plan
  BODY_WEIGHT: 'zenith_body_weight', // Body weight tracking entries
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

// ============ WEEKLY PLANS ============

// Get all weekly plans
export function getWeeklyPlans(): WeeklyPlan[] {
  return getItem<WeeklyPlan[]>(STORAGE_KEYS.WEEKLY_PLANS, [defaultWeeklyPlan]);
}

// Save a weekly plan
export function saveWeeklyPlan(plan: WeeklyPlan): void {
  const plans = getWeeklyPlans();
  const index = plans.findIndex(p => p.id === plan.id);
  if (index >= 0) {
    plans[index] = plan;
  } else {
    plans.push(plan);
  }
  setItem(STORAGE_KEYS.WEEKLY_PLANS, plans);
}

// Delete a weekly plan
export function deleteWeeklyPlan(id: string): void {
  const plans = getWeeklyPlans().filter(p => p.id !== id);
  setItem(STORAGE_KEYS.WEEKLY_PLANS, plans);
  // If deleted plan was active, switch to first available
  if (getActivePlanId() === id && plans.length > 0) {
    setActivePlanId(plans[0].id);
  }
}

// Get/Set active plan
export function getActivePlanId(): string | null {
  return getItem<string | null>(STORAGE_KEYS.ACTIVE_PLAN, 'default_plan');
}

export function setActivePlanId(planId: string): void {
  setItem(STORAGE_KEYS.ACTIVE_PLAN, planId);
}

export function getActivePlan(): WeeklyPlan | null {
  const planId = getActivePlanId();
  if (!planId) return null;
  return getWeeklyPlans().find(p => p.id === planId) || null;
}

// Get/Set last used day
export function getLastUsedDay(): number | null {
  return getItem<number | null>(STORAGE_KEYS.LAST_DAY, null);
}

export function setLastUsedDay(dayNumber: number): void {
  setItem(STORAGE_KEYS.LAST_DAY, dayNumber);
}

// Default weekly plan (4 Full Body + 1 Arms)
const defaultWeeklyPlan: WeeklyPlan = {
  id: 'default_plan',
  name: 'Sample Weekly Plan',
  days: [
    {
      dayNumber: 1,
      name: 'Day 1 - Full Body',
      exercises: [
        { exerciseId: 'lat_pulldown', exerciseName: 'Lat Pulldown', defaultSets: 3, defaultReps: 10 },
        { exerciseId: 'bench_press', exerciseName: 'Bench Press', defaultSets: 3, defaultReps: 10 },
        { exerciseId: 'leg_press', exerciseName: 'Leg Press', defaultSets: 3, defaultReps: 10 },
        { exerciseId: 'shoulder_press', exerciseName: 'Shoulder Press', defaultSets: 3, defaultReps: 10 },
        { exerciseId: 'cable_crunch', exerciseName: 'Cable Crunch', defaultSets: 3, defaultReps: 15 },
      ],
    },
    {
      dayNumber: 2,
      name: 'Day 2 - Full Body',
      exercises: [
        { exerciseId: 'seated_row', exerciseName: 'Seated Row', defaultSets: 3, defaultReps: 10 },
        { exerciseId: 'incline_press', exerciseName: 'Incline Press', defaultSets: 3, defaultReps: 10 },
        { exerciseId: 'romanian_deadlift', exerciseName: 'Romanian Deadlift', defaultSets: 3, defaultReps: 10 },
        { exerciseId: 'lateral_raise', exerciseName: 'Lateral Raise', defaultSets: 3, defaultReps: 12 },
      ],
    },
    {
      dayNumber: 3,
      name: 'Day 3 - Full Body',
      exercises: [
        { exerciseId: 'lat_pulldown', exerciseName: 'Lat Pulldown', defaultSets: 3, defaultReps: 10 },
        { exerciseId: 'chest_fly', exerciseName: 'Chest Fly', defaultSets: 3, defaultReps: 12 },
        { exerciseId: 'leg_curl', exerciseName: 'Leg Curl', defaultSets: 3, defaultReps: 12 },
        { exerciseId: 'leg_extension', exerciseName: 'Leg Extension', defaultSets: 3, defaultReps: 12 },
      ],
    },
    {
      dayNumber: 4,
      name: 'Rest Day',
      exercises: [],
      isRestDay: true,
    },
    {
      dayNumber: 5,
      name: 'Day 5 - Full Body (Legs Focus)',
      exercises: [
        { exerciseId: 'leg_curl', exerciseName: 'Leg Curl', defaultSets: 3, defaultReps: 10 },
        { exerciseId: 'machine_squat', exerciseName: 'Machine Squat', defaultSets: 3, defaultReps: 10 },
        { exerciseId: 'cable_pec_fly', exerciseName: 'Cable Pec Fly', defaultSets: 3, defaultReps: 12 },
        { exerciseId: 'lat_pulldown', exerciseName: 'Lat Pulldown', defaultSets: 3, defaultReps: 10 },
        { exerciseId: 'calf_raise', exerciseName: 'Calf Raise', defaultSets: 3, defaultReps: 15 },
      ],
    },
    {
      dayNumber: 6,
      name: 'Day 6 - Arms',
      exercises: [
        { exerciseId: 'bicep_curls', exerciseName: 'Bicep Curls', defaultSets: 3, defaultReps: 12 },
        { exerciseId: 'tricep_pressdown', exerciseName: 'Tricep Pressdown', defaultSets: 3, defaultReps: 12 },
        { exerciseId: 'preacher_curl', exerciseName: 'Preacher Curl', defaultSets: 3, defaultReps: 10 },
        { exerciseId: 'tricep_kickback', exerciseName: 'Tricep Kickback', defaultSets: 3, defaultReps: 12 },
      ],
    },
    {
      dayNumber: 7,
      name: 'Rest Day',
      exercises: [],
      isRestDay: true,
    },
  ],
};

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

export function addCustomExercise(name: string, muscleGroup: string): Exercise {
  const exercises = getExercises();
  const newExercise: Exercise = {
    id: `custom_${Date.now()}`,
    name: name.trim(),
    muscleGroup: muscleGroup.toLowerCase().replace(' ', '_') as Exercise['muscleGroup'],
    isCompound: false, // Custom exercises default to isolation
  };
  exercises.push(newExercise);
  setItem(STORAGE_KEYS.EXERCISES, exercises);
  return newExercise;
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

// Get last session data for an exercise (for progressive overload tracking)
export function getLastExerciseSession(exerciseId: string, beforeDate?: string): WorkoutSet[] | null {
  const workouts = getWorkouts()
    .filter(w => w.completed && w.type !== 'rest')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  
  const cutoffDate = beforeDate ? new Date(beforeDate).getTime() : Date.now();
  
  for (const workout of workouts) {
    if (new Date(workout.date).getTime() >= cutoffDate) continue; // Skip today's or future workouts
    
    const exercise = workout.exercises.find(ex => ex.exerciseId === exerciseId);
    if (exercise && exercise.sets.some(s => s.completed)) {
      return exercise.sets.filter(s => s.completed);
    }
  }
  
  return null;
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
    // Extract sheet ID from URL
    const sheetIdMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch) {
      return { success: false, workoutsImported: 0, exercisesFound: 0, errors: ['Invalid Google Sheets URL'] };
    }
    
    const sheetId = sheetIdMatch[1];
    
    // Fetch all three sheets: Log Sheet, Exercise Data Transpose, Workout Plan
    const logSheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=Log%20Sheet`;
    const exerciseDataUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=Exercise%20Data%20Transpose`;
    const workoutPlanUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=Workout%20Plan`;
    
    // Step 1: Import exercises from Exercise Data Transpose sheet (first column has exercise names)
    try {
      const exerciseResponse = await fetch(exerciseDataUrl);
      if (exerciseResponse.ok) {
        const exerciseText = await exerciseResponse.text();
        importExercisesFromSheet(exerciseText, errors);
      } else {
        errors.push('Could not fetch Exercise Data sheet');
      }
    } catch (e) {
      errors.push('Error fetching Exercise Data sheet');
    }
    
    // Step 2: Import workout template from Workout Plan sheet
    try {
      const planResponse = await fetch(workoutPlanUrl);
      if (planResponse.ok) {
        const planText = await planResponse.text();
        importWorkoutPlanFromSheet(planText, errors);
      } else {
        errors.push('Could not fetch Workout Plan sheet');
      }
    } catch (e) {
      errors.push('Error fetching Workout Plan sheet');
    }
    
    // Step 3: Import workout history from Log Sheet
    const logResponse = await fetch(logSheetUrl);
    if (!logResponse.ok) {
      return { success: false, workoutsImported: 0, exercisesFound: 0, errors: ['Failed to fetch Log Sheet. Make sure it\'s publicly accessible.'] };
    }
    
    const csvText = await logResponse.text();
    return importFromCSV(csvText);
  } catch (e) {
    errors.push(`Network error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    return { success: false, workoutsImported: 0, exercisesFound: 0, errors };
  }
}

// Import exercises from Exercise Data Transpose sheet (first COLUMN contains exercise names)
function importExercisesFromSheet(csvText: string, _errors: string[]): void {
  const lines = csvText.split('\n').map(line => line.trim()).filter(line => line);
  if (lines.length < 2) return;
  
  const existingExercises = getExercises();
  const existingNames = new Set(existingExercises.map(e => e.name.toLowerCase()));
  
  let addedCount = 0;
  // Skip header row, each subsequent row has exercise name in first column
  for (let i = 1; i < lines.length; i++) {
    const rowValues = parseCSVLine(lines[i]);
    const name = rowValues[0]?.trim();
    if (name && !existingNames.has(name.toLowerCase())) {
      // Guess muscle group from exercise name
      const muscleGroup = guessMuscleGroup(name);
      const newExercise: Exercise = {
        id: `imported_${Date.now()}_${i}`,
        name,
        muscleGroup,
        isCompound: isCompoundExercise(name),
      };
      existingExercises.push(newExercise);
      existingNames.add(name.toLowerCase());
      addedCount++;
    }
  }
  
  if (addedCount > 0) {
    setItem(STORAGE_KEYS.EXERCISES, existingExercises);
  }
}

// Import workout template from Workout Plan sheet - creates a WeeklyPlan with separate days
function importWorkoutPlanFromSheet(csvText: string, _errors: string[]): void {
  const lines = csvText.split('\n').map(line => line.trim()).filter(line => line);
  if (lines.length < 2) return;
  
  // First row: Day 1, Day 2, Day 3, etc.
  const headerRow = parseCSVLine(lines[0]);
  const numDays = headerRow.length;
  const exercises = getExercises();
  
  // Initialize days array
  const days: DayPlan[] = [];
  for (let col = 0; col < numDays; col++) {
    const dayName = headerRow[col]?.trim() || `Day ${col + 1}`;
    days.push({
      dayNumber: col + 1,
      name: dayName,
      exercises: [],
      isRestDay: false,
    });
  }
  
  // Parse each row - each cell goes to its respective day
  for (let row = 1; row < lines.length; row++) {
    const rowValues = parseCSVLine(lines[row]);
    for (let col = 0; col < numDays; col++) {
      const exerciseName = rowValues[col]?.trim();
      if (exerciseName) {
        // Find matching exercise in database (case-insensitive)
        let exercise = exercises.find(e => 
          e.name.toLowerCase() === exerciseName.toLowerCase()
        );
        
        // If not found, try partial match
        if (!exercise) {
          exercise = exercises.find(e => 
            e.name.toLowerCase().includes(exerciseName.toLowerCase()) ||
            exerciseName.toLowerCase().includes(e.name.toLowerCase())
          );
        }
        
        if (exercise) {
          days[col].exercises.push({
            exerciseId: exercise.id,
            exerciseName: exercise.name,
            defaultSets: 3,
            defaultReps: 10,
          });
        } else {
          // Create exercise on the fly if not found
          const newExercise: Exercise = {
            id: `imported_${Date.now()}_${row}_${col}`,
            name: exerciseName,
            muscleGroup: guessMuscleGroup(exerciseName),
            isCompound: isCompoundExercise(exerciseName),
          };
          const allExercises = getExercises();
          allExercises.push(newExercise);
          setItem(STORAGE_KEYS.EXERCISES, allExercises);
          
          days[col].exercises.push({
            exerciseId: newExercise.id,
            exerciseName: newExercise.name,
            defaultSets: 3,
            defaultReps: 10,
          });
        }
      }
    }
  }
  
  // Mark days with no exercises as rest days
  for (const day of days) {
    if (day.exercises.length === 0) {
      day.isRestDay = true;
      day.name = `${day.name} (Rest)`;
    }
  }
  
  // Create the weekly plan
  const weeklyPlan: WeeklyPlan = {
    id: 'imported_plan',
    name: 'Imported Workout Plan',
    days,
    isCustom: false,
    isImported: true,
  };
  
  // Save or update the imported plan
  const plans = getWeeklyPlans();
  const existingIndex = plans.findIndex(p => p.id === 'imported_plan');
  if (existingIndex >= 0) {
    plans[existingIndex] = weeklyPlan;
  } else {
    plans.push(weeklyPlan);
  }
  setItem(STORAGE_KEYS.WEEKLY_PLANS, plans);
  
  // Set as active plan
  setActivePlanId('imported_plan');
}

// Helper to guess muscle group from exercise name
function guessMuscleGroup(name: string): Exercise['muscleGroup'] {
  const lower = name.toLowerCase();
  if (lower.includes('squat') || lower.includes('leg') || lower.includes('calf') || lower.includes('hip')) return 'legs';
  if (lower.includes('bench') || lower.includes('chest') || lower.includes('pec') || lower.includes('push')) return 'chest';
  if (lower.includes('row') || lower.includes('lat') || lower.includes('pull')) return 'back';
  if (lower.includes('shoulder') || lower.includes('delt') || lower.includes('lateral raise') || lower.includes('shrug')) return 'shoulders';
  if (lower.includes('curl') || lower.includes('bicep')) return 'biceps';
  if (lower.includes('tricep') || lower.includes('extension') || lower.includes('pressdown') || lower.includes('kickback')) return 'triceps';
  if (lower.includes('crunch') || lower.includes('ab') || lower.includes('leg raise')) return 'core';
  if (lower.includes('deadlift') || lower.includes('romanian')) return 'legs';
  return 'full_body';
}

// Helper to check if exercise is compound
function isCompoundExercise(name: string): boolean {
  const lower = name.toLowerCase();
  const compounds = ['squat', 'deadlift', 'bench', 'row', 'press', 'pull-up', 'pulldown', 'dip'];
  return compounds.some(c => lower.includes(c));
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
  let lastDate: Date | null = null; // Track last seen date for empty date rows
  
  for (const line of dataLines) {
    // Parse CSV (handle quoted values)
    const values = parseCSVLine(line);
    if (values.length < 8) {
      errors.push(`Skipping malformed row: ${line.substring(0, 50)}...`);
      continue;
    }
    
    const [dateStr, exerciseName, set1Reps, set1Weight, set2Reps, set2Weight, set3Reps, set3Weight] = values;
    
    // Handle empty date (means same workout as previous row)
    let date: Date | null = null;
    if (dateStr && dateStr.trim()) {
      date = parseDateString(dateStr);
      if (!date) {
        errors.push(`Invalid date format: ${dateStr}`);
        continue;
      }
      lastDate = date; // Remember this date for subsequent rows
    } else {
      // Empty date - use last seen date
      if (!lastDate) {
        errors.push(`Empty date with no previous date to reference`);
        continue;
      }
      date = lastDate;
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
    
    // Map exercise names to actual exercise IDs from database
    const allExercises = getExercises();
    const exercises = Array.from(workoutData.exercises.entries()).map(([name, data]) => {
      // Find exercise in database (case-insensitive, trim whitespace)
      const cleanName = name.trim();
      let exercise = allExercises.find(e => e.name.toLowerCase() === cleanName.toLowerCase());
      
      // If not found, try partial match
      if (!exercise) {
        exercise = allExercises.find(e => 
          e.name.toLowerCase().includes(cleanName.toLowerCase()) ||
          cleanName.toLowerCase().includes(e.name.toLowerCase())
        );
      }
      
      // If still not found, create it
      if (!exercise) {
        const newEx: Exercise = {
          id: `imported_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: cleanName,
          muscleGroup: guessMuscleGroup(cleanName),
          isCompound: isCompoundExercise(cleanName),
        };
        allExercises.push(newEx);
        setItem(STORAGE_KEYS.EXERCISES, allExercises);
        exercise = newEx;
      }
      
      return {
        id: crypto.randomUUID(),
        exerciseId: exercise.id, // Use actual exercise ID from database
        exerciseName: exercise.name, // Use consistent name from database
        sets: data.sets,
      };
    });
    
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

// =====================
// Body Weight Tracking
// =====================

// Get all body weight entries, sorted by date (newest first)
export function getBodyWeightEntries(): BodyWeightEntry[] {
  const entries = getItem<BodyWeightEntry[]>(STORAGE_KEYS.BODY_WEIGHT, []);
  return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// Add a new body weight entry
export function addBodyWeightEntry(weight: number, notes?: string, date?: string): BodyWeightEntry {
  const entry: BodyWeightEntry = {
    id: `bw_${Date.now()}`,
    date: date || new Date().toISOString().split('T')[0],
    weight,
    notes,
  };
  
  const entries = getBodyWeightEntries();
  
  // Check if there's already an entry for this date - replace it
  const existingIndex = entries.findIndex(e => e.date === entry.date);
  if (existingIndex >= 0) {
    entries[existingIndex] = entry;
  } else {
    entries.push(entry);
  }
  
  setItem(STORAGE_KEYS.BODY_WEIGHT, entries);
  return entry;
}

// Delete a body weight entry
export function deleteBodyWeightEntry(id: string): void {
  const entries = getBodyWeightEntries().filter(e => e.id !== id);
  setItem(STORAGE_KEYS.BODY_WEIGHT, entries);
}

// Get the latest body weight entry
export function getLatestBodyWeight(): BodyWeightEntry | null {
  const entries = getBodyWeightEntries();
  return entries.length > 0 ? entries[0] : null;
}

// Get body weight change over a period
export function getBodyWeightChange(days: number = 7): { change: number; startWeight: number; endWeight: number } | null {
  const entries = getBodyWeightEntries();
  if (entries.length < 2) return null;
  
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  
  // Latest weight
  const endWeight = entries[0].weight;
  
  // Find weight closest to (but before) the cutoff date
  const startEntry = entries.find(e => new Date(e.date) <= cutoffDate);
  if (!startEntry) return null;
  
  return {
    change: endWeight - startEntry.weight,
    startWeight: startEntry.weight,
    endWeight,
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
