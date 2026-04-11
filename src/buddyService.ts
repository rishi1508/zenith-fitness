import {
  doc, getDoc, setDoc, deleteDoc, updateDoc,
  collection, query, where, getDocs, onSnapshot,
  orderBy, limit, addDoc, serverTimestamp, Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import type {
  UserProfile, BuddyRequest, BuddyRelationship,
  ChatMessage, BuddyNotification, Workout, UserStats,
} from './types';

// ============ USER PROFILES ============

/** Create or update the current user's public profile. */
export async function upsertUserProfile(stats?: UserStats): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const ref = doc(db, 'userProfiles', user.uid);
  const existing = await getDoc(ref);

  const profile: Partial<UserProfile> = {
    uid: user.uid,
    displayName: user.displayName || 'Anonymous',
    email: user.email || '',
    photoURL: user.photoURL || undefined,
  };

  if (!existing.exists()) {
    profile.joinedAt = new Date().toISOString();
    profile.totalWorkouts = stats?.totalWorkouts ?? 0;
    profile.currentStreak = stats?.currentStreak ?? 0;
    profile.isWorkingOut = false;
  } else {
    // Update stats if provided
    if (stats) {
      profile.totalWorkouts = stats.totalWorkouts;
      profile.currentStreak = stats.currentStreak;
    }
  }

  await setDoc(ref, profile, { merge: true });
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

/** Search users by display name (case-insensitive prefix match). */
export async function searchUsers(searchTerm: string): Promise<UserProfile[]> {
  const user = auth.currentUser;
  if (!user || searchTerm.trim().length < 2) return [];

  const term = searchTerm.trim();
  // Firestore range query for prefix match
  const q = query(
    collection(db, 'userProfiles'),
    where('displayName', '>=', term),
    where('displayName', '<=', term + '\uf8ff'),
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

  // Also try lowercase search
  if (results.length === 0) {
    const lowerTerm = term.toLowerCase();
    const q2 = query(
      collection(db, 'userProfiles'),
      where('displayName', '>=', lowerTerm),
      where('displayName', '<=', lowerTerm + '\uf8ff'),
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
    fromPhoto: user.photoURL || undefined,
    toUid,
    toName,
    toPhoto,
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

  return onSnapshot(q, (snap) => {
    const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() } as BuddyRequest));
    callback(requests);
  });
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

  return onSnapshot(q, (snap) => {
    const buddies = snap.docs.map((d) => ({ id: d.id, ...d.data() } as BuddyRelationship));
    callback(buddies);
  });
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

/** Send a chat message. */
export async function sendMessage(
  chatId: string,
  text: string,
  type: ChatMessage['type'] = 'text',
  workoutData?: ChatMessage['workoutData'],
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

  return onSnapshot(q, (snap) => {
    const messages = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage));
    callback(messages);
  });
}

/** Send a workout invite to a buddy via chat. */
export async function sendWorkoutInvite(
  chatId: string,
  workoutName: string,
  exerciseCount: number,
): Promise<void> {
  await sendMessage(
    chatId,
    `Hey! Want to do "${workoutName}" together? (${exerciseCount} exercises)`,
    'workout_invite',
    { workoutName, exerciseCount },
  );
}

// ============ NOTIFICATIONS ============

/** Add a notification for a user. */
async function addNotification(
  targetUid: string,
  notification: Omit<BuddyNotification, 'id'>,
): Promise<void> {
  await addDoc(collection(db, 'notifications', targetUid, 'items'), notification);
}

/** Get unread notifications. */
export async function getNotifications(): Promise<BuddyNotification[]> {
  const user = auth.currentUser;
  if (!user) return [];

  const q = query(
    collection(db, 'notifications', user.uid, 'items'),
    where('read', '==', false),
    orderBy('createdAt', 'desc'),
    limit(50),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as BuddyNotification));
}

/** Listen to notifications in real-time. */
export function listenToNotifications(
  callback: (notifications: BuddyNotification[]) => void,
): () => void {
  const user = auth.currentUser;
  if (!user) return () => {};

  const q = query(
    collection(db, 'notifications', user.uid, 'items'),
    where('read', '==', false),
    orderBy('createdAt', 'desc'),
    limit(50),
  );

  return onSnapshot(q, (snap) => {
    const notifications = snap.docs.map((d) => ({ id: d.id, ...d.data() } as BuddyNotification));
    callback(notifications);
  });
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
