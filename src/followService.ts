import {
  collection, deleteDoc, doc, getDoc, getDocs, increment, limit as fsLimit, query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { auth, db } from './firebase';

/**
 * Following, kept deliberately thin.
 *
 * A buddy is a two-way relationship you both agree to — it unlocks chat,
 * live sessions and comparisons. Following is one-way and needs no consent:
 * it is how you keep an eye on someone's training without asking to train
 * with them. Both exist because they answer different questions.
 *
 * One edge document per pair, plus a denormalised count on each profile so a
 * profile header costs no extra reads.
 */

const edgeId = (follower: string, target: string) => `${follower}__${target}`;

export async function isFollowing(targetUid: string): Promise<boolean> {
  const me = auth.currentUser?.uid;
  if (!me || me === targetUid) return false;
  try {
    return (await getDoc(doc(db, 'follows', edgeId(me, targetUid)))).exists();
  } catch {
    return false;
  }
}

export async function follow(targetUid: string): Promise<void> {
  const me = auth.currentUser?.uid;
  if (!me || me === targetUid) return;
  const ref = doc(db, 'follows', edgeId(me, targetUid));
  if ((await getDoc(ref)).exists()) return;
  await setDoc(ref, { follower: me, target: targetUid, at: new Date().toISOString() });
  // Counters are best-effort: an edge that exists without its count is a
  // cosmetic error, a count without an edge is a lie.
  await Promise.all([
    updateDoc(doc(db, 'userProfiles', targetUid), { followerCount: increment(1) }).catch(() => {}),
    updateDoc(doc(db, 'userProfiles', me), { followingCount: increment(1) }).catch(() => {}),
  ]);
}

export async function unfollow(targetUid: string): Promise<void> {
  const me = auth.currentUser?.uid;
  if (!me || me === targetUid) return;
  const ref = doc(db, 'follows', edgeId(me, targetUid));
  if (!(await getDoc(ref)).exists()) return;
  await deleteDoc(ref);
  await Promise.all([
    updateDoc(doc(db, 'userProfiles', targetUid), { followerCount: increment(-1) }).catch(() => {}),
    updateDoc(doc(db, 'userProfiles', me), { followingCount: increment(-1) }).catch(() => {}),
  ]);
}

/** Uids following `targetUid`. Capped — the header only needs a count. */
export async function listFollowers(targetUid: string, max = 50): Promise<string[]> {
  const snap = await getDocs(query(collection(db, 'follows'), where('target', '==', targetUid), fsLimit(max)));
  return snap.docs.map((d) => (d.data() as { follower: string }).follower);
}

export async function listFollowing(followerUid: string, max = 50): Promise<string[]> {
  const snap = await getDocs(query(collection(db, 'follows'), where('follower', '==', followerUid), fsLimit(max)));
  return snap.docs.map((d) => (d.data() as { target: string }).target);
}
