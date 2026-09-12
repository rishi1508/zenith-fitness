import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../auth/AuthContext';
import type { UserProfile } from '../types';

/** Live view of the signed-in user's own userProfiles doc. `loaded` flips
 *  once the first snapshot has arrived (the doc may not exist yet). */
export function useMyProfile(): { profile: UserProfile | null; loaded: boolean } {
  const { user, isGuest } = useAuth();
  const [state, setState] = useState<{ uid: string; profile: UserProfile | null; loaded: boolean }>({ uid: '', profile: null, loaded: false });

  useEffect(() => {
    if (!user || isGuest) return;
    const uid = user.uid;
    return onSnapshot(
      doc(db, 'userProfiles', uid),
      (snap) => setState({ uid, profile: snap.exists() ? (snap.data() as UserProfile) : null, loaded: true }),
      (err) => { console.warn('[profile] listener error:', err); setState({ uid, profile: null, loaded: true }); },
    );
  }, [user, isGuest]);

  return state.uid === user?.uid ? { profile: state.profile, loaded: state.loaded } : { profile: null, loaded: false };
}
