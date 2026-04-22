import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { db, auth } from './firebase';

// -------- Capacitor native-push bridge (Android APK / iOS) --------
// The @capacitor/push-notifications plugin isn't in package.json yet — we
// lazily ask Capacitor whether it's registered. If not, we fall through
// to the web-push path. Once the user runs:
//
//   npm install @capacitor/push-notifications
//   npx cap sync
//
// ...the plugin becomes available and the native branch takes over on
// APK / iOS builds.
interface NativePushPlugin {
  requestPermissions(): Promise<{ receive: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' }>;
  register(): Promise<void>;
  addListener(eventName: 'registration', cb: (token: { value: string }) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(eventName: 'registrationError', cb: (err: unknown) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(eventName: 'pushNotificationReceived' | 'pushNotificationActionPerformed', cb: (n: unknown) => void): Promise<{ remove: () => Promise<void> }>;
}
const NativePush: NativePushPlugin | null = Capacitor.isPluginAvailable('PushNotifications')
  ? registerPlugin<NativePushPlugin>('PushNotifications')
  : null;

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

/** True if this runtime can receive push — either the native Capacitor
 *  plugin is available (APK / iOS build) or the browser supports web push. */
export async function pushSupported(): Promise<boolean> {
  if (NativePush && Capacitor.isNativePlatform()) return true;
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!('Notification' in window)) return false;
  try { return await isSupported(); } catch { return false; }
}

/** Current permission state ('granted' | 'denied' | 'prompt' | 'unsupported'). */
export async function pushPermissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> {
  if (!(await pushSupported())) return 'unsupported';
  if (NativePush && Capacitor.isNativePlatform()) {
    try {
      const result = await NativePush.requestPermissions();
      return result.receive === 'granted' ? 'granted' : result.receive === 'denied' ? 'denied' : 'prompt';
    } catch { return 'prompt'; }
  }
  const p = Notification.permission;
  return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt';
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
  if (!(await pushSupported())) return null;
  const user = auth.currentUser;
  if (!user) return null;

  // ---- Native (Capacitor APK / iOS) ----
  if (NativePush && Capacitor.isNativePlatform()) {
    try {
      const perm = await NativePush.requestPermissions();
      if (perm.receive !== 'granted') return null;
      return await new Promise<string | null>((resolve) => {
        let resolved = false;
        const settle = (v: string | null) => { if (!resolved) { resolved = true; resolve(v); } };
        NativePush.addListener('registration', async (t) => {
          try {
            await setDoc(
              doc(db, 'userProfiles', user.uid, 'fcmTokens', t.value),
              { token: t.value, createdAt: new Date().toISOString(), platform: Capacitor.getPlatform() },
            );
          } catch (err) { console.warn('[Push] token save failed:', err); }
          settle(t.value);
        });
        NativePush.addListener('registrationError', (err) => {
          console.warn('[Push] native registration error:', err);
          settle(null);
        });
        NativePush.register().catch((err) => { console.warn('[Push] native register failed:', err); settle(null); });
        // Safety timeout — Firebase usually emits within a couple of seconds.
        setTimeout(() => settle(null), 15_000);
      });
    } catch (err) {
      console.warn('[Push] native enable failed:', err);
      return null;
    }
  }

  // ---- Web Push fallback ----
  if (!VAPID_KEY) {
    console.info('[Push] VAPID key missing — web push is disabled. Set VITE_FCM_VAPID_KEY.');
    return null;
  }

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

/**
 * Call the Vercel push endpoint to fan out a notification to the
 * recipient's registered devices. Fire-and-forget — a failure here never
 * blocks the in-app toast, which is already driven by the Firestore
 * write the caller made separately.
 *
 * No-op if VITE_PUSH_ENDPOINT isn't configured (treats push as disabled).
 */
export async function deliverPush(params: {
  recipientUid: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<void> {
  const endpoint = import.meta.env.VITE_PUSH_ENDPOINT as string | undefined;
  if (!endpoint) return;
  const user = auth.currentUser;
  if (!user) return;
  if (params.recipientUid === user.uid) return; // don't push to self
  try {
    const idToken = await user.getIdToken();
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, idToken }),
    });
  } catch (err) {
    // Swallow — the in-app notification is already queued via Firestore.
    console.warn('[Push] deliverPush failed:', err);
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
