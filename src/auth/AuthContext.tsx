import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { User } from 'firebase/auth';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithCredential,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  fetchSignInMethodsForEmail,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth } from '../firebase';
import { migrateLocalStorageToFirestore, pullFirestoreToLocalStorage, setupFirestoreListeners, teardownFirestoreListeners, pullSharedExercises } from '../firestoreSync';
import * as otpService from '../otpService';

const GUEST_MODE_KEY = 'zenith_guest_mode';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isGuest: boolean;
  signInWithGoogle: () => Promise<void>;
  signInOrRegisterWithEmail: (email: string, password: string) => Promise<{ isNewUser: boolean }>;
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

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
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
            const didMigrate = await migrateLocalStorageToFirestore(firebaseUser.uid);
            if (!didMigrate) {
              await pullFirestoreToLocalStorage(firebaseUser.uid);
            }
            await pullSharedExercises();
            onDataRefresh?.();
            setupFirestoreListeners(firebaseUser.uid, () => {
              onDataRefresh?.();
            });
          } catch (err) {
            console.error('[Auth] Migration/sync error:', err);
            // Best-effort: still attach the listener so future syncs work.
            setupFirestoreListeners(firebaseUser.uid, () => {
              onDataRefresh?.();
            });
          }
        })();
      } else {
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

  // Email + password: auto-detects whether to register or sign in.
  // If user already has a Google account with same email, links the password credential.
  const signInOrRegisterWithEmail = useCallback(async (email: string, password: string): Promise<{ isNewUser: boolean }> => {
    try {
      // Try signing in first
      await signInWithEmailAndPassword(auth, email, password);
      return { isNewUser: false };
    } catch (err: unknown) {
      const firebaseErr = err as { code?: string };

      if (firebaseErr.code === 'auth/user-not-found' || firebaseErr.code === 'auth/invalid-credential') {
        // Check if the email exists with a different provider (e.g., Google)
        const methods = await fetchSignInMethodsForEmail(auth, email);

        if (methods.length > 0 && !methods.includes('password')) {
          // User exists with Google but not password — they need to sign in with Google first,
          // then we can link the password. For now, throw a helpful error.
          throw new Error('This email is registered with Google. Please sign in with Google first, then add a password in Settings.');
        }

        // No account exists — create one
        await createUserWithEmailAndPassword(auth, email, password);
        return { isNewUser: true };
      }

      if (firebaseErr.code === 'auth/wrong-password') {
        throw new Error('Incorrect password. Please try again.');
      }

      if (firebaseErr.code === 'auth/too-many-requests') {
        throw new Error('Too many failed attempts. Please try again later.');
      }

      if (firebaseErr.code === 'auth/weak-password') {
        throw new Error('Password must be at least 6 characters.');
      }

      if (firebaseErr.code === 'auth/email-already-in-use') {
        throw new Error('This email is already registered. Please sign in instead.');
      }

      throw err;
    }
  }, []);

  // Email OTP: send a verification code via EmailJS
  const sendEmailOTP = useCallback(async (email: string) => {
    await otpService.sendOTP(email);
  }, []);

  // Email OTP: verify the code and try to sign in.
  // For NEW users, returns { isNewUser: true } WITHOUT creating the account
  // so LoginView can collect name first. completeOTPRegistration finishes it.
  const verifyEmailOTP = useCallback(async (email: string, code: string): Promise<{ isNewUser: boolean }> => {
    await otpService.verifyOTP(email, code);

    const normalizedEmail = email.toLowerCase().trim();
    const password = await otpService.derivePassword(email);

    try {
      await signInWithEmailAndPassword(auth, normalizedEmail, password);
      return { isNewUser: false };
    } catch (err: unknown) {
      const firebaseErr = err as { code?: string };

      if (firebaseErr.code === 'auth/user-not-found') {
        // Brand new email — don't create yet, let LoginView collect name first
        return { isNewUser: true };
      }

      if (firebaseErr.code === 'auth/invalid-credential' || firebaseErr.code === 'auth/wrong-password') {
        // Email exists but was registered via Google or old password flow.
        // OTP proved they own the email, so try creating password provider.
        // This will fail with email-already-in-use if user exists with any provider.
        try {
          await createUserWithEmailAndPassword(auth, normalizedEmail, password);
          return { isNewUser: false };
        } catch (innerErr: unknown) {
          const innerCode = (innerErr as { code?: string }).code;
          if (innerCode === 'auth/email-already-in-use') {
            throw new Error('This email is registered with Google. Please use "Continue with Google" to sign in.');
          }
          throw innerErr;
        }
      }

      throw err;
    }
  }, []);

  // Complete OTP registration: creates account with displayName already set.
  // Called AFTER name is collected so onAuthStateChanged navigates with name ready.
  const completeOTPRegistration = useCallback(async (email: string, displayName: string) => {
    const normalizedEmail = email.toLowerCase().trim();
    const password = await otpService.derivePassword(email);
    const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
    await updateProfile(credential.user, { displayName });
    // Force context to pick up the displayName immediately
    setUser({ ...credential.user } as User);
  }, []);

  const signOut = useCallback(async () => {
    teardownFirestoreListeners();
    await firebaseSignOut(auth);
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
    <AuthContext.Provider value={{ user, loading, isGuest, signInWithGoogle, signInOrRegisterWithEmail, sendEmailOTP, verifyEmailOTP, completeOTPRegistration, signOut, enterGuestMode, exitGuestMode }}>
      {children}
    </AuthContext.Provider>
  );
}
