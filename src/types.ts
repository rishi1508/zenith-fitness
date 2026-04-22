export interface Exercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  isCompound: boolean;
  /** Finer-grained bucket than isCompound — drives smart defaults like
   *  rest-timer length. If omitted we derive it from isCompound. */
  category?: ExerciseCategory;
  notes?: string; // Personal notes: form cues, pain points, RPE targets
  videoUrl?: string; // YouTube or form guide link
  isFavorite?: boolean; // Mark as favorite for quick access
}

export type ExerciseCategory = 'compound' | 'isolation' | 'cardio' | 'core' | 'other';

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
  sessionId?: string; // set when this workout is part of a group session
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
  /** If this plan was imported from a sharedTemplates/{id} doc, record the
   *  source id so the Common Templates view can show "Remove" instead of
   *  "Add" and support one-click removal. */
  sourceTemplateId?: string;
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

/** Body-part circumference measurements (cm). All fields optional so the
 *  user can log whichever subset they care about. */
export type BodyMeasurementField =
  | 'chest' | 'waist' | 'hips' | 'leftArm' | 'rightArm'
  | 'leftThigh' | 'rightThigh' | 'leftCalf' | 'rightCalf' | 'neck' | 'shoulders';

export interface BodyMeasurementEntry {
  id: string;
  date: string; // ISO
  measurements: Partial<Record<BodyMeasurementField, number>>; // cm
  notes?: string;
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

// ============ BUDDY SYSTEM ============

/** Buddy comparison snapshot stored on the public profile so buddies can
 *  read it without needing cross-user access to raw workout data. */
export interface BuddyCompareStats {
  updatedAt: string; // ISO
  headline: {
    totalWorkouts: number;
    currentStreak: number;
    totalVolume: number;
    avgVolumePerSession: number;
  };
  // Per-muscle-group total volume (kg). Only includes groups with non-zero volume.
  muscleGroupVolumes: Partial<Record<MuscleGroup, number>>;
  // Per-exercise max lift (heavier weight wins; same-weight-more-reps wins).
  exerciseMaxes: Array<{
    exerciseId: string;
    exerciseName: string;
    muscleGroup: MuscleGroup;
    maxWeight: number;
    repsAtMax: number;
  }>;
  // Compact summaries of the 20 most recent completed workouts so buddies
  // can see workout history on the profile without cross-user data access.
  recentWorkouts?: Array<{
    id: string;
    date: string;
    name: string;
    type: WorkoutType;
    duration?: number;
    exerciseCount: number;
    totalVolume: number;
    topExercises: Array<{ name: string; setCount: number; maxWeight: number }>;
  }>;
}

/** Public user profile (searchable by other users) */
export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  joinedAt: string;
  totalWorkouts: number;
  currentStreak: number;
  isWorkingOut: boolean;
  activeWorkoutName?: string;
  activeWorkoutStartedAt?: string;
  compareStats?: BuddyCompareStats;
  /** ISO timestamp of the last heartbeat from the user's app.
   *  Used to render the online/offline/busy dot on buddy avatars. */
  lastActive?: string;
}

/** Buddy request between two users */
export interface BuddyRequest {
  id: string;
  fromUid: string;
  fromName: string;
  fromPhoto?: string | null;
  toUid: string;
  toName: string;
  toPhoto?: string | null;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}

/** Mutual buddy relationship */
export interface BuddyRelationship {
  id: string;
  users: [string, string];
  userNames: Record<string, string>;
  userPhotos: Record<string, string>;
  createdAt: string;
  chatId: string;
}

/** Chat message between buddies */
export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  type: 'text' | 'workout_invite' | 'workout_update';
  workoutData?: {
    workoutName?: string;
    exerciseCount?: number;
  };
}

/** In-app buddy notification */
export interface BuddyNotification {
  id: string;
  type: 'buddy_request' | 'buddy_accepted' | 'workout_started' | 'workout_invite' | 'session_invite' | 'chat_message';
  fromUid: string;
  fromName: string;
  message: string;
  createdAt: string;
  read: boolean;
  data?: Record<string, string>;
}

// ============ GROUP WORKOUT SESSIONS ============

export type SessionStatus = 'waiting' | 'active' | 'completed' | 'cancelled';
export type ParticipantStatus = 'invited' | 'joined' | 'active' | 'completed' | 'declined';

/** Summary of one participant in a group workout (stored in session doc). */
export interface SessionParticipant {
  uid: string;
  name: string;
  photoURL: string | null;
  status: ParticipantStatus;
  joinedAt?: string;
  completedAt?: string;
  totalVolume: number;
  completedSets: number;
  totalSets: number;
  currentExercise: string;
  duration?: number;
}

/** A group workout session (2-3 participants). */
export interface WorkoutSession {
  id: string;
  hostUid: string;
  hostName: string;
  status: SessionStatus;
  workoutName: string;
  workoutType: WorkoutType;
  templateExercises: TemplateExercise[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  participants: Record<string, SessionParticipant>;
}

/** Live exercise progress for a participant (separate doc for performance). */
export interface SessionProgress {
  exercises: WorkoutExercise[];
  lastUpdated: number;
}

/** Quick reaction during a live session. */
export interface SessionReaction {
  id: string;
  fromUid: string;
  fromName: string;
  emoji: string;
  timestamp: string;
}
