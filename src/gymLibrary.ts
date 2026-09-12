/**
 * A gym's own content: the exercises its trainers curate (with their own
 * demonstration videos) and the weekly plans they publish for members.
 *
 *   gyms/{gymId}/exercises/{id}  — GymExercise, staff write, members read
 *   gyms/{gymId}/plans/{id}      — GymWorkoutPlan, staff write, members read + adopt
 *
 * Gym exercises are never copied into a member's own library. They live in
 * a module cache filled by one listener (started by GymContext) and are
 * appended to the pickers as read-only rows — so a member who leaves the
 * gym loses the videos, not their history, and the trainer's edit reaches
 * every phone live.
 */
import { useSyncExternalStore } from 'react';
import {
  collection, deleteDoc, doc, getDocs, increment, onSnapshot, orderBy, query, setDoc, updateDoc,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import * as storage from './storage';
import type { Exercise, GymExercise, GymWorkoutPlan, WeeklyPlan } from './types';

// ----- exercises -------------------------------------------------------------

function stripUndefined<T extends object>(o: T): T {
  const copy = { ...o };
  for (const k of Object.keys(copy) as (keyof T)[]) if (copy[k] === undefined) delete copy[k];
  return copy;
}

/** The read-only Exercise a member sees for a gym exercise. Coach cues arrive
 *  as `sharedNotes`, which is the slot every screen already renders. */
export function gymExerciseToExercise(gymId: string, ge: GymExercise): Exercise {
  return stripUndefined({
    id: ge.id,
    name: ge.name,
    muscleGroup: ge.muscleGroup,
    isCompound: ge.isCompound,
    category: ge.category,
    equipment: ge.equipment,
    sharedNotes: ge.notes,
    videoUrl: ge.videoUrl,
    met: ge.met,
    createdBy: ge.createdBy,
    createdByName: ge.createdByName,
    gymId,
  });
}

let cache: Exercise[] = [];
let cacheGymId: string | null = null;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((fn) => fn());

/** Live list of a gym's exercises, newest edits first. */
export function listenToGymExercises(gymId: string, cb: (list: GymExercise[]) => void): () => void {
  return onSnapshot(
    query(collection(db, 'gyms', gymId, 'exercises'), orderBy('name')),
    (snap) => cb(snap.docs.map((d) => d.data() as GymExercise)),
    (err) => console.warn('[GymLibrary] exercises listener error:', err),
  );
}

/** Fills the cache the pickers read. One listener per gym; GymContext owns it. */
export function startGymLibrarySync(gymId: string): () => void {
  cacheGymId = gymId;
  const unsub = listenToGymExercises(gymId, (list) => {
    if (cacheGymId !== gymId) return;
    cache = list.map((ge) => gymExerciseToExercise(gymId, ge));
    notify();
  });
  return () => {
    unsub();
    if (cacheGymId === gymId) { cacheGymId = null; cache = []; notify(); }
  };
}

/** The gym's exercises as read-only Exercise rows (empty when not in a gym). */
export function getGymExercises(): Exercise[] {
  return cache;
}

export function useGymExercises(): Exercise[] {
  return useSyncExternalStore((fn) => { subscribers.add(fn); return () => subscribers.delete(fn); }, getGymExercises, getGymExercises);
}

/** The member's own library plus the gym's rows, without duplicating an
 *  exercise the member already has under the same id. */
export function withGymExercises(local: Exercise[]): Exercise[] {
  if (cache.length === 0) return local;
  const have = new Set(local.map((e) => e.id));
  return [...local, ...cache.filter((e) => !have.has(e.id))];
}

/** Resolve an exercise by id, then by name, across the member's library and the gym's. */
export function findExercise(exerciseId: string, exerciseName: string): Exercise | undefined {
  const nameKey = storage.exerciseNameKey(exerciseName);
  const all = [...storage.getExercises(), ...cache];
  return all.find((e) => e.id === exerciseId) || all.find((e) => storage.exerciseNameKey(e.name) === nameKey);
}

export interface GymExerciseInput {
  id?: string;
  name: string;
  muscleGroup: GymExercise['muscleGroup'];
  category: GymExercise['category'];
  equipment?: GymExercise['equipment'];
  videoUrl?: string;
  notes?: string;
  met?: number;
}

/** Staff: creates or updates one of the gym's exercises. */
export async function saveGymExercise(gymId: string, input: GymExerciseInput, existing?: GymExercise): Promise<GymExercise> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const now = new Date().toISOString();
  const id = existing?.id ?? input.id ?? crypto.randomUUID();
  const ge: GymExercise = stripUndefined({
    id,
    name: input.name.trim(),
    nameKey: storage.exerciseNameKey(input.name),
    muscleGroup: input.muscleGroup,
    category: input.category,
    isCompound: input.category === 'compound',
    equipment: input.equipment,
    videoUrl: input.videoUrl?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    met: input.met,
    createdBy: existing?.createdBy ?? user.uid,
    createdByName: existing?.createdByName ?? (user.displayName || 'Staff'),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  await setDoc(doc(db, 'gyms', gymId, 'exercises', id), ge);
  return ge;
}

export async function deleteGymExercise(gymId: string, id: string): Promise<void> {
  await deleteDoc(doc(db, 'gyms', gymId, 'exercises', id));
}

// ----- plans -----------------------------------------------------------------

export function listenToGymPlans(gymId: string, cb: (plans: GymWorkoutPlan[]) => void): () => void {
  return onSnapshot(
    query(collection(db, 'gyms', gymId, 'plans'), orderBy('updatedAt', 'desc')),
    (snap) => cb(snap.docs.map((d) => d.data() as GymWorkoutPlan)),
    (err) => console.warn('[GymLibrary] plans listener error:', err),
  );
}

export async function listGymPlans(gymId: string): Promise<GymWorkoutPlan[]> {
  const snap = await getDocs(query(collection(db, 'gyms', gymId, 'plans'), orderBy('updatedAt', 'desc')));
  return snap.docs.map((d) => d.data() as GymWorkoutPlan);
}

/** Staff: publishes one of their own weekly plans to the gym. The gym plan
 *  keeps the local plan's id, so publishing the same plan again updates it. */
export async function publishGymPlan(gymId: string, plan: WeeklyPlan, description?: string): Promise<GymWorkoutPlan> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const now = new Date().toISOString();
  const ref = doc(db, 'gyms', gymId, 'plans', plan.id);
  const existing = (await getDocs(query(collection(db, 'gyms', gymId, 'plans')))).docs.find((d) => d.id === plan.id)?.data() as GymWorkoutPlan | undefined;
  const gp: GymWorkoutPlan = stripUndefined({
    id: plan.id,
    name: plan.name.trim(),
    description: description?.trim() || existing?.description,
    days: plan.days.map((d) => ({ dayNumber: d.dayNumber, name: d.name, exercises: d.exercises, ...(d.isRestDay ? { isRestDay: true } : {}) })),
    createdBy: existing?.createdBy ?? user.uid,
    createdByName: existing?.createdByName ?? (user.displayName || 'Staff'),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    useCount: existing?.useCount ?? 0,
  });
  await setDoc(ref, gp);
  return gp;
}

export async function deleteGymPlan(gymId: string, id: string): Promise<void> {
  await deleteDoc(doc(db, 'gyms', gymId, 'plans', id));
}

/** The member's local copy of a gym plan, if they already adopted it. */
export function adoptedCopy(gymPlanId: string): WeeklyPlan | undefined {
  return storage.getWeeklyPlans().find((p) => p.sourceGymPlanId === gymPlanId);
}

/** Member: copies the gym plan into their own plans and makes it the active
 *  one. A second tap replaces the earlier copy (the trainer may have changed
 *  the plan) instead of adding a duplicate. */
export function adoptGymPlan(gymId: string, plan: GymWorkoutPlan, gymName: string): WeeklyPlan {
  const previous = adoptedCopy(plan.id);
  const local: WeeklyPlan = {
    id: previous?.id ?? crypto.randomUUID(),
    name: plan.name,
    days: plan.days.map((d) => ({ ...d, exercises: d.exercises.map((e) => ({ ...e })) })),
    isCustom: true,
    isImported: true,
    sourceGymPlanId: plan.id,
  };
  const rest = storage.getWeeklyPlans().filter((p) => p.id !== local.id);
  storage.saveWeeklyPlans([...rest, local]);
  storage.setActivePlanId(local.id);
  if (!previous) {
    updateDoc(doc(db, 'gyms', gymId, 'plans', plan.id), { useCount: increment(1) })
      .catch((err) => console.warn(`[GymLibrary] useCount bump failed for ${gymName}:`, err));
  }
  return local;
}
