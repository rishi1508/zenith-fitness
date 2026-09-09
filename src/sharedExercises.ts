import { collection, doc, onSnapshot, setDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { db, auth } from './firebase';
import * as storage from './storage';
import { isAdmin } from './admin';
import type { Exercise, ExerciseCategory, ExerciseEquipment, MuscleGroup } from './types';

/**
 * Shared exercise library — one Firestore document per exercise at
 * `sharedExercises/{id}`, owned by whoever created it.
 *
 * Replaces the old single `shared/exerciseLibrary` array document, which
 * any user could overwrite wholesale, had no notion of ownership, and was
 * merged with `local.notes ?? shared.notes` — so the first person to write
 * a note won forever and a creator's notes never reached anyone who had
 * their own. That merge also wrote straight to localStorage without
 * queuing a sync, and the per-user Firestore listener that attached right
 * after clobbered it. Net effect: notes were only ever visible to their
 * author.
 *
 * Model now:
 *   - `notes` on a local Exercise are PERSONAL and never leave the device.
 *   - `sharedNotes` are the CREATOR's notes; they live in the shared doc
 *     and are pushed to everyone via a live listener.
 *   - The creator (or an admin, see admin.ts) owns name / muscle group /
 *     category / equipment / creator notes / video. Everyone else gets
 *     those fields read-only and can only add personal notes + favourite.
 *   - Firestore's IndexedDB persistence is enabled, so a publish made
 *     offline is durable and lands when the device reconnects.
 */

export interface SharedExerciseDoc {
  id: string;
  name: string;
  /** exerciseNameKey(name) — for matching users' pre-existing copies. */
  nameKey: string;
  muscleGroup: MuscleGroup;
  category: ExerciseCategory;
  isCompound: boolean;
  equipment?: ExerciseEquipment;
  /** Metabolic equivalent, when the creator set one. Absent means every
   *  client derives it from the category (src/energy.ts). */
  met?: number;
  /** Creator notes. */
  notes?: string;
  videoUrl?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

const COLLECTION = 'sharedExercises';

/** Can `uid` change the shared definition of this exercise? Unowned local
 *  exercises (never published) are editable — publishing claims them. */
export function canEditShared(ex: Pick<Exercise, 'createdBy'>, uid: string | null | undefined): boolean {
  if (!uid) return !ex.createdBy;
  return !ex.createdBy || ex.createdBy === uid || isAdmin(uid);
}

function stripUndefined<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

/**
 * Publish (create or update) the shared definition of a local exercise.
 * No-op for guests and for exercises owned by someone else (unless admin).
 * The local copy is stamped with createdBy so later edits know who owns it.
 */
export async function publishExercise(ex: Exercise): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  if (!canEditShared(ex, user.uid)) return;

  const docId = ex.sharedId ?? ex.id;
  const createdBy = ex.createdBy ?? user.uid;
  const createdByName = ex.createdByName ?? user.displayName ?? undefined;
  const now = new Date().toISOString();
  const payload: Omit<SharedExerciseDoc, 'createdAt'> & { createdAt?: string } = stripUndefined({
    id: docId,
    name: ex.name,
    nameKey: storage.exerciseNameKey(ex.name),
    muscleGroup: ex.muscleGroup,
    category: ex.category ?? (ex.isCompound ? 'compound' : 'isolation'),
    isCompound: ex.isCompound,
    equipment: ex.equipment,
    met: ex.met,
    notes: ex.sharedNotes?.trim() || undefined,
    videoUrl: ex.videoUrl?.trim() || undefined,
    createdBy,
    createdByName,
    updatedAt: now,
  });
  // `merge` keeps createdAt from a previous publish; a brand-new doc gets
  // one now. Fields we deliberately cleared (notes/video) are removed via
  // an explicit null-free delete below.
  if (!ex.createdBy) payload.createdAt = now;

  if (ex.createdBy !== createdBy || ex.createdByName !== createdByName) {
    storage.updateExercise(ex.id, { createdBy, createdByName });
  }

  try {
    await setDoc(doc(db, COLLECTION, docId), payload, { merge: true });
    // merge:true can't unset a field; if the creator cleared their notes
    // or video, write the cleared shape explicitly.
    if (!payload.notes || !payload.videoUrl || payload.met === undefined) {
      const clear: Record<string, unknown> = {};
      if (!payload.notes) clear.notes = null;
      if (!payload.videoUrl) clear.videoUrl = null;
      if (payload.met === undefined) clear.met = null;
      await setDoc(doc(db, COLLECTION, docId), clear, { merge: true });
    }
  } catch (err) {
    console.error('[SharedExercises] publish failed:', err);
  }
}

/** Admin / creator: remove an exercise from the shared library. Local
 *  copies on other devices are left alone (their history references it). */
export async function deleteSharedExercise(ex: Exercise): Promise<void> {
  const user = auth.currentUser;
  if (!user || !canEditShared(ex, user.uid)) return;
  try {
    await deleteDoc(doc(db, COLLECTION, ex.sharedId ?? ex.id));
  } catch (err) {
    console.error('[SharedExercises] delete failed:', err);
  }
}

/** Admin console: one-shot fetch of every shared exercise, for
 *  AdminLibraryView's browse + delete list. Not a live listener — the
 *  screen is opened rarely and the only action is delete. */
export async function listAllSharedExercises(): Promise<SharedExerciseDoc[]> {
  const snap = await getDocs(collection(db, COLLECTION));
  return snap.docs.map((d) => d.data() as SharedExerciseDoc);
}

/** Admin console: remove any shared exercise by id (firestore.rules
 *  restricts this to the creator or an admin; AdminLibraryView is
 *  admin-only, so no ownership check is needed here). */
export async function deleteSharedExerciseById(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}

/**
 * Merge the shared library into the local one. Pure, so it can be tested.
 *
 *   - Shared exercise with no local match → added locally with the SAME id.
 *   - Match by id, then by sharedId, then by name key.
 *   - If I created it (the shared doc says so, OR my local copy already
 *     carries my uid — e.g. a same-named exercise someone else also
 *     created), my local copy is the source of truth → untouched
 *     (except stamping createdBy if missing).
 *   - Otherwise the shared definition wins for name (same-id only),
 *     muscle group, category, equipment, creator notes and video. Personal
 *     notes and favourite are never touched — except that a personal note
 *     identical to the creator note is dropped, so users whose notes were
 *     promoted to the shared library don't see them twice.
 */
export function mergeSharedIntoLocal(
  local: Exercise[],
  shared: SharedExerciseDoc[],
  myUid: string | null,
): { next: Exercise[]; changed: boolean } {
  const next = local.map((e) => ({ ...e }));
  const byId = new Map<string, number>();
  const bySharedId = new Map<string, number>();
  const byName = new Map<string, number>();
  next.forEach((e, i) => {
    byId.set(e.id, i);
    if (e.sharedId) bySharedId.set(e.sharedId, i);
    byName.set(storage.exerciseNameKey(e.name), i);
  });

  let changed = false;
  for (const s of shared) {
    if (!s || !s.id || !s.name) continue;
    const idx = byId.get(s.id) ?? bySharedId.get(s.id) ?? byName.get(s.nameKey || storage.exerciseNameKey(s.name));

    if (idx === undefined) {
      const added: Exercise = stripUndefined({
        id: s.id,
        name: s.name,
        muscleGroup: s.muscleGroup,
        isCompound: s.isCompound ?? s.category === 'compound',
        category: s.category,
        equipment: s.equipment,
        met: s.met ?? undefined,
        sharedNotes: s.notes || undefined,
        videoUrl: s.videoUrl || undefined,
        createdBy: s.createdBy,
        createdByName: s.createdByName,
      });
      next.push(added);
      byId.set(added.id, next.length - 1);
      byName.set(storage.exerciseNameKey(added.name), next.length - 1);
      changed = true;
      continue;
    }

    const before = next[idx];
    if (myUid && (s.createdBy === myUid || before.createdBy === myUid)) {
      if (s.createdBy === myUid && before.createdBy !== myUid) {
        next[idx] = { ...before, createdBy: myUid, createdByName: s.createdByName ?? before.createdByName };
        changed = true;
      }
      continue;
    }

    const after: Exercise = stripUndefined({
      ...before,
      name: before.id === s.id ? s.name : before.name,
      muscleGroup: s.muscleGroup ?? before.muscleGroup,
      category: s.category ?? before.category,
      isCompound: s.isCompound ?? before.isCompound,
      equipment: s.equipment ?? before.equipment,
      met: s.met ?? before.met,
      sharedNotes: s.notes || undefined,
      videoUrl: s.videoUrl || before.videoUrl || undefined,
      createdBy: s.createdBy,
      createdByName: s.createdByName ?? before.createdByName,
      sharedId: before.id !== s.id ? s.id : undefined,
    });
    if (after.notes && s.notes && after.notes.trim() === s.notes.trim()) delete after.notes;
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      next[idx] = after;
      changed = true;
    }
  }
  return { next, changed };
}

let unsubscribe: (() => void) | null = null;

/**
 * Live-sync the shared library into the local one. Call once after the
 * per-user pull on sign-in; returns a stop function (also stored so
 * stopSharedExerciseSync() can be called from sign-out).
 */
export function startSharedExerciseSync(onChange: () => void): () => void {
  stopSharedExerciseSync();
  const uid = auth.currentUser?.uid ?? null;
  unsubscribe = onSnapshot(
    collection(db, COLLECTION),
    (snap) => {
      const shared = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SharedExerciseDoc, 'id'>) }));
      const { next, changed } = mergeSharedIntoLocal(storage.getExercises(), shared, uid);
      if (changed) {
        storage.saveExercises(next);
        onChange();
      }
    },
    (err) => console.warn('[SharedExercises] listener error:', err),
  );
  return stopSharedExerciseSync;
}

export function stopSharedExerciseSync(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

/** Create an exercise in the local library and publish it to the shared
 *  library (guests only get the local copy). Used by every "Create"
 *  path — Exercise Library, mid-workout picker, plan editor. */
export function createAndPublishExercise(
  input: Omit<storage.NewExerciseInput, 'createdBy' | 'createdByName'>,
): Exercise {
  const user = auth.currentUser;
  const created = storage.createExercise({
    ...input,
    createdBy: user?.uid,
    createdByName: user?.displayName ?? undefined,
  });
  if (user) void publishExercise(created);
  return created;
}
