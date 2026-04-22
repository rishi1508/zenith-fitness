import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db, auth } from './firebase';

/**
 * Web Push wiring for Firebase Cloud Messaging.
 *
 * To complete setup, the project owner needs to:
 *   1. Create a Web Push certificate in the Firebase console
 *      (Project settings → Cloud Messaging → Web configuration).
 *   2. Paste the resulting public VAPID key into
 *      VITE_FCM_VAPID_KEY (see .env.example).
 *   3. Deploy /public/firebase-messaging-sw.js (shipped alongside
 *      this file) so background pushes are handled.
 *
 * Until step 2 is done this module becomes a no-op — everything
 * else in the app continues to work.
 */

const VAPID_KEY = import.meta.env.VITE_FCM_VAPID_KEY as string | undefined;

// Firebase Messaging reuses the default app initialized in firebase.ts.

/** True if this runtime can receive web push (service worker + notifications API). */
export async function pushSupported(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!('Notification' in window)) return false;
  try { return await isSupported(); } catch { return false; }
}

/**
 * Register the service worker, request notification permission, fetch
 * an FCM token, and persist it at `userProfiles/{uid}/tokens/{token}`
 * so a server-side trigger can fan out pushes. Safe to call multiple
 * times — idempotent token write.
 *
 * Returns the token on success, null otherwise.
 */
export async function enablePushNotifications(): Promise<string | null> {
  if (!VAPID_KEY) {
    console.info('[Push] VAPID key missing — push is disabled. Set VITE_FCM_VAPID_KEY.');
    return null;
  }
  if (!(await pushSupported())) return null;
  const user = auth.currentUser;
  if (!user) return null;

  try {
    // Firebase expects the messaging sw at /firebase-messaging-sw.js by default.
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      console.info('[Push] Permission not granted:', perm);
      return null;
    }

    const messaging = getMessaging();
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg,
    });
    if (!token) return null;

    // Persist token under the user so a trigger can look it up.
    await setDoc(
      doc(db, 'userProfiles', user.uid, 'fcmTokens', token),
      { token, createdAt: new Date().toISOString(), ua: navigator.userAgent },
    );

    // Foreground messages — route through the existing in-app toast.
    onMessage(messaging, (payload) => {
      console.info('[Push] Foreground message:', payload);
      // The normal Firestore notification listener surfaces this
      // already — leaving the console line for debugging only.
    });

    return token;
  } catch (err) {
    console.warn('[Push] enable failed:', err);
    return null;
  }
}

/** Revoke the current device's token. */
export async function disablePushNotifications(token: string | null): Promise<void> {
  if (!token) return;
  const user = auth.currentUser;
  if (!user) return;
  try {
    await deleteDoc(doc(db, 'userProfiles', user.uid, 'fcmTokens', token));
  } catch { /* ignore */ }
}
