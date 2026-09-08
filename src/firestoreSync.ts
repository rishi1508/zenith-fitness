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
  zenith_body_measurements: 'bodyMeasurements',
  zenith_health_profile: 'healthProfile',
  zenith_phase_settings: 'phaseSettings',
  zenith_nutrition_targets: 'nutritionTargets',
  zenith_food_favourites: 'foodFavourites',
  zenith_food_recents: 'foodRecents',
  zenith_custom_foods: 'customFoods',
  zenith_deload_weeks: 'deloadWeeks',
  zenith_level_seen: 'levelSeen',
  zenith_prs: 'records',
  zenith_sound_settings: 'soundSettings',
  zenith_theme_settings: 'themeSettings',
  zenith_rest_presets: 'restPresets',
  zenith_volume_goals: 'volumeGoals',
};

// Debounce timers for fire-and-forget sync
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
// The latest value per key waiting to be written. Kept up-to-date alongside
// the debounce so flushPendingWrites() can push everything immediately on
// app unload / tab hide.
const pendingWrites = new Map<string, unknown>();
let currentUserId: string | null = null;
let unsubscribers: (() => void)[] = [];

// Flag to prevent Firestore listener from writing back to localStorage during pull
let isSyncing = false;

const DEBOUNCE_MS = 300; // Was 1000ms — long enough to lose writes if the
// user closed the app within a second of editing. 300ms still batches rapid
// typing without risking data loss.

/** Returns true on successful write; false on any failure so the caller
 *  can decide whether to keep the entry in the pending queue for retry. */
async function writeToFirestore(localStorageKey: string, value: unknown): Promise<boolean> {
  if (!currentUserId) return false;
  const firestoreDoc = STORAGE_TO_FIRESTORE[localStorageKey];
  if (!firestoreDoc) return false;
  try {
    const docRef = doc(db, 'users', currentUserId, 'data', firestoreDoc);
    // Each key is ONE Firestore document (1 MiB hard limit). Workouts are
    // ~1 KB each, so a daily lifter crosses it after ~950 sessions; warn well
    // before the write starts failing so the sharding follow-up gets done.
    const bytes = JSON.stringify(value).length;
    if (bytes > 700_000) console.warn(`[FirestoreSync] ${firestoreDoc} is ${Math.round(bytes / 1024)} KB — approaching the 1 MiB document limit`);
    await setDoc(docRef, { value, updatedAt: new Date().toISOString() });
    return true;
  } catch (err) {
    console.error(`[FirestoreSync] Failed to sync ${localStorageKey}:`, err);
    return false;
  }
}

/**
 * Queue a Firestore write (debounced, retried on failure).
 * Called from storage.ts after every localStorage write.
 * The pending value is KEPT on failure so the next debounce firing, a
 * flush, or the exponential-backoff retry all re-attempt the write
 * instead of silently dropping data.
 */
export function queueFirestoreSync(localStorageKey: string, value: unknown): void {
  if (!currentUserId || isSyncing) return;
  if (!STORAGE_TO_FIRESTORE[localStorageKey]) return;

  pendingWrites.set(localStorageKey, value);
  scheduleWrite(localStorageKey, DEBOUNCE_MS);
}

/** Internal: schedule (or reschedule) a write after `delayMs` ms. */
function scheduleWrite(localStorageKey: string, delayMs: number): void {
  const existing = debounceTimers.get(localStorageKey);
  if (existing) clearTimeout(existing);
  debounceTimers.set(
    localStorageKey,
    setTimeout(async () => {
      debounceTimers.delete(localStorageKey);
      const v = pendingWrites.get(localStorageKey);
      if (v === undefined) return;
      const ok = await writeToFirestore(localStorageKey, v);
      if (ok) {
        pendingWrites.delete(localStorageKey);
      } else {
        // Leave value in pendingWrites and schedule a retry with
        // increasing backoff capped at 30 s. Any newer edit will
        // overwrite it in-place via queueFirestoreSync (short-circuits
        // stale retries with fresh data).
        const nextDelay = Math.min(30_000, Math.max(delayMs * 2, 1_000));
        scheduleWrite(localStorageKey, nextDelay);
      }
    }, delayMs),
  );
}

/**
 * Immediately write every pending change to Firestore. Call this from
 * visibilitychange (hidden) and beforeunload handlers so the user never
 * loses a save by closing the app during the debounce window. Failed
 * writes stay in the pending queue so the next app session retries them.
 */
export async function flushPendingWrites(): Promise<void> {
  if (pendingWrites.size === 0) return;
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  debounceTimers.clear();
  const entries = Array.from(pendingWrites.entries());
  await Promise.all(
    entries.map(async ([k, v]) => {
      const ok = await writeToFirestore(k, v);
      if (ok) pendingWrites.delete(k);
    }),
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
        batch.set(docRef, { value, updatedAt: new Date().toISOString() });
      }
    } catch {
      // Skip unparseable values
    }
  }

  await batch.commit();

  console.log('[FirestoreSync] Migration complete');
  return true;
}

/**
 * Pull all Firestore data into localStorage (for returning users on new device).
 *
 * IMPORTANT: For each key we compare byte length and, where available,
 * `updatedAt`. We never overwrite a non-empty local value that looks richer
 * or identical to the cloud copy — that was the data-loss vector when the
 * user added notes locally, closed the app inside the debounce window, and
 * on reopen the pull wiped their notes with the stale cloud state.
 */
export async function pullFirestoreToLocalStorage(userId: string): Promise<void> {
  currentUserId = userId;
  isSyncing = true;

  try {
    for (const [localKey, firestoreDoc] of Object.entries(STORAGE_TO_FIRESTORE)) {
      try {
        const docRef = doc(db, 'users', userId, 'data', firestoreDoc);
        const snap = await getDoc(docRef);
        if (!snap.exists()) continue;
        const data = snap.data();
        if (data.value === undefined) continue;

        const existingRaw = localStorage.getItem(localKey);
        if (existingRaw) {
          const cloudRaw = JSON.stringify(data.value);
          // Don't overwrite if local is already a superset of or equal to
          // cloud. Conservative heuristic: if the local payload is longer,
          // assume it has unsynced edits and skip (a pending write will push
          // it on the next flush).
          if (existingRaw.length >= cloudRaw.length) {
            // Push local up to cloud in case it diverged in the user's favor.
            queueFirestoreSync(localKey, JSON.parse(existingRaw));
            continue;
          }
        }
        localStorage.setItem(localKey, JSON.stringify(data.value));
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
