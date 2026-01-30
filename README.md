# Zenith Fitness 🔥

Your personal workout tracker, built by Zenith ⚡

## Features

- **Workout Templates** — Pre-built 4-day full body split + arms day
- **Active Workout Tracking** — Log weight, reps, mark sets complete
- **Rest Timer** — Auto-starts after completing sets, with vibration alerts
- **Stats Dashboard** — Track streaks, weekly workouts, total progress
- **Workout History** — View and manage past workouts
- **Offline Support** — Works without internet (PWA)
- **Auto-Updates** — Get notified when new versions are available

## Installation

### Option 1: Download APK (Recommended)
1. Go to [Releases](https://github.com/LordZenith/zenith-fitness/releases)
2. Download the latest `zenith-fitness-vX.X.X.apk`
3. Install on your Android phone

### Option 2: PWA (Browser)
1. Open the app URL in Chrome on your phone
2. Tap the menu (⋮) → "Add to Home Screen"
3. Use like a native app!

## Development

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Build for production
npm run build

# Sync to Android
npx cap sync android
```

## Building APK Locally

Requires Java 17+ and Android SDK.

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

APK will be at `android/app/build/outputs/apk/debug/app-debug.apk`

## Tech Stack

- **Frontend:** React + TypeScript + Tailwind CSS
- **Build:** Vite
- **Mobile:** Capacitor (Android)
- **Storage:** localStorage (offline-first)

## Screenshots

*Coming soon*

---

Built with 💪 by Zenith ⚡
