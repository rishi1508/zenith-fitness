// Shared account-deletion helper for api/admin.ts (admin-initiated) and
// api/account.ts (self-service, Play Store requirement). Both routes
// verify the caller's identity themselves; this only does the wipe.
//
// Order matters: the auth account goes first, so that once this returns
// nobody can sign in as the user again even if a later step fails. Every
// data step then runs (none is skipped because another failed) and the
// failures are reported together — the caller's ID token stays valid for
// up to an hour, so tapping Delete again retries the leftovers.
//
// What goes: users/{uid} (all app data), userProfiles/{uid} (+ fcmTokens),
// notifications/{uid}, buddy pairs + their chats, buddy requests either
// way, follow edges either way, sessions the user hosted, the gym
// membership doc, staff role, own feed posts (with comments/media),
// comments and reactions left on other members' posts, rate-limit
// counters and any pending OTP code.
//
// What stays, on purpose: gym payments and check-ins (the gym's own
// business records — they carry the uid and amounts, no name), shared
// library entries the user contributed (exercises/foods/templates are
// community content), and other people's notifications that name them.
// docs/LAUNCH_REVIEW_2026-09-13.md lists this for the privacy policy.

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type DocumentReference, type Firestore, type Query, type WriteBatch } from 'firebase-admin/firestore';
import crypto from 'node:crypto';

/** Thrown before anything is deleted when the account owns a gym. */
export class GymOwnerError extends Error {}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

async function deleteAll(q: Query, recursive = false, db?: Firestore): Promise<void> {
  const snap = await q.get();
  if (recursive && db) {
    for (const d of snap.docs) await db.recursiveDelete(d.ref);
    return;
  }
  await commitInChunks(snap.docs.map((d) => d.ref), (b, ref) => b.delete(ref));
}

async function commitInChunks(refs: DocumentReference[], op: (b: WriteBatch, ref: DocumentReference) => void): Promise<void> {
  if (!refs.length) return;
  const db = refs[0].firestore;
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch();
    refs.slice(i, i + 400).forEach((ref) => op(batch, ref));
    await batch.commit();
  }
}

async function wipeBuddies(db: Firestore, uid: string): Promise<void> {
  const pairs = await db.collection('buddies').where('users', 'array-contains', uid).get();
  for (const pair of pairs.docs) {
    await db.recursiveDelete(db.collection('chats').doc(`chat_${pair.id}`));
    await pair.ref.delete();
  }
}

async function wipeGymPresence(db: Firestore, gymId: string, uid: string): Promise<void> {
  const gym = db.collection('gyms').doc(gymId);
  await gym.collection('members').doc(uid).delete();
  const gymSnap = await gym.get();
  const staff = (gymSnap.exists ? (gymSnap.data() as { staff?: Record<string, string> }).staff : undefined) ?? {};
  if (staff[uid]) await gym.update({ [`staff.${uid}`]: FieldValue.delete() });

  // Own posts, with their comments and media.
  await deleteAll(gym.collection('feed').where('uid', '==', uid), true, db);
  // Comments and reactions on everyone else's posts. Bounded: the feed is
  // read newest-first and only posts that have comments are opened.
  const commented = await gym.collection('feed').where('commentCount', '>', 0).orderBy('commentCount').limit(500).get();
  for (const post of commented.docs) {
    const mine = await post.ref.collection('comments').where('uid', '==', uid).get();
    if (mine.empty) continue;
    await commitInChunks(mine.docs.map((d) => d.ref), (b, ref) => b.delete(ref));
    await post.ref.update({ commentCount: FieldValue.increment(-mine.size) }).catch(() => { /* post gone meanwhile */ });
  }
  const reacted = await gym.collection('feed').where(`reactions.${uid}`, '!=', null).limit(500).get();
  await commitInChunks(reacted.docs.map((d) => d.ref), (b, ref) => b.update(ref, { [`reactions.${uid}`]: FieldValue.delete() }));
}

export async function wipeUserData(authAdmin: Auth, db: Firestore, uid: string): Promise<void> {
  const owned = await db.collection('gyms').where('ownerUid', '==', uid).limit(1).get();
  if (!owned.empty) throw new GymOwnerError('This account owns a gym. Transfer ownership to another staff member first.');

  let email: string | undefined;
  try {
    email = (await authAdmin.getUser(uid)).email ?? undefined;
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/user-not-found') throw err;
  }
  const profileSnap = await db.collection('userProfiles').doc(uid).get();
  const gymId = profileSnap.exists ? (profileSnap.data() as { gym?: { gymId?: string } }).gym?.gymId : undefined;

  try {
    await authAdmin.deleteUser(uid);
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/user-not-found') throw err;
  }

  const steps: Array<[string, () => Promise<unknown>]> = [
    ['data', () => db.recursiveDelete(db.collection('users').doc(uid))],
    ['profile', () => db.recursiveDelete(db.collection('userProfiles').doc(uid))],
    ['notifications', () => db.recursiveDelete(db.collection('notifications').doc(uid))],
    ['buddies', () => wipeBuddies(db, uid)],
    ['requests-sent', () => deleteAll(db.collection('buddyRequests').where('fromUid', '==', uid))],
    ['requests-received', () => deleteAll(db.collection('buddyRequests').where('toUid', '==', uid))],
    ['following', () => deleteAll(db.collection('follows').where('follower', '==', uid))],
    ['followers', () => deleteAll(db.collection('follows').where('target', '==', uid))],
    ['sessions', () => deleteAll(db.collection('workoutSessions').where('hostUid', '==', uid), true, db)],
    ['gym', () => (gymId ? wipeGymPresence(db, gymId, uid) : Promise.resolve())],
    ['limits', () => commitInChunks(
      [uid, `push:${uid}`, `push-announce:${uid}`].map((k) => db.collection('zenLimits').doc(k)),
      (b, ref) => b.delete(ref),
    )],
    ['otp', () => (email ? db.collection('otpCodes').doc(sha256(email.trim().toLowerCase())).delete() : Promise.resolve())],
  ];
  const results = await Promise.allSettled(steps.map(([, run]) => run()));
  const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [steps[i][0]] : []));
  results.forEach((r, i) => { if (r.status === 'rejected') console.error(`[wipe] ${uid} step ${steps[i][0]} failed:`, r.reason); });
  if (failed.length) {
    throw new Error(`Your account is deleted, but some data could not be removed yet (${failed.join(', ')}). Tap Delete again to retry.`);
  }
}
