# Manual setup — push notifications & health sync

## A. Push notifications

Goal: buddy messages + session invites show up in the Android notification
tray even when the app is closed. 100 % free using Vercel's hobby tier.

There are **4 steps**. Each is 3–5 min.

---

### Step 1 — Get your Firebase Web Push VAPID key

(Needed for the web / PWA path. APK uses a different mechanism; step 3.)

1. Open [Firebase Console → Cloud Messaging](https://console.firebase.google.com/project/zenith-fitness-18e2a/settings/cloudmessaging).
2. **Web configuration → Web Push certificates → Generate key pair**.
3. Copy the long string shown under "Key pair".

Save it — you'll paste it in step 4.

---

### Step 2 — Get your Firebase service-account JSON

(Used by the Vercel function to send pushes on behalf of your project.)

1. Firebase Console → **Project settings → Service accounts → Generate
   new private key**. Confirm, a JSON file downloads.
2. Open it — you'll need three fields from it in step 3:
   - `project_id`
   - `client_email`
   - `private_key` (the long multi-line `-----BEGIN PRIVATE KEY-----…`)

Keep the file safe; treat it like a password.

---

### Step 3 — Deploy the Vercel push function

The app already ships `api/push.ts` and `vercel.json`. You just need to
deploy them to your Vercel account.

From the repo root on your machine:

```bash
npm install -g vercel          # if you don't have the CLI
vercel login
vercel                         # first run asks: link to existing project? → No, create new
vercel env add FIREBASE_PROJECT_ID            # paste the project_id value
vercel env add FIREBASE_CLIENT_EMAIL          # paste the client_email value
vercel env add FIREBASE_PRIVATE_KEY           # paste the WHOLE private_key value including BEGIN/END lines
vercel --prod                  # deploy to production
```

When asked **"Which scope"**, pick your personal account.
For each `env add`, choose **Production** (and optionally Preview). The
CLI accepts multi-line input for the private key — paste it as-is.

After `vercel --prod` finishes, note the production URL it prints, e.g.:
```
https://zenith-fitness-abc123.vercel.app
```

Your push endpoint is **that URL + `/api/push`** — that's what the web
app calls. Save it for step 4.

**Verify it works:** run
```bash
curl -X POST https://your-project.vercel.app/api/push -H 'Content-Type: application/json' -d '{}'
```
You should get a 400 with `{"error":"recipientUid, title, idToken required"}` —
that's good, it means the function is reachable and auth-checking.

---

### Step 4 — Wire the keys into your app build

Two env vars need to land in the Firebase-hosted web app build:

- `VITE_FCM_VAPID_KEY` — the VAPID key from step 1
- `VITE_PUSH_ENDPOINT` — the Vercel URL from step 3 (include `/api/push`)

**For CI builds** (what github.com/rishi1508/zenith-fitness deploys):

1. GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**.
   Add both secrets with those exact names.
2. Tell me to update `.github/workflows/build-apk.yml` to inject them —
   that's a one-line change per secret. Or do it yourself by adding
   inside the "Build web app" step:
   ```yaml
   env:
     VITE_FCM_VAPID_KEY: ${{ secrets.VITE_FCM_VAPID_KEY }}
     VITE_PUSH_ENDPOINT: ${{ secrets.VITE_PUSH_ENDPOINT }}
   ```

**For local testing:** create `.env.local` in the repo root with both
values, then `npm run dev`.

---

### Step 5 (optional but recommended) — Install the native Capacitor push plugin

For the Android APK specifically, add native push:

```bash
npm install @capacitor/push-notifications
npx cap sync android
```

The plugin auto-adds `POST_NOTIFICATIONS` to the Android manifest.
Rebuild the APK.

Once the plugin is in the APK, `pushService.ts` automatically takes the
native branch — no code change required.

---

### Step 6 — Test the whole flow

1. Install the APK on your phone (or open the PWA in Chrome).
2. Sign in. The bottom-sheet prompt appears ~1.5 s after login asking to
   enable notifications. Tap **Enable**, accept the OS dialog.
3. On a second phone / browser, sign in as a different user and send a
   chat message to you.
4. Within a few seconds the notification appears in your Android
   notification tray. Tap it → the app opens to the chat.

**If nothing shows up:** open browser devtools / `adb logcat` and look
for `[Push]` log lines. The Vercel function logs also help — `vercel logs`
from the CLI, or the Deployments tab in the Vercel dashboard.

---

### How the permission UX works

- **Soft in-app prompt** — slides up from the bottom 1.5 s after login,
  once per device per user. Offers **Enable notifications** / **Not now**.
- **Settings → Push notifications** — always available. Shows:
  - "Enable notifications" button when permission is `prompt`
  - "✓ Enabled on this device" when `granted`
  - A note explaining how to re-enable via OS settings when `denied`
- **If the user taps "Deny" on the OS prompt**, browsers / Android block
  in-app re-prompts. They must go to:
  - **Chrome PWA**: the lock icon in the URL bar → Site settings → Notifications → Allow.
  - **Android APK**: system Settings → Apps → Zenith Fitness → Notifications → On.

---

## B. Health sync (Apple Health / Google Health Connect)

Still optional, same as before — each finished workout is pushed to the
phone's Health store.

### B1. Install the plugins

```bash
npm install @capacitor-community/health-connect @perfood/capacitor-healthkit
npx cap sync
```

### B2. Android permissions

Add inside `<manifest>` in `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.health.WRITE_EXERCISE" />
<uses-permission android:name="android.permission.health.WRITE_ACTIVE_CALORIES_BURNED" />
<queries>
  <package android:name="com.google.android.apps.healthdata" />
</queries>
```

Health Connect must be installed on the device (bundled on newer Android,
downloadable from Play Store otherwise).

### B3. iOS permissions

Edit `ios/App/App/Info.plist`:

```xml
<key>NSHealthShareUsageDescription</key>
<string>Zenith Fitness reads your body data to show it in the app.</string>
<key>NSHealthUpdateUsageDescription</key>
<string>Zenith Fitness writes your workouts to Apple Health so they show up alongside other activities.</string>
```

### B4. Enable in app

Once built and installed, **Settings → Health sync** becomes active.
Toggle on — every finished workout is pushed automatically.
