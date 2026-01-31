# Zenith Fitness 🔥

Your personal workout tracker — built by Zenith ⚡ for Rishi

**Track. Improve. Dominate.**

![Version](https://img.shields.io/badge/version-1.14.0-orange)
![Platform](https://img.shields.io/badge/platform-Android%20%7C%20PWA-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## ✨ Features

### Core Tracking
- **Workout Templates** — Create custom templates or use pre-built 4-day split
- **Smart Template Selection** — Remembers your last used template, shows it first
- **Active Workout Mode** — Log weight, reps, mark sets complete in real-time
- **Rest Timer** — Preset buttons (30s, 60s, 90s, 2m) with vibration alerts
- **Auto Rest Day Detection** — Prompts to log missed days as rest days

### Progress & Stats
- **Dashboard Stats** — Total Volume, Avg/Session, Weekly Workouts, Total Count
- **Exercise Progress** — Per-exercise analytics with interactive line charts
- **Weekly Insights** — Volume and workout comparisons vs. last week
- **Personal Record Notifications** — Toast + vibration when you hit a new PR 🏆

### Google Sheets Integration
- **Import Workouts** — Pull workout history from Google Sheets
- **Import Exercises** — Load custom exercise lists
- **Import Templates** — Create templates from your workout plans
- **Export Data** — Backup your data to clipboard (JSON format)

### UI/UX
- **Splash Screen** — Animated loading with app branding
- **Dark/Light Mode** — Toggle in Settings, persists across sessions
- **Daily Motivational Quotes** — Fresh inspiration on the home screen
- **Workout Celebration** — Confetti animation when you complete a workout 🎉
- **Search** — Find exercises in progress view
- **Hardware Back Button** — Proper Android back navigation

### Technical
- **Offline Support** — Full PWA capability, works without internet
- **Auto-Updates** — Notification when new versions are available
- **Local Storage** — All data stored on device (privacy-first)
- **Capacitor Native** — Android APK with native features

## 📱 Installation

### Option 1: Download APK (Recommended)
1. Go to [Releases](https://github.com/LordZenith/zenith-fitness/releases)
2. Download the latest `zenith-fitness-vX.X.X.apk`
3. Install on your Android phone
4. Future updates install over existing app (no uninstall needed from v1.5.1+)

### Option 2: PWA (Browser)
1. Visit the app URL in Chrome on your phone
2. Tap the menu (⋮) → "Add to Home Screen"
3. Use like a native app!

## 🛠️ Development

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

## 📦 Building APK Locally

Requires Java 17+ and Android SDK.

```bash
# Build web app
npm run build

# Sync to Android
npx cap sync android

# Build APK
cd android
./gradlew assembleRelease

# APK location: android/app/build/outputs/apk/release/app-release.apk
```

## 🚀 GitHub Actions

The repo includes automated APK builds:
- Push a version tag (e.g., `v1.14.0`) to trigger a release
- APK is automatically built and attached to the GitHub release
- Uses secure signing key from GitHub Secrets

## 📂 Project Structure

```
zenith-fitness/
├── src/
│   ├── App.tsx           # Main React component (all views)
│   ├── storage.ts        # LocalStorage data layer
│   ├── types.ts          # TypeScript interfaces
│   ├── UpdateChecker.tsx # Version check component
│   ├── VolumeLineChart.tsx # Interactive progress chart
│   └── index.css         # Styles + CSS variables for theming
├── android/              # Capacitor Android project
├── .github/workflows/    # CI/CD for APK builds
├── capacitor.config.ts   # Capacitor configuration
└── package.json
```

## 📊 Data Format

Workout data is stored in localStorage as JSON:

```typescript
interface Workout {
  id: string;
  templateId?: string;
  name: string;
  date: string;           // ISO date
  exercises: WorkoutExercise[];
  completed: boolean;
  isRestDay?: boolean;
  isImported?: boolean;
  importSource?: string;
}

interface WorkoutExercise {
  name: string;
  sets: WorkoutSet[];
}

interface WorkoutSet {
  weight: number;
  reps: number;
  completed: boolean;
}
```

## 🔗 Google Sheets Format

For importing, your Google Sheet should have:

**Log Sheet** (workout history):
| Date | Exercise | Weight | Reps | Sets |
|------|----------|--------|------|------|
| 2026-01-30 | Bench Press | 60 | 10 | 3 |

**Exercise Data** (exercise list):
| Exercise Name | Category | Primary Muscle |
|---------------|----------|----------------|
| Bench Press | Compound | Chest |

**Workout Plan** (for templates):
| Day | Exercise | Sets | Reps |
|-----|----------|------|------|
| Day 1 - Push | Bench Press | 3 | 10 |

## 🎯 Roadmap

- [ ] Two-way Google Sheets sync (read + write)
- [ ] Workout reminders / notifications
- [ ] Exercise video demonstrations
- [ ] Social features (share workouts)
- [ ] Apple Watch / Wear OS support

## 📝 Changelog

See [Releases](https://github.com/LordZenith/zenith-fitness/releases) for full version history.

### Recent Highlights
- **v1.14.0** — Improved rest timer with preset buttons
- **v1.13.0** — Daily motivational quotes
- **v1.12.0** — Weekly Insights card
- **v1.11.0** — PR notifications 🏆
- **v1.10.0** — Workout celebration 🎉
- **v1.9.0** — Smart templates + auto rest day detection
- **v1.8.0** — Volume stats (replaced streaks)
- **v1.7.0** — Splash screen + light/dark mode
- **v1.6.0** — Interactive line charts
- **v1.5.0** — Custom workout templates
- **v1.4.0** — Google Sheets import/export

---

Built with ❤️ by **Zenith** ⚡ for **Rishi**

*"The only bad workout is the one that didn't happen."*
