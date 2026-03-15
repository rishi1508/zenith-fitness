import { doc, getDoc, setDoc, onSnapshot, writeBatch } from 'firebase/firestore';
import { db } from './firebase';

// Maps localStorage keys to Firestore document names under users/{uid}/data/
const STORAGE_TO_FIRESTORE: Record<string, string> = {
  zenith_workouts: 'workouts',
  zenith_templates: 'templates',
  zenith_exercises: 'exercises',
  zenith_records: 'records',
  zenith_settings: 'settings',
  zenith_last_template: 'lastTemplate',
  zenith_weekly_plans: 'weeklyPlans',
  zenith_active_plan: 'activePlan',
  zenith_last_day: 'lastDay',
  zenith_body_weight: 'bodyWeight',
  zenith_deload_weeks: 'deloadWeeks',
  zenith_prs: 'records',
  zenith_sound_settings: 'soundSettings',
  zenith_theme_settings: 'themeSettings',
  zenith_rest_presets: 'restPresets',
  zenith_volume_goals: 'volumeGoals',
};

// Debounce timers for fire-and-forget sync
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
let currentUserId: string | null = null;
let unsubscribers: (() => void)[] = [];

// Flag to prevent Firestore listener from writing back to localStorage during pull
let isSyncing = false;

/**
 * Queue a Firestore write (debounced, fire-and-forget).
 * Called from storage.ts after every localStorage write.
 */
export function queueFirestoreSync(localStorageKey: string, value: unknown): void {
  if (!currentUserId || isSyncing) return;
  const firestoreDoc = STORAGE_TO_FIRESTORE[localStorageKey];
  if (!firestoreDoc) return;

  // Debounce: wait 1s after last change before writing
  const existing = debounceTimers.get(localStorageKey);
  if (existing) clearTimeout(existing);

  const userId = currentUserId;
  debounceTimers.set(
    localStorageKey,
    setTimeout(async () => {
      debounceTimers.delete(localStorageKey);
      try {
        const docRef = doc(db, 'users', userId, 'data', firestoreDoc);
        await setDoc(docRef, { value, updatedAt: Date.now() });
      } catch (err) {
        console.error(`[FirestoreSync] Failed to sync ${localStorageKey}:`, err);
      }
    }, 1000)
  );
}

/**
 * Migrate existing localStorage data to Firestore on first login.
 * Returns true if migration happened, false if user already has cloud data.
 */
export async function migrateLocalStorageToFirestore(userId: string): Promise<boolean> {
  currentUserId = userId;

  // Check if user already has cloud data
  const profileRef = doc(db, 'users', userId, 'meta', 'profile');
  const profileSnap = await getDoc(profileRef);

  if (profileSnap.exists()) {
    // Returning user — don't migrate, caller should pull instead
    return false;
  }

  // First-time login: migrate localStorage to Firestore
  console.log('[FirestoreSync] First login — migrating localStorage to Firestore');

  const batch = writeBatch(db);

  // Write profile marker
  batch.set(profileRef, {
    migratedAt: Date.now(),
    migratedFrom: 'localStorage',
  });

  // Write each localStorage key to its Firestore doc
  for (const [localKey, firestoreDoc] of Object.entries(STORAGE_TO_FIRESTORE)) {
    try {
      const raw = localStorage.getItem(localKey);
      if (raw !== null) {
        const value = JSON.parse(raw);
        const docRef = doc(db, 'users', userId, 'data', firestoreDoc);
        batch.set(docRef, { value, updatedAt: Date.now() });
      }
    } catch {
      // Skip unparseable values
    }
  }

  await batch.commit();

  // Seed shared exercise library with this user's exercises
  try {
    const exercisesRaw = localStorage.getItem('zenith_exercises');
    if (exercisesRaw) {
      const exercises: Exercise[] = JSON.parse(exercisesRaw);
      const sharedRef = doc(db, SHARED_EXERCISES_DOC);
      const sharedSnap = await getDoc(sharedRef);
      const existing: Exercise[] = sharedSnap.exists() ? (sharedSnap.data().exercises || []) : [];
      const existingNames = new Set(existing.map(e => e.name.toLowerCase()));
      let added = 0;
      for (const ex of exercises) {
        if (!existingNames.has(ex.name.toLowerCase())) {
          existing.push(ex);
          existingNames.add(ex.name.toLowerCase());
          added++;
        }
      }
      if (added > 0) {
        await setDoc(sharedRef, { exercises: existing, updatedAt: Date.now() });
      }
    }
  } catch (err) {
    console.error('[FirestoreSync] Failed to seed shared library:', err);
  }

  console.log('[FirestoreSync] Migration complete');
  return true;
}

/**
 * Pull all Firestore data into localStorage (for returning users on new device).
 */
export async function pullFirestoreToLocalStorage(userId: string): Promise<void> {
  currentUserId = userId;
  isSyncing = true;

  try {
    for (const [localKey, firestoreDoc] of Object.entries(STORAGE_TO_FIRESTORE)) {
      try {
        const docRef = doc(db, 'users', userId, 'data', firestoreDoc);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data();
          if (data.value !== undefined) {
            localStorage.setItem(localKey, JSON.stringify(data.value));
          }
        }
      } catch (err) {
        console.error(`[FirestoreSync] Failed to pull ${firestoreDoc}:`, err);
      }
    }
    console.log('[FirestoreSync] Pulled cloud data to localStorage');
  } finally {
    isSyncing = false;
  }
}

/**
 * Set up real-time Firestore listeners for cross-device sync.
 */
export function setupFirestoreListeners(userId: string, onUpdate: () => void): void {
  // Clean up any existing listeners
  teardownFirestoreListeners();
  currentUserId = userId;

  for (const [localKey, firestoreDoc] of Object.entries(STORAGE_TO_FIRESTORE)) {
    const docRef = doc(db, 'users', userId, 'data', firestoreDoc);
    const unsub = onSnapshot(docRef, (snap) => {
      if (isSyncing) return;
      if (snap.exists() && snap.metadata.hasPendingWrites === false) {
        // This is a remote change, update localStorage
        const data = snap.data();
        if (data.value !== undefined) {
          try {
            isSyncing = true;
            localStorage.setItem(localKey, JSON.stringify(data.value));
            onUpdate();
          } finally {
            isSyncing = false;
          }
        }
      }
    });
    unsubscribers.push(unsub);
  }
}

/**
 * Clean up Firestore listeners.
 */
export function teardownFirestoreListeners(): void {
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers = [];
}

/**
 * Set the current user ID (called on auth state change).
 */
export function setCurrentUserId(userId: string | null): void {
  currentUserId = userId;
  if (!userId) {
    teardownFirestoreListeners();
  }
}

// ============ SHARED EXERCISE LIBRARY ============

import type { Exercise } from './types';

const SHARED_EXERCISES_DOC = 'shared/exerciseLibrary';

/**
 * Push a new exercise to the shared library (all users can see it).
 */
export async function addToSharedExerciseLibrary(exercise: Exercise): Promise<void> {
  try {
    const docRef = doc(db, SHARED_EXERCISES_DOC);
    const snap = await getDoc(docRef);
    const existing: Exercise[] = snap.exists() ? (snap.data().exercises || []) : [];

    // Deduplicate by name (case-insensitive)
    if (existing.some(e => e.name.toLowerCase() === exercise.name.toLowerCase())) {
      return; // Already exists
    }

    existing.push(exercise);
    await setDoc(docRef, { exercises: existing, updatedAt: Date.now() });
  } catch (err) {
    console.error('[FirestoreSync] Failed to add to shared library:', err);
  }
}

/**
 * Pull shared exercises and merge into localStorage (adds missing ones).
 * Returns the number of new exercises added.
 */
export async function pullSharedExercises(): Promise<number> {
  try {
    const docRef = doc(db, SHARED_EXERCISES_DOC);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return 0;

    const sharedExercises: Exercise[] = snap.data().exercises || [];
    const localRaw = localStorage.getItem('zenith_exercises');
    const localExercises: Exercise[] = localRaw ? JSON.parse(localRaw) : [];
    const localNames = new Set(localExercises.map(e => e.name.toLowerCase()));

    let added = 0;
    for (const ex of sharedExercises) {
      if (!localNames.has(ex.name.toLowerCase())) {
        localExercises.push(ex);
        localNames.add(ex.name.toLowerCase());
        added++;
      }
    }

    if (added > 0) {
      localStorage.setItem('zenith_exercises', JSON.stringify(localExercises));
    }
    return added;
  } catch (err) {
    console.error('[FirestoreSync] Failed to pull shared exercises:', err);
    return 0;
  }
}
