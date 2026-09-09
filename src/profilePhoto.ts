import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

/**
 * Where a self-uploaded avatar actually lives.
 *
 * Not in Firebase Auth's `photoURL`: that field is capped (a few kB at
 * most), so writing a data URI to it fails outright — "photo upload failed,
 * URL too large". Google sign-ins put a real https URL there and that keeps
 * working; anything the user picks themselves goes to their `userProfiles`
 * document, which buddies already read, plus a local copy so the app paints
 * it before Firestore answers.
 */

const KEY = 'zenith_profile_photo';

/** The photo this device has for the signed-in user, if any. */
export function getLocalProfilePhoto(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { uid, dataUri } = JSON.parse(raw) as { uid: string; dataUri: string };
    return uid === auth.currentUser?.uid ? dataUri : null;
  } catch {
    return null;
  }
}

/** The one to show: what they uploaded, else whatever the provider gave us. */
export function effectiveProfilePhoto(authPhotoURL?: string | null): string | null {
  return getLocalProfilePhoto() ?? authPhotoURL ?? null;
}

/**
 * Saves an avatar. Writes the profile document (so buddies and the gym see
 * it) and caches it locally. Never touches Auth's photoURL with a data URI.
 */
export async function saveProfilePhoto(dataUri: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to change your photo');
  try {
    localStorage.setItem(KEY, JSON.stringify({ uid: user.uid, dataUri }));
  } catch { /* private mode — the profile write below still counts */ }
  await setDoc(doc(db, 'userProfiles', user.uid), { photoURL: dataUri }, { merge: true });
  window.dispatchEvent(new Event('zenith-profile-photo'));
}

export function clearLocalProfilePhoto(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
