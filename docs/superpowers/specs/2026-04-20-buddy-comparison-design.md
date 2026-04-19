# Buddy Comparison — Design

**Status:** approved (option C)
**Author:** Rishi Mishra
**Date:** 2026-04-20

## Goal

Let two buddies see a head-to-head breakdown of strength and training volume so they have a fun, friendly reason to compete. The view answers: *"Who is stronger on what?"*

## Scope

- Me vs. one selected buddy (reached from `BuddyProfileView`).
- All-time data only in v1. A time-window toggle (30d / 90d / all-time) is deferred.
- No bodyweight normalization in v1. Deferred.
- Not a leaderboard across many buddies — that would be a separate feature.

## Entry points

A new **"Compare"** button in the action row of `BuddyProfileView`, alongside existing *Chat* and *Workout Together* buttons. Tapping it navigates to a new view: `buddy-compare`.

No entry from the Buddies list itself in v1 — reaching the comparison implies you're already on a buddy's profile.

## Data source

`buddyService.getBuddyWorkouts(buddyUid)` already exists and reads the buddy's full workout history from Firestore (`users/{uid}/data/workouts`). Local user's workouts come from `storage.getWorkouts()`. Both sources return `Workout[]` with completed sets, weights, reps, and muscle-group info on each exercise.

No new Firestore reads or schema changes are needed. The view is a pure client-side computation.

## View structure

Top to bottom:

### 1. Header + verdict chip

- Back button + "vs. {buddyName}".
- Verdict chip summarizing the exercise face-off: *"You lead in 7 · They lead in 4 · 2 tied"*. Color: orange if you lead, blue if they lead, grey if tied.

### 2. Headline scoreboard

Four rows, each with two columns (me | buddy), with the winning column highlighted by a subtle gradient border and a small crown icon:

| Metric | Source |
|---|---|
| Total workouts | count of completed non-rest workouts |
| Current streak | `UserStats.currentStreak` (already computed for both sides) |
| Total volume (kg) | sum of `weight × reps` over completed sets |
| Avg volume / session | total volume ÷ total workouts |

### 3. Muscle-group showdown

One horizontal bar per muscle group (`chest`, `back`, `shoulders`, `biceps`, `triceps`, `legs`, `core`, `full_body`). Each row:

- Label on the left (muscle group name + icon).
- Bar is split into two halves: mine (left) and buddy's (right), each width proportional to that side's share of `me + buddy` volume for that muscle group.
- Winner half is filled orange; loser half is grey.
- Right-edge label: *"You lead"* / *"They lead"* / *"Tied"* (treat within 2% as tied).

If neither side has logged that muscle group, omit the row.

### 4. Exercise face-off

Only exercises **both** sides have logged at least one completed set for. Per exercise:

- Exercise name
- Two mini-cards side-by-side showing: **max weight × reps** (primary, bold) and **est. 1RM** (secondary, muted, Epley: `weight × (1 + reps/30)`)
- Winner highlighted. Winner rule matches the fixed PR logic:
  1. Higher max weight wins.
  2. Tie on max weight → more reps at that weight wins.
  3. Same weight and reps → tie.

Sorted by: winners on top, descending by weight gap; ties last.

### 5. Exclusives (optional tail section)

Two small lists below the face-off, fed by `ComparisonResult.exclusives` split on `side`:
- **"Only you've logged"**: exercises the buddy has never logged a completed set for. Name + your max weight × reps. Not scored.
- **"Only they've logged"**: same for buddy.

Collapsed by default with a toggle. Pure informational, no winner label.

## Computation module

A new pure-function module `src/buddyComparison.ts` with:

```ts
interface SideStat {
  maxWeight: number;
  repsAtMax: number;
  est1RM: number; // Epley: weight × (1 + reps/30)
}

interface HeadlineStats {
  totalWorkouts: number;
  currentStreak: number;
  totalVolume: number;
  avgVolumePerSession: number;
}

export interface ExerciseFaceoff {
  exerciseId: string;
  exerciseName: string;
  me: SideStat;      // always present — face-off list only contains shared exercises
  buddy: SideStat;
  winner: 'me' | 'buddy' | 'tie';
}

export interface ExerciseExclusive {
  exerciseId: string;
  exerciseName: string;
  side: 'me' | 'buddy';
  maxWeight: number;
  repsAtMax: number;
}

export interface MuscleGroupFaceoff {
  group: MuscleGroup;
  meVolume: number;
  buddyVolume: number;
  winner: 'me' | 'buddy' | 'tie'; // within 2% counts as tie
}

export interface ComparisonResult {
  headline: { me: HeadlineStats; buddy: HeadlineStats };
  muscleGroups: MuscleGroupFaceoff[];
  exercises: ExerciseFaceoff[];
  exclusives: ExerciseExclusive[];
  verdict: { meLeads: number; buddyLeads: number; ties: number };
}

export function computeComparison(
  myWorkouts: Workout[],
  buddyWorkouts: Workout[],
  exercises: Exercise[], // for muscleGroup lookup by exerciseId
): ComparisonResult;
```

Keeping this a pure function (no React, no async) means it's easy to test in isolation and easy to drop into the view.

## New view component

`src/views/BuddyComparisonView.tsx`:

```ts
interface BuddyComparisonViewProps {
  buddyUid: string;
  buddyName: string;
  buddyPhotoURL?: string | null;
  isDark: boolean;
  onBack: () => void;
}
```

Responsibilities:
- On mount, fetch buddy workouts via `buddyService.getBuddyWorkouts(buddyUid)` and local workouts via `storage.getWorkouts()`.
- Call `computeComparison(...)` and render the sections above.
- Loading and error states: spinner during fetch, empty-state card if either side has no completed workouts yet ("{name} hasn't logged any workouts yet — check back soon!").

The view itself is dumb rendering. All math lives in `buddyComparison.ts`.

## App wiring

- Add `'buddy-compare'` to the `View` type union in `App.tsx`.
- Add `onCompare` prop to `BuddyProfileView`; wire the Compare button to `onCompare(buddyUid, buddyName, photoURL)`.
- In App, set buddy context and `navigateTo('buddy-compare')`.
- Render `<BuddyComparisonView>` when `view === 'buddy-compare'`.
- `goBack()` already handles arbitrary views via the navigation-history stack — no changes needed.

## Testing

No test framework in the project, so verification is manual:

- **Build** — `npm run build` passes with no TS errors.
- **Manual golden path** — with my account + a buddy account, open profile → Compare → see scoreboard, muscle groups, exercise face-off populated correctly.
- **Empty states** — Compare against a buddy with no workouts → see empty-state card.
- **Tie cases** — two exercises where both have identical max weight × reps → both shown as ties in verdict chip and exercise list.
- **Exclusives** — exercise done only by me shows up under "Only you've logged" and is not in the face-off list.

## Out of scope (deferred)

- Time-window filter (30d / 90d / all-time).
- Bodyweight-normalized strength (strength-to-weight ratio).
- Shareable comparison card (image export).
- Multi-buddy tournaments or leaderboards.
- Persistence / caching of comparison results.
- Any animation beyond existing fade-in.

## Dependencies / risks

- Depends on Firestore rules permitting a buddy's workout read. This path is already used by `BuddyProfileView` to show workout history, so if that works today, Compare works too.
- If a buddy profile stores stats in `userProfiles/{uid}` but `users/{uid}/data/workouts` is not readable, the view degrades to an empty-state card rather than crashing.
- `getBuddyStats` for `currentStreak` — already used; no new behavior.
