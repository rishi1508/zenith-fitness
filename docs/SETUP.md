# Manual setup — push notifications & health sync

Two features ship "off by default" because they need keys / native plugins
that can't be committed to git. Run these once and they're live forever.

## A. Push notifications (Android APK + web)

The goal: when a buddy messages you, the notification shows up in the
Android notification tray (the shade you swipe down from the top), even
if the app isn't open.

There are three parts:
1. **FCM key setup** (one-time, Firebase console + env var).
2. **Capacitor push plugin** (one-time, needed for the APK build).
3. **Server-side fan-out** (one-time, Cloud Function that actually sends
   the push).

### A1. Get your Web Push VAPID key

1. Open https://console.firebase.google.com/project/zenith-fitness-18e2a/settings/cloudmessaging
2. Scroll to **Web configuration → Web Push certificates**.
3. Click **Generate key pair** if there isn't one. Copy the long string
   shown under "Key pair".
4. Paste it into GitHub: https://github.com/rishi1508/zenith-fitness/settings/secrets/actions
   → **New repository secret** → name `VITE_FCM_VAPID_KEY`, paste the key.
5. Edit `.github/workflows/build-apk.yml` and add the env var to the
   `Build web app` step (I'll do this if you let me know; easy one-liner).
   Or, for quick local testing, create `.env.local` in the repo root:
   ```
   VITE_FCM_VAPID_KEY=<paste your key>
   ```
   and rebuild.

After this, Settings → Push notifications shows an **Enable notifications**
button in the PWA. Tapping it triggers the browser's permission dialog.

### A2. Install the Capacitor push plugin (for the Android APK)

Web Push works in Chrome. For the APK you need the native plugin.

From the repo root:

```bash
npm install @capacitor/push-notifications
npx cap sync android
```

Android side — `android/app/src/main/AndroidManifest.xml` should already
have `<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>`
thanks to the plugin's manifest merge. If not, add it inside `<manifest>`.

Rebuild the APK:
```bash
cd android && ./gradlew assembleRelease
```

Once the APK has the plugin, `pushService.ts` automatically takes the
native branch on that device. No code change required.

### A3. Server-side fan-out (sends the actual push)

Right now the app writes to `notifications/{uid}/items` when a buddy
messages you. The in-app toast sees it, but the OS doesn't. You need a
Cloud Function that listens for those writes and forwards them to FCM.

1. In the Firebase console, enable **Cloud Functions** (if you haven't).
2. Create `functions/src/index.ts` (or let me do it — ask and I'll write
   the whole Function) with something like:
   ```ts
   exports.onNotification = functions.firestore
     .document('notifications/{uid}/items/{notifId}')
     .onCreate(async (snap, ctx) => {
       const n = snap.data();
       const tokensSnap = await db.collection(`userProfiles/${ctx.params.uid}/fcmTokens`).get();
       const tokens = tokensSnap.docs.map(d => d.id);
       if (!tokens.length) return;
       await admin.messaging().sendEachForMulticast({
         tokens,
         notification: { title: n.fromName, body: n.message },
         data: { chatId: n.data?.chatId ?? '', sessionId: n.data?.sessionId ?? '' },
       });
     });
   ```
3. Deploy: `firebase deploy --only functions`

After this, any chat message / session invite / buddy request
automatically lights up the notification tray on every device where the
user has granted permission.

### A4. When does the permission prompt appear?

There are three paths:
- **Soft prompt**: 1.5 s after first login on a device, a friendly card
  appears at the bottom of the screen explaining what notifications are
  for. Tapping "Enable notifications" triggers the OS permission dialog.
  Tapping "Not now" hides it (per-device, per-user).
- **Settings → Push notifications**: always available to enable /
  diagnose.
- **OS-level re-enable**: if the user denied once, browsers / Android
  block further in-app prompts. They have to go to:
  - **Chrome**: lock icon in address bar → Site settings → Notifications → Allow.
  - **Android APK**: Settings app → Apps → Zenith Fitness → Notifications → On.

## B. Health sync (Apple Health / Google Health Connect)

Each finished workout gets pushed into the phone's Health store.

### B1. Install the plugins (native only)

```bash
npm install @capacitor-community/health-connect @perfood/capacitor-healthkit
npx cap sync
```

### B2. Android permissions

Edit `android/app/src/main/AndroidManifest.xml` and add inside `<manifest>`:

```xml
<uses-permission android:name="android.permission.health.WRITE_EXERCISE" />
<uses-permission android:name="android.permission.health.WRITE_ACTIVE_CALORIES_BURNED" />
<queries>
  <package android:name="com.google.android.apps.healthdata" />
</queries>
```

Also make sure the device has the Health Connect app installed (newer
Android versions bundle it).

### B3. iOS permissions

Edit `ios/App/App/Info.plist` and add:

```xml
<key>NSHealthShareUsageDescription</key>
<string>Zenith Fitness reads your body data to show it in the app.</string>
<key>NSHealthUpdateUsageDescription</key>
<string>Zenith Fitness writes your workouts to Apple Health so they show up alongside other activities.</string>
```

### B4. Enable in app

Once the APK / iOS build with these plugins runs on the device, the
**Settings → Health sync** toggle becomes active. Flip it on and every
finished workout is pushed automatically.

## Why these can't be auto-configured

- The VAPID key is a secret — committing it would let anyone send pushes
  to your users.
- Capacitor plugins touch native Android / iOS config; `npm install`
  modifies Gradle and cocoapods files that need a full `npx cap sync`.
- Cloud Functions run on Firebase's paid tier (Blaze) — requires a
  billing account decision.
