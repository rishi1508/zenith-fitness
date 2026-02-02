# Zenith Fitness — Architecture Guide

A technical overview for developers (including future me).

## Project Philosophy

**Simplicity over structure** — Most logic lives in App.tsx. Yes, it's 3300+ lines. It works. Refactoring is planned when the feature set stabilizes.

**Offline-first** — All data in localStorage. No backend, no accounts, no sync headaches.

**Single source of truth** — `storage.ts` is the data layer. Components don't touch localStorage directly.

## File Overview

```
src/
├── App.tsx           # 3300+ lines, all views and components
├── storage.ts        # Data persistence layer (localStorage)
├── types.ts          # TypeScript interfaces
├── main.tsx          # React entry point
├── index.css         # All styles + CSS variables for theming
├── UpdateChecker.tsx # Version check component
└── VolumeLineChart.tsx # Reusable line chart (extracted)
```

## Data Flow

```
User Action → Component Handler → storage.ts → localStorage
                    ↓
              State Update (useState)
                    ↓
              Re-render
```

All persistence goes through `storage.ts`. Never call `localStorage.getItem/setItem` directly from components.

## Key Data Types

### Core Entities

```typescript
// Exercise — base definition
interface Exercise {
  id: string;
  name: string;
  muscleGroup: string;
  videoUrl?: string;   // YouTube/form guide link
  notes?: string;      // Personal form cues
}

// Weekly Plan — a full week of workouts
interface WeeklyPlan {
  id: string;
  name: string;           // e.g., "4FB+1Arms"
  days: DayPlan[];        // Array of days (typically 5-7)
  isActive?: boolean;     // Only one active at a time
  lastUsedDayIndex?: number;
}

// Day Plan — exercises for one day
interface DayPlan {
  dayName: string;        // e.g., "Day 1 - Full Body"
  isRestDay: boolean;
  exercises: DayExercise[];
}

// Workout — an actual completed/in-progress session
interface Workout {
  id: string;
  name: string;
  date: string;           // ISO date (YYYY-MM-DD)
  exercises: WorkoutExercise[];
  completed: boolean;
  isRestDay?: boolean;
  startTime?: string;     // ISO timestamp for duration tracking
  planId?: string;        // Links back to weekly plan
  dayIndex?: number;
}
```

### Storage Keys

```typescript
// In storage.ts
const STORAGE_KEYS = {
  exercises: 'zenith-fitness-exercises',
  workouts: 'zenith-fitness-workouts',
  activeWorkout: 'zenith-fitness-active-workout',
  weeklyPlans: 'zenith-fitness-weekly-plans',
  theme: 'zenith-fitness-theme',
  bodyWeight: 'zenith-fitness-body-weight',
  exerciseNotes: 'zenith-fitness-exercise-notes',
};
```

## Component Map (in App.tsx)

| Component | Purpose | Lines (approx) |
|-----------|---------|----------------|
| `App` | Main router, state management | 450 |
| `HomeView` | Dashboard with stats + start workout | 150 |
| `ActiveWorkoutView` | Live workout tracking | 200 |
| `ExerciseCard` | Single exercise in workout | 165 |
| `HistoryView` | Past workouts list | 120 |
| `HistoryWorkoutCard` | Single history entry | 125 |
| `WeeklyPlansView` | Plan management | 180 |
| `EditWeeklyPlanView` | Create/edit plan | 200 |
| `DayExerciseEditor` | Edit exercises for one day | 220 |
| `ProgressView` | Charts + exercise stats | 290 |
| `SettingsView` | Config + import/export | 205 |
| `BodyWeightSection` | Weight tracking (in Settings) | 225 |
| `ExerciseManagerView` | Exercise library CRUD | 240 |
| `WeeklyOverviewView` | Calendar grid view | 160 |
| `VolumeLineChart` | Interactive chart | (separate file) |
| `WeeklyInsightsCard` | Weekly comparison card | 60 |
| `StatCard` | Reusable stat display | 25 |
| `NavButton` | Bottom nav button | 20 |
| `WorkoutTimer` | Duration display | 25 |
| `SplashScreen` | Animated loader | 17 |

## View Navigation

```
SplashScreen → HomeView
                  │
    ┌─────────────┼─────────────┐
    ↓             ↓             ↓
HistoryView  ProgressView  SettingsView
    │                           │
    └──→ (delete, template) ←───┼──→ WeeklyPlansView
                                │         ↓
                                │    EditWeeklyPlanView
                                │         ↓
                                │    DayExerciseEditor
                                │
                                └──→ ExerciseManagerView
                                │
                                └──→ WeeklyOverviewView

HomeView → "Start Workout" → ActiveWorkoutView
                                   │
                                   └──→ (complete) → HomeView + celebration
```

## Theme System

CSS variables in `index.css`:

```css
/* Light mode (default) */
:root {
  --bg-primary: #f5f5f5;
  --bg-secondary: #ffffff;
  --text-primary: #1a1a1a;
  --text-secondary: #666666;
  --accent: #f97316;        /* Orange */
  --accent-hover: #ea580c;
}

/* Dark mode */
.dark {
  --bg-primary: #0a0a0a;
  --bg-secondary: #171717;
  --text-primary: #ffffff;
  --text-secondary: #a3a3a3;
  /* accent stays orange */
}
```

Components use `isDark` prop to conditionally apply `.dark` class.

## Adding a New Feature

### New View
1. Create component function in App.tsx (or extract to file if large)
2. Add to `View` type in state
3. Add case in main render switch
4. Add navigation button/link

### New Data Type
1. Add interface to `types.ts`
2. Add storage functions to `storage.ts`
3. Add state to App component
4. Wire up save/load in useEffect

### New Setting
1. Add to SettingsView component
2. Add storage key + functions if persisted
3. Thread through App state if needed by other views

## Google Sheets Integration

Read-only via public CSV export:
```
https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet={SHEET_NAME}
```

Sheet names:
- `Exercise Data` — Column A = exercise names
- `Workout Plan` — Each column = one day's exercises (row 1 = day name)
- `Log Sheet` — Date, Exercise, Weight, Reps, Sets columns

**Note:** Two-way sync needs OAuth setup (future work).

## Building

```bash
# Dev
npm run dev          # Vite dev server on :5173

# Production
npm run build        # Outputs to dist/
npx cap sync android # Copy to Android project

# APK
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

## Testing Notes

No automated tests yet. Manual testing checklist:
- [ ] Create new weekly plan
- [ ] Start workout from plan
- [ ] Complete sets with weights
- [ ] Finish workout → celebration shows
- [ ] Check history shows new workout
- [ ] Check progress chart updates
- [ ] Import from Google Sheets
- [ ] Export data
- [ ] Body weight tracking

## Known Technical Debt

1. **App.tsx size** — 3300+ lines, should extract views to separate files
2. **No tests** — Needs at least unit tests for storage.ts
3. **No error boundaries** — App crashes show white screen
4. **No performance optimization** — Re-renders on every state change
5. **Hardcoded Google Sheets ID** — Should be configurable

## Refactoring Priority

When stabilized:
1. Extract views to `src/views/*.tsx`
2. Extract shared components to `src/components/*.tsx`
3. Add React Query or similar for data fetching
4. Add Vitest for storage.ts tests
5. Add error boundary wrapper

---

*Last updated: 2026-02-02*
