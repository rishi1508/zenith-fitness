import { useState, useEffect, useMemo } from 'react';
import {
  Dumbbell, ChevronRight, ChevronLeft, Check, Clock, Search, X, Edit3, Trash2, Plus,
  TrendingUp, Trophy, ArrowUp, ArrowRight, ArrowDown, FileText, Play, Info
} from 'lucide-react';
import type { Workout, WorkoutSet, WorkoutExercise, Exercise } from '../types';
import * as storage from '../storage';
import { hapticImpact, hapticNotification } from '../haptics';

// Module-level AudioContext so oscillators don't constantly warm up a new
// context (which Android autoplay policy keeps in "suspended"). Lazily
// created and resumed inside playSound.
let sharedAudioContext: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  if (sharedAudioContext) return sharedAudioContext;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedAudioContext = new Ctor();
    return sharedAudioContext;
  } catch {
    return null;
  }
}

// Active Workout View
export function ActiveWorkoutView({
  workout, onUpdate, onFinish, onPause, onDiscard,
  sessionMode, buddyProgress,
}: {
  workout: Workout;
  onUpdate: (workout: Workout) => void;
  onFinish: () => void;
  onPause: () => void;
  onDiscard: () => void;
  /** 'host' = finish ends session for all; 'participant' = cannot finish; null = regular personal workout */
  sessionMode?: 'host' | 'participant' | null;
  /** Per-exercise best set from the other buddy in the session, keyed by exercise NAME (case-insensitive, trimmed) */
  buddyProgress?: Map<string, { buddyName: string; weight: number; reps: number }>;
}) {
  const [restTimer, setRestTimer] = useState<number | null>(null);
  const [restTimeLeft, setRestTimeLeft] = useState(0);
  const [prAchievement, setPrAchievement] = useState<{exercise: string; weight: number; reps: number; isVolumePR?: boolean} | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  
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

  // Persistent audio context — browsers require the same context for
  // subsequent plays, and suspended contexts must be resumed via a user
  // gesture. Creating a fresh one per call is why sounds were firing
  // inconsistently on Android.
  const playSound = (type: 'celebration' | 'timer') => {
    if (!storage.isSoundEnabled(type)) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();

      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.value = type === 'celebration' ? 880 : 440;

      // Short attack + release envelope so the tone doesn't click.
      const now = ctx.currentTime;
      const duration = type === 'celebration' ? 0.4 : 0.2;
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.3, now + 0.015);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

      oscillator.start(now);
      if (type === 'celebration') {
        oscillator.frequency.setValueAtTime(880, now);
        oscillator.frequency.setValueAtTime(1047, now + 0.1);
        oscillator.frequency.setValueAtTime(1319, now + 0.2);
      }
      oscillator.stop(now + duration + 0.02);
    } catch (e) {
      console.log('Audio not supported:', e);
    }
  };

  useEffect(() => {
    if (restTimer === null) return;
    
    if (restTimeLeft <= 0) {
      setRestTimer(null);
      // Play timer sound
      playSound('timer');
      // Strong vibration pattern when timer ends
      hapticNotification('warning');
      return;
    }

    const interval = setInterval(() => {
      setRestTimeLeft(t => t - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [restTimer, restTimeLeft]);

  const startRestTimer = (seconds: number) => {
    setRestTimer(seconds);
    setRestTimeLeft(seconds);
    // Quick haptic feedback when starting timer
    hapticImpact('light');
  };
  
  // Add exercise to current workout
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [addSearchQuery, setAddSearchQuery] = useState('');
  const [allExercises, setAllExercises] = useState<Exercise[]>(() => storage.getExercises());

  const refreshExercises = () => setAllExercises(storage.getExercises());

  const addExercise = (exercise: Exercise) => {
    const lastSession = storage.getLastExerciseSession(exercise.id);
    const defaultSets = 3;
    const newExercise: WorkoutExercise = {
      id: crypto.randomUUID(),
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      sets: Array.from({ length: defaultSets }, (_, i) => ({
        id: crypto.randomUUID(),
        weight: lastSession && lastSession[i] ? lastSession[i].weight : 0,
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
    setAddSearchQuery('');
  };

  // Delete exercise from current workout
  const deleteExercise = (exerciseIndex: number) => {
    if (workout.exercises.length <= 1) {
      alert('Cannot delete the last exercise. Use the trash button to discard the entire workout.');
      return;
    }
    
    const exerciseName = workout.exercises[exerciseIndex].exerciseName;
    if (confirm(`Remove "${exerciseName}" from this session?`)) {
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
    
    // Create new sets with pre-filled weights from last session of new exercise
    const newSets: WorkoutSet[] = Array.from({ length: numSets }, (_, i) => ({
      id: `${newExercise.id}_set${i}_${Date.now()}`,
      weight: lastSession && lastSession[i] ? lastSession[i].weight : 0,
      reps: lastSession && lastSession[i] ? lastSession[i].reps : oldExercise.sets[i]?.reps || 10,
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
    const updatedSet = {
      ...workout.exercises[exerciseIndex].sets[setIndex],
      ...updates,
    };
    newWorkout.exercises[exerciseIndex].sets[setIndex] = updatedSet;
    onUpdate(newWorkout);

    // Start rest timer when completing a set
    if (updates.completed && !workout.exercises[exerciseIndex].sets[setIndex].completed) {
      startRestTimer(90); // 90 second default rest
      
      const exercise = newWorkout.exercises[exerciseIndex];
      
      if (updatedSet.weight > 0 && updatedSet.reps > 0) {
        // Check for weight/reps PR
        const isPR = storage.checkAndUpdatePR(
          exercise.exerciseId,
          exercise.exerciseName,
          updatedSet.weight,
          updatedSet.reps
        );
        
        // Check for volume PR (total volume this exercise in this session).
        // Use the UPDATED set's values, and also pull prior session by
        // exerciseId OR by name so session-mode exercises that use the
        // host's ids still resolve.
        const currentVolume = exercise.sets.reduce((sum, s) => {
          // Current set uses the freshly-updated values; older sets only
          // count if actually completed.
          if (s.id === updatedSet.id) return sum + updatedSet.weight * updatedSet.reps;
          return s.completed ? sum + s.weight * s.reps : sum;
        }, 0);

        // Resolve lastSession by id first, then by name (matches PR logic).
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
        // Fire volume PR on the LAST completed set of the session — which
        // is "the set at max index whose values are non-zero". This keeps
        // the toast from spamming, and correctly handles Add Set making
        // the last index larger than 2.
        const completedCountNow = exercise.sets.filter(s => s.completed || s.id === updatedSet.id).length;
        const isLastCompletedSet = setIndex === exercise.sets.length - 1 ||
          completedCountNow === exercise.sets.length;

        if (isPR) {
          setPrAchievement({
            exercise: exercise.exerciseName,
            weight: updatedSet.weight,
            reps: updatedSet.reps,
          });
          setTimeout(() => setPrAchievement(null), 3500);
          // Play celebration sound
          playSound('celebration');
          hapticNotification('success');
        } else if (isVolumePR && isLastCompletedSet) {
          // Volume PR — fires on last set (or when all sets are completed)
          setPrAchievement({
            exercise: exercise.exerciseName,
            weight: Math.round(currentVolume),
            reps: 0,
            isVolumePR: true,
          });
          setTimeout(() => setPrAchievement(null), 3500);
          hapticNotification('success');
        }
      }
    }
  };

  const completedSets = workout.exercises.reduce((acc, ex) => 
    acc + ex.sets.filter(s => s.completed).length, 0
  );
  const totalSets = workout.exercises.reduce((acc, ex) => acc + ex.sets.length, 0);
  const progress = totalSets > 0 ? (completedSets / totalSets) * 100 : 0;

  return (
    <div className="space-y-4 animate-fadeIn pb-32">
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
                {prAchievement.isVolumePR ? 'Volume PR!' : 'New Personal Record!'}
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
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={onPause} className="p-2 -ml-2 text-zinc-400" title="Pause workout">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="text-center">
          <h1 className="text-lg font-bold">{workout.name}</h1>
          <div className="text-xs text-orange-400 font-mono flex items-center justify-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDuration(elapsedSeconds)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Dustbin: visible for personal workouts and for hosts in a
              group session (cancels the whole session). Hidden for
              non-host participants — only the host can cancel on
              everyone's behalf. */}
          {sessionMode !== 'participant' && (
            <button
              onClick={onDiscard}
              className="p-2 text-zinc-500 hover:text-red-400 transition-colors"
              title={sessionMode === 'host' ? 'Cancel session for all' : 'Discard workout'}
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
          {sessionMode === 'participant' ? (
            <div className="px-3 py-2 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-400">
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

      {/* Progress Bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-zinc-400">Progress</span>
          <span className="text-orange-400">{completedSets}/{totalSets} sets</span>
        </div>
        <div className="h-2 bg-[#2e2e2e] rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-orange-500 to-red-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Quick Rest Timer Buttons (when no timer running) */}
      {restTimer === null && (
        <div className="flex gap-2">
          <span className="text-sm text-zinc-500 self-center">Rest:</span>
          {storage.getRestTimerPresets().map(seconds => (
            <button
              key={seconds}
              onClick={() => startRestTimer(seconds)}
              className="flex-1 py-2 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg text-sm text-zinc-400 hover:border-orange-500/50 transition-colors"
            >
              {seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${seconds}s`}
            </button>
          ))}
        </div>
      )}
      
      {/* STICKY Rest Timer - Fixed at bottom when running */}
      {restTimer !== null && (
        <div className="fixed bottom-0 left-0 right-0 z-40 p-4 bg-[#0f0f0f] border-t border-orange-500/30">
          <div className="bg-orange-500/20 border border-orange-500/30 rounded-xl p-4 flex items-center justify-between max-w-lg mx-auto">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Clock className="w-8 h-8 text-orange-400" />
                <div className="absolute inset-0 animate-ping opacity-30">
                  <Clock className="w-8 h-8 text-orange-400" />
                </div>
              </div>
              <div>
                <div className="text-sm text-orange-400">Rest Timer</div>
                <div className="text-3xl font-bold font-mono">{restTimeLeft}s</div>
              </div>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setRestTimeLeft(t => t + 30)}
                className="px-3 py-2 bg-orange-500/30 rounded-lg text-sm font-medium"
              >
                +30s
              </button>
              <button 
                onClick={() => setRestTimer(null)}
                className="px-3 py-2 bg-zinc-700 rounded-lg text-sm font-medium"
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
                buddyBest={buddyProgress?.get(exercise.exerciseName.trim().toLowerCase())}
              />
            </div>
          );
        })}

        {/* Add Exercise Button */}
        <button
          onClick={() => setShowAddExercise(true)}
          className="w-full py-3 border-2 border-dashed border-[#3e3e3e] rounded-xl text-zinc-400 hover:border-orange-500/50 hover:text-orange-400 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Add Exercise
        </button>
      </div>

      {/* Add Exercise Modal */}
      {showAddExercise && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center animate-fadeIn">
          <div className="bg-[#1a1a1a] w-full max-h-[80vh] rounded-t-2xl overflow-hidden">
            <div className="p-4 border-b border-[#2e2e2e]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold">Add Exercise</h3>
                <button
                  onClick={() => { setShowAddExercise(false); setAddSearchQuery(''); }}
                  className="p-2 text-zinc-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                <input
                  type="text"
                  value={addSearchQuery}
                  onChange={(e) => setAddSearchQuery(e.target.value)}
                  placeholder="Search exercises..."
                  className="w-full pl-10 pr-4 py-3 bg-[#252525] border border-[#3e3e3e] rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500"
                  autoFocus
                />
              </div>
            </div>
            <div className="overflow-y-auto max-h-[60vh] p-2">
              {allExercises
                .filter(ex =>
                  ex.name.toLowerCase().includes(addSearchQuery.toLowerCase()) &&
                  !workout.exercises.some(we => we.exerciseId === ex.id)
                )
                .map(ex => {
                  const lastData = storage.getLastExerciseSession(ex.id);
                  return (
                    <button
                      key={ex.id}
                      onClick={() => addExercise(ex)}
                      className="w-full p-3 rounded-lg text-left hover:bg-[#252525] transition-colors flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium">{ex.name}</div>
                        <div className="text-xs text-zinc-500">
                          {ex.muscleGroup.replace('_', ' ')}
                          {lastData && lastData[0] && (
                            <span className="text-orange-400 ml-2">
                              Last: {lastData[0].weight}kg x {lastData[0].reps}
                            </span>
                          )}
                        </div>
                      </div>
                      <Plus className="w-4 h-4 text-orange-400" />
                    </button>
                  );
                })}
              {addSearchQuery.trim() && (
                <div className="mt-3 pt-3 border-t border-[#2e2e2e]">
                  <div className="text-xs text-zinc-500 mb-2 px-3">Can't find what you're looking for?</div>
                  <button
                    onClick={() => {
                      const created = storage.addCustomExercise(addSearchQuery.trim(), 'other');
                      refreshExercises();
                      addExercise(created);
                    }}
                    className="w-full p-3 rounded-lg text-left hover:bg-[#252525] transition-colors flex items-center gap-2 text-orange-400"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create "{addSearchQuery.trim()}"</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Exercise Card
function ExerciseCard({ exercise, onUpdateSet, onAddSet, onRemoveSet, onSwapExercise, onDelete, canDelete, onExerciseCreated, buddyBest }: {
  exercise: WorkoutExercise;
  onUpdateSet: (setIndex: number, updates: Partial<WorkoutSet>) => void;
  onAddSet: () => void;
  onRemoveSet: (setIndex: number) => void;
  onSwapExercise: (newExercise: Exercise) => void;
  onDelete: () => void;
  canDelete: boolean;
  onExerciseCreated: () => void;
  /** Best set from the other buddy on this exercise in the current session. */
  buddyBest?: { buddyName: string; weight: number; reps: number };
}) {
  const [expanded, setExpanded] = useState(true);
  const [showExerciseSelector, setShowExerciseSelector] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const completedCount = exercise.sets.filter(s => s.completed).length;
  
  // Get all exercises for the selector
  const [allExercises, setAllExercises] = useState<Exercise[]>(() => storage.getExercises());
  const filteredExercises = useMemo(() =>
    allExercises.filter(ex =>
      ex.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      ex.id !== exercise.exerciseId // Exclude current exercise
    ),
    [allExercises, searchQuery, exercise.exerciseId]
  );
  
  // Get last session data for progressive overload tracking
  const lastSession = useMemo(() => 
    storage.getLastExerciseSession(exercise.exerciseId), 
    [exercise.exerciseId]
  );
  
  const [showInfo, setShowInfo] = useState(false);
  // Re-fetched each time the info modal opens so newly-edited notes in the
  // Exercise Library show without requiring a full remount. Previously this
  // was useMemo'd with stale deps, which is why saved notes sometimes
  // wouldn't appear here.
  const [exerciseData, setExerciseData] = useState<{
    notes?: string; videoUrl?: string;
    muscleGroup?: Exercise['muscleGroup']; isCompound?: boolean;
  }>({});
  useEffect(() => {
    const exercises = storage.getExercises();
    const nameKey = exercise.exerciseName.trim().toLowerCase();
    const ex = exercises.find(e => e.id === exercise.exerciseId)
      || exercises.find(e => e.name.trim().toLowerCase() === nameKey);
    setExerciseData({
      notes: ex?.notes,
      videoUrl: ex?.videoUrl,
      muscleGroup: ex?.muscleGroup,
      isCompound: ex?.isCompound,
    });
  }, [exercise.exerciseId, exercise.exerciseName, showInfo]);

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
    if (!lastSession || setIndex >= lastSession.length) return null;
    const lastSet = lastSession[setIndex];
    
    if (currentWeight === 0 || currentReps === 0) return null; // No data yet
    
    const weightDiff = currentWeight - lastSet.weight;
    const repsDiff = currentReps - lastSet.reps;
    
    // Improved: either weight or reps increased (or both)
    if (weightDiff > 0 || repsDiff > 0) {
      return { icon: 'up', color: 'text-green-400', label: 'Improved!' };
    }
    // Same
    if (weightDiff === 0 && repsDiff === 0) {
      return { icon: 'right', color: 'text-zinc-400', label: 'Same as last' };
    }
    // Decreased
    return { icon: 'down', color: 'text-red-400', label: 'Lower' };
  };

  return (
    <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl overflow-hidden">
      {/* Exercise Selector Modal */}
      {showExerciseSelector && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center animate-fadeIn">
          <div className="bg-[#1a1a1a] w-full max-h-[80vh] rounded-t-2xl overflow-hidden">
            <div className="p-4 border-b border-[#2e2e2e]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold">Swap Exercise</h3>
                <button 
                  onClick={() => {
                    setShowExerciseSelector(false);
                    setSearchQuery('');
                  }}
                  className="p-2 text-zinc-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search exercises..."
                  className="w-full pl-10 pr-4 py-3 bg-[#252525] border border-[#3e3e3e] rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500"
                  autoFocus
                />
              </div>
            </div>
            <div className="overflow-y-auto max-h-[60vh] p-2">
              {filteredExercises.length === 0 && !searchQuery.trim() ? (
                <div className="text-center py-8 text-zinc-500">
                  No exercises found
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredExercises.map(ex => {
                    const lastData = storage.getLastExerciseSession(ex.id);
                    return (
                      <button
                        key={ex.id}
                        onClick={() => {
                          onSwapExercise(ex);
                          setShowExerciseSelector(false);
                          setSearchQuery('');
                        }}
                        className="w-full p-3 rounded-lg text-left hover:bg-[#252525] transition-colors flex items-center justify-between"
                      >
                        <div>
                          <div className="font-medium">{ex.name}</div>
                          <div className="text-xs text-zinc-500">
                            {ex.muscleGroup.replace('_', ' ')}
                            {lastData && lastData[0] && (
                              <span className="text-orange-400 ml-2">
                                Last: {lastData[0].weight}kg × {lastData[0].reps}
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-600" />
                      </button>
                    );
                  })}
                </div>
              )}
              {searchQuery.trim() && (
                <div className="mt-3 pt-3 border-t border-[#2e2e2e]">
                  <div className="text-xs text-zinc-500 mb-2 px-3">Can't find what you're looking for?</div>
                  <button
                    onClick={() => {
                      const created = storage.addCustomExercise(searchQuery.trim(), 'other');
                      setAllExercises(storage.getExercises());
                      onExerciseCreated();
                      onSwapExercise(created);
                      setShowExerciseSelector(false);
                      setSearchQuery('');
                    }}
                    className="w-full p-3 rounded-lg text-left hover:bg-[#252525] transition-colors flex items-center gap-2 text-orange-400"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create "{searchQuery.trim()}"</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      <div className="p-4 flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-3 flex-1"
        >
          <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center relative">
            <Dumbbell className="w-5 h-5 text-orange-400" />
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
            <div className="text-sm text-zinc-500">{completedCount}/{exercise.sets.length} sets</div>
          </div>
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowInfo(true)}
            className="p-2 text-zinc-500 hover:text-blue-400 transition-colors"
            title="Exercise info"
          >
            <Info className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowExerciseSelector(true)}
            className="p-2 text-zinc-500 hover:text-orange-400 transition-colors"
            title="Swap exercise"
          >
            <Edit3 className="w-5 h-5" />
          </button>
          {canDelete && (
            <button
              onClick={onDelete}
              className="p-2 text-zinc-500 hover:text-red-400 transition-colors"
              title="Remove exercise"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
          <button onClick={() => setExpanded(!expanded)}>
            <ChevronRight className={`w-5 h-5 text-zinc-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
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
            className="bg-[#1a1a1a] w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-[#1a1a1a] p-4 border-b border-[#2e2e2e] flex items-center justify-between">
              <h3 className="font-bold">{exercise.exerciseName}</h3>
              <button
                onClick={() => setShowInfo(false)}
                className="p-1.5 text-zinc-500 hover:text-white rounded-lg hover:bg-[#252525]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                {exerciseData.muscleGroup && (
                  <div className="bg-[#252525] rounded-lg p-3">
                    <div className="text-[10px] uppercase text-zinc-500 font-semibold">Muscle group</div>
                    <div className="font-medium mt-0.5 capitalize">{exerciseData.muscleGroup.replace('_', ' ')}</div>
                  </div>
                )}
                <div className="bg-[#252525] rounded-lg p-3">
                  <div className="text-[10px] uppercase text-zinc-500 font-semibold">Sets planned</div>
                  <div className="font-medium mt-0.5">{exercise.sets.length}</div>
                </div>
                {exerciseData.isCompound !== undefined && (
                  <div className="bg-[#252525] rounded-lg p-3 col-span-2">
                    <div className="text-[10px] uppercase text-zinc-500 font-semibold">Type</div>
                    <div className="font-medium mt-0.5">{exerciseData.isCompound ? 'Compound' : 'Isolation'}</div>
                  </div>
                )}
              </div>
              {exerciseData.notes ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" /> Notes & cues
                  </div>
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-zinc-300 whitespace-pre-wrap">
                    {exerciseData.notes}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-zinc-500 italic">No notes yet — add cues or form reminders from the Exercise Library.</p>
              )}
              {exerciseData.videoUrl && (
                <a
                  href={exerciseData.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-medium text-sm transition-colors"
                >
                  <Play className="w-4 h-4" /> Watch form video
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          {/* Exercise Notes & Video */}
          {(exerciseData.notes || exerciseData.videoUrl) && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
              {exerciseData.notes && (
                <div className="mb-2">
                  <div className="text-xs font-medium text-blue-400 mb-1 flex items-center gap-1"><FileText className="w-3 h-3" /> Notes</div>
                  <div className="text-sm text-zinc-300">{exerciseData.notes}</div>
                </div>
              )}
              {exerciseData.videoUrl && (
                <a
                  href={exerciseData.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-orange-400 hover:text-orange-300 transition-colors"
                >
                  <Play className="w-4 h-4" />
                  <span>Watch Form Video</span>
                </a>
              )}
            </div>
          )}
          
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 text-xs text-zinc-500 px-2">
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
                    set.completed ? 'bg-emerald-500/10' : 'bg-[#252525]'
                  }`}
                >
                  <div className="col-span-2 text-center font-medium">{setIndex + 1}</div>
                  <div className="col-span-4">
                    <input
                      type="number"
                      value={set.weight || ''}
                      onChange={(e) => onUpdateSet(setIndex, { weight: parseFloat(e.target.value) || 0 })}
                      placeholder="0"
                      className="w-full bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg px-3 py-2 text-center focus:outline-none focus:border-orange-500"
                    />
                  </div>
                  <div className="col-span-4">
                    <input
                      type="number"
                      value={set.reps || ''}
                      onChange={(e) => onUpdateSet(setIndex, { reps: parseInt(e.target.value) || 0 })}
                      placeholder="0"
                      className="w-full bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg px-3 py-2 text-center focus:outline-none focus:border-orange-500"
                    />
                  </div>
                  <div className="col-span-2 flex items-center justify-center gap-1">
                    <button
                      onClick={() => onUpdateSet(setIndex, { completed: !set.completed })}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                        set.completed
                          ? 'bg-emerald-500 text-white'
                          : 'bg-[#2e2e2e] text-zinc-400 hover:bg-[#3e3e3e]'
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
                        className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Remove this set"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                
                {/* Last session comparison */}
                {lastSet && (
                  <div className="flex items-center justify-between px-2 text-xs">
                    <span className="text-zinc-500">
                      Last: {lastSet.weight}kg × {lastSet.reps} reps
                    </span>
                    {indicator && (
                      <span className={`flex items-center gap-1 ${indicator.color} font-medium`}>
                        <span>{indicator.icon === 'up' ? <ArrowUp className="w-3 h-3" /> : indicator.icon === 'right' ? <ArrowRight className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}</span>
                        <span>{indicator.label}</span>
                      </span>
                    )}
                  </div>
                )}
                {/* Buddy's best set in the current group session, if any */}
                {setIndex === 0 && buddyBest && buddyBest.weight > 0 && buddyBest.reps > 0 && (
                  <div className="px-2 text-xs text-blue-400">
                    {buddyBest.buddyName} did {buddyBest.weight}kg × {buddyBest.reps} reps
                  </div>
                )}
              </div>
            );
          })}

          {/* Add set button */}
          <button
            onClick={onAddSet}
            className="w-full mt-2 py-2 rounded-lg text-xs font-medium border border-dashed border-zinc-700 text-zinc-400 hover:border-orange-500/50 hover:text-orange-400 transition-colors flex items-center justify-center gap-1.5"
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
