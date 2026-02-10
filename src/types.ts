export interface Exercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  isCompound: boolean;
  notes?: string; // Personal notes: form cues, pain points, RPE targets
  videoUrl?: string; // YouTube or form guide link
}

export type MuscleGroup = 
  | 'chest' 
  | 'back' 
  | 'shoulders' 
  | 'biceps' 
  | 'triceps' 
  | 'legs' 
  | 'core' 
  | 'full_body'
  | 'other';

export interface WorkoutSet {
  id: string;
  reps: number;
  weight: number; // in kg
  completed: boolean;
  rpe?: number; // Rate of Perceived Exertion 1-10
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  exerciseName: string;
  sets: WorkoutSet[];
  notes?: string;
  supersetGroup?: string; // e.g., "A", "B", "C" - exercises with same group are supersets
}

export interface Workout {
  id: string;
  date: string; // ISO date string
  name: string;
  type: WorkoutType;
  exercises: WorkoutExercise[];
  duration?: number; // in minutes
  notes?: string;
  completed: boolean;
  startedAt?: string;
  completedAt?: string;
}

export type WorkoutType = 
  | 'full_body' 
  | 'upper' 
  | 'lower' 
  | 'push' 
  | 'pull' 
  | 'arms' 
  | 'custom'
  | 'rest'
  | 'imported';

export interface TemplateExercise {
  exerciseId: string;
  exerciseName: string;
  defaultSets: number;
  defaultReps: number;
  supersetGroup?: string; // e.g., "A", "B", "C" - exercises with same group are supersets
}

// A single day's workout within a weekly plan
export interface DayPlan {
  dayNumber: number; // 1-7
  name: string; // e.g., "Day 1 - Full Body" or "Arms Day"
  exercises: TemplateExercise[];
  isRestDay?: boolean;
}

// Weekly workout plan (the TEMPLATE)
export interface WeeklyPlan {
  id: string;
  name: string; // e.g., "4 Full Body + 1 Arms", "Push/Pull/Legs"
  days: DayPlan[];
  isCustom?: boolean;
  isImported?: boolean;
}

// Legacy - kept for backward compatibility, represents a single day workout
export interface WorkoutTemplate {
  id: string;
  name: string;
  type: WorkoutType;
  exercises: TemplateExercise[];
  dayOfWeek?: number; // 0-6, Sunday-Saturday
  isCustom?: boolean; // true for user-created templates
  weeklyPlanId?: string; // Link to parent weekly plan
}

export interface UserStats {
  totalWorkouts: number;
  currentStreak: number;
  longestStreak: number;
  thisWeekWorkouts: number;
  lastWorkoutDate?: string;
  totalVolume: number;        // Total weight lifted all time
  avgVolumePerSession: number; // Average volume per workout
}

export interface PersonalRecord {
  exerciseId: string;
  exerciseName: string;
  weight: number;
  reps: number;
  date: string;
}

// Body weight tracking for body composition goals
export interface BodyWeightEntry {
  id: string;
  date: string; // ISO date string
  weight: number; // in kg
  notes?: string; // e.g., "morning weight", "after workout", "bloated"
}

// Weekly volume goals per muscle group
export interface VolumeGoal {
  muscleGroup: MuscleGroup;
  targetSets: number; // Weekly target sets
  enabled: boolean;
}

export interface WeeklyVolumeProgress {
  muscleGroup: MuscleGroup;
  targetSets: number;
  completedSets: number;
  percentComplete: number;
}
