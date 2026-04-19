# Buddy Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a "Compare" view on buddy profiles that shows a friendly head-to-head of strength and training volume between me and a buddy.

**Architecture:** A pure-function computation module (`src/buddyComparison.ts`) produces a `ComparisonResult` from two sets of `Workout[]` plus the exercise library. A new view (`src/views/BuddyComparisonView.tsx`) fetches both sides via existing services and renders four sections: verdict chip, headline scoreboard, muscle-group showdown, exercise face-off + exclusives. Entry point is a new "Compare" button on `BuddyProfileView` wired through a `buddy-compare` view case in `App.tsx`.

**Tech Stack:** React 19 + TypeScript, Tailwind CSS v4, existing services (`storage.getWorkouts`, `buddyService.getBuddyWorkouts`). No new dependencies.

**Note on testing:** The project has no automated test framework (per `CLAUDE.md`). Verification per task is `npm run build` (tsc + vite) plus manual browser checks on the last task.

---

## File Structure

- **Create:** `src/buddyComparison.ts` — pure computation module (types + `computeComparison`)
- **Create:** `src/views/BuddyComparisonView.tsx` — new view component
- **Modify:** `src/views/index.ts` — export the new view
- **Modify:** `src/views/BuddyProfileView.tsx` — add "Compare" button + `onCompare` prop
- **Modify:** `src/App.tsx` — add `'buddy-compare'` to View union; render new view; wire `onCompare`

---

## Task 1: Pure computation module

**Files:**
- Create: `src/buddyComparison.ts`

- [ ] **Step 1: Create the file with full content**

Create `src/buddyComparison.ts` with this exact content:

```ts
import type { Workout, Exercise, MuscleGroup } from './types';

// ========== Public types ==========

export interface SideStat {
  maxWeight: number;
  repsAtMax: number;
  est1RM: number; // Epley: weight × (1 + reps/30), rounded
}

export interface HeadlineStats {
  totalWorkouts: number;
  currentStreak: number;
  totalVolume: number;
  avgVolumePerSession: number;
}

export interface ExerciseFaceoff {
  exerciseId: string;
  exerciseName: string;
  me: SideStat;
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

// ========== Internals ==========

function compareSides(me: SideStat, buddy: SideStat): 'me' | 'buddy' | 'tie' {
  if (me.maxWeight > buddy.maxWeight) return 'me';
  if (buddy.maxWeight > me.maxWeight) return 'buddy';
  if (me.repsAtMax > buddy.repsAtMax) return 'me';
  if (buddy.repsAtMax > me.repsAtMax) return 'buddy';
  return 'tie';
}

function computeCurrentStreak(workouts: Workout[]): number {
  const completed = workouts.filter((w) => w.completed && w.type !== 'rest');
  const uniqueDates = Array.from(
    new Set(completed.map((w) => new Date(w.date).toDateString())),
  ).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < uniqueDates.length; i++) {
    const d = new Date(uniqueDates[i]);
    d.setHours(0, 0, 0, 0);
    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    if (d.getTime() === expected.getTime()) streak++;
    else break;
  }
  return streak;
}

function computeSideStatForExercise(
  workouts: Workout[],
  exerciseId: string,
): SideStat | null {
  let maxWeight = 0;
  let repsAtMax = 0;
  let hasData = false;

  for (const w of workouts) {
    if (!w.completed || w.type === 'rest') continue;
    for (const ex of w.exercises) {
      if (ex.exerciseId !== exerciseId) continue;
      for (const s of ex.sets) {
        if (!s.completed || s.weight <= 0 || s.reps <= 0) continue;
        hasData = true;
        if (
          s.weight > maxWeight ||
          (s.weight === maxWeight && s.reps > repsAtMax)
        ) {
          maxWeight = s.weight;
          repsAtMax = s.reps;
        }
      }
    }
  }

  if (!hasData) return null;
  return {
    maxWeight,
    repsAtMax,
    est1RM: Math.round(maxWeight * (1 + repsAtMax / 30)),
  };
}

function computeHeadline(workouts: Workout[]): HeadlineStats {
  const completed = workouts.filter((w) => w.completed && w.type !== 'rest');
  let totalVolume = 0;
  for (const w of completed) {
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        if (s.completed) totalVolume += s.weight * s.reps;
      }
    }
  }
  return {
    totalWorkouts: completed.length,
    currentStreak: computeCurrentStreak(workouts),
    totalVolume: Math.round(totalVolume),
    avgVolumePerSession: completed.length
      ? Math.round(totalVolume / completed.length)
      : 0,
  };
}

function computeMuscleGroupVolumes(
  workouts: Workout[],
  groupByExId: Map<string, MuscleGroup>,
): Map<MuscleGroup, number> {
  const result = new Map<MuscleGroup, number>();
  for (const w of workouts) {
    if (!w.completed || w.type === 'rest') continue;
    for (const ex of w.exercises) {
      const group = groupByExId.get(ex.exerciseId);
      if (!group) continue;
      for (const s of ex.sets) {
        if (!s.completed) continue;
        const volume = s.weight * s.reps;
        result.set(group, (result.get(group) || 0) + volume);
      }
    }
  }
  return result;
}

// ========== Public entry point ==========

export function computeComparison(
  myWorkouts: Workout[],
  buddyWorkouts: Workout[],
  exercises: Exercise[],
): ComparisonResult {
  const headline = {
    me: computeHeadline(myWorkouts),
    buddy: computeHeadline(buddyWorkouts),
  };

  // Collect exercise IDs and names from both sides
  const myExerciseIds = new Set<string>();
  const buddyExerciseIds = new Set<string>();
  const nameByExId = new Map<string, string>();

  for (const w of myWorkouts) {
    for (const ex of w.exercises) {
      myExerciseIds.add(ex.exerciseId);
      if (!nameByExId.has(ex.exerciseId)) nameByExId.set(ex.exerciseId, ex.exerciseName);
    }
  }
  for (const w of buddyWorkouts) {
    for (const ex of w.exercises) {
      buddyExerciseIds.add(ex.exerciseId);
      if (!nameByExId.has(ex.exerciseId)) nameByExId.set(ex.exerciseId, ex.exerciseName);
    }
  }

  // Exercise face-off (only shared exercises both have completed sets for)
  const shared = Array.from(myExerciseIds).filter((id) => buddyExerciseIds.has(id));
  const faceoffs: ExerciseFaceoff[] = [];
  for (const exerciseId of shared) {
    const me = computeSideStatForExercise(myWorkouts, exerciseId);
    const buddy = computeSideStatForExercise(buddyWorkouts, exerciseId);
    if (!me || !buddy) continue;
    faceoffs.push({
      exerciseId,
      exerciseName: nameByExId.get(exerciseId) || exerciseId,
      me,
      buddy,
      winner: compareSides(me, buddy),
    });
  }

  // Sort: non-ties first by largest weight gap, ties last alphabetically
  faceoffs.sort((a, b) => {
    if (a.winner === 'tie' && b.winner !== 'tie') return 1;
    if (b.winner === 'tie' && a.winner !== 'tie') return -1;
    if (a.winner === 'tie' && b.winner === 'tie') {
      return a.exerciseName.localeCompare(b.exerciseName);
    }
    const gapA = Math.abs(a.me.maxWeight - a.buddy.maxWeight);
    const gapB = Math.abs(b.me.maxWeight - b.buddy.maxWeight);
    return gapB - gapA;
  });

  const meLeads = faceoffs.filter((f) => f.winner === 'me').length;
  const buddyLeads = faceoffs.filter((f) => f.winner === 'buddy').length;
  const ties = faceoffs.filter((f) => f.winner === 'tie').length;

  // Exclusives — exercises only one side has logged
  const exclusives: ExerciseExclusive[] = [];
  for (const id of myExerciseIds) {
    if (buddyExerciseIds.has(id)) continue;
    const stat = computeSideStatForExercise(myWorkouts, id);
    if (!stat) continue;
    exclusives.push({
      exerciseId: id,
      exerciseName: nameByExId.get(id) || id,
      side: 'me',
      maxWeight: stat.maxWeight,
      repsAtMax: stat.repsAtMax,
    });
  }
  for (const id of buddyExerciseIds) {
    if (myExerciseIds.has(id)) continue;
    const stat = computeSideStatForExercise(buddyWorkouts, id);
    if (!stat) continue;
    exclusives.push({
      exerciseId: id,
      exerciseName: nameByExId.get(id) || id,
      side: 'buddy',
      maxWeight: stat.maxWeight,
      repsAtMax: stat.repsAtMax,
    });
  }
  exclusives.sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));

  // Muscle group showdown
  const groupByExId = new Map<string, MuscleGroup>();
  for (const e of exercises) groupByExId.set(e.id, e.muscleGroup);
  const myVol = computeMuscleGroupVolumes(myWorkouts, groupByExId);
  const buddyVol = computeMuscleGroupVolumes(buddyWorkouts, groupByExId);
  const allGroups = new Set<MuscleGroup>([...myVol.keys(), ...buddyVol.keys()]);
  const muscleGroups: MuscleGroupFaceoff[] = [];
  for (const group of allGroups) {
    const meVolume = myVol.get(group) || 0;
    const buddyVolume = buddyVol.get(group) || 0;
    if (meVolume === 0 && buddyVolume === 0) continue;
    const total = meVolume + buddyVolume;
    const ratio = total > 0 ? Math.abs(meVolume - buddyVolume) / total : 0;
    const winner: 'me' | 'buddy' | 'tie' =
      ratio < 0.02 ? 'tie' : meVolume > buddyVolume ? 'me' : 'buddy';
    muscleGroups.push({
      group,
      meVolume: Math.round(meVolume),
      buddyVolume: Math.round(buddyVolume),
      winner,
    });
  }
  // Stable, intuitive ordering
  const GROUP_ORDER: MuscleGroup[] = [
    'chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core', 'full_body', 'other',
  ];
  muscleGroups.sort(
    (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group),
  );

  return {
    headline,
    muscleGroups,
    exercises: faceoffs,
    exclusives,
    verdict: { meLeads, buddyLeads, ties },
  };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: `✓ built in ...` with no TypeScript errors. If TS complains about unused types, that's a real bug — fix it.

- [ ] **Step 3: Commit**

```bash
git add src/buddyComparison.ts
git commit -m "$(cat <<'EOF'
feat: add buddyComparison pure computation module

Computes head-to-head stats (headline, muscle groups, exercise face-off,
exclusives) from two sets of workouts. Pure functions only — no React,
no async — so the view can stay a thin renderer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: The comparison view

**Files:**
- Create: `src/views/BuddyComparisonView.tsx`

- [ ] **Step 1: Create the view with full content**

Create `src/views/BuddyComparisonView.tsx`:

```tsx
import { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft, Crown, Loader2, Scale, Trophy, ChevronDown, ChevronUp,
} from 'lucide-react';
import type { Workout, MuscleGroup } from '../types';
import * as storage from '../storage';
import * as buddyService from '../buddyService';
import { Avatar } from '../components';
import { computeComparison, type ComparisonResult } from '../buddyComparison';

interface BuddyComparisonViewProps {
  buddyUid: string;
  buddyName: string;
  buddyPhotoURL?: string | null;
  isDark: boolean;
  onBack: () => void;
}

const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  legs: 'Legs',
  core: 'Core',
  full_body: 'Full Body',
  other: 'Other',
};

function formatVolume(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}k`;
  return String(kg);
}

export function BuddyComparisonView({
  buddyUid, buddyName, buddyPhotoURL, isDark, onBack,
}: BuddyComparisonViewProps) {
  const [buddyWorkouts, setBuddyWorkouts] = useState<Workout[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showExclusives, setShowExclusives] = useState(false);

  // Local data is always available from storage
  const myWorkouts = useMemo(() => storage.getWorkouts(), []);
  const exercises = useMemo(() => storage.getExercises(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const w = await buddyService.getBuddyWorkouts(buddyUid);
        if (!cancelled) setBuddyWorkouts(w);
      } catch (e) {
        if (!cancelled) {
          console.error('[BuddyCompare] Failed to load buddy workouts:', e);
          setError('Could not load buddy workouts.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [buddyUid]);

  const result: ComparisonResult | null = useMemo(() => {
    if (!buddyWorkouts) return null;
    return computeComparison(myWorkouts, buddyWorkouts, exercises);
  }, [myWorkouts, buddyWorkouts, exercises]);

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtleText = isDark ? 'text-zinc-400' : 'text-gray-500';
  const hoverBg = isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${hoverBg}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Compare</h1>
        </div>
        <div className={`rounded-xl border p-6 text-center ${cardBg} ${cardBorder}`}>
          <Scale className={`w-10 h-10 mx-auto mb-2 ${subtleText}`} />
          <p className={`text-sm ${subtleText}`}>{error || 'Nothing to compare yet.'}</p>
        </div>
      </div>
    );
  }

  const noBuddyWorkouts = (buddyWorkouts?.length || 0) === 0;
  const noMyWorkouts = myWorkouts.length === 0;
  if (noBuddyWorkouts || noMyWorkouts) {
    const who = noBuddyWorkouts ? buddyName : 'You';
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${hoverBg}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">vs. {buddyName}</h1>
        </div>
        <div className={`rounded-xl border p-6 text-center ${cardBg} ${cardBorder}`}>
          <Trophy className={`w-10 h-10 mx-auto mb-2 ${subtleText}`} />
          <p className={`text-sm ${subtleText}`}>
            {who} haven't logged any workouts yet — check back soon!
          </p>
        </div>
      </div>
    );
  }

  const { headline, muscleGroups, exercises: faceoffs, exclusives, verdict } = result;
  const verdictLabel =
    verdict.meLeads > verdict.buddyLeads
      ? `You lead in ${verdict.meLeads} · They lead in ${verdict.buddyLeads} · ${verdict.ties} tied`
      : verdict.buddyLeads > verdict.meLeads
        ? `They lead in ${verdict.buddyLeads} · You lead in ${verdict.meLeads} · ${verdict.ties} tied`
        : `Tied at ${verdict.meLeads}-${verdict.buddyLeads} · ${verdict.ties} ties`;
  const verdictColor =
    verdict.meLeads > verdict.buddyLeads
      ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
      : verdict.buddyLeads > verdict.meLeads
        ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
        : isDark
          ? 'bg-zinc-800 text-zinc-300 border-zinc-700'
          : 'bg-gray-100 text-gray-600 border-gray-300';

  const winGradient = (side: 'me' | 'buddy' | 'tie', target: 'me' | 'buddy') =>
    side === target
      ? 'border-orange-500/50 bg-gradient-to-br from-orange-500/10 to-transparent'
      : cardBorder;

  const myExclusives = exclusives.filter((e) => e.side === 'me');
  const buddyExclusives = exclusives.filter((e) => e.side === 'buddy');

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${hoverBg}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">vs. {buddyName}</h1>
      </div>

      {/* Avatars */}
      <div className={`rounded-xl border p-4 flex items-center justify-around ${cardBg} ${cardBorder}`}>
        <div className="flex flex-col items-center gap-1">
          <Avatar name="You" size="lg" />
          <div className="text-xs font-medium">You</div>
        </div>
        <div className={`text-sm font-bold ${subtleText}`}>VS</div>
        <div className="flex flex-col items-center gap-1">
          <Avatar name={buddyName} photoURL={buddyPhotoURL || null} size="lg" />
          <div className="text-xs font-medium truncate max-w-[120px]">{buddyName}</div>
        </div>
      </div>

      {/* Verdict chip */}
      <div className={`rounded-full border px-4 py-2 text-center text-xs font-semibold ${verdictColor}`}>
        {verdictLabel}
      </div>

      {/* Headline scoreboard */}
      <div>
        <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${subtleText}`}>
          Scoreboard
        </h3>
        <div className="space-y-2">
          {[
            { label: 'Workouts', me: headline.me.totalWorkouts, buddy: headline.buddy.totalWorkouts, suffix: '' },
            { label: 'Streak', me: headline.me.currentStreak, buddy: headline.buddy.currentStreak, suffix: 'd' },
            { label: 'Total volume', me: formatVolume(headline.me.totalVolume), buddy: formatVolume(headline.buddy.totalVolume), suffix: 'kg' },
            { label: 'Avg / session', me: formatVolume(headline.me.avgVolumePerSession), buddy: formatVolume(headline.buddy.avgVolumePerSession), suffix: 'kg' },
          ].map((row) => {
            const meVal = typeof row.me === 'number' ? row.me : parseFloat(row.me);
            const buddyVal = typeof row.buddy === 'number' ? row.buddy : parseFloat(row.buddy);
            const winner: 'me' | 'buddy' | 'tie' =
              meVal > buddyVal ? 'me' : buddyVal > meVal ? 'buddy' : 'tie';
            return (
              <div key={row.label} className={`rounded-xl border p-3 grid grid-cols-[1fr_auto_1fr] gap-3 items-center ${cardBg} ${cardBorder}`}>
                <div className={`text-right rounded-lg px-3 py-2 border ${winGradient(winner, 'me')}`}>
                  <div className="text-lg font-bold flex items-center justify-end gap-1.5">
                    {winner === 'me' && <Crown className="w-4 h-4 text-yellow-400" />}
                    {row.me}{row.suffix}
                  </div>
                </div>
                <div className={`text-[10px] font-semibold uppercase ${subtleText}`}>{row.label}</div>
                <div className={`text-left rounded-lg px-3 py-2 border ${winGradient(winner, 'buddy')}`}>
                  <div className="text-lg font-bold flex items-center gap-1.5">
                    {row.buddy}{row.suffix}
                    {winner === 'buddy' && <Crown className="w-4 h-4 text-yellow-400" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Muscle group showdown */}
      {muscleGroups.length > 0 && (
        <div>
          <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${subtleText}`}>
            Muscle Groups
          </h3>
          <div className={`rounded-xl border divide-y ${cardBg} ${cardBorder} ${isDark ? 'divide-[#2e2e2e]' : 'divide-gray-200'}`}>
            {muscleGroups.map((mg) => {
              const total = mg.meVolume + mg.buddyVolume;
              const mePct = total > 0 ? (mg.meVolume / total) * 100 : 0;
              const buddyPct = 100 - mePct;
              const meColor = mg.winner === 'me' ? 'bg-orange-500' : isDark ? 'bg-zinc-700' : 'bg-gray-300';
              const buddyColor = mg.winner === 'buddy' ? 'bg-orange-500' : isDark ? 'bg-zinc-700' : 'bg-gray-300';
              const label =
                mg.winner === 'me' ? 'You lead' : mg.winner === 'buddy' ? 'They lead' : 'Tied';
              return (
                <div key={mg.group} className="p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-sm font-medium">{MUSCLE_GROUP_LABELS[mg.group]}</div>
                    <div className={`text-xs ${
                      mg.winner === 'me' ? 'text-orange-400' : mg.winner === 'buddy' ? 'text-blue-400' : subtleText
                    }`}>{label}</div>
                  </div>
                  <div className="flex h-2 rounded-full overflow-hidden">
                    <div className={meColor} style={{ width: `${mePct}%` }} />
                    <div className={buddyColor} style={{ width: `${buddyPct}%` }} />
                  </div>
                  <div className={`flex justify-between text-[10px] mt-1 ${subtleText}`}>
                    <span>You · {formatVolume(mg.meVolume)}kg</span>
                    <span>{formatVolume(mg.buddyVolume)}kg · Them</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Exercise face-off */}
      {faceoffs.length > 0 && (
        <div>
          <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${subtleText}`}>
            Exercise Face-off
          </h3>
          <div className="space-y-2">
            {faceoffs.map((f) => (
              <div key={f.exerciseId} className={`rounded-xl border p-3 ${cardBg} ${cardBorder}`}>
                <div className="text-sm font-medium mb-2">{f.exerciseName}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className={`rounded-lg px-3 py-2 border ${winGradient(f.winner, 'me')}`}>
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] uppercase font-semibold opacity-60">You</div>
                      {f.winner === 'me' && <Crown className="w-3.5 h-3.5 text-yellow-400" />}
                    </div>
                    <div className="text-base font-bold">{f.me.maxWeight}kg × {f.me.repsAtMax}</div>
                    <div className={`text-[11px] ${subtleText}`}>est. 1RM {f.me.est1RM}kg</div>
                  </div>
                  <div className={`rounded-lg px-3 py-2 border ${winGradient(f.winner, 'buddy')}`}>
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] uppercase font-semibold opacity-60">{buddyName}</div>
                      {f.winner === 'buddy' && <Crown className="w-3.5 h-3.5 text-yellow-400" />}
                    </div>
                    <div className="text-base font-bold">{f.buddy.maxWeight}kg × {f.buddy.repsAtMax}</div>
                    <div className={`text-[11px] ${subtleText}`}>est. 1RM {f.buddy.est1RM}kg</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Exclusives (collapsed by default) */}
      {exclusives.length > 0 && (
        <div>
          <button
            onClick={() => setShowExclusives((v) => !v)}
            className={`w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider ${subtleText} py-1`}
          >
            <span>Exclusive exercises ({exclusives.length})</span>
            {showExclusives ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showExclusives && (
            <div className="space-y-3 mt-2">
              {myExclusives.length > 0 && (
                <div>
                  <div className={`text-[11px] font-semibold mb-1 ${subtleText}`}>Only you've logged</div>
                  <div className={`rounded-xl border divide-y ${cardBg} ${cardBorder} ${isDark ? 'divide-[#2e2e2e]' : 'divide-gray-200'}`}>
                    {myExclusives.map((e) => (
                      <div key={e.exerciseId} className="flex items-center justify-between p-3 text-sm">
                        <span>{e.exerciseName}</span>
                        <span className={subtleText}>{e.maxWeight}kg × {e.repsAtMax}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {buddyExclusives.length > 0 && (
                <div>
                  <div className={`text-[11px] font-semibold mb-1 ${subtleText}`}>Only {buddyName} has logged</div>
                  <div className={`rounded-xl border divide-y ${cardBg} ${cardBorder} ${isDark ? 'divide-[#2e2e2e]' : 'divide-gray-200'}`}>
                    {buddyExclusives.map((e) => (
                      <div key={e.exerciseId} className="flex items-center justify-between p-3 text-sm">
                        <span>{e.exerciseName}</span>
                        <span className={subtleText}>{e.maxWeight}kg × {e.repsAtMax}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: `✓ built in ...` — no TS errors. If `storage.getExercises` doesn't exist, check `src/storage.ts` for the actual name and adjust.

- [ ] **Step 3: Commit (no push — view is unwired)**

```bash
git add src/views/BuddyComparisonView.tsx
git commit -m "$(cat <<'EOF'
feat: add BuddyComparisonView (unwired)

Renders head-to-head scoreboard, muscle-group showdown, exercise face-off
and exclusives. Pure renderer — delegates all math to buddyComparison.
Not yet reachable from the UI (wired in next commit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire the entry point

**Files:**
- Modify: `src/views/index.ts`
- Modify: `src/views/BuddyProfileView.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Export the new view**

Append to `src/views/index.ts` (follow existing export style):

```ts
export { BuddyComparisonView } from './BuddyComparisonView';
```

- [ ] **Step 2: Add Compare button to BuddyProfileView**

In `src/views/BuddyProfileView.tsx`:

(a) Add `Scale` to the lucide-react imports (alongside `ArrowLeft, Dumbbell, Flame, ...`).

(b) Add `onCompare` to the props interface:

```tsx
interface BuddyProfileViewProps {
  buddyUid: string;
  buddyName: string;
  isDark: boolean;
  onBack: () => void;
  onOpenChat: (chatId: string, buddyName: string) => void;
  onStartSession: (sessionId: string) => void;
  onCompare: (buddyUid: string, buddyName: string, photoURL: string | null) => void;
}
```

(c) Destructure `onCompare` in the component signature.

(d) Replace the existing two-button action row (`<Chat>` + `<Workout Together>`) with a three-column grid including the new Compare button:

Find this block:

```tsx
        <div className="flex gap-3">
          <button
            onClick={() => onOpenChat(buddy.chatId, buddyName)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-colors ${
              isDark ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-gray-100 hover:bg-gray-200'
            }`}
          >
            <MessageCircle className="w-4 h-4" /> Chat
          </button>
          <button
            onClick={async () => {
              const plan = storage.getActivePlan();
```

And change the container to a 3-column grid, adding a new Compare button between Chat and Workout Together:

```tsx
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => onOpenChat(buddy.chatId, buddyName)}
            className={`flex items-center justify-center gap-1.5 py-3 rounded-xl font-medium text-xs transition-colors ${
              isDark ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-gray-100 hover:bg-gray-200'
            }`}
          >
            <MessageCircle className="w-4 h-4" /> Chat
          </button>
          <button
            onClick={() => onCompare(buddyUid, buddyName, profile?.photoURL || null)}
            className={`flex items-center justify-center gap-1.5 py-3 rounded-xl font-medium text-xs transition-colors ${
              isDark ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-gray-100 hover:bg-gray-200'
            }`}
          >
            <Scale className="w-4 h-4" /> Compare
          </button>
          <button
            onClick={async () => {
              const plan = storage.getActivePlan();
```

And change the matching closing "Workout Together" button class from `flex-1 ... text-sm` to keep it consistent with the other two:

```tsx
            className="flex items-center justify-center gap-1.5 py-3 rounded-xl font-medium text-xs bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity"
```

(Keep the same onClick body — only the wrapping `<div className="flex gap-3">` becomes `<div className="grid grid-cols-3 gap-2">` and the button className widths shrink to fit three buttons.)

- [ ] **Step 3: Wire the view in App.tsx**

In `src/App.tsx`:

(a) Add `'buddy-compare'` to the `View` type union:

```ts
type View = 'home' | 'workout' | 'history' | 'templates' | 'active' | 'progress' | 'settings' | 'exercises' | 'weekly' | 'compare' | 'analysis' | 'buddies' | 'buddy-profile' | 'buddy-chat' | 'buddy-compare' | 'session-lobby';
```

(b) Add `BuddyComparisonView` to the existing views import line:

```ts
import { HistoryView, ProgressView, SettingsView, ExerciseManagerView, HomeView, ActiveWorkoutView, WeeklyPlansView, WeeklyOverviewView, ComparisonView, LoginView, AnalysisView, BuddyView, BuddyProfileView, BuddyChatView, SessionLobbyView, BuddyComparisonView } from './views';
```

(c) Pass `onCompare` to `BuddyProfileView`. Find the `{view === 'buddy-profile' && ...}` block and extend it:

```tsx
        {view === 'buddy-profile' && buddyContext.uid && (
          <BuddyProfileView
            buddyUid={buddyContext.uid}
            buddyName={buddyContext.name}
            isDark={isDark}
            onBack={() => goBack()}
            onOpenChat={(chatId, name) => {
              setBuddyContext((prev) => ({ ...prev, chatId, name, photoURL: prev.photoURL }));
              navigateTo('buddy-chat');
            }}
            onStartSession={(sessionId) => {
              setActiveSessionId(sessionId);
              navigateTo('session-lobby');
            }}
            onCompare={(uid, name, photoURL) => {
              setBuddyContext({ uid, name, photoURL });
              navigateTo('buddy-compare');
            }}
          />
        )}
```

(d) Render the new view. Add this block after the `session-lobby` case (before `</main>`):

```tsx
        {view === 'buddy-compare' && buddyContext.uid && (
          <BuddyComparisonView
            buddyUid={buddyContext.uid}
            buddyName={buddyContext.name}
            buddyPhotoURL={buddyContext.photoURL}
            isDark={isDark}
            onBack={() => goBack()}
          />
        )}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: `✓ built in ...` with no TS errors. If it errors on `buddyContext.photoURL`, verify the state shape at the top of App.tsx — it already includes `photoURL?: string | null`, so the view's optional prop type should match.

- [ ] **Step 5: Manual browser verification**

Run: `npm run dev` and in a browser on `http://localhost:5174`:

1. Log in with a real account.
2. Open **Buddies** → tap a buddy → buddy profile loads.
3. Three buttons in the action row: **Chat**, **Compare**, **Workout Together**.
4. Tap **Compare** → comparison view loads after a brief spinner.
5. Verify each section renders:
   - Avatars + "vs. {buddyName}" header
   - Verdict chip with correct color (orange if you lead, blue if they lead, grey if tied)
   - Scoreboard with crowns on winning side of each row
   - Muscle Groups list with winning bar in orange
   - Exercise Face-off cards with the correct winner highlighted (heavier weight wins; same-weight-more-reps wins)
   - "Exclusive exercises" collapsed section expands on tap and shows only-me / only-them lists
6. Tap back arrow → returns to buddy profile (no stack corruption).
7. If the buddy has no workouts yet: empty-state card appears instead of a crash.

- [ ] **Step 6: Commit**

```bash
git add src/views/index.ts src/views/BuddyProfileView.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
feat: wire Compare button on buddy profile to BuddyComparisonView

Adds a Compare button to the buddy profile action row and a new
buddy-compare view. Reuses the existing navigation-history stack
for back behavior.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist

- **Spec coverage:** headline scoreboard ✓, muscle-group showdown ✓, exercise face-off ✓, exclusives ✓, verdict chip ✓, entry point from BuddyProfileView ✓, empty states ✓, winner rule matches PR hierarchy ✓.
- **Placeholder scan:** no TBD/TODO/similar in plan; every step has complete code or explicit command.
- **Type consistency:** `ComparisonResult`, `SideStat`, `MuscleGroupFaceoff`, `ExerciseFaceoff`, `ExerciseExclusive` names are identical in both the computation module and the view.
- **Out of scope (intentionally deferred):** time-window toggle, bodyweight normalization, multi-buddy tournaments, shareable card, animations.
