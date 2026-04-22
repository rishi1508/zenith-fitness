import {
  doc, getDoc, setDoc, deleteDoc, updateDoc,
  collection, query, where, getDocs, onSnapshot,
  orderBy, limit, addDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { deliverPush } from './pushService';
import type {
  UserProfile, BuddyRequest, BuddyRelationship,
  ChatMessage, BuddyNotification, Workout, UserStats, BuddyCompareStats,
} from './types';

// ============ USER PROFILES ============

/** Create or update the current user's public profile. */
export async function upsertUserProfile(
  stats?: UserStats,
  compareStats?: BuddyCompareStats,
): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const ref = doc(db, 'userProfiles', user.uid);
    const existing = await getDoc(ref);

    const profile: Record<string, unknown> = {
      uid: user.uid,
      displayName: user.displayName || 'Anonymous',
      displayNameLower: (user.displayName || 'anonymous').toLowerCase(),
      email: user.email || '',
      photoURL: user.photoURL || null,
    };

    if (!existing.exists()) {
      profile.joinedAt = new Date().toISOString();
      profile.totalWorkouts = stats?.totalWorkouts ?? 0;
      profile.currentStreak = stats?.currentStreak ?? 0;
      profile.isWorkingOut = false;
    } else {
      if (stats) {
        profile.totalWorkouts = stats.totalWorkouts;
        profile.currentStreak = stats.currentStreak;
      }
    }

    if (compareStats) {
      profile.compareStats = compareStats;
    }

    await setDoc(ref, profile, { merge: true });
  } catch (err) {
    console.error('[Buddy] Failed to upsert profile — check Firestore rules for userProfiles collection:', err);
  }
}

/** Set "working out" status on current user's profile. */
export async function setWorkingOutStatus(
  isWorkingOut: boolean,
  workoutName?: string,
  startedAt?: string,
): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const ref = doc(db, 'userProfiles', user.uid);
  await setDoc(ref, {
    isWorkingOut,
    activeWorkoutName: isWorkingOut ? workoutName : null,
    activeWorkoutStartedAt: isWorkingOut ? startedAt : null,
  }, { merge: true });
}

/**
 * Write a `lastActive` heartbeat to the current user's public profile so
 * buddies can show an online/offline dot on the avatar. Cheap — a single
 * field merge — but we still throttle to once-per-minute in the caller
 * (App.tsx) to keep Firestore write costs low.
 */
export async function touchHeartbeat(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const ref = doc(db, 'userProfiles', user.uid);
    await setDoc(ref, { lastActive: new Date().toISOString() }, { merge: true });
  } catch (err) {
    // Don't throw — heartbeat is best-effort — but surface so
    // rule-denials / long-term network issues show up in diagnostics.
    console.warn('[Presence] heartbeat failed:', err);
  }
}

/** Compute the online/offline/busy state for a profile given its
 *  lastActive timestamp + isWorkingOut flag. ONLINE_THRESHOLD_MS is
 *  intentionally a bit generous so a ~60 s heartbeat miss doesn't flip
 *  the dot. */
export const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 min
export type PresenceState = 'offline' | 'online' | 'in-workout';
export function computePresence(profile: Pick<UserProfile, 'lastActive' | 'isWorkingOut'> | null | undefined): PresenceState {
  if (!profile) return 'offline';
  const last = profile.lastActive ? new Date(profile.lastActive).getTime() : 0;
  const isOnline = last > 0 && Date.now() - last < ONLINE_THRESHOLD_MS;
  if (!isOnline) return 'offline';
  return profile.isWorkingOut ? 'in-workout' : 'online';
}

/** Search users by display name (case-insensitive prefix match). */
export async function searchUsers(searchTerm: string): Promise<UserProfile[]> {
  const user = auth.currentUser;
  if (!user) return [];

  // If no search term, return all users
  if (searchTerm.trim().length === 0) {
    return getAllUsers();
  }

  const lowerTerm = searchTerm.trim().toLowerCase();

  try {
    // Query on the lowercase field for case-insensitive search
    const q = query(
      collection(db, 'userProfiles'),
      where('displayNameLower', '>=', lowerTerm),
      where('displayNameLower', '<=', lowerTerm + '\uf8ff'),
      limit(20),
    );

    const snap = await getDocs(q);
    const results: UserProfile[] = [];
    snap.forEach((d) => {
      const data = d.data() as UserProfile;
      if (data.uid !== user.uid) {
        results.push(data);
      }
    });

    // Fallback: also try on displayName (for profiles created before displayNameLower existed)
    if (results.length === 0) {
      const term = searchTerm.trim();
      const q2 = query(
        collection(db, 'userProfiles'),
        where('displayName', '>=', term),
        where('displayName', '<=', term + '\uf8ff'),
        limit(20),
      );
      const snap2 = await getDocs(q2);
      snap2.forEach((d) => {
        const data = d.data() as UserProfile;
        if (data.uid !== user.uid) {
          results.push(data);
        }
      });
    }

    return results;
  } catch (err) {
    console.error('[Buddy] Search failed — check Firestore rules for userProfiles collection:', err);
    return [];
  }
}

/** Get all registered users (for browsing). */
export async function getAllUsers(): Promise<UserProfile[]> {
  const user = auth.currentUser;
  if (!user) return [];

  try {
    const q = query(collection(db, 'userProfiles'), limit(50));
    const snap = await getDocs(q);
    const results: UserProfile[] = [];
    snap.forEach((d) => {
      const data = d.data() as UserProfile;
      if (data.uid !== user.uid) {
        results.push(data);
      }
    });
    return results;
  } catch (err) {
    console.error('[Buddy] Failed to load users — check Firestore rules for userProfiles collection:', err);
    return [];
  }
}

/** Get a specific user's profile. */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const ref = doc(db, 'userProfiles', uid);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

// ============ BUDDY REQUESTS ============

/** Generate a deterministic relationship ID from two UIDs. */
function getBuddyPairId(uid1: string, uid2: string): string {
  return [uid1, uid2].sort().join('_');
}

/** Send a buddy request. */
export async function sendBuddyRequest(toUid: string, toName: string, toPhoto?: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  // Check if already buddies
  const pairId = getBuddyPairId(user.uid, toUid);
  const buddyRef = doc(db, 'buddies', pairId);
  const buddySnap = await getDoc(buddyRef);
  if (buddySnap.exists()) throw new Error('Already buddies!');

  // Check if request already exists (in either direction)
  const existingQ = query(
    collection(db, 'buddyRequests'),
    where('fromUid', '==', user.uid),
    where('toUid', '==', toUid),
    where('status', '==', 'pending'),
  );
  const existingSnap = await getDocs(existingQ);
  if (!existingSnap.empty) throw new Error('Request already sent!');

  // Check reverse direction too
  const reverseQ = query(
    collection(db, 'buddyRequests'),
    where('fromUid', '==', toUid),
    where('toUid', '==', user.uid),
    where('status', '==', 'pending'),
  );
  const reverseSnap = await getDocs(reverseQ);
  if (!reverseSnap.empty) {
    // They already sent us a request — auto-accept it
    const existingRequest = reverseSnap.docs[0];
    await acceptBuddyRequest(existingRequest.id);
    return;
  }

  const request: Omit<BuddyRequest, 'id'> = {
    fromUid: user.uid,
    fromName: user.displayName || 'Anonymous',
    fromPhoto: user.photoURL || null,
    toUid,
    toName,
    toPhoto: toPhoto || null,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  await addDoc(collection(db, 'buddyRequests'), request);

  // Send notification to recipient
  await addNotification(toUid, {
    type: 'buddy_request',
    fromUid: user.uid,
    fromName: user.displayName || 'Anonymous',
    message: `${user.displayName || 'Someone'} sent you a buddy request!`,
    createdAt: new Date().toISOString(),
    read: false,
  });
}

/** Accept a buddy request — creates mutual relationship + chat. */
export async function acceptBuddyRequest(requestId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const requestRef = doc(db, 'buddyRequests', requestId);
  const requestSnap = await getDoc(requestRef);
  if (!requestSnap.exists()) throw new Error('Request not found');

  const request = { id: requestSnap.id, ...requestSnap.data() } as BuddyRequest;
  if (request.status !== 'pending') throw new Error('Request already handled');

  const pairId = getBuddyPairId(request.fromUid, request.toUid);
  const chatId = `chat_${pairId}`;

  const batch = writeBatch(db);

  // Update request status
  batch.update(requestRef, { status: 'accepted' });

  // Create buddy relationship
  const buddyRef = doc(db, 'buddies', pairId);
  const relationship: Omit<BuddyRelationship, 'id'> = {
    users: [request.fromUid, request.toUid] as [string, string],
    userNames: {
      [request.fromUid]: request.fromName,
      [request.toUid]: request.toName,
    },
    userPhotos: {
      ...(request.fromPhoto ? { [request.fromUid]: request.fromPhoto } : {}),
      ...(request.toPhoto ? { [request.toUid]: request.toPhoto } : {}),
    },
    createdAt: new Date().toISOString(),
    chatId,
  };
  batch.set(buddyRef, relationship);

  // Create chat document
  const chatRef = doc(db, 'chats', chatId);
  batch.set(chatRef, {
    users: [request.fromUid, request.toUid],
    createdAt: new Date().toISOString(),
  });

  await batch.commit();

  // Notify the request sender
  await addNotification(request.fromUid, {
    type: 'buddy_accepted',
    fromUid: user.uid,
    fromName: user.displayName || 'Anonymous',
    message: `${user.displayName || 'Someone'} accepted your buddy request!`,
    createdAt: new Date().toISOString(),
    read: false,
  });
}

/** Decline a buddy request. */
export async function declineBuddyRequest(requestId: string): Promise<void> {
  const requestRef = doc(db, 'buddyRequests', requestId);
  await updateDoc(requestRef, { status: 'declined' });
}

/** Cancel an outgoing buddy request (delete it). */
export async function cancelBuddyRequest(requestId: string): Promise<void> {
  await deleteDoc(doc(db, 'buddyRequests', requestId));
}

/** Get incoming pending buddy requests for the current user. */
export async function getIncomingRequests(): Promise<BuddyRequest[]> {
  const user = auth.currentUser;
  if (!user) return [];

  const q = query(
    collection(db, 'buddyRequests'),
    where('toUid', '==', user.uid),
    where('status', '==', 'pending'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as BuddyRequest));
}

/** Get outgoing pending buddy requests. */
export async function getOutgoingRequests(): Promise<BuddyRequest[]> {
  const user = auth.currentUser;
  if (!user) return [];

  const q = query(
    collection(db, 'buddyRequests'),
    where('fromUid', '==', user.uid),
    where('status', '==', 'pending'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as BuddyRequest));
}

/** Listen for incoming buddy requests in real-time. */
export function listenToIncomingRequests(
  callback: (requests: BuddyRequest[]) => void,
): () => void {
  const user = auth.currentUser;
  if (!user) return () => {};

  const q = query(
    collection(db, 'buddyRequests'),
    where('toUid', '==', user.uid),
    where('status', '==', 'pending'),
  );

  return onSnapshot(
    q,
    (snap) => {
      const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() } as BuddyRequest));
      callback(requests);
    },
    (err) => console.warn('[Buddy] requests listener error:', err),
  );
}

// ============ BUDDY RELATIONSHIPS ============

/** Get all buddies for the current user. */
export async function getBuddies(): Promise<BuddyRelationship[]> {
  const user = auth.currentUser;
  if (!user) return [];

  const q = query(
    collection(db, 'buddies'),
    where('users', 'array-contains', user.uid),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as BuddyRelationship));
}

/** Listen to buddy list changes in real-time. */
export function listenToBuddies(
  callback: (buddies: BuddyRelationship[]) => void,
): () => void {
  const user = auth.currentUser;
  if (!user) return () => {};

  const q = query(
    collection(db, 'buddies'),
    where('users', 'array-contains', user.uid),
  );

  return onSnapshot(
    q,
    (snap) => {
      const buddies = snap.docs.map((d) => ({ id: d.id, ...d.data() } as BuddyRelationship));
      callback(buddies);
    },
    (err) => console.warn('[Buddy] buddies listener error:', err),
  );
}

/** Remove a buddy relationship. */
export async function removeBuddy(buddyRelationshipId: string): Promise<void> {
  await deleteDoc(doc(db, 'buddies', buddyRelationshipId));
}

/** Check if two users are already buddies. */
export async function areBuddies(uid1: string, uid2: string): Promise<boolean> {
  const pairId = getBuddyPairId(uid1, uid2);
  const snap = await getDoc(doc(db, 'buddies', pairId));
  return snap.exists();
}

/** Get a buddy's workout history from their Firestore data. */
export async function getBuddyWorkouts(buddyUid: string): Promise<Workout[]> {
  const ref = doc(db, 'users', buddyUid, 'data', 'workouts');
  const snap = await getDoc(ref);
  if (!snap.exists()) return [];
  const data = snap.data();
  return (data.value as Workout[]) || [];
}

/** Get a buddy's stats from their workout data. */
export async function getBuddyStats(buddyUid: string): Promise<UserStats | null> {
  const workouts = await getBuddyWorkouts(buddyUid);
  if (workouts.length === 0) return null;

  const completed = workouts.filter((w) => w.completed && w.type !== 'rest');
  const totalVolume = completed.reduce((sum, w) => {
    return sum + w.exercises.reduce((eSum, ex) => {
      return eSum + ex.sets.reduce((sSum, s) => sSum + (s.weight * s.reps), 0);
    }, 0);
  }, 0);

  // Calculate streak
  const dates = completed
    .map((w) => new Date(w.date).toDateString())
    .filter((d, i, arr) => arr.indexOf(d) === i)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  let currentStreak = 0;
  let longestStreak = 0;
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < dates.length; i++) {
    const d = new Date(dates[i]);
    d.setHours(0, 0, 0, 0);
    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    if (d.getTime() === expected.getTime()) {
      streak++;
    } else {
      break;
    }
  }
  currentStreak = streak;
  longestStreak = Math.max(currentStreak, longestStreak);

  // This week's workouts
  const startOfWeek = new Date(today);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const thisWeekWorkouts = completed.filter(
    (w) => new Date(w.date) >= startOfWeek
  ).length;

  return {
    totalWorkouts: completed.length,
    currentStreak,
    longestStreak,
    thisWeekWorkouts,
    lastWorkoutDate: completed[0]?.date,
    totalVolume,
    avgVolumePerSession: completed.length > 0 ? Math.round(totalVolume / completed.length) : 0,
  };
}

// ============ CHAT ============

/** Send a chat message. Optionally notifies the recipient.
 *  The notification write is isolated from the message write so a
 *  notification-rule failure or transient error can't silently eat the
 *  user's message — they're decoupled, and any notification failure is
 *  surfaced to the console so it's diagnosable. */
export async function sendMessage(
  chatId: string,
  text: string,
  type: ChatMessage['type'] = 'text',
  workoutData?: ChatMessage['workoutData'],
  recipientUid?: string,
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const msg: Omit<ChatMessage, 'id'> = {
    senderId: user.uid,
    senderName: user.displayName || 'Anonymous',
    text,
    timestamp: new Date().toISOString(),
    type,
    ...(workoutData ? { workoutData } : {}),
  };

  await addDoc(collection(db, 'chats', chatId, 'messages'), msg);

  if (recipientUid && recipientUid !== user.uid) {
    // `chat_message` so the toast can render a chat-bubble icon and the
    // tap handler routes to the chat — the legacy 'buddy_accepted'
    // re-use opened an unrelated profile view, which wasn't ideal.
    const notifMessage = type === 'workout_invite'
      ? `${user.displayName || 'Your buddy'} sent you a workout invite!`
      : `${user.displayName || 'Your buddy'}: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`;

    try {
      await addDoc(collection(db, 'notifications', recipientUid, 'items'), {
        type: type === 'workout_invite' ? 'workout_invite' : 'chat_message',
        fromUid: user.uid,
        fromName: user.displayName || 'Anonymous',
        message: notifMessage,
        createdAt: new Date().toISOString(),
        read: false,
        data: { chatId },
      });
    } catch (err) {
      console.error('[Chat] Failed to deliver message notification:', err);
    }
    // Fire a system push regardless of whether the Firestore write
    // succeeded — system push is the more urgent delivery path.
    deliverPush({
      recipientUid,
      title: user.displayName || 'Zenith Fitness',
      body: notifMessage,
      data: { chatId, type: type === 'workout_invite' ? 'workout_invite' : 'chat_message' },
    }).catch(() => { /* logged inside */ });
  }
}

/** Listen to chat messages in real-time. */
export function listenToMessages(
  chatId: string,
  callback: (messages: ChatMessage[]) => void,
): () => void {
  const q = query(
    collection(db, 'chats', chatId, 'messages'),
    orderBy('timestamp', 'asc'),
    limit(200),
  );

  return onSnapshot(
    q,
    (snap) => {
      const messages = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage));
      callback(messages);
    },
    (err) => console.warn('[Chat] messages listener error:', err),
  );
}

/** Delete a chat message (only sender can delete). */
export async function deleteMessage(chatId: string, messageId: string): Promise<void> {
  await deleteDoc(doc(db, 'chats', chatId, 'messages', messageId));
}

/**
 * Toggle the current user's reaction `emoji` on a message. If the user
 * has already reacted with that emoji, remove it; otherwise add it.
 * Stored in `reactions: { emoji: [uid, ...] }` on the message doc.
 */
export async function toggleMessageReaction(
  chatId: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  const ref = doc(db, 'chats', chatId, 'messages', messageId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data() as ChatMessage;
    const current = { ...(data.reactions || {}) };
    const users = current[emoji] || [];
    const idx = users.indexOf(user.uid);
    if (idx >= 0) users.splice(idx, 1);
    else users.push(user.uid);
    if (users.length === 0) delete current[emoji];
    else current[emoji] = users;
    await updateDoc(ref, { reactions: current });
  } catch (err) {
    console.warn('[Chat] toggle reaction failed:', err);
  }
}

// ============ TYPING INDICATOR ============

/**
 * Record that the current user is typing in this chat. Written as
 * `typingUntil.{uid}` on the chat doc (ISO of a few seconds in the
 * future). Readers check `typingUntil[otherUid] > now()` to decide
 * whether to show "typing...". Using a forward-looking expiry means
 * no follow-up "I stopped typing" write is required.
 */
export async function setTypingActive(chatId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const expiresAt = new Date(Date.now() + 4000).toISOString();
    await updateDoc(doc(db, 'chats', chatId), {
      [`typingUntil.${user.uid}`]: expiresAt,
    });
  } catch (err) {
    // Surface so the root cause is visible in the console instead of a silent no-op.
    console.warn('[Chat] typing write failed:', err);
  }
}

/**
 * Listen to the chat doc's typingUntil map and emit the set of uids
 * currently typing. A local ticker re-evaluates expiry every 1s so
 * "typing…" clears promptly when the sender stops, without waiting
 * for another Firestore write.
 */
export function listenToTyping(
  chatId: string,
  callback: (typingUids: Set<string>) => void,
): () => void {
  let latestMap: Record<string, string> = {};
  const emit = () => {
    const now = Date.now();
    const active = new Set<string>();
    for (const [uid, iso] of Object.entries(latestMap)) {
      if (new Date(iso).getTime() > now) active.add(uid);
    }
    callback(active);
  };
  const unsub = onSnapshot(doc(db, 'chats', chatId), (snap) => {
    if (!snap.exists()) { latestMap = {}; emit(); return; }
    const data = snap.data() as { typingUntil?: Record<string, string> };
    latestMap = data.typingUntil || {};
    emit();
  }, (err) => {
    console.warn('[Chat] typing listener error:', err);
  });
  const tick = setInterval(emit, 1000);
  return () => { unsub(); clearInterval(tick); };
}

/** Send a workout invite to a buddy via chat. */
export async function sendWorkoutInvite(
  chatId: string,
  workoutName: string,
  exerciseCount: number,
  recipientUid?: string,
): Promise<void> {
  await sendMessage(
    chatId,
    `Hey! Want to do "${workoutName}" together? (${exerciseCount} exercises)`,
    'workout_invite',
    { workoutName, exerciseCount },
    recipientUid,
  );
}

// ============ NOTIFICATIONS ============

/** Add a notification for a user — both the in-app Firestore doc (drives
 *  the in-session toast) and a best-effort system push via the Vercel
 *  endpoint. */
async function addNotification(
  targetUid: string,
  notification: Omit<BuddyNotification, 'id'>,
): Promise<void> {
  try {
    await addDoc(collection(db, 'notifications', targetUid, 'items'), notification);
    console.info('[Notif] wrote Firestore notification to', targetUid, notification.type);
  } catch (err) {
    console.error('[Notif] Firestore write FAILED:', err);
    throw err;
  }
  // Fire-and-forget; failure here doesn't block the in-app path.
  deliverPush({
    recipientUid: targetUid,
    title: notification.fromName || 'Zenith Fitness',
    body: notification.message,
    data: notification.data,
  }).catch(() => { /* already logged inside deliverPush */ });
}

/** Get unread notifications. */
export async function getNotifications(): Promise<BuddyNotification[]> {
  const user = auth.currentUser;
  if (!user) return [];

  // Order-only query — avoids requiring a composite index for (read ASC, createdAt DESC).
  // Unread filter is applied in memory.
  const q = query(
    collection(db, 'notifications', user.uid, 'items'),
    orderBy('createdAt', 'desc'),
    limit(50),
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as BuddyNotification))
    .filter((n) => !n.read);
}

/** Listen to notifications in real-time. */
export function listenToNotifications(
  callback: (notifications: BuddyNotification[]) => void,
): () => void {
  const user = auth.currentUser;
  if (!user) return () => {};

  const q = query(
    collection(db, 'notifications', user.uid, 'items'),
    orderBy('createdAt', 'desc'),
    limit(50),
  );

  return onSnapshot(
    q,
    (snap) => {
      const notifications = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as BuddyNotification))
        .filter((n) => !n.read);
      callback(notifications);
    },
    (err) => {
      console.error('[Buddy] Notification listener failed:', err);
    },
  );
}

/** Mark a notification as read. */
export async function markNotificationRead(notificationId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const ref = doc(db, 'notifications', user.uid, 'items', notificationId);
  await updateDoc(ref, { read: true });
}

/** Mark all notifications as read. */
export async function markAllNotificationsRead(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const q = query(
    collection(db, 'notifications', user.uid, 'items'),
    where('read', '==', false),
  );
  const snap = await getDocs(q);
  const batch = writeBatch(db);
  snap.docs.forEach((d) => {
    batch.update(d.ref, { read: true });
  });
  await batch.commit();
}

/** Notify all buddies that the current user started a workout. */
export async function notifyBuddiesWorkoutStarted(workoutName: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const buddies = await getBuddies();
  for (const buddy of buddies) {
    const buddyUid = buddy.users.find((u) => u !== user.uid);
    if (!buddyUid) continue;

    await addNotification(buddyUid, {
      type: 'workout_started',
      fromUid: user.uid,
      fromName: user.displayName || 'Anonymous',
      message: `${user.displayName || 'Your buddy'} just started "${workoutName}"!`,
      createdAt: new Date().toISOString(),
      read: false,
    });
  }
}
