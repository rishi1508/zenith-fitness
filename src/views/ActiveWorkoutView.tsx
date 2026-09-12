import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Dumbbell, ChevronRight, ChevronLeft, Check, Clock, X, Edit3, Trash2, Plus,
  TrendingUp, TrendingDown, Trophy, ArrowUp, ArrowRight, ArrowDown, FileText, Play, Info,
  MessageCircle
} from 'lucide-react';
import type { Workout, WorkoutSet, WorkoutExercise, Exercise } from '../types';
import * as storage from '../storage';
import { hapticImpact } from '../haptics';
import { feedback } from '../feedback';
import { defaultRestSecondsFor } from '../restTimer';
import { labelize } from '../exerciseUtils';
import { ExercisePickerSheet } from './exercises/ExercisePickerSheet';
import { buildProgression, collectExerciseSessions, formatKg, formatSet } from '../progression';
import {
  computeDeloadSuggestion, deloadTargetFor, deloadWeekEndsAt, deloadZenPrompt,
} from '../deloadDetector';
import { findExercise, withGymExercises } from '../gymLibrary';
import { DeloadExplainerSheet, VideoModal } from '../components';

import { Button, IconButton, Pill, useToast, useConfirm } from '../ui';

/** What the lifter should aim for today, or null outside a deload week. */
type DeloadTarget = { weight: number; reps: number } | null;

/** "Target 45 kg × 6" / "Target bodyweight × 8". */
function deloadTargetLabel(t: NonNullable<DeloadTarget>): string {
  return t.weight > 0 ? `Target ${formatKg(t.weight)} kg × ${t.reps}` : `Target bodyweight × ${t.reps}`;
}

// Active Workout View
export function ActiveWorkoutView({
  workout, onUpdate, onFinish, onPause, onDiscard,
  sessionMode, buddyProgress, onAskZen,
}: {
  workout: Workout;
  onUpdate: (workout: Workout) => void;
  onFinish: () => void;
  onPause: () => void;
  onDiscard: () => void;
  /** Opens Zen with the question already typed. The deload banner's "Ask
   *  Zen" button is hidden when this isn't wired. */
  onAskZen?: (prompt: string) => void;
  /** 'host' = finish ends session for all; 'participant' = cannot finish; null = regular personal workout */
  sessionMode?: 'host' | 'participant' | null;
  /** Per-exercise full ordered set list from EACH OTHER participant in
   *  the session, keyed by exercise NAME (case-insensitive, trimmed).
   *  Each index in a buddy's `sets` corresponds to that set number
   *  (0 = set 1, etc.) so the UI can show "buddy did Xkg × Y reps"
   *  alongside YOUR matching set. In a 3-person session every buddy
   *  who logged data appears as its own line under each of your sets.
   *  Exercises no buddy has done are absent from the map — no entry
   *  shown for divergent exercises (e.g. you do incline DB while buddy
   *  does incline bench). */
  buddyProgress?: Map<string, Array<{ buddyName: string; sets: Array<{ weight: number; reps: number }> }>>;
}) {
  const [restTimer, setRestTimer] = useState<number | null>(null);
  const [restTimeLeft, setRestTimeLeft] = useState(0);
  const [prAchievement, setPrAchievement] = useState<{exercise: string; weight: number; reps: number; isVolumePR?: boolean} | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Snapshot of personal records taken once at view mount. Used by the
  // in-session PR toast — we compare against this snapshot, NOT against
  // a record that gets updated mid-session. Earlier we'd persist a PR
  // immediately on set completion, so a typo'd 150kg×10 became the new
  // "previous best" within the same session — and a corrected 15kg×10
  // never re-fired the celebration. The actual PR record is now
  // recomputed at session end via storage.recomputePersonalRecords().
  const [prSnapshot] = useState(() => {
    const records = storage.getPersonalRecords();
    const m = new Map<string, { weight: number; reps: number }>();
    for (const r of records) {
      m.set(r.exerciseId, { weight: r.weight, reps: r.reps });
      m.set(r.exerciseName.trim().toLowerCase(), { weight: r.weight, reps: r.reps });
    }
    return m;
  });

  // Best (weight, reps) per exercise observed so far in this session.
  // Only used to dedupe toasts: we fire a PR toast only when session-best
  // INCREASES (and beats the historical snapshot). Editing values down
  // doesn't fire; editing UP to a new high does.
  const sessionBestRef = useRef<Map<string, { weight: number; reps: number }>>(new Map());

  /* ---------------- Deload week (src/deloadDetector.ts) ---------------- */

  const deload = !!workout.deload;
  const [deloadInfoOpen, setDeloadInfoOpen] = useState(false);
  // The same numbers the home banner explained with, so the "i" here tells
  // the same story rather than a second one.
  const deloadData = useMemo(
    () => computeDeloadSuggestion(storage.getWorkouts()),
    // The report is about weeks of history; nothing logged in this session
    // can change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deload],
  );
  const deloadEndsAt = useMemo(() => (deload ? deloadWeekEndsAt() : null), [deload]);
  const deloadDaysLeft = deloadEndsAt
    ? Math.max(1, Math.ceil((deloadEndsAt.getTime() - Date.now()) / 86400000))
    : null;

  // One history scan for every exercise on screen, recomputed only when the
  // exercise LIST changes — so adding or swapping an exercise mid-session
  // gets its own target, but typing into a set does not rescan localStorage.
  const exerciseKey = workout.exercises.map((ex) => `${ex.id}:${ex.exerciseId}`).join('|');
  const deloadTargets = useMemo(() => {
    const map = new Map<string, NonNullable<DeloadTarget>>();
    if (!deload) return map;
    const history = storage.getWorkouts();
    for (const ex of workout.exercises) {
      const target = deloadTargetFor(ex.exerciseId, ex.exerciseName, history);
      if (target) map.set(ex.id, target);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deload, exerciseKey]);

  /** Write the target weight and reps into every set not already logged. */
  const applyDeloadTargets = () => {
    const exercises = workout.exercises.map((ex) => {
      const target = deloadTargets.get(ex.id);
      if (!target) return ex;
      return {
        ...ex,
        sets: ex.sets.map((s) => (s.completed ? s : { ...s, weight: target.weight, reps: target.reps })),
      };
    });
    onUpdate({ ...workout, exercises });
    hapticImpact('light');
  };

  // Sets arrive pre-filled with last session's weight, which is the wrong
  // number for a deliberately light week. Rewrite the weights once, while
  // nothing has been logged yet — reps are still the lifter's to enter.
  const deloadPrefilledRef = useRef(false);
  useEffect(() => {
    if (!deload || deloadPrefilledRef.current || deloadTargets.size === 0) return;
    deloadPrefilledRef.current = true;
    if (workout.exercises.some((ex) => ex.sets.some((s) => s.completed))) return;
    onUpdate({
      ...workout,
      exercises: workout.exercises.map((ex) => {
        const target = deloadTargets.get(ex.id);
        if (!target) return ex;
        return { ...ex, sets: ex.sets.map((s) => (s.completed ? s : { ...s, weight: target.weight })) };
      }),
    });
    // Runs once per mount, as soon as targets exist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deload, deloadTargets]);

  // Workout duration timer
  useEffect(() => {
    const startTime = workout.startedAt ? new Date(workout.startedAt).getTime() : Date.now();
    
    const updateElapsed = () => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    };
    
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [workout.startedAt]);
  
  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (restTimer === null) return;
    const interval = setInterval(() => {
      setRestTimeLeft((t) => {
        if (t <= 1) {
          // Finished: clear the timer and signal from inside the tick so the
          // effect body itself never sets state.
          setRestTimer(null);
          feedback('restDone');
          return 0;
        }
        // Three seconds out, a quieter heads-up so you can rack up in time.
        if (t === 4) feedback('restEnding');
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [restTimer]);

  const startRestTimer = (seconds: number) => {
    setRestTimer(seconds);
    setRestTimeLeft(seconds);
  };
  
  // Add exercise to current workout
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [allExercises, setAllExercises] = useState<Exercise[]>(() => withGymExercises(storage.getExercises()));

  const refreshExercises = () => setAllExercises(storage.getExercises());

  const addExercise = (exercise: Exercise) => {
    const lastSession = storage.getLastExerciseSession(exercise.id);
    // Added mid-deload: start it at its own lighter target rather than at
    // last session's working weight.
    const target = deload ? deloadTargetFor(exercise.id, exercise.name, storage.getWorkouts()) : null;
    const defaultSets = 3;
    const newExercise: WorkoutExercise = {
      id: crypto.randomUUID(),
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      sets: Array.from({ length: defaultSets }, (_, i) => ({
        id: crypto.randomUUID(),
        weight: target ? target.weight : (lastSession && lastSession[i] ? lastSession[i].weight : 0),
        reps: 0,
        completed: false,
      })),
    };
    const newWorkout = {
      ...workout,
      exercises: [...workout.exercises, newExercise],
    };
    onUpdate(newWorkout);
    setShowAddExercise(false);
  };

  const { showToast } = useToast();
  const { confirm: confirmDialog } = useConfirm();
  // Delete exercise from current workout
  const deleteExercise = async (exerciseIndex: number) => {
    if (workout.exercises.length <= 1) {
      showToast('You cannot remove the last exercise — discard the workout instead.', 'error');
      return;
    }
    
    const exerciseName = workout.exercises[exerciseIndex].exerciseName;
    if (await confirmDialog({ title: 'Remove exercise?', message: `Remove "${exerciseName}" from this session?`, confirmLabel: 'Remove', tone: 'danger' })) {
      const newWorkout = { ...workout };
      newWorkout.exercises = workout.exercises.filter((_, i) => i !== exerciseIndex);
      onUpdate(newWorkout);
      // Haptic feedback for deletion
      hapticImpact('medium');
    }
  };

  // Swap exercise with a different one from the library
  const swapExercise = (exerciseIndex: number, newExercise: Exercise) => {
    const newWorkout = { ...workout };
    newWorkout.exercises = [...workout.exercises];
    
    const oldExercise = workout.exercises[exerciseIndex];
    const numSets = oldExercise.sets.length;
    
    // Get last session data for the NEW exercise to pre-fill weights
    const lastSession = storage.getLastExerciseSession(newExercise.id);
    // On a deload week the swapped-in lift gets its own lighter target.
    const target = deload ? deloadTargetFor(newExercise.id, newExercise.name, storage.getWorkouts()) : null;

    // Create new sets with pre-filled weights from last session of new exercise
    const newSets: WorkoutSet[] = Array.from({ length: numSets }, (_, i) => ({
      id: `${newExercise.id}_set${i}_${Date.now()}`,
      weight: target ? target.weight : (lastSession && lastSession[i] ? lastSession[i].weight : 0),
      reps: target ? target.reps : (lastSession && lastSession[i] ? lastSession[i].reps : oldExercise.sets[i]?.reps || 10),
      completed: false,
    }));
    
    newWorkout.exercises[exerciseIndex] = {
      ...oldExercise,
      exerciseId: newExercise.id,
      exerciseName: newExercise.name,
      sets: newSets,
    };
    
    onUpdate(newWorkout);
  };

  const addSet = (exerciseIndex: number) => {
    const newWorkout = { ...workout };
    newWorkout.exercises = [...workout.exercises];
    const ex = { ...workout.exercises[exerciseIndex] };
    ex.sets = [...ex.sets];
    const lastSet = ex.sets[ex.sets.length - 1];
    ex.sets.push({
      id: crypto.randomUUID(),
      reps: 0,
      weight: lastSet?.weight || 0,
      completed: false,
    });
    newWorkout.exercises[exerciseIndex] = ex;
    onUpdate(newWorkout);
  };

  const removeSet = (exerciseIndex: number, setIndex: number) => {
    const ex = workout.exercises[exerciseIndex];
    if (!ex || ex.sets.length <= 1) return; // keep at least one
    const newWorkout = { ...workout };
    newWorkout.exercises = [...workout.exercises];
    newWorkout.exercises[exerciseIndex] = {
      ...ex,
      sets: ex.sets.filter((_, i) => i !== setIndex),
    };
    onUpdate(newWorkout);
  };

  const updateSet = (exerciseIndex: number, setIndex: number, updates: Partial<WorkoutSet>) => {
    const newWorkout = { ...workout };
    newWorkout.exercises = [...workout.exercises];
    newWorkout.exercises[exerciseIndex] = { ...workout.exercises[exerciseIndex] };
    newWorkout.exercises[exerciseIndex].sets = [...workout.exercises[exerciseIndex].sets];
    const oldSet = workout.exercises[exerciseIndex].sets[setIndex];
    const updatedSet = { ...oldSet, ...updates };
    newWorkout.exercises[exerciseIndex].sets[setIndex] = updatedSet;
    onUpdate(newWorkout);

    const exercise = newWorkout.exercises[exerciseIndex];

    // Decide whether this update should re-evaluate PR / volume / rest:
    //   (a) The set just transitioned from incomplete → complete (logging).
    //   (b) The set was already complete and weight/reps changed (correction).
    // Case (b) is the fix for "user typo'd 150 → toast fires; corrects to
    // 15 (still a PR vs history) → no toast" — we now re-evaluate on
    // value changes too.
    const justCompleted = !!updates.completed && !oldSet.completed;
    const isStillCompleted = !!updatedSet.completed;
    const valueChanged =
      (updates.weight !== undefined && updates.weight !== oldSet.weight) ||
      (updates.reps !== undefined && updates.reps !== oldSet.reps);
    const editedCompletedSet = oldSet.completed && isStillCompleted && valueChanged;
    // Nothing to celebrate on a deload week — the weights are meant to be
    // light, so a "new record" toast would be either wrong or tone-deaf.
    const shouldEvaluate = (justCompleted || editedCompletedSet) && !deload;

    // Rest timer — only on first completion, not on edits.
    if (justCompleted) {
      // The set landing is the cue; the timer starting is the same moment,
      // so it does not get its own.
      feedback('setComplete');
      const libraryEntry = storage.getExercises().find(
        (e) => e.id === exercise.exerciseId
          || e.name.trim().toLowerCase() === exercise.exerciseName.trim().toLowerCase(),
      );
      startRestTimer(defaultRestSecondsFor(libraryEntry));
    }

    // Always keep the per-exercise session-best ref accurate, even on
    // un-completes / value drops. The toast logic below decides whether
    // to fire based on the prev value vs the freshly-recomputed one.
    let freshSessionBest: { weight: number; reps: number } | null = null;
    for (const s of exercise.sets) {
      if (!s.completed || s.weight <= 0 || s.reps <= 0) continue;
      if (!freshSessionBest
          || s.weight > freshSessionBest.weight
          || (s.weight === freshSessionBest.weight && s.reps > freshSessionBest.reps)) {
        freshSessionBest = { weight: s.weight, reps: s.reps };
      }
    }
    const prevSessionBest = sessionBestRef.current.get(exercise.exerciseId);
    if (freshSessionBest) {
      sessionBestRef.current.set(exercise.exerciseId, freshSessionBest);
    } else {
      sessionBestRef.current.delete(exercise.exerciseId);
    }

    if (shouldEvaluate && updatedSet.weight > 0 && updatedSet.reps > 0 && freshSessionBest) {
      // Did session-best go UP this update? (Rules out edits down or sideways.)
      const sessionBestIncreased =
        !prevSessionBest
        || freshSessionBest.weight > prevSessionBest.weight
        || (freshSessionBest.weight === prevSessionBest.weight && freshSessionBest.reps > prevSessionBest.reps);

      // Does it beat the user's pre-session historical best?
      const snapshotPR = prSnapshot.get(exercise.exerciseId)
        ?? prSnapshot.get(exercise.exerciseName.trim().toLowerCase());
      const beatsHistorical =
        !snapshotPR
        || freshSessionBest.weight > snapshotPR.weight
        || (freshSessionBest.weight === snapshotPR.weight && freshSessionBest.reps > snapshotPR.reps);

      const isWeightRepPR = sessionBestIncreased && beatsHistorical;

      // Volume PR (current session total volume vs prior session). Not
      // persisted — purely cosmetic.
      const currentVolume = exercise.sets.reduce((sum, s) =>
        s.completed ? sum + s.weight * s.reps : sum, 0);
      let lastSession = storage.getLastExerciseSession(exercise.exerciseId);
      if (!lastSession) {
        const nameKey = exercise.exerciseName.trim().toLowerCase();
        const prior = storage.getWorkouts()
          .filter(w => w.completed && w.type !== 'rest')
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        for (const w of prior) {
          const match = w.exercises.find(ex => ex.exerciseName.trim().toLowerCase() === nameKey);
          if (match && match.sets.some(s => s.completed)) {
            lastSession = match.sets.filter(s => s.completed);
            break;
          }
        }
      }
      const lastVolume = lastSession
        ? lastSession.reduce((sum, s) => sum + (s.weight * s.reps), 0)
        : 0;
      const isVolumePR = currentVolume > lastVolume && lastVolume > 0;
      const allSetsCompleted = exercise.sets.every(s => s.completed);
      const isLastCompletedSet = setIndex === exercise.sets.length - 1 || allSetsCompleted;

      if (isWeightRepPR) {
        setPrAchievement({
          exercise: exercise.exerciseName,
          weight: freshSessionBest.weight,
          reps: freshSessionBest.reps,
        });
        setTimeout(() => setPrAchievement(null), 3500);
        feedback('prCelebration');
      } else if (isVolumePR && isLastCompletedSet) {
        setPrAchievement({
          exercise: exercise.exerciseName,
          weight: Math.round(currentVolume),
          reps: 0,
          isVolumePR: true,
        });
        setTimeout(() => setPrAchievement(null), 3500);
        feedback('prCelebration');
      }
    }
  };

  const completedSets = workout.exercises.reduce((acc, ex) => 
    acc + ex.sets.filter(s => s.completed).length, 0
  );
  const totalSets = workout.exercises.reduce((acc, ex) => acc + ex.sets.length, 0);
  const progress = totalSets > 0 ? (completedSets / totalSets) * 100 : 0;

  return (
    <div className="space-y-4 animate-fadeIn" style={{ paddingBottom: 'calc(128px + env(safe-area-inset-bottom, 0px))' }}>
      {/* PR Achievement Toast */}
      {prAchievement && (
        <div className="fixed top-4 left-4 right-4 z-50 animate-fadeIn">
          <div className={`rounded-xl p-4 shadow-lg flex items-center gap-3 ${
            prAchievement.isVolumePR 
              ? 'bg-gradient-to-r from-purple-500 to-blue-500 shadow-purple-500/30'
              : 'bg-gradient-to-r from-yellow-500 to-orange-500 shadow-orange-500/30'
          }`}>
            <div className="text-3xl">{prAchievement.isVolumePR ? <TrendingUp className="w-8 h-8 text-white" /> : <Trophy className="w-8 h-8 text-white" />}</div>
            <div className="flex-1 text-white">
              <div className="font-bold">
                {prAchievement.isVolumePR ? 'Volume PR' : 'New personal record'}
              </div>
              <div className="text-sm text-white/90">
                {prAchievement.isVolumePR 
                  ? `${prAchievement.exercise}: ${prAchievement.weight}kg total volume!`
                  : `${prAchievement.exercise}: ${prAchievement.weight}kg × ${prAchievement.reps}`
                }
              </div>
            </div>
            <button 
              onClick={() => setPrAchievement(null)}
              className="text-white/70 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
      
      {/* Header. The title is truncated and the side groups are pinned:
          a long plan name used to wrap into the back arrow and the Finish
          button, which is what made the top of this screen look crowded. */}
      <div className="flex items-center gap-2">
        <button onClick={onPause} className="p-2 -ml-2 shrink-0 text-muted" title="Pause workout">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="text-base font-bold truncate" title={workout.name}>{workout.name}</h1>
          <div className="text-xs text-accent font-mono flex items-center justify-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDuration(elapsedSeconds)}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Dustbin: visible for personal workouts and for hosts in a
              group session (cancels the whole session). Hidden for
              non-host participants — only the host can cancel on
              everyone's behalf. */}
          {sessionMode !== 'participant' && (
            <button
              onClick={onDiscard}
              className="p-2 text-subtle hover:text-danger transition-colors"
              title={sessionMode === 'host' ? 'Cancel session for all' : 'Discard workout'}
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
          {sessionMode === 'participant' ? (
            <div className="px-3 py-2 rounded-lg text-xs font-medium bg-surface-2 text-muted">
              Waiting for host…
            </div>
          ) : (
            <button
              onClick={onFinish}
              className="px-4 py-2 bg-emerald-600 rounded-lg text-sm font-medium"
            >
              {sessionMode === 'host' ? 'Finish Session' : 'Finish'}
            </button>
          )}
        </div>
      </div>

      {/* Deload week — the same explanation the home banner gave, so the
          lifter isn't re-reading a new word mid-session. */}
      {deload && (
        <div className="bg-surface border border-info/35 rounded-card p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-control bg-info/14 text-info flex items-center justify-center shrink-0">
              <TrendingDown className="w-[18px] h-[18px]" strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-text">Deload week · lighter on purpose</p>
              <p className="text-[13px] leading-[18px] text-muted mt-1">
                Take the target on each exercise and stop a couple of reps short of hard.
                {deloadDaysLeft !== null && ` ${deloadDaysLeft} day${deloadDaysLeft === 1 ? '' : 's'} left of the easy week.`}
              </p>
            </div>
            <IconButton icon={Info} label="Why this?" size="sm" onClick={() => setDeloadInfoOpen(true)} />
          </div>
          <div className="flex gap-2 mt-3">
            <Button
              variant="primary" size="md" onClick={applyDeloadTargets}
              disabled={deloadTargets.size === 0}
              className="flex-1 min-w-0"
            >
              Set deload targets
            </Button>
            {onAskZen && (
              <Button
                variant="secondary" size="md" icon={MessageCircle} className="shrink-0"
                onClick={() => onAskZen(deloadZenPrompt(deloadData.risingStreak))}
              >
                Ask Zen
              </Button>
            )}
          </div>
          <DeloadExplainerSheet
            open={deloadInfoOpen}
            onClose={() => setDeloadInfoOpen(false)}
            data={deloadData}
          />
        </div>
      )}

      {/* Progress Bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-muted">Progress</span>
          <span className="text-accent">{completedSets}/{totalSets} sets</span>
        </div>
        <div className="h-2 bg-border rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-orange-500 to-red-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Quick Rest Timer Buttons (when no timer running) */}
      {restTimer === null && (
        <div className="flex gap-2">
          <span className="text-sm text-subtle self-center">Rest:</span>
          {storage.getRestTimerPresets().map(seconds => (
            <button
              key={seconds}
              onClick={() => { feedback('restStart'); startRestTimer(seconds); }}
              className="flex-1 py-2 bg-surface border border-border rounded-lg text-sm text-muted hover:border-accent/50 transition-colors"
            >
              {seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${seconds}s`}
            </button>
          ))}
        </div>
      )}
      
      {/* STICKY Rest Timer - Fixed at bottom when running */}
      {restTimer !== null && (
        <div className="fixed bottom-0 left-0 right-0 z-40 p-4 bg-bg border-t border-accent/30">
          <div className="bg-accent-soft border border-accent/30 rounded-xl p-4 flex items-center justify-between max-w-lg mx-auto">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Clock className="w-8 h-8 text-accent" />
                <div className="absolute inset-0 animate-ping opacity-30">
                  <Clock className="w-8 h-8 text-accent" />
                </div>
              </div>
              <div>
                <div className="text-sm text-accent">Rest Timer</div>
                <div className="text-3xl font-bold font-mono">{restTimeLeft}s</div>
              </div>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setRestTimeLeft(t => t + 30)}
                className="px-3 py-2 bg-accent/30 rounded-lg text-sm font-medium"
              >
                +30s
              </button>
              <button 
                onClick={() => setRestTimer(null)}
                className="px-3 py-2 bg-surface-2 rounded-lg text-sm font-medium"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exercises */}
      <div className="space-y-4">
        {workout.exercises.map((exercise, exIndex) => {
          // Check if this exercise is part of a superset
          const isSuperset = exercise.supersetGroup;
          const prevExercise = workout.exercises[exIndex - 1];
          const nextExercise = workout.exercises[exIndex + 1];
          const isFirstInSuperset = isSuperset && (!prevExercise || prevExercise.supersetGroup !== exercise.supersetGroup);
          const isLastInSuperset = isSuperset && (!nextExercise || nextExercise.supersetGroup !== exercise.supersetGroup);

          return (
            <div key={exercise.id} className="relative">
              {/* Superset connector line */}
              {isSuperset && !isFirstInSuperset && (
                <div className="absolute left-5 -top-4 w-0.5 h-4 bg-purple-500/50" />
              )}
              {isSuperset && !isLastInSuperset && (
                <div className="absolute left-5 -bottom-4 w-0.5 h-4 bg-purple-500/50 z-10" />
              )}

              {/* Superset group label for first exercise */}
              {isFirstInSuperset && (
                <div className="text-xs text-purple-400 font-medium mb-2 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                  Superset {exercise.supersetGroup}
                </div>
              )}

              <ExerciseCard
                exercise={exercise}
                onUpdateSet={(setIndex, updates) => updateSet(exIndex, setIndex, updates)}
                onAddSet={() => addSet(exIndex)}
                onRemoveSet={(setIndex) => removeSet(exIndex, setIndex)}
                onSwapExercise={(newExercise) => swapExercise(exIndex, newExercise)}
                onDelete={() => deleteExercise(exIndex)}
                canDelete={workout.exercises.length > 1}
                onExerciseCreated={refreshExercises}
                sessionId={workout.sessionId}
                buddyBest={buddyProgress?.get(exercise.exerciseName.trim().toLowerCase())}
                deloadTarget={deload ? deloadTargets.get(exercise.id) ?? null : null}
                deload={deload}
              />
            </div>
          );
        })}

        {/* Add Exercise Button */}
        <button
          onClick={() => setShowAddExercise(true)}
          className="w-full py-3 border-2 border-dashed border-border rounded-xl text-muted hover:border-accent/50 hover:text-accent transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Add Exercise
        </button>
        {/* The sticky rest timer is fixed to the bottom; leave room so the
            button above stays reachable while it counts down. */}
        {restTimer !== null && <div aria-hidden className="h-28" />}
      </div>

      <ExercisePickerSheet
        open={showAddExercise}
        title="Add exercise"
        exercises={allExercises.filter((ex) => !workout.exercises.some((we) => we.exerciseId === ex.id))}
        action="add"
        sessionId={workout.sessionId}
        onCreated={refreshExercises}
        onPick={(ex) => { setShowAddExercise(false); addExercise(ex); }}
        onClose={() => setShowAddExercise(false)}
      />
    </div>
  );
}

// Exercise Card
function ExerciseCard({ exercise, onUpdateSet, onAddSet, onRemoveSet, onSwapExercise, onDelete, canDelete, onExerciseCreated, sessionId, buddyBest, deloadTarget, deload }: {
  exercise: WorkoutExercise;
  onUpdateSet: (setIndex: number, updates: Partial<WorkoutSet>) => void;
  onAddSet: () => void;
  onRemoveSet: (setIndex: number) => void;
  onSwapExercise: (newExercise: Exercise) => void;
  onDelete: () => void;
  canDelete: boolean;
  onExerciseCreated: () => void;
  /** When this card is rendered inside a buddy session, the parent
   *  passes the session id so a custom exercise the user creates from
   *  the swap-search flow can be broadcast to other participants. */
  sessionId?: string;
  /** All other participants' ordered set lists for this exercise in
   *  the current session. The card renders one "{buddyName} did Xkg × Y"
   *  line per buddy below YOUR set N, when each buddy has logged set
   *  N. Empty / absent → no hint is shown. */
  buddyBest?: Array<{ buddyName: string; sets: Array<{ weight: number; reps: number }> }>;
  /** What to lift on this exercise during a deload week, or null when the
   *  exercise has no history to scale down from. */
  deloadTarget?: DeloadTarget;
  /** True while this whole session is a deload week workout. */
  deload?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showExerciseSelector, setShowExerciseSelector] = useState(false);
  const completedCount = exercise.sets.filter(s => s.completed).length;
  
  // Get all exercises for the selector
  const [allExercises, setAllExercises] = useState<Exercise[]>(() => withGymExercises(storage.getExercises()));
  
  // Get last session data for progressive overload tracking
  const lastSession = useMemo(() => 
    storage.getLastExerciseSession(exercise.exerciseId), 
    [exercise.exerciseId]
  );
  
  const [showInfo, setShowInfo] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  // Re-fetched each time the info modal opens so newly-edited notes in the
  // Exercise Library show without requiring a full remount. Previously this
  // was useMemo'd with stale deps, which is why saved notes sometimes
  // wouldn't appear here.
  const exerciseData = useMemo<{
    notes?: string; sharedNotes?: string; videoUrl?: string;
    muscleGroup?: Exercise['muscleGroup']; isCompound?: boolean;
    equipment?: Exercise['equipment'];
  }>(() => {
    // The member's own library first, then the gym's (a gym exercise is
    // never copied into the member's data — see src/gymLibrary.ts).
    const ex = findExercise(exercise.exerciseId, exercise.exerciseName);
    return {
      notes: ex?.notes,
      sharedNotes: ex?.sharedNotes,
      videoUrl: ex?.videoUrl,
      muscleGroup: ex?.muscleGroup,
      isCompound: ex?.isCompound,
      equipment: ex?.equipment,
    };
    // showInfo / expanded are deliberate: re-read the library when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.exerciseId, exercise.exerciseName, showInfo, expanded]);

  // What to aim for today, from this exercise's own history (src/progression.ts).
  // Pure and local: no AI, no network, and it stays quiet until there are two
  // sessions to reason from.
  const progression = useMemo(
    () => buildProgression({
      sessions: collectExerciseSessions(storage.getWorkouts(), exercise.exerciseId, exercise.exerciseName),
      equipment: exerciseData.equipment,
      targetReps: exercise.sets[0]?.reps,
    }),
    // Recomputed when the card opens, not on every keystroke in a set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exercise.exerciseId, exercise.exerciseName, exerciseData.equipment, expanded],
  );

  // Get PR for this exercise — match by id OR by name so session workouts
  // (which carry the host's exerciseIds) resolve to the local user's PR.
  const exercisePR = useMemo(() => {
    const records = storage.getPersonalRecords();
    const nameKey = exercise.exerciseName.trim().toLowerCase();
    return records.find(
      r => r.exerciseId === exercise.exerciseId ||
           r.exerciseName.trim().toLowerCase() === nameKey,
    ) ?? null;
  }, [exercise.exerciseId, exercise.exerciseName]);
  
  // Helper to get comparison indicator for a set
  const getProgressIndicator = (setIndex: number, currentWeight: number, currentReps: number) => {
    if (currentWeight === 0 || currentReps === 0) return null; // No data yet

    // On a deload week the lift IS supposed to be lighter, so there is
    // nothing to compare it to and nothing to grade. Neutral words only —
    // "Lower" after a set you were told to take easy is just a punishment
    // for following the plan.
    if (deload) {
      const onTarget = !!deloadTarget
        && Math.abs(currentWeight - deloadTarget.weight) <= Math.max(deloadTarget.weight * 0.1, 1.25);
      return {
        icon: 'right' as const,
        color: onTarget ? 'text-info' : 'text-muted',
        label: onTarget ? 'On target' : 'Deload set',
      };
    }

    if (!lastSession || setIndex >= lastSession.length) return null;
    const lastSet = lastSession[setIndex];

    const weightDiff = currentWeight - lastSet.weight;
    const repsDiff = currentReps - lastSet.reps;
    
    // Improved: either weight or reps increased (or both)
    if (weightDiff > 0 || repsDiff > 0) {
      return { icon: 'up', color: 'text-green-400', label: 'Improved!' };
    }
    // Same
    if (weightDiff === 0 && repsDiff === 0) {
      return { icon: 'right', color: 'text-muted', label: 'Same as last' };
    }
    // Decreased
    return { icon: 'down', color: 'text-red-400', label: 'Lower' };
  };

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <ExercisePickerSheet
        open={showExerciseSelector}
        title="Swap exercise"
        exercises={allExercises.filter((ex) => ex.id !== exercise.exerciseId)}
        action="swap"
        sessionId={sessionId}
        onCreated={() => { setAllExercises(storage.getExercises()); onExerciseCreated(); }}
        onPick={(ex) => { setShowExerciseSelector(false); onSwapExercise(ex); }}
        onClose={() => setShowExerciseSelector(false)}
      />
      
      <div className="p-4 flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-3 flex-1"
        >
          <div className="w-10 h-10 rounded-lg bg-accent-soft flex items-center justify-center relative">
            <Dumbbell className="w-5 h-5 text-accent" />
            {/* Superset Badge */}
            {exercise.supersetGroup && (
              <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-purple-500 text-[10px] font-bold flex items-center justify-center text-white">
                {exercise.supersetGroup}
              </div>
            )}
          </div>
          <div className="text-left">
            <div className="font-medium flex items-center gap-2">
              {exercise.exerciseName}
              {exercise.supersetGroup && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-medium">
                  Superset {exercise.supersetGroup}
                </span>
              )}
            </div>
            <div className="text-sm text-subtle flex items-center gap-2 flex-wrap">
              <span>{completedCount}/{exercise.sets.length} sets</span>
              {/* Deload week: what to lift here, worked out from this
                  exercise's own last three normal sessions. */}
              {deloadTarget && <Pill tone="info">{deloadTargetLabel(deloadTarget)}</Pill>}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowInfo(true)}
            className="p-2 text-subtle hover:text-blue-400 transition-colors"
            title="Exercise info"
          >
            <Info className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowExerciseSelector(true)}
            className="p-2 text-subtle hover:text-accent transition-colors"
            title="Swap exercise"
          >
            <Edit3 className="w-5 h-5" />
          </button>
          {canDelete && (
            <button
              onClick={onDelete}
              className="p-2 text-subtle hover:text-danger transition-colors"
              title="Remove exercise"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
          <button onClick={() => setExpanded(!expanded)}>
            <ChevronRight className={`w-5 h-5 text-subtle transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        </div>
      </div>

      {/* Exercise Info Modal */}
      {showInfo && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center animate-fadeIn"
          onClick={() => setShowInfo(false)}
        >
          <div
            className="bg-surface w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-surface p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-bold">{exercise.exerciseName}</h3>
              <button
                onClick={() => setShowInfo(false)}
                className="p-1.5 text-subtle hover:text-text rounded-lg hover:bg-surface-2"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                {exerciseData.muscleGroup && (
                  <div className="bg-surface-2 rounded-lg p-3">
                    <div className="text-[10px] uppercase text-subtle font-semibold">Muscle group</div>
                    <div className="font-medium mt-0.5 capitalize">{exerciseData.muscleGroup.replace('_', ' ')}</div>
                  </div>
                )}
                <div className="bg-surface-2 rounded-lg p-3">
                  <div className="text-[10px] uppercase text-subtle font-semibold">Sets planned</div>
                  <div className="font-medium mt-0.5">{exercise.sets.length}</div>
                </div>
                {exerciseData.isCompound !== undefined && (
                  <div className="bg-surface-2 rounded-lg p-3">
                    <div className="text-[10px] uppercase text-subtle font-semibold">Type</div>
                    <div className="font-medium mt-0.5">{exerciseData.isCompound ? 'Compound' : 'Isolation'}</div>
                  </div>
                )}
                {exerciseData.equipment && (
                  <div className="bg-surface-2 rounded-lg p-3">
                    <div className="text-[10px] uppercase text-subtle font-semibold">Equipment</div>
                    <div className="font-medium mt-0.5">{labelize(exerciseData.equipment)}</div>
                  </div>
                )}
              </div>
              {exerciseData.sharedNotes && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-subtle mb-1.5 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" /> Exercise notes
                  </div>
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-text whitespace-pre-wrap">
                    {exerciseData.sharedNotes}
                  </div>
                </div>
              )}
              {exerciseData.notes && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-subtle mb-1.5 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" /> My notes
                  </div>
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-text whitespace-pre-wrap">
                    {exerciseData.notes}
                  </div>
                </div>
              )}
              {!exerciseData.sharedNotes && !exerciseData.notes && (
                <p className="text-xs text-subtle italic">No notes yet — add cues or form reminders from the Exercise Library.</p>
              )}
              {exerciseData.videoUrl && (
                <button
                  type="button"
                  onClick={() => setVideoOpen(true)}
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-white hover:brightness-110 font-medium text-sm transition-colors"
                >
                  <Play className="w-4 h-4" /> Watch form video
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          {/* What to aim for today. A deload week overrides it: the whole
              point is to go lighter, so "try 85 kg" would fight the plan. */}
          {deload ? deloadTarget && (
            <div className="rounded-lg border border-info/25 bg-info/10 p-3">
              <div className="flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-info shrink-0" />
                <span className="text-sm font-semibold">
                  {deloadTargetLabel(deloadTarget)}
                </span>
              </div>
              <p className="text-xs text-muted mt-1">
                About 60 % of your recent best on this lift, for the same reps. It should
                feel easy — leave the last couple of reps in the tank.
              </p>
            </div>
          ) : progression.suggestion && (
            <div className="rounded-lg border border-accent/25 bg-accent-soft p-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-accent shrink-0" />
                <span className="text-sm font-semibold">
                  {progression.suggestion.kind === 'hold' ? 'Hold at' : 'Try'}{' '}
                  {progression.suggestion.weight > 0 ? `${progression.suggestion.weight} kg × ` : ''}
                  {progression.suggestion.reps} reps
                </span>
                {progression.last && (
                  <span className="text-xs text-subtle ml-auto shrink-0">
                    Last: {formatSet(progression.last)}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted mt-1">{progression.suggestion.why}</p>
            </div>
          )}

          {/* Exercise Notes & Video */}
          {(exerciseData.sharedNotes || exerciseData.notes || exerciseData.videoUrl) && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
              {exerciseData.sharedNotes && (
                <div className="mb-2">
                  <div className="text-xs font-medium text-blue-400 mb-1 flex items-center gap-1">
                    <FileText className="w-3 h-3" /> Exercise notes
                  </div>
                  <div className="text-sm text-text whitespace-pre-wrap">{exerciseData.sharedNotes}</div>
                </div>
              )}
              {exerciseData.notes && (
                <div className="mb-2">
                  <div className="text-xs font-medium text-emerald-400 mb-1 flex items-center gap-1"><FileText className="w-3 h-3" /> My notes</div>
                  <div className="text-sm text-text whitespace-pre-wrap">{exerciseData.notes}</div>
                </div>
              )}
              {exerciseData.videoUrl && (
                <button
                  type="button"
                  onClick={() => setVideoOpen(true)}
                  className="inline-flex items-center gap-2 text-sm text-accent hover:brightness-110 transition-colors"
                >
                  <Play className="w-4 h-4" />
                  <span>Watch form video</span>
                </button>
              )}
            </div>
          )}
          {videoOpen && exerciseData.videoUrl && (
            <VideoModal url={exerciseData.videoUrl} title={exercise.exerciseName} onClose={() => setVideoOpen(false)} />
          )}
          
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 text-xs text-subtle px-2">
            <div className="col-span-2">SET</div>
            <div className="col-span-4">WEIGHT (kg)</div>
            <div className="col-span-4">REPS</div>
            <div className="col-span-2"></div>
          </div>

          {/* Sets */}
          {exercise.sets.map((set, setIndex) => {
            const lastSet = lastSession && setIndex < lastSession.length ? lastSession[setIndex] : null;
            const indicator = getProgressIndicator(setIndex, set.weight, set.reps);
            
            return (
              <div key={set.id} className="space-y-1">
                <div 
                  className={`grid grid-cols-12 gap-2 items-center p-2 rounded-lg ${
                    set.completed ? 'bg-emerald-500/10' : 'bg-surface-2'
                  }`}
                >
                  <div className="col-span-2 text-center font-medium">{setIndex + 1}</div>
                  <div className="col-span-4">
                    <input
                      type="number"
                      value={set.weight || ''}
                      onChange={(e) => onUpdateSet(setIndex, { weight: parseFloat(e.target.value) || 0 })}
                      placeholder="0"
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-center focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div className="col-span-4">
                    <input
                      type="number"
                      value={set.reps || ''}
                      onChange={(e) => onUpdateSet(setIndex, { reps: parseInt(e.target.value) || 0 })}
                      placeholder="0"
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-center focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div className="col-span-2 flex items-center justify-center gap-1">
                    <button
                      onClick={() => onUpdateSet(setIndex, { completed: !set.completed })}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                        set.completed
                          ? 'bg-emerald-500 text-white'
                          : 'bg-border text-muted hover:brightness-110'
                      }`}
                      title={set.completed ? 'Uncheck set' : 'Mark set complete'}
                    >
                      <Check className="w-5 h-5" />
                    </button>
                    {/* Remove set — hidden on the very first row so the
                        exercise always has at least one set. */}
                    {exercise.sets.length > 1 && (
                      <button
                        onClick={() => onRemoveSet(setIndex)}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-subtle hover:text-danger hover:bg-red-500/10 transition-colors"
                        title="Remove this set"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                
                {/* Last session comparison. During a deload the line can
                    carry only the neutral label — there may be no previous
                    session at all for an exercise added mid-week. */}
                {(lastSet || indicator) && (
                  <div className="flex items-center justify-between px-2 text-xs">
                    <span className="text-subtle">
                      {lastSet ? `Last: ${lastSet.weight}kg × ${lastSet.reps} reps` : ''}
                    </span>
                    {indicator && (
                      <span className={`flex items-center gap-1 ${indicator.color} font-medium`}>
                        <span>{indicator.icon === 'up' ? <ArrowUp className="w-3 h-3" /> : indicator.icon === 'right' ? <ArrowRight className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}</span>
                        <span>{indicator.label}</span>
                      </span>
                    )}
                  </div>
                )}
                {/* One line per OTHER participant who's logged this
                    set. We render set-by-set: YOUR set N → each buddy's
                    set N (if they've done it). In a 3-person session
                    that's potentially two stacked lines under one of
                    your sets. Earlier this only showed the first
                    buddy's data even when 3 people were in the
                    session, dropping the second buddy from the hint. */}
                {buddyBest && buddyBest.length > 0 && (
                  <>
                    {buddyBest.map((b) => {
                      const buddySet = b.sets[setIndex];
                      if (!buddySet || buddySet.weight <= 0 || buddySet.reps <= 0) return null;
                      return (
                        <div key={b.buddyName} className="px-2 text-xs text-blue-400">
                          {b.buddyName} did {buddySet.weight}kg × {buddySet.reps} reps
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            );
          })}

          {/* Add set button */}
          <button
            onClick={onAddSet}
            className="w-full mt-2 py-2 rounded-lg text-xs font-medium border border-dashed border-border text-muted hover:border-accent/50 hover:text-accent transition-colors flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Add set
          </button>

          {/* Personal Record */}
          {exercisePR && exercisePR.weight > 0 && (
            <div className="flex items-center gap-2 px-2 pt-2 text-sm text-yellow-500">
              <Trophy className="w-4 h-4" />
              <span>PR: {exercisePR.weight}kg x {exercisePR.reps}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
