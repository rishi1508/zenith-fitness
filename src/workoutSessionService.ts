import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs, onSnapshot,
  addDoc, orderBy, limit,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import type {
  WorkoutSession, SessionParticipant, SessionProgress,
  SessionReaction, TemplateExercise, WorkoutType, WorkoutExercise,
} from './types';


// ============ SESSION CRUD ============

/** Create a new group workout session. Returns the session ID. */
export async function createSession(
  workoutName: string,
  workoutType: WorkoutType,
  templateExercises: TemplateExercise[],
): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const sessionId = crypto.randomUUID();
  const hostParticipant: SessionParticipant = {
    uid: user.uid,
    name: user.displayName || 'Anonymous',
    photoURL: user.photoURL || null,
    status: 'joined',
    joinedAt: new Date().toISOString(),
    totalVolume: 0,
    completedSets: 0,
    totalSets: 0,
    currentExercise: '',
  };

  const session: WorkoutSession = {
    id: sessionId,
    hostUid: user.uid,
    hostName: user.displayName || 'Anonymous',
    status: 'waiting',
    workoutName,
    workoutType,
    templateExercises,
    createdAt: new Date().toISOString(),
    participants: { [user.uid]: hostParticipant },
  };

  await setDoc(doc(db, 'workoutSessions', sessionId), session);
  return sessionId;
}

/** Invite a buddy to a session. */
export async function inviteToSession(
  sessionId: string,
  buddyUid: string,
  buddyName: string,
  buddyPhotoURL: string | null,
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const sessionRef = doc(db, 'workoutSessions', sessionId);
  const snap = await getDoc(sessionRef);
  if (!snap.exists()) throw new Error('Session not found');

  const session = snap.data() as WorkoutSession;
  const participantCount = Object.keys(session.participants).length;
  if (participantCount >= 3) throw new Error('Session is full (max 3 participants)');
  if (session.participants[buddyUid]) throw new Error('Already invited');

  const participant: SessionParticipant = {
    uid: buddyUid,
    name: buddyName,
    photoURL: buddyPhotoURL,
    status: 'invited',
    totalVolume: 0,
    completedSets: 0,
    totalSets: 0,
    currentExercise: '',
  };

  await updateDoc(sessionRef, {
    [`participants.${buddyUid}`]: participant,
  });

  // Send notification
  await addDoc(collection(db, 'notifications', buddyUid, 'items'), {
    type: 'session_invite',
    fromUid: user.uid,
    fromName: user.displayName || 'Anonymous',
    message: `${user.displayName || 'Someone'} invited you to work out together: "${session.workoutName}"`,
    createdAt: new Date().toISOString(),
    read: false,
    data: { sessionId },
  });
}

/** Accept a session invite (join the lobby). */
export async function joinSession(sessionId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const sessionRef = doc(db, 'workoutSessions', sessionId);
  await updateDoc(sessionRef, {
    [`participants.${user.uid}.status`]: 'joined',
    [`participants.${user.uid}.joinedAt`]: new Date().toISOString(),
  });
}

/** Decline a session invite. */
export async function declineSession(sessionId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const sessionRef = doc(db, 'workoutSessions', sessionId);
  await updateDoc(sessionRef, {
    [`participants.${user.uid}.status`]: 'declined',
  });
}

/** Host starts the session — all joined participants become 'active'. */
export async function startSession(sessionId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const sessionRef = doc(db, 'workoutSessions', sessionId);
  const snap = await getDoc(sessionRef);
  if (!snap.exists()) throw new Error('Session not found');

  const session = snap.data() as WorkoutSession;
  if (session.hostUid !== user.uid) throw new Error('Only the host can start');

  const updates: Record<string, unknown> = {
    status: 'active',
    startedAt: new Date().toISOString(),
  };

  // Set all joined participants to active
  for (const [uid, p] of Object.entries(session.participants)) {
    if (p.status === 'joined') {
      updates[`participants.${uid}.status`] = 'active';
    }
  }

  await updateDoc(sessionRef, updates);
}

// ============ LIVE PROGRESS ============

/** Sync participant's live exercise progress to Firestore. Debounced by caller. */
export async function syncProgress(
  sessionId: string,
  exercises: WorkoutExercise[],
): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  // Calculate summary stats
  let totalVolume = 0;
  let completedSets = 0;
  let totalSets = 0;
  let currentExercise = '';

  for (const ex of exercises) {
    totalSets += ex.sets.length;
    for (const s of ex.sets) {
      if (s.completed || s.reps > 0) {
        completedSets++;
        totalVolume += s.weight * s.reps;
      }
    }
    // Current exercise = last one with incomplete sets
    if (ex.sets.some(s => !s.completed && s.reps === 0)) {
      if (!currentExercise) currentExercise = ex.exerciseName;
    }
  }
  if (!currentExercise && exercises.length > 0) {
    currentExercise = exercises[exercises.length - 1].exerciseName;
  }

  // Update summary in main session doc
  const sessionRef = doc(db, 'workoutSessions', sessionId);
  await updateDoc(sessionRef, {
    [`participants.${user.uid}.totalVolume`]: totalVolume,
    [`participants.${user.uid}.completedSets`]: completedSets,
    [`participants.${user.uid}.totalSets`]: totalSets,
    [`participants.${user.uid}.currentExercise`]: currentExercise,
  });

  // Store detailed exercise data in subcollection
  const progressRef = doc(db, 'workoutSessions', sessionId, 'progress', user.uid);
  const progress: SessionProgress = {
    exercises,
    lastUpdated: Date.now(),
  };
  await setDoc(progressRef, progress);
}

/** Mark participant as completed. */
export async function completeSession(sessionId: string, duration: number): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const sessionRef = doc(db, 'workoutSessions', sessionId);
  await updateDoc(sessionRef, {
    [`participants.${user.uid}.status`]: 'completed',
    [`participants.${user.uid}.completedAt`]: new Date().toISOString(),
    [`participants.${user.uid}.duration`]: duration,
  });

  // Check if all active participants are done
  const snap = await getDoc(sessionRef);
  if (snap.exists()) {
    const session = snap.data() as WorkoutSession;
    const activeParticipants = Object.values(session.participants).filter(
      (p) => p.status === 'active' || p.status === 'completed'
    );
    const allDone = activeParticipants.every((p) => p.status === 'completed');
    if (allDone) {
      await updateDoc(sessionRef, {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
    }
  }
}

// ============ REACTIONS ============

const REACTION_EMOJIS = ['🔥', '💪', '👏', '⚡'] as const;
export { REACTION_EMOJIS };

/** Send a quick reaction. */
export async function sendReaction(sessionId: string, emoji: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  await addDoc(collection(db, 'workoutSessions', sessionId, 'reactions'), {
    fromUid: user.uid,
    fromName: user.displayName || 'Anonymous',
    emoji,
    timestamp: new Date().toISOString(),
  });
}

/** Listen to reactions in real-time (last 10 only). */
export function listenToReactions(
  sessionId: string,
  callback: (reactions: SessionReaction[]) => void,
): () => void {
  const q = query(
    collection(db, 'workoutSessions', sessionId, 'reactions'),
    orderBy('timestamp', 'desc'),
    limit(10),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SessionReaction)));
  });
}

// ============ LISTENERS ============

/** Listen to a session in real-time. */
export function listenToSession(
  sessionId: string,
  callback: (session: WorkoutSession | null) => void,
): () => void {
  return onSnapshot(doc(db, 'workoutSessions', sessionId), (snap) => {
    callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as WorkoutSession) : null);
  });
}

/** Listen to a participant's detailed progress. */
export function listenToProgress(
  sessionId: string,
  uid: string,
  callback: (progress: SessionProgress | null) => void,
): () => void {
  return onSnapshot(doc(db, 'workoutSessions', sessionId, 'progress', uid), (snap) => {
    callback(snap.exists() ? (snap.data() as SessionProgress) : null);
  });
}

/** Get all pending session invites for the current user. */
export async function getPendingSessionInvites(): Promise<WorkoutSession[]> {
  const user = auth.currentUser;
  if (!user) return [];

  // Query sessions where user is a participant
  // We need to check participant status client-side since Firestore can't query nested maps
  const q = query(
    collection(db, 'workoutSessions'),
    where('status', '==', 'waiting'),
  );

  try {
    const snap = await getDocs(q);
    const sessions: WorkoutSession[] = [];
    snap.forEach((d) => {
      const session = { id: d.id, ...d.data() } as WorkoutSession;
      const myParticipant = session.participants[user.uid];
      if (myParticipant && myParticipant.status === 'invited') {
        sessions.push(session);
      }
    });
    return sessions;
  } catch {
    return [];
  }
}

/** Delete a session (host only, for cleanup). */
export async function deleteSession(sessionId: string): Promise<void> {
  await deleteDoc(doc(db, 'workoutSessions', sessionId));
}
