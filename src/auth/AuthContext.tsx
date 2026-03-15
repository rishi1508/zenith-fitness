import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { User } from 'firebase/auth';
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { auth } from '../firebase';
import { migrateLocalStorageToFirestore, pullFirestoreToLocalStorage, setupFirestoreListeners, teardownFirestoreListeners, pullSharedExercises } from '../firestoreSync';

const GUEST_MODE_KEY = 'zenith_guest_mode';
const EMAIL_FOR_SIGNIN_KEY = 'zenith_email_for_signin';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isGuest: boolean;
  signInWithGoogle: () => Promise<void>;
  sendEmailLink: (email: string) => Promise<void>;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  // Use custom event to notify App to refresh data after auth sync
  const onDataRefresh = useCallback(() => window.dispatchEvent(new Event('zenith-data-refresh')), []);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(() => {
    try { return localStorage.getItem(GUEST_MODE_KEY) === 'true'; } catch { return false; }
  });

  // Handle email link sign-in completion (user clicked the magic link)
  useEffect(() => {
    if (isSignInWithEmailLink(auth, window.location.href)) {
      let email = localStorage.getItem(EMAIL_FOR_SIGNIN_KEY);
      if (!email) {
        email = window.prompt('Please provide your email for confirmation');
      }
      if (email) {
        signInWithEmailLink(auth, email, window.location.href)
          .then(() => {
            localStorage.removeItem(EMAIL_FOR_SIGNIN_KEY);
            // Clean up the URL
            window.history.replaceState(null, '', window.location.pathname);
          })
          .catch((err) => {
            console.error('[Auth] Email link sign-in failed:', err);
          });
      }
    }
  }, []);

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        setIsGuest(false);
        try { localStorage.removeItem(GUEST_MODE_KEY); } catch { /* ignore */ }

        // Migration / sync logic
        try {
          const didMigrate = await migrateLocalStorageToFirestore(firebaseUser.uid);
          if (!didMigrate) {
            await pullFirestoreToLocalStorage(firebaseUser.uid);
          }
          // Pull shared exercise library from all users
          await pullSharedExercises();
          onDataRefresh?.();
        } catch (err) {
          console.error('[Auth] Migration/sync error:', err);
        }

        // Set up real-time listeners for cross-device sync
        setupFirestoreListeners(firebaseUser.uid, () => {
          onDataRefresh?.();
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [onDataRefresh]);

  const signInWithGoogle = useCallback(async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  }, []);

  const sendEmailLink = useCallback(async (email: string) => {
    const actionCodeSettings = {
      url: window.location.origin + window.location.pathname,
      handleCodeInApp: true,
    };
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    localStorage.setItem(EMAIL_FOR_SIGNIN_KEY, email);
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
    <AuthContext.Provider value={{ user, loading, isGuest, signInWithGoogle, sendEmailLink, signOut, enterGuestMode, exitGuestMode }}>
      {children}
    </AuthContext.Provider>
  );
}
