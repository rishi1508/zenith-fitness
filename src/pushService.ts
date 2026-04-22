import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import { doc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { db, auth } from './firebase';

/**
 * @capacitor/push-notifications ships with the app, so on Android APK /
 * iOS builds we use it directly. On web we fall back to the Firebase
 * Web SDK (service worker + VAPID). `Capacitor.isNativePlatform()` is
 * the runtime switch.
 */

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
  if (Capacitor.isNativePlatform()) return true;
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!('Notification' in window)) return false;
  try { return await isSupported(); } catch { return false; }
}

/** Current permission state ('granted' | 'denied' | 'prompt' | 'unsupported'). */
export async function pushPermissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> {
  if (!(await pushSupported())) return 'unsupported';
  if (Capacitor.isNativePlatform()) {
    // checkPermissions() is the read-only variant. Using requestPermissions()
    // here would *prompt* every time the Settings screen renders on
    // Android < 13 (where no OS prompt is needed, permission is auto-granted).
    try {
      const result = await PushNotifications.checkPermissions();
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
  if (Capacitor.isNativePlatform()) {
    try {
      // Ensure a 'default' channel exists on Android 8+. FCM pushes from
      // api/push.ts use channelId: 'default'; without a matching channel,
      // Android silently drops the notification. Idempotent — create is
      // a no-op if the channel is already there.
      if (Capacitor.getPlatform() === 'android') {
        try {
          await PushNotifications.createChannel({
            id: 'default',
            name: 'General',
            description: 'General app notifications',
            importance: 4, // IMPORTANCE_HIGH → heads-up notification
            visibility: 1, // VISIBILITY_PUBLIC
            lights: true,
            vibration: true,
          });
        } catch (err) {
          console.warn('[Push] createChannel failed (continuing):', err);
        }
      }

      const perm = await PushNotifications.requestPermissions();
      console.info('[Push] native requestPermissions →', perm.receive);
      if (perm.receive !== 'granted') return null;

      return await new Promise<string | null>((resolve) => {
        let resolved = false;
        const settle = (v: string | null) => { if (!resolved) { resolved = true; resolve(v); } };

        // Listeners must be attached BEFORE register() so the very first
        // event (which can fire synchronously on some devices) isn't lost.
        PushNotifications.addListener('registration', async (t) => {
          console.info('[Push] native registration got token:', t.value.slice(0, 20) + '…');
          try {
            await setDoc(
              doc(db, 'userProfiles', user.uid, 'fcmTokens', t.value),
              { token: t.value, createdAt: new Date().toISOString(), platform: Capacitor.getPlatform() },
            );
            console.info('[Push] native token saved to Firestore');
          } catch (err) { console.error('[Push] token save FAILED — check Firestore rules for userProfiles/{uid}/fcmTokens:', err); }
          settle(t.value);
        });
        PushNotifications.addListener('registrationError', (err) => {
          console.warn('[Push] native registration error:', err);
          settle(null);
        });

        PushNotifications.register()
          .then(() => console.info('[Push] native register() resolved, awaiting token…'))
          .catch((err: unknown) => { console.warn('[Push] native register failed:', err); settle(null); });

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
    // Reuse the single SW registered by main.tsx at scope '/'. Previously we
    // also registered '/firebase-messaging-sw.js' here, which fought the app
    // SW for the same scope and caused the "AbortError: Registration failed
    // - push service error" from getToken(). The unified /sw.js now loads
    // the Firebase messaging compat scripts itself, so we just hand FCM
    // that registration. See public/sw.js for the merged code.
    const reg = await navigator.serviceWorker.ready;

    // Clean up any stale firebase-messaging-sw.js registration left over
    // from pre-3.14.10 versions so it never reclaims the scope again.
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL;
        if (url && url.endsWith('/firebase-messaging-sw.js')) {
          console.info('[Push] unregistering legacy firebase-messaging-sw.js');
          await r.unregister();
        }
      }
    } catch { /* best effort */ }

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
    if (!token) {
      console.warn('[Push] web getToken returned empty — VAPID key wrong or FCM blocked');
      return null;
    }
    console.info('[Push] web token acquired:', token.slice(0, 20) + '…');

    // Persist token under the user so a trigger can look it up.
    try {
      await setDoc(
        doc(db, 'userProfiles', user.uid, 'fcmTokens', token),
        { token, createdAt: new Date().toISOString(), ua: navigator.userAgent },
      );
      console.info('[Push] web token saved to Firestore');
    } catch (err) {
      console.error('[Push] token save FAILED — check Firestore rules for userProfiles/{uid}/fcmTokens:', err);
      throw err;
    }

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
  if (!endpoint) {
    console.warn('[Push] deliverPush skipped — VITE_PUSH_ENDPOINT is not set at build time');
    return;
  }
  const user = auth.currentUser;
  if (!user) {
    console.warn('[Push] deliverPush skipped — no authenticated user');
    return;
  }
  if (params.recipientUid === user.uid) {
    console.info('[Push] deliverPush skipped — recipient equals sender');
    return;
  }
  try {
    const idToken = await user.getIdToken();
    console.info('[Push] POST', endpoint, 'recipient:', params.recipientUid, 'title:', params.title);
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, idToken }),
    });
    const text = await resp.text().catch(() => '');
    console.info('[Push] endpoint responded', resp.status, text.slice(0, 200));
  } catch (err) {
    // Don't let a push failure bubble up — the in-app toast is already
    // queued via Firestore, so the notification is not lost.
    console.warn('[Push] deliverPush failed:', err);
  }
}

/**
 * Auto-register a push token on app launch when:
 *   - user is signed in
 *   - permission is already 'granted'
 *   - we don't already have a token for this device in Firestore
 *
 * Self-heals past failures (rule denials, cleared caches, FCM rotations)
 * without requiring the user to tap Enable again.
 */
export async function autoRegisterPushIfNeeded(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  if (!(await pushSupported())) return;

  // Ensure the 'default' notification channel exists on Android regardless
  // of whether we still need to register a token. Users who already had a
  // token before v3.14.10 would otherwise get FCM pushes silently dropped
  // because the server-side channelId has no matching channel on the
  // device. Idempotent.
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    try {
      await PushNotifications.createChannel({
        id: 'default',
        name: 'General',
        description: 'General app notifications',
        importance: 4,
        visibility: 1,
        lights: true,
        vibration: true,
      });
    } catch { /* channel may already exist — ignore */ }
  }

  const state = await pushPermissionState();
  if (state !== 'granted') return; // don't auto-trigger a prompt

  try {
    // Query tokens for this user. If any exist with a length > 50
    // (real FCM tokens are 150+ chars), skip.
    const tokensRef = collection(db, 'userProfiles', user.uid, 'fcmTokens');
    const snap = await getDocs(tokensRef);
    const hasRealToken = snap.docs.some((d) => (d.data() as { token?: string }).token && (d.data() as { token: string }).token.length > 50);
    if (hasRealToken) {
      console.info('[Push] auto-register skipped — token already on file');
      return;
    }
  } catch (err) {
    console.warn('[Push] auto-register list check failed:', err);
  }

  console.info('[Push] auto-register: permission granted but no token — registering');
  const token = await enablePushNotifications();
  if (token) console.info('[Push] auto-register: token saved');
  else console.warn('[Push] auto-register: failed to acquire token');
}

/** Wire up the "user tapped a push" handlers so the app can deep-link into
 *  the chat / session the push is about.
 *
 *  Both the native Capacitor event and the Web Push notificationclick path
 *  funnel into a single `zenith-push-tap` CustomEvent on `window`. App.tsx
 *  listens for that event once and routes the user. Call this ONCE on app
 *  start.
 */
export function attachPushTapHandler(): () => void {
  const unsubs: Array<() => void> = [];

  // ---- Native (Capacitor) ----
  if (Capacitor.isNativePlatform()) {
    try {
      const handle = PushNotifications.addListener(
        'pushNotificationActionPerformed',
        (event) => {
          const data = event.notification?.data as Record<string, string> | undefined;
          console.info('[Push] native tap → data:', data);
          if (data) {
            window.dispatchEvent(new CustomEvent('zenith-push-tap', { detail: data }));
          }
        },
      );
      // addListener returns a Promise<PluginListenerHandle> on newer
      // Capacitor — handle both shapes defensively.
      unsubs.push(() => {
        Promise.resolve(handle).then((h) => h?.remove?.()).catch(() => {});
      });
    } catch (err) {
      console.warn('[Push] attachPushTapHandler (native) failed:', err);
    }
  }

  // ---- Web Push ----
  // The unified /sw.js posts a { type: 'zenith-push-tap', data } message to
  // the controlling client when the user clicks a system notification.
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    const onMsg = (event: MessageEvent) => {
      const payload = event.data;
      if (payload && typeof payload === 'object' && payload.type === 'zenith-push-tap') {
        console.info('[Push] web tap → data:', payload.data);
        window.dispatchEvent(new CustomEvent('zenith-push-tap', { detail: payload.data || {} }));
      }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    unsubs.push(() => navigator.serviceWorker.removeEventListener('message', onMsg));
  }

  // Cold-start case (web): the SW opens /?chatId=…&fromUid=…&type=… so the
  // React app can pick it up even if it hadn't been alive when the push
  // was tapped. We replay that into the same CustomEvent channel.
  if (typeof window !== 'undefined' && window.location.search) {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has('chatId') && params.get('type') === 'chat_message') {
        const data = {
          chatId: params.get('chatId') || '',
          type: 'chat_message',
          fromUid: params.get('fromUid') || '',
          fromName: params.get('fromName') || '',
        };
        console.info('[Push] cold-start tap from URL:', data);
        // Fire after mount so App.tsx's listener is attached first.
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('zenith-push-tap', { detail: data }));
          // Strip query so a refresh doesn't re-open the chat.
          try {
            window.history.replaceState({}, '', window.location.pathname);
          } catch { /* ignore */ }
        }, 100);
      }
    } catch { /* ignore */ }
  }

  return () => { for (const u of unsubs) { try { u(); } catch { /* ignore */ } } };
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
