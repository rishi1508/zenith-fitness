export interface Exercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  isCompound: boolean;
  /** Finer-grained bucket than isCompound — drives smart defaults like
   *  rest-timer length. If omitted we derive it from isCompound. */
  category?: ExerciseCategory;
  equipment?: ExerciseEquipment;
  /** PERSONAL notes — private to this user, never shared. */
  notes?: string;
  /** CREATOR notes — written by whoever created the exercise (or an
   *  admin) and shown to everyone who has it. Read-only for others. */
  sharedNotes?: string;
  videoUrl?: string; // YouTube or form guide link
  /** Metabolic cost of this movement, in METs, used to price the calories it
   *  burns (see src/energy.ts). Absent means "derive it from category and
   *  equipment" — only set this when the derived value is wrong. */
  met?: number;
  isFavorite?: boolean; // Mark as favorite for quick access
  /** uid of the user who created / owns the shared definition. Absent on
   *  the built-in seed until the shared library assigns one. */
  createdBy?: string;
  createdByName?: string;
  /** When this local exercise was matched to a shared one by NAME (the
   *  user had already created their own copy), the shared doc's id.
   *  Absent when the local id IS the shared id. */
  sharedId?: string;
}

export type ExerciseCategory = 'compound' | 'isolation' | 'cardio' | 'core' | 'other';
export const EXERCISE_CATEGORIES: readonly ExerciseCategory[] = ['compound', 'isolation', 'cardio', 'core', 'other'];

export type ExerciseEquipment =
  | 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'kettlebell' | 'band' | 'other';
export const EXERCISE_EQUIPMENT: readonly ExerciseEquipment[] =
  ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'other'];

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
export const MUSCLE_GROUPS: readonly MuscleGroup[] =
  ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core', 'full_body', 'other'];

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
  /** ISO time of the user's last interaction with this in-progress
   *  workout. Drives the idle auto-finish (see App.tsx). */
  lastActivityAt?: string;
  /** True when the app finished this workout itself after the user went
   *  idle, instead of the user tapping Finish. */
  autoCompleted?: boolean;
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
  /** Weekly N★ streak (weeks) at `streakLevel`. See streakService. */
  currentStreak: number;
  longestStreak: number;
  /** Days/week the shown streak is measured at (1–6). */
  streakLevel?: number;
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
    /** Days/week `currentStreak` is measured at. Absent on snapshots
     *  written by clients older than the N★ streak. */
    streakLevel?: number;
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
  /**
   * Compact per-day activity volume for the last ~180 days. Keyed by
   * YYYY-MM-DD. Powers the buddy-profile heatmap without requiring any
   * cross-user workout reads. 'rest' is a sentinel volume — negative so
   * the heatmap can distinguish a rest day from an inactive day.
   */
  activityDays?: Record<string, number>;
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
  /** Days/week `currentStreak` is measured at. Absent for legacy clients. */
  streakLevel?: number;
  /** Experience level from lifetime volume (src/levels.ts). */
  level?: number;
  /** Lifetime volume in kg, mirrored so a buddy's profile can show progress. */
  totalVolume?: number;
  isWorkingOut: boolean;
  activeWorkoutName?: string;
  activeWorkoutStartedAt?: string;
  compareStats?: BuddyCompareStats;
  /** Denormalised follow counts (src/followService.ts). */
  followerCount?: number;
  followingCount?: number;
  /** Badges earned, oldest first (src/badges.ts). Published so somebody
   *  else's profile can show them without reading private history. */
  badges?: Array<{ id: string; at: string }>;
  /** ISO timestamp of the last heartbeat from the user's app.
   *  Used to render the online/offline/busy dot on buddy avatars. */
  lastActive?: string;
  /** Cached pointer to the gym this user belongs to (member or staff),
   *  mirrored from gyms/{gymId}/members/{uid}. null once they leave.
   *  See GymContext in the Gym OS lite section below. */
  gym?: GymContext | null;
  /** Premium scaffolding (docs/REVAMP_SPEC.md §5) — no billing yet.
   *  'premium' here is what `resolveTier` treats as "paid". */
  subscriptionTier?: 'free' | 'premium';
  subscriptionSource?: 'purchase' | 'admin-grant';
  /** Set by the admin console's Grant/Revoke premium action alongside
   *  subscriptionTier/subscriptionSource. */
  premiumGrant?: boolean;
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
  /** The request this pair came from — the recipient's proof of consent.
   *  Written since 3.25.0; the security rule that requires it can only be
   *  tightened once older installs have updated (docs/AUDIT_2026-09-10.md). */
  requestId?: string;
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
  /** Map of emoji → array of uids who reacted with it. Stored inline on
   *  the message doc so reactions stream down with the same listener. */
  reactions?: Record<string, string[]>;
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
  /** ISO time of this participant's last interaction with their workout.
   *  The idle auto-finish only ends a group session once EVERY active
   *  participant has been idle past the threshold. */
  lastActiveAt?: string;
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
  /** Custom exercises created by ANY participant during this session.
   *  Other clients pick these up via the session listener and add them
   *  to their local library if they don't already have them, so the
   *  same exercise id is shared instead of everyone creating duplicates
   *  with the same name. */
  customExercises?: Exercise[];
  /** Live exercise template, mutated by the HOST as they
   *  add/remove/swap exercises or change set counts during the
   *  session. Initialised to a copy of templateExercises at create
   *  time. Non-host participants listen for changes here and
   *  reconcile their own workout: new exercises are added, removed
   *  exercises are dropped (only if the participant hasn't logged
   *  any sets on them), and set-count changes are propagated. The
   *  participant's own ad-hoc additions / their own set logs are
   *  never overwritten. */
  currentTemplateExercises?: TemplateExercise[];
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

// ============ APP SETTINGS ============

/** Preferences shared by every line chart in the app (exercise volume,
 *  body weight, …). Persisted under `zenith_settings` and synced. */
export interface ChartSettings {
  /** Draw the moving-average overlay line. */
  showMovingAverage: boolean;
  /** Draw the raw data-point series (line + dots). */
  showRawPoints: boolean;
  /** Trailing window for the moving average, in points (2–30). */
  movingAverageWindow: number;
}

export interface StreakSettings {
  /** Days per week the user has committed to train (1–6). `null` means
   *  "auto": derive from the active weekly plan's non-rest days, else 3. */
  commitment: number | null;
}

/** Misc UI preferences that don't warrant their own section. */
export interface UiSettings {
  /** "Get the app" web banner (src/shell/GetAppBanner.tsx) dismissed. */
  getAppBannerDismissed?: boolean;
}

/** Single persisted settings object. New preferences go here rather than
 *  in yet another top-level localStorage key. */
export interface AppSettings {
  chart: ChartSettings;
  streak: StreakSettings;
  ui: UiSettings;
}

// ============ GYM OS LITE (Tier A) ============
// See docs/GYM_TIER_A_SPEC.md §2. Gym data lives entirely in Firestore
// (src/gymService.ts) — no new localStorage keys. The only local trace
// is the cached `gym` pointer on UserProfile below.

export type GymRole = 'member' | 'trainer' | 'manager' | 'owner';
export type MembershipStatus = 'active' | 'expiring' | 'expired' | 'frozen' | 'none';
export type CheckinMethod = 'member-qr' | 'staff-qr' | 'code' | 'manual';
export type PaymentMethod = 'upi' | 'cash' | 'card' | 'other';

export interface GymPlan { id: string; name: string; months: number; price: number; active: boolean }

export interface Gym {
  id: string;
  name: string;
  logoUrl?: string;
  accentColor?: string;          // hex, applied to --accent when set
  address?: string;
  phone?: string;
  /** Where the gym physically is. Set by the owner from the front desk;
   *  poster-QR check-ins are only accepted within `geofenceM` of it. */
  location?: { lat: number; lng: number };
  /** Geofence radius in metres. Absent = DEFAULT_GEOFENCE_M (src/geo.ts). */
  geofenceM?: number;
  /** The gym's UPI id, used to build renewal payment links. */
  upiVpa?: string;
  ownerUid: string;
  staff: Record<string, Exclude<GymRole, 'member'>>;
  joinCode: string;              // 6 chars A–Z0–9, members enter this to join
  plans: GymPlan[];
  /** sha256(`${code}:${date}:${gymId}`) of today's 6-digit check-in code; members hash their input and compare. */
  dailyCodeHash?: string;
  dailyCodeDate?: string;        // YYYY-MM-DD local
  memberCount: number;           // denormalised, updated on add/remove
  createdAt: string;
  subscriptionStatus: 'pilot' | 'active' | 'lapsed';
  pilotEndsAt?: string;
  /** Internal admin note (AdminGymsView) — never shown to gym members. */
  notes?: string;
}

export interface GymMember {
  uid: string;                   // real auth uid, or `demo_<n>` for seeded members
  /** Join code presented when the member enrolled themselves (rules verify it). */
  joinCode?: string;
  name: string;
  phone?: string;
  email?: string;
  photoURL?: string | null;
  role: GymRole;
  joinedAt: string;
  planId?: string;
  planStart?: string;            // ISO date
  planEnd?: string;              // ISO date (exclusive end)
  frozen?: boolean;
  trainerUid?: string;
  notes?: string;
  lastCheckinAt?: string;
  lastWorkoutAt?: string;
  checkinCount30d?: number;      // denormalised by client on check-in
}

export interface GymPayment { id: string; uid: string; amount: number; method: PaymentMethod; paidAt: string; months: number; planId?: string; note?: string; recordedBy: string }
export interface GymCheckin { id: string; uid: string; at: string; date: string /* YYYY-MM-DD local */; method: CheckinMethod; byUid: string; codeHash?: string /* method 'code': sha256(code:date:gymId), checked by rules */; distanceM?: number /* method 'member-qr': metres from the gym when the phone checked in */ }
/** Per-day check-in aggregate (doc id = date), denormalised on each
 *  check-in so the dashboard can read ~30 docs instead of ~thousands of
 *  raw checkins. See docs/REVAMP_SPEC.md §7 R4. */
export interface GymDailyStat { date: string; count: number; hours: Record<string, number> }
export interface GymClass { id: string; name: string; weekday: number /* 0=Sun..6 */; startTime: string /* HH:mm */; durationMin: number; trainerUid?: string; capacity?: number /* undefined = uncapped */; active: boolean }
export interface GymClassSession { id: string /* `${classId}_${YYYY-MM-DD}` */; classId: string; date: string; enrolled: string[]; attended: string[] }
/**
 * One post in a gym's feed (docs/GYM_TIER_A_SPEC.md §9).
 *
 * Shaped after Strava's athlete posts: a piece of text that can carry an
 * attachment — a session, a personal record, an achievement, a photo — rather
 * than a separate feature per kind. Deliberately small: the image, when there
 * is one, lives in the post's `media` subcollection so listing the feed does
 * not pull megabytes of base64.
 */
export interface GymFeedPost {
  id: string;
  uid: string;
  name: string;
  photoURL?: string | null;
  at: string;                    // ISO
  date: string;                  // YYYY-MM-DD local
  kind: GymFeedKind;
  /** The member's own words. The only thing every post has. */
  text?: string;
  /** kind 'workout': the session summary, denormalised so the feed is one query. */
  workout?: GymFeedWorkout;
  /** kind 'pr': the lift that went up. */
  pr?: { exercise: string; weight: number; reps: number };
  /** kind 'achievement': a level, a streak star, a check-in milestone. */
  achievement?: { label: string; detail?: string };
  /** True when a `media/image` doc exists for this post. */
  hasImage?: boolean;
  /** uid → emoji. Rules let a member add or remove only their own key. */
  reactions?: Record<string, string>;
  /** Denormalised so the card can say "3 comments" without a second query. */
  commentCount?: number;
}

export type GymFeedKind = 'workout' | 'photo' | 'text' | 'pr' | 'achievement';

export interface GymFeedWorkout {
  name: string;
  sets: number;
  volumeKg: number;
  exercises?: number;
  durationMin?: number;
  /** Calories above resting, from src/energy.ts. */
  kcal?: number;
  /** How many personal records fell in that session. */
  prs?: number;
}

export interface GymFeedComment {
  id: string;
  uid: string;
  name: string;
  photoURL?: string | null;
  text: string;
  at: string;
}

export interface GymAnnouncement {
  id: string;
  text: string;
  audience: 'all' | { classId: string };
  byUid: string;
  byName: string;
  byPhotoURL?: string | null;
  at: string;
  /** True when a `media/image` doc hangs off this announcement — same shape
   *  as a feed post, so a notice can carry a poster or a photo of the board. */
  hasImage?: boolean;
}

/** Cached on userProfiles/{uid} so the app knows which gym to load on start. */
export interface GymContext { gymId: string; gymRole: GymRole; joinedAt: string }

/** Dashboard aggregate stats — computed client-side by gymStats.computeDashboard
 *  from data fetched once (members, last-30d checkins, last-90d payments,
 *  classes, last-7d sessions). See docs/GYM_TIER_A_SPEC.md §5. */
export interface DashboardStats {
  totalMembers: number;
  activeMembers: number;
  expiringIn7: number;
  expiringIn30: number;
  expired: number;
  frozen: number;
  checkinsToday: number;
  /** 30 entries, oldest first, ending today. */
  checkinsPerDay: Array<{ date: string; count: number }>;
  /** 24 hourly buckets (local hour-of-day), aggregated over the last 30 days. */
  checkinsPerHour: number[];
  /** Distinct uids with a check-in or workout in the last 7 days. */
  activeThisWeek: number;
  /** Joined >30d ago, no check-in/workout in 14d, not expired/frozen. */
  atRisk: GymMember[];
  /** Members whose plan has expired (and who aren't frozen), with days overdue. */
  duesOutstanding: Array<{ member: GymMember; daysOverdue: number }>;
  revenue30d: number;
  revenue90d: number;
  newMembers30d: number;
  /** Of members joined in the last 30d, the share (0–1) with ≥2 check-ins. */
  signupToActive: number;
  classFill: Array<{ cls: GymClass; avgEnrolled: number; avgAttended: number; capacity?: number }>;
}

// ===== Health management (docs/HEALTH_SPEC.md) =====

/** Nutrients per serving or per 100 g. kcal + macros in grams; sodium in mg. */
export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
}

/** ifct = IFCT 2017 (NIN), usda = USDA FoodData Central, dish = curated Indian dish
 *  (approximate), off = Open Food Facts barcode, user = created in-app (sharedFoods). */
export type FoodSource = 'ifct' | 'usda' | 'dish' | 'off' | 'user';

/** A household measure for a food: `{ label: 'katori', grams: 150 }`. Grams is always implicit. */
export interface FoodUnit {
  label: string;
  grams: number;
}

export interface FoodItem {
  id: string;
  name: string;
  /** `ml` for drinks: `per100g` is then per 100 ml and every amount for this
   *  food is labelled in millilitres. Absent means grams. */
  basis?: 'g' | 'ml';
  aliases?: string[];
  source: FoodSource;
  group?: string;
  brand?: string;
  barcode?: string;
  per100g: Macros;
  units: FoodUnit[];
  /** Curated dish or scan estimate — shown with an "approx." tag. */
  approx?: boolean;
  createdBy?: string;
  createdByName?: string;
  createdAt?: string;
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snacks';

/**
 * A set of foods logged together — "my usual breakfast". Saved from a day's
 * meal section and re-added in one tap. Private by default; publishing copies
 * it to `sharedMeals` for everyone (docs/HEALTH_SPEC.md §3).
 */
export interface SavedMeal {
  id: string;
  name: string;
  /** Diary entries minus their per-day identity (`id`, `at`, `meal`). */
  items: SavedMealItem[];
  kcal: number;
  createdBy?: string;
  createdByName?: string;
  createdAt: string;
  /** True once the user has published it to the shared library. */
  shared?: boolean;
}

export type SavedMealItem = Omit<FoodEntry, 'id' | 'at' | 'meal'>;

export interface FoodEntry {
  id: string;
  foodId: string;
  name: string;
  /** Copied from the food so the diary keeps saying "ml" for drinks. */
  basis?: 'g' | 'ml';
  source: FoodSource;
  meal: MealSlot;
  qty: number;
  unit: string;
  grams: number;
  macros: Macros;
  at: string; // ISO timestamp
  approx?: boolean;
}

/** One document per user per local day: users/{uid}/nutrition/{YYYY-MM-DD}. */
export interface NutritionDay {
  date: string; // YYYY-MM-DD local
  entries: FoodEntry[];
  waterMl: number;
  updatedAt: string;
}

export interface NutritionTargets {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  waterMl: number;
  mode: 'auto' | 'manual';
  updatedAt: string;
}

export interface ActivitySession {
  id: string;
  type: string;
  startAt: string;
  durationMin: number;
  kcal?: number;
  source: string;
}

/** One document per user per local day: users/{uid}/activity/{YYYY-MM-DD}. */
export interface ActivityDay {
  date: string;
  steps?: number;
  activeKcal?: number;
  totalKcal?: number;
  restingHr?: number;
  avgHr?: number;
  sleepMin?: number;
  sessions?: ActivitySession[];
  source: 'health-connect' | 'manual' | 'mixed';
  updatedAt: string;
}

export type PhaseGoal = 'bulk' | 'cut' | 'maintain';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very-active';

export interface HealthProfile {
  sex?: 'male' | 'female';
  heightCm?: number;
  birthYear?: number;
  activityLevel?: ActivityLevel;
}

export interface PhaseSettings {
  goal: PhaseGoal;
  /** Signed for bulk (+), cut (−); e.g. 0.25 = +0.25 % body weight per week. */
  targetRatePctPerWeek: number;
  startDate: string; // YYYY-MM-DD
  startWeightKg?: number;
}
