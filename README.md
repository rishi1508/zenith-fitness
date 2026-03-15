# Zenith Fitness

Your personal workout tracker — built by Zenith

**Track. Improve. Dominate.**

![Version](https://img.shields.io/badge/version-3.0.0-orange)
![Platform](https://img.shields.io/badge/platform-Android%20%7C%20PWA-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

### Weekly Plans (v2.0+)
The core concept: **A "plan" is a full week** — not a single workout.

- **Weekly Plan Architecture** — Create plans like "4FB+1Arms" or "PPL" with multiple days
- **Per-Day Exercise Assignment** — Each day has its own exercises with default sets/reps
- **Rest Day Support** — Mark any day as a rest day with one tap
- **Active Plan Tracking** — Set any plan as active, app remembers where you left off
- **Day Selector** — Pick which day of your weekly plan you're doing today

### Core Tracking
- **Exercise Library** — Centralized list of all exercises (Settings → Exercise Library)
- **Custom Exercises** — Create your own with name and muscle group
- **Active Workout Mode** — Log weight, reps, mark sets complete in real-time
- **Auto-fill Weights** — Pre-fills exact weight pattern from last session (e.g., 48kg, 52kg, 48kg)
- **Rest Timer** — Preset buttons (1:00, 1:30, 2:00, 3:00) with vibration alerts
- **Auto Rest Day Detection** — Prompts to log missed days as rest days

### Progress & Stats
- **Weekly Insights** — Volume and workout comparisons vs. last week
- **Exercise Progress** — Interactive line charts with clickable data points
- **Personal Record Notifications** — Toast + vibration when you hit a new PR
- **Estimated 1RM** — Epley formula calculation for each exercise
- **Full Exercise List** — See progress for ALL exercises in your library

### Body Tracking
- **Body Weight Logger** — Track weight with optional notes (morning, post-workout, etc.)
- **Trend Analysis** — 7-day and 30-day change with color coding
- **Mini Trend Chart** — Visual weight history (last 10 entries)
- **Full History View** — Review and delete past entries

### Firebase Auth & Cloud Sync (v3.0+)
- **Firebase Authentication** — Sign in with Google for secure cloud-backed accounts
- **Firestore Cloud Sync** — Automatically sync workout data across devices
- **Offline-first with sync** — Works offline, syncs when connection is available

### Google Sheets Integration
- **Import Exercises** — Load from "Exercise Data" sheet (reads first column)
- **Import Workout Plan** — Creates full weekly plan from "Workout Plan" sheet
- **Import History** — Pull workout logs from "Log Sheet"
- **Smart Data Handling** — Handles empty dates (same workout grouping)
- **Export Data** — Backup your data to clipboard (JSON format)

### UI/UX
- **Splash Screen** — Animated loading with app branding
- **Dark/Light Mode** — Toggle in Settings, persists across sessions
- **Daily Motivational Quotes** — Fresh inspiration on the home screen
- **Workout Celebration** — Confetti animation when you complete a workout
- **Search** — Find exercises in Progress view and template editors
- **Hardware Back Button** — Proper Android back navigation

### Technical
- **Offline Support** — Full PWA capability, works without internet
- **Auto-Updates** — Notification when new versions are available
- **Local Storage** — All data stored on device (privacy-first)
- **Capacitor Native** — Android APK with native features

## Installation

### Option 1: Download APK (Recommended)
1. Go to [Releases](https://github.com/rishi1508/zenith-fitness/releases)
2. Download the latest `zenith-fitness-vX.X.X.apk`
3. Install on your Android phone
4. Future updates install over existing app (no uninstall needed from v1.5.1+)

### Option 2: PWA (Browser)
1. Visit the app URL in Chrome on your phone
2. Tap the menu → "Add to Home Screen"
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
# Build web app
npm run build

# Sync to Android
npx cap sync android

# Build APK
cd android
./gradlew assembleRelease

# APK location: android/app/build/outputs/apk/release/app-release.apk
```

## GitHub Actions

The repo includes automated APK builds:
- Push a version tag (e.g., `v2.4.0`) to trigger a release
- APK is automatically built and attached to the GitHub release
- Uses secure signing key from GitHub Secrets


## Project Structure

```
zenith-fitness/
├── src/
│   ├── App.tsx              # Main component (3300+ lines, all views)
│   ├── storage.ts           # LocalStorage data layer
│   ├── types.ts             # TypeScript interfaces
│   ├── UpdateChecker.tsx    # Version check component
│   ├── VolumeLineChart.tsx  # Interactive progress chart
│   ├── main.tsx             # React entry point
│   └── index.css            # Styles + CSS variables for theming
├── android/                 # Capacitor Android project
├── .github/workflows/       # CI/CD for APK builds
├── ARCHITECTURE.md          # Technical architecture guide
├── capacitor.config.ts      # Capacitor configuration
└── package.json
```

> See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed technical documentation.

## Data Format

### Weekly Plan Structure

```typescript
interface WeeklyPlan {
  id: string;
  name: string;           // e.g., "4FB+1Arms"
  days: DayPlan[];        // Array of days in the plan
  isActive?: boolean;
  lastUsedDayIndex?: number;
}

interface DayPlan {
  dayName: string;        // e.g., "Day 1 - Full Body"
  isRestDay: boolean;
  exercises: DayExercise[];
}

interface DayExercise {
  exerciseId: string;
  defaultSets: number;
  defaultReps: number;
}
```

### Workout Record

```typescript
interface Workout {
  id: string;
  name: string;           // e.g., "4FB+1Arms - Day 1"
  date: string;           // ISO date
  exercises: WorkoutExercise[];
  completed: boolean;
  isRestDay?: boolean;
  isImported?: boolean;
  planId?: string;
  dayIndex?: number;
}
```

## Google Sheets Format

For importing, your Google Sheet should have these sheets:

**Exercise Data** (first column = exercise names):
```
| A (Exercise Names) | B (Notes)    |
|--------------------|--------------|
| Bench Press        | Chest        |
| Squat              | Legs         |
| Deadlift           | Back         |
```

**Workout Plan** (each column = one day):
```
| A          | B          | C          | D (Rest) |
|------------|------------|------------|----------|
| Day 1      | Day 2      | Day 3      | Day 4    |
| Squat      | Bench      | Deadlift   |          |
| Leg Press  | OHP        | Rows       |          |
| Lunges     | Dips       | Pullups    |          |
```

**Log Sheet** (workout history):
```
| Date       | Exercise      | Weight | Reps | Sets |
|------------|---------------|--------|------|------|
| 2026-01-30 | Bench Press   | 60     | 10   | 3    |
|            | Incline Press | 40     | 10   | 3    |
| 2026-01-31 | Squat         | 80     | 8    | 4    |
```
*(Empty date = same workout as row above)*

## Roadmap

- [ ] Two-way Google Sheets sync (read + write via OAuth)
- [ ] Workout reminders / notifications
- [ ] Exercise video demonstrations
- [ ] Workout sharing
- [ ] Wear OS support

## Changelog

See [Releases](https://github.com/rishi1508/zenith-fitness/releases) for full version history.

### v2.x (Major Architecture Refactor)
- **v2.18.0** — Weekly Insights Enhanced: Day streak counter, PRs this week, goal progress bar, offline sync indicator, interactive body weight chart with tooltips
- **v2.17.0** — Google Sheets Auto-Sync: Workout data syncs to Google Sheets via Apps Script webhook (requires setup)
- **v2.16.0** — PR Tracking: Personal Records displayed in weekly insights with celebration indicator
- **v2.15.0** — Body Weight Tracking: Log weight with notes, 7/30-day trends, mini chart, color-coded changes
- **v2.14.0** — Estimated 1RM Calculator: Epley formula display alongside PRs in Progress view
- **v2.13.0** — Exercise Video Links: Add YouTube/form guide URLs to exercises, accessible during workouts
- **v2.12.0** — Smart Rest Day Reminders: Banner on home screen after 3+ consecutive workout days with one-tap rest logging
- **v2.11.0** — Save Workout as Template: Tap copy icon in history to convert any workout into a reusable weekly plan
- **v2.10.0** — Weekly Overview Calendar: 7-day grid view showing active plan, completion status, and progress tracking
- **v2.9.0** — Exercise Notes: Add personal notes (form cues, pain points, RPE) to any exercise, visible during workouts
- **v2.8.0** — Progressive Overload Tracker: Shows last session stats + visual indicators (improved, same, lower)
- **v2.7.0** — UI improvements: Exercise Library button alignment, distinct Active state (green badge + ring), renamed default template
- **v2.6.0** — Fixed PR calculation (max reps at max weight), exact set pattern auto-fill, header safe area
- **v2.5.0** — Comprehensive import fix (exercise ID matching), Progress view height fix
- **v2.4.0** — Critical data fixes (import empty dates, progress scroll)
- **v2.3.0** — Auto-fill weights, history template names, settings light mode
- **v2.2.0** — Weekly Plan Creator with per-day UI
- **v2.1.0** — Exercise Library manager + auto-fill weights
- **v2.0.0** — WeeklyPlan architecture (plans = full weeks, not single days)

### v1.x Highlights
- **v1.22.0** — Edit all templates
- **v1.21.0** — Template dropdown selector
- **v1.20.0** — Interactive progress line charts
- **v1.19.0** — Splash, stats, import fixes
- **v1.18.x** — Complete light mode support
- **v1.15.0** — Bug fixes + exercise search
- **v1.14.0** — Rest timer presets
- **v1.11.0** — PR notifications
- **v1.10.0** — Workout celebration
- **v1.9.0** — Smart templates + auto rest day
- **v1.5.1** — Release signing (updates work without uninstall)

---

Built by **Zenith**

*"The only bad workout is the one that didn't happen."*
