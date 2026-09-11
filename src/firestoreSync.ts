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
  zenith_meals: 'meals',
  zenith_deload_weeks: 'deloadWeeks',
  zenith_level_seen: 'levelSeen',
  zenith_buddy_affinity: 'buddyAffinity',
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
// The workout log is rewritten on every set edit and is the largest document
// by far, so it waits a little longer for the typing to stop.
const DEBOUNCE_BY_KEY: Record<string, number> = { zenith_workouts: 2_500 };

/**
 * Per-key "when did this device last change or accept this value" — the
 * timestamps that decide who wins. Cleared with the rest of the user's local
 * data on sign-out, so a stamp can never speak for another account.
 *
 * Why timestamps and not size: comparing JSON lengths (the previous rule)
 * could not tell a deletion from a stale copy, so a workout removed on one
 * device came back from the other, and a fresh install's tiny placeholder
 * value ("1") out-voted the real cloud value ("7").
 */
const META_KEY = 'zenith_sync_meta';
type SyncMeta = Record<string, { updatedAt: string }>;
function readMeta(): SyncMeta {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}') as SyncMeta; } catch { return {}; }
}
function stamp(localKey: string, updatedAt: string): void {
  try {
    const meta = readMeta();
    meta[localKey] = { updatedAt };
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch { /* storage unavailable */ }
}
function stampOf(localKey: string): string | null {
  return readMeta()[localKey]?.updatedAt ?? null;
}

/** Returns true on successful write; false on any failure so the caller
 *  can decide whether to keep the entry in the pending queue for retry.
 *  `updatedAt` is the local EDIT time, so the cloud carries when the change
 *  happened rather than when it was uploaded. */
async function writeToFirestore(localStorageKey: string, value: unknown, updatedAt: string): Promise<boolean> {
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
    await setDoc(docRef, { value, updatedAt });
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

  stamp(localStorageKey, new Date().toISOString());
  pendingWrites.set(localStorageKey, value);
  scheduleWrite(localStorageKey, DEBOUNCE_BY_KEY[localStorageKey] ?? DEBOUNCE_MS);
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
      const ok = await writeToFirestore(localStorageKey, v, stampOf(localStorageKey) ?? new Date().toISOString());
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
      const ok = await writeToFirestore(k, v, stampOf(k) ?? new Date().toISOString());
      if (ok) pendingWrites.delete(k);
    }),
  );
}

/** Forget everything queued for the previous account. Called whenever the
 *  signed-in user changes, so a write can never land in the wrong account. */
function dropPendingWrites(): void {
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  debounceTimers.clear();
  pendingWrites.clear();
}

function switchUser(userId: string): void {
  if (currentUserId !== userId) dropPendingWrites();
  currentUserId = userId;
}

/**
 * Migrate existing localStorage data to Firestore on first login.
 * Returns true if migration happened, false if user already has cloud data.
 */
export async function migrateLocalStorageToFirestore(userId: string): Promise<boolean> {
  switchUser(userId);

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
        const updatedAt = new Date().toISOString();
        batch.set(docRef, { value, updatedAt });
        stamp(localKey, updatedAt);
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
 * Per key, the newer side wins by `updatedAt`: a local edit stamped after
 * the cloud copy is pushed straight up (bypassing the queue, which is
 * deliberately closed during a pull); anything else is taken from the cloud
 * and its stamp recorded, so the listener below knows not to re-apply it.
 * Local values from before stamps existed fall back to the old
 * longer-wins rule once, then carry a stamp like everything else.
 */
export async function pullFirestoreToLocalStorage(userId: string): Promise<void> {
  switchUser(userId);
  isSyncing = true;

  try {
    for (const [localKey, firestoreDoc] of Object.entries(STORAGE_TO_FIRESTORE)) {
      try {
        const docRef = doc(db, 'users', userId, 'data', firestoreDoc);
        const snap = await getDoc(docRef);
        if (!snap.exists()) {
          // Nothing in the cloud yet for a key this device has: push it.
          const existingRaw = localStorage.getItem(localKey);
          if (existingRaw) {
            const at = stampOf(localKey) ?? new Date().toISOString();
            stamp(localKey, at);
            await writeToFirestore(localKey, JSON.parse(existingRaw), at);
          }
          continue;
        }
        const data = snap.data();
        if (data.value === undefined) continue;
        const cloudAt = typeof data.updatedAt === 'string' ? data.updatedAt : '';

        const existingRaw = localStorage.getItem(localKey);
        if (existingRaw) {
          const localAt = stampOf(localKey);
          const cloudRaw = JSON.stringify(data.value);
          const localWins = localAt
            ? localAt > cloudAt
            // Pre-stamp local value: the old heuristic, one last time.
            : existingRaw !== cloudRaw && existingRaw.length > cloudRaw.length;
          if (localWins) {
            const at = localAt ?? new Date().toISOString();
            stamp(localKey, at);
            await writeToFirestore(localKey, JSON.parse(existingRaw), at);
            continue;
          }
        }
        localStorage.setItem(localKey, JSON.stringify(data.value));
        stamp(localKey, cloudAt);
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
  switchUser(userId);

  for (const [localKey, firestoreDoc] of Object.entries(STORAGE_TO_FIRESTORE)) {
    const docRef = doc(db, 'users', userId, 'data', firestoreDoc);
    const unsub = onSnapshot(docRef, (snap) => {
      if (isSyncing) return;
      if (snap.exists() && snap.metadata.hasPendingWrites === false) {
        const data = snap.data();
        if (data.value === undefined) return;
        // The first snapshot is always the current document, including what
        // this device just pulled or pushed; only something newer than our
        // stamp is a real remote change. This is what used to wipe a
        // local-only workout the moment the listener attached.
        const cloudAt = typeof data.updatedAt === 'string' ? data.updatedAt : '';
        const localAt = stampOf(localKey);
        if (localAt && cloudAt <= localAt) return;
        try {
          isSyncing = true;
          localStorage.setItem(localKey, JSON.stringify(data.value));
          stamp(localKey, cloudAt);
          onUpdate();
        } finally {
          isSyncing = false;
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
  if (!userId) {
    // Signed out: nothing queued may survive into whoever signs in next.
    teardownFirestoreListeners();
    dropPendingWrites();
    currentUserId = null;
    return;
  }
  switchUser(userId);
}
