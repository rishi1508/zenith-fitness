import {
  doc, getDoc, setDoc, deleteDoc, deleteField, updateDoc, collection, getDocs, query, where, limit as fsLimit,
} from 'firebase/firestore';
import { db } from './firebase';
import { setStaffRole } from './gymService';
import type { GymClass, GymClassSession, GymRole } from './types';

/**
 * Staff/owner-only Firestore helpers that don't belong in gymService.ts
 * (per docs/GYM_TIER_A_SPEC.md — UI agents add missing service helpers
 * here rather than editing gymService.ts). Same conventions as
 * gymService.ts: plain async functions, no local caching.
 */

function stripUndefined<T extends object>(o: T): T {
  const copy = { ...o };
  for (const k of Object.keys(copy) as (keyof T)[]) if (copy[k] === undefined) delete copy[k];
  return copy;
}

/**
 * Fetches session docs across a set of classes with `date >= sinceDate`
 * (YYYY-MM-DD). Used by the dashboard's class-fill aggregation — gymService
 * only exposes a single-class/single-date listener, not a bulk read. One
 * query per class, same cost-discipline shape as the rest of Tier A.
 */
export async function listSessions(gymId: string, classes: GymClass[], sinceDate: string): Promise<GymClassSession[]> {
  const results = await Promise.all(
    classes.map(async (cls) => {
      const snap = await getDocs(
        query(collection(db, 'gyms', gymId, 'classes', cls.id, 'sessions'), where('date', '>=', sinceDate)),
      );
      return snap.docs.map((d) => d.data() as GymClassSession);
    }),
  );
  return results.flat();
}

/** Looks up a userProfiles doc by email (case-insensitive), for the
 *  "add staff by email" flow in GymSettingsView. */
export async function findUserProfileByEmail(
  email: string,
): Promise<{ uid: string; name: string; email: string } | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const snap = await getDocs(query(collection(db, 'userProfiles'), where('email', '==', normalized), fsLimit(1)));
  if (snap.empty) return null;
  const found = snap.docs[0];
  const data = found.data() as { displayName?: string; email?: string };
  return { uid: found.id, name: data.displayName || data.email || normalized, email: data.email || normalized };
}

/**
 * Owner: adds a Zenith account as gym staff by email. `setStaffRole`
 * assumes a members/{uid} doc already exists (it updates member.role in
 * the same batch); a person who isn't already a gym member has none, so
 * this creates a minimal one first, then delegates to setStaffRole.
 */
export async function addStaffByEmail(
  gymId: string,
  email: string,
  role: Exclude<GymRole, 'member'>,
): Promise<{ uid: string; name: string }> {
  const profile = await findUserProfileByEmail(email);
  if (!profile) throw new Error('No Zenith account found with that email');

  const memberRef = doc(db, 'gyms', gymId, 'members', profile.uid);
  const memberSnap = await getDoc(memberRef);
  if (!memberSnap.exists()) {
    await setDoc(
      memberRef,
      stripUndefined({
        uid: profile.uid,
        name: profile.name,
        email: profile.email,
        role,
        joinedAt: new Date().toISOString(),
      }),
    );
  }
  await setStaffRole(gymId, profile.uid, role);
  return { uid: profile.uid, name: profile.name };
}

/** Clears a member's assigned trainer. updateMember (gymService.ts) strips
 *  `undefined` fields before writing, so it can only ever omit trainerUid
 *  from a patch — never actually delete an existing value — hence this
 *  dedicated helper for the one place that needs a real field-delete. */
export async function clearMemberTrainer(gymId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, 'gyms', gymId, 'members', uid), { trainerUid: deleteField() });
}

/** Clears a gym's accent colour (back to the app default). Same
 *  field-delete gap as clearMemberTrainer — updateGym (gymService.ts)
 *  can only omit `undefined` fields, never delete an existing one. */
export async function clearGymAccentColor(gymId: string): Promise<void> {
  await updateDoc(doc(db, 'gyms', gymId), { accentColor: deleteField() });
}

/** Clears a gym's check-in geofence, so the poster QR works anywhere
 *  again. Same field-delete gap as clearGymAccentColor. */
export async function clearGymLocation(gymId: string): Promise<void> {
  await updateDoc(doc(db, 'gyms', gymId), { location: deleteField() });
}

/** Owner: rotates a gym's join code — writes the new gymJoinCodes doc and
 *  points the gym at it first, then best-effort deletes the old code doc
 *  (a stray old code left behind if the delete fails is harmless: it's
 *  no longer referenced by the gym, so it can't be used to join it). */
export async function regenerateJoinCode(gymId: string, oldCode: string): Promise<string> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];

  await setDoc(doc(db, 'gymJoinCodes', code), { gymId });
  await updateDoc(doc(db, 'gyms', gymId), { joinCode: code });
  if (oldCode && oldCode !== code) {
    await deleteDoc(doc(db, 'gymJoinCodes', oldCode)).catch((err) => {
      console.warn('[Gym] regenerateJoinCode: failed to delete old code doc:', err);
    });
  }
  return code;
}
