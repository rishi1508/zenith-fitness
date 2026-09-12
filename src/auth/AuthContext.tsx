import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { User } from 'firebase/auth';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth } from '../firebase';
import { migrateLocalStorageToFirestore, pullFirestoreToLocalStorage, setupFirestoreListeners, teardownFirestoreListeners, flushPendingWrites, setCurrentUserId } from '../firestoreSync';
import { startSharedExerciseSync, stopSharedExerciseSync } from '../sharedExercises';
import * as otpService from '../otpService';

const GUEST_MODE_KEY = 'zenith_guest_mode';
const LAST_UID_KEY = 'zenith_last_uid';
// Device-level preferences that survive a sign-out / account switch. Everything
// else under `zenith_*` is one user's data and must not leak into the next
// account on a shared phone or gym tablet.
const DEVICE_KEYS = new Set([GUEST_MODE_KEY, LAST_UID_KEY, 'zenith_theme', 'zenith_device_guest_backup']);

/** Guest data set aside when a guest signs in to an account that already has
 *  cloud data. Device-scoped (survives clearLocalUserData) so Settings → Data
 *  & backup can offer it back. */
export const GUEST_BACKUP_KEY = 'zenith_device_guest_backup';
function parkGuestData(): void {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('zenith_') && !DEVICE_KEYS.has(k) && k !== 'zenith_sync_meta');
    const data: Record<string, string> = {};
    let hasContent = false;
    for (const k of keys) { const v = localStorage.getItem(k); if (v !== null) { data[k] = v; if (k === 'zenith_workouts' && v.length > 2) hasContent = true; } }
    if (!hasContent) { for (const k of keys) localStorage.removeItem(k); return; }
    localStorage.setItem(GUEST_BACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), data }));
    for (const k of keys) localStorage.removeItem(k);
  } catch { /* storage unavailable */ }
}

function clearLocalUserData(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('zenith_') && !DEVICE_KEYS.has(key)) localStorage.removeItem(key);
    }
  } catch { /* storage unavailable */ }
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isGuest: boolean;
  signInWithGoogle: () => Promise<void>;
  sendEmailOTP: (email: string) => Promise<void>;
  verifyEmailOTP: (email: string, code: string) => Promise<{ isNewUser: boolean }>;
  completeOTPRegistration: (email: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  enterGuestMode: () => void;
  exitGuestMode: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const onDataRefresh = useCallback(() => window.dispatchEvent(new Event('zenith-data-refresh')), []);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Ticket handed back by /api/otp for a NEW email between "code verified"
  // and "name entered". Never persisted.
  const pendingOtpTicket = useRef<{ email: string; ticket: string } | null>(null);
  const [isGuest, setIsGuest] = useState(() => {
    try { return localStorage.getItem(GUEST_MODE_KEY) === 'true'; } catch { return false; }
  });

  // Handle Google redirect result (for iOS where popup doesn't work)
  useEffect(() => {
    getRedirectResult(auth).catch((err) => {
      if (err?.code !== 'auth/redirect-cancelled-by-user') {
        console.error('[Auth] Redirect result error:', err);
      }
    });
  }, []);

  // DEV-only headless QA sign-in: ?__devToken=<Firebase custom token>, or
  // ?__devEmail=…&__devPassword=… for the seeded QA accounts, lets an
  // autopilot QA agent sign in without the interactive login flow.
  // Guarded by import.meta.env.DEV, which Vite inlines at build time, so
  // this branch is dead code (and the params are ignored) in production
  // builds. The params are stripped from the URL immediately so a reload
  // or a shared link doesn't replay them.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('__devToken');
    const email = params.get('__devEmail');
    const password = params.get('__devPassword');
    if (!token && !(email && password)) return;
    for (const k of ['__devToken', '__devEmail', '__devPassword']) params.delete(k);
    const nextSearch = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (nextSearch ? `?${nextSearch}` : '') + window.location.hash);
    const signIn = token
      ? signInWithCustomToken(auth, token)
      : signInWithEmailAndPassword(auth, email!, password!);
    signIn.catch((err) => {
      console.error('[Auth] DEV sign-in failed:', err);
    });
  }, []);

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        // A different account than the last one on this device: wipe the
        // previous user's local data BEFORE migrate/pull, otherwise their
        // workouts would be uploaded into this account (first login) or
        // out-vote this account's cloud copy (the "local is longer" guard).
        // A guest session (no last uid) is meant to carry into the new
        // account, so it is left alone.
        try {
          const lastUid = localStorage.getItem(LAST_UID_KEY);
          if (lastUid && lastUid !== firebaseUser.uid) clearLocalUserData();
          localStorage.setItem(LAST_UID_KEY, firebaseUser.uid);
        } catch { /* ignore */ }
        setUser(firebaseUser);
        setIsGuest(false);
        setLoading(false);
        try { localStorage.removeItem(GUEST_MODE_KEY); } catch { /* ignore */ }

        // Background sync — and CRUCIALLY, set up the realtime listener
        // only AFTER the protective pull completes. Earlier we set up
        // the listener in parallel with the pull, which introduced a
        // race: the listener's first onSnapshot fires within
        // milliseconds of subscribe, unconditionally overwriting
        // localStorage with whatever Firestore has. If the user closed
        // the app before flushPendingWrites finished on the previous
        // session, Firestore was still holding STALE data — the
        // listener would then overwrite the user's local-only edits
        // (e.g. exercise notes they just saved) before the protective
        // pullFirestoreToLocalStorage (which has a length-heuristic
        // guard) could intervene. Deferring to after-pull means the
        // listener only handles legitimate future remote changes.
        (async () => {
          try {
            const wasGuest = (() => { try { return localStorage.getItem(GUEST_MODE_KEY) === 'true' || !localStorage.getItem(LAST_UID_KEY); } catch { return false; } })();
            const didMigrate = await migrateLocalStorageToFirestore(firebaseUser.uid);
            if (!didMigrate) {
              // A guest session signing in to an EXISTING account: the two
              // histories cannot be merged safely (whole-array documents), and
              // silently letting either one overwrite the other lost data both
              // ways. The account's cloud copy wins; the guest data is parked
              // as a backup this device can restore from Settings.
              if (wasGuest) parkGuestData();
              await pullFirestoreToLocalStorage(firebaseUser.uid);
            }
            onDataRefresh?.();
            setupFirestoreListeners(firebaseUser.uid, () => {
              onDataRefresh?.();
            });
            // Shared exercise library — live merge into the local library.
            // Goes through storage.saveExercises so the per-user doc picks
            // it up too (the old one-shot pull wrote localStorage directly
            // and the per-user listener then clobbered it).
            startSharedExerciseSync(() => onDataRefresh?.());
          } catch (err) {
            console.error('[Auth] Migration/sync error:', err);
            // Best-effort: still attach the listener so future syncs work.
            setupFirestoreListeners(firebaseUser.uid, () => {
              onDataRefresh?.();
            });
          }
        })();
      } else {
        // Nothing queued may survive into the next account.
        setCurrentUserId(null);
        setUser(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [onDataRefresh]);

  const signInWithGoogle = useCallback(async () => {
    if (Capacitor.isNativePlatform()) {
      // Native Android: use Capacitor plugin for native Google Sign-In
      const result = await FirebaseAuthentication.signInWithGoogle();
      const idToken = result.credential?.idToken;
      if (idToken) {
        const credential = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(auth, credential);
      }
    } else if (isIOS()) {
      // iOS Safari/PWA: popup is unreliable, use redirect
      const provider = new GoogleAuthProvider();
      await signInWithRedirect(auth, provider);
    } else {
      // Desktop/Android browser: popup works fine
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    }
  }, []);

  // Email OTP: send a verification code via EmailJS
  const sendEmailOTP = useCallback(async (email: string) => {
    await otpService.sendOTP(email);
  }, []);

  // Email OTP: the server checks the code. An existing account (any
  // provider — the email is proven) comes back with a custom token and we
  // sign in immediately. A brand-new email comes back with a short-lived
  // ticket instead, so LoginView can collect a name before the account is
  // created (completeOTPRegistration).
  const verifyEmailOTP = useCallback(async (email: string, code: string): Promise<{ isNewUser: boolean }> => {
    const result = await otpService.verifyOTP(email, code);
    if (result.token) {
      await signInWithCustomToken(auth, result.token);
      return { isNewUser: false };
    }
    if (!result.ticket) throw new Error('Verification failed. Please request a new code.');
    pendingOtpTicket.current = { email: email.trim().toLowerCase(), ticket: result.ticket };
    return { isNewUser: true };
  }, []);

  // Complete OTP registration: the server creates the account with the
  // display name already set and returns a custom token, so
  // onAuthStateChanged fires with the name ready.
  const completeOTPRegistration = useCallback(async (email: string, displayName: string) => {
    const pending = pendingOtpTicket.current;
    if (!pending || pending.email !== email.trim().toLowerCase()) {
      throw new Error('Verification expired. Please request a new code.');
    }
    const { token } = await otpService.completeRegistration(email, pending.ticket, displayName);
    pendingOtpTicket.current = null;
    const credential = await signInWithCustomToken(auth, token);
    setUser({ ...credential.user } as User);
  }, []);

  const signOut = useCallback(async () => {
    // Push the last debounced edits before the listeners go away, then
    // remove this user's data from the device.
    try { await flushPendingWrites(); } catch { /* best-effort */ }
    teardownFirestoreListeners();
    setCurrentUserId(null);
    stopSharedExerciseSync();
    await firebaseSignOut(auth);
    clearLocalUserData();
    try { localStorage.removeItem(LAST_UID_KEY); } catch { /* ignore */ }
    setUser(null);
  }, []);

  const enterGuestMode = useCallback(() => {
    setIsGuest(true);
    try { localStorage.setItem(GUEST_MODE_KEY, 'true'); } catch { /* ignore */ }
  }, []);

  const exitGuestMode = useCallback(() => {
    setIsGuest(false);
    try { localStorage.removeItem(GUEST_MODE_KEY); } catch { /* ignore */ }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, isGuest, signInWithGoogle, sendEmailOTP, verifyEmailOTP, completeOTPRegistration, signOut, enterGuestMode, exitGuestMode }}>
      {children}
    </AuthContext.Provider>
  );
}
