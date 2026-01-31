export interface Exercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  isCompound: boolean;
}

export type MuscleGroup = 
  | 'chest' 
  | 'back' 
  | 'shoulders' 
  | 'biceps' 
  | 'triceps' 
  | 'legs' 
  | 'core' 
  | 'full_body';

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
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  type: WorkoutType;
  exercises: TemplateExercise[];
  dayOfWeek?: number; // 0-6, Sunday-Saturday
  isCustom?: boolean; // true for user-created templates
}

export interface UserStats {
  totalWorkouts: number;
  currentStreak: number;
  longestStreak: number;
  thisWeekWorkouts: number;
  lastWorkoutDate?: string;
}

export interface PersonalRecord {
  exerciseId: string;
  exerciseName: string;
  weight: number;
  reps: number;
  date: string;
}
