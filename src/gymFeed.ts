import {
  doc, collection, deleteDoc, getDoc, onSnapshot, query, orderBy, limit as fsLimit, setDoc, updateDoc, deleteField,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { localDateISO } from './gymStats';
import type { GymFeedPost, Workout } from './types';

/**
 * The gym feed (docs/GYM_TIER_A_SPEC.md §9): what the people you actually
 * train alongside did today. Same shape as the rest of gymService — plain
 * async functions and onSnapshot listeners returning an unsubscribe.
 *
 * Two deliberate choices about cost:
 *   - a post is one small doc, so opening the feed is ~20 reads;
 *   - a progress photo lives in `feed/{id}/media/image` and is fetched only
 *     when that post is actually rendered, so a scroll past ten photos does
 *     not download ten photos' worth of base64 into the list query.
 */

/** Newest posts first. */
export function listenToFeed(gymId: string, cb: (posts: GymFeedPost[]) => void, limit = 20): () => void {
  const q = query(collection(db, 'gyms', gymId, 'feed'), orderBy('at', 'desc'), fsLimit(limit));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as GymFeedPost)),
    (err) => console.warn('[GymFeed] listener error:', err),
  );
}

/** The image for one post, or null. One read, on demand. */
export async function getPostImage(gymId: string, postId: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, 'gyms', gymId, 'feed', postId, 'media', 'image'));
    const data = snap.data() as { dataUrl?: string } | undefined;
    return data?.dataUrl ?? null;
  } catch (err) {
    console.warn('[GymFeed] image read failed:', err);
    return null;
  }
}

interface NewPost {
  text?: string;
  workout?: GymFeedPost['workout'];
  /** JPEG base64 (no data: prefix) — see prepareScanImage in nutrition/scan. */
  imageBase64?: string;
}

/** Post to the gym's feed as the signed-in member. */
export async function createPost(gymId: string, input: NewPost): Promise<GymFeedPost> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const id = `${user.uid}_${Date.now()}`;
  const now = new Date();
  const post: GymFeedPost = {
    id,
    uid: user.uid,
    name: user.displayName || 'A member',
    photoURL: user.photoURL ?? null,
    at: now.toISOString(),
    date: localDateISO(now),
    kind: input.workout ? 'workout' : 'photo',
    ...(input.text?.trim() ? { text: input.text.trim().slice(0, 280) } : {}),
    ...(input.workout ? { workout: input.workout } : {}),
    ...(input.imageBase64 ? { hasImage: true } : {}),
    reactions: {},
  };
  await setDoc(doc(db, 'gyms', gymId, 'feed', id), post);
  if (input.imageBase64) {
    await setDoc(doc(db, 'gyms', gymId, 'feed', id, 'media', 'image'), {
      uid: user.uid,
      dataUrl: `data:image/jpeg;base64,${input.imageBase64}`,
    });
  }
  return post;
}

/** A finished session as a feed-ready summary. */
export function workoutSummary(workout: Workout): NonNullable<GymFeedPost['workout']> {
  let sets = 0;
  let volumeKg = 0;
  for (const ex of workout.exercises) {
    for (const s of ex.sets) {
      if (!s.completed) continue;
      sets++;
      volumeKg += s.weight * s.reps;
    }
  }
  return {
    name: workout.name,
    sets,
    volumeKg: Math.round(volumeKg),
    ...(workout.duration ? { durationMin: workout.duration } : {}),
  };
}

/** Add or remove the caller's reaction. Rules only let them touch their own key. */
export async function toggleReaction(gymId: string, postId: string, emoji: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const ref = doc(db, 'gyms', gymId, 'feed', postId);
  const snap = await getDoc(ref);
  const current = (snap.data() as GymFeedPost | undefined)?.reactions?.[user.uid];
  await updateDoc(ref, {
    [`reactions.${user.uid}`]: current === emoji ? deleteField() : emoji,
  });
}

/** The author (or gym staff, per rules) removes a post. */
export async function deletePost(gymId: string, postId: string, hasImage?: boolean): Promise<void> {
  if (hasImage) {
    try {
      await deleteDoc(doc(db, 'gyms', gymId, 'feed', postId, 'media', 'image'));
    } catch (err) {
      console.warn('[GymFeed] image delete failed:', err);
    }
  }
  await deleteDoc(doc(db, 'gyms', gymId, 'feed', postId));
}
