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

/**
 * Becoming buddies makes each of you a follower of the other.
 *
 * A buddy is the stronger relationship — mutual, consented, and it unlocks
 * chat and live sessions — so it would be odd to agree to train with someone
 * and still not see their training. Idempotent, and safe to call for a pair
 * that is already linked.
 *
 * Only the caller's own edge can be written (the rules see to that), so this
 * creates the caller → other edge; the other side creates theirs when their
 * app next runs `syncBuddyFollows`.
 */
export async function followBuddy(otherUid: string): Promise<void> {
  await follow(otherUid).catch((err) => console.warn('[Follow] buddy follow failed:', err));
}

/**
 * Catch-up for buddies made before following existed, and for the half of
 * each pair the other person's device has to write. Runs once a day at most.
 */
export async function syncBuddyFollows(buddyUids: readonly string[]): Promise<void> {
  const me = auth.currentUser?.uid;
  if (!me || buddyUids.length === 0) return;
  const key = `zenith_buddy_follow_sync_${me}`;
  try {
    const last = localStorage.getItem(key);
    if (last && Date.now() - Number(last) < 24 * 60 * 60 * 1000) return;
  } catch { /* private mode — just do the work */ }

  for (const uid of buddyUids) {
    if (uid === me) continue;
    // `follow` is a no-op when the edge is already there, so this costs one
    // read per buddy on the days it runs.
    await follow(uid).catch(() => {});
  }
  try { localStorage.setItem(key, String(Date.now())); } catch { /* ignore */ }
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
