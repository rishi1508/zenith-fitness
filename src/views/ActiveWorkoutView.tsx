import { useState, useEffect, useMemo } from 'react';
import { 
  Dumbbell, ChevronRight, Check, Clock, Search, X, Edit3, Trash2
} from 'lucide-react';
import type { Workout, WorkoutSet, WorkoutExercise, Exercise } from '../types';
import * as storage from '../storage';

// Active Workout View
export function ActiveWorkoutView({ workout, onUpdate, onFinish, onCancel }: {
  workout: Workout;
  onUpdate: (workout: Workout) => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const [restTimer, setRestTimer] = useState<number | null>(null);
  const [restTimeLeft, setRestTimeLeft] = useState(0);
  const [prAchievement, setPrAchievement] = useState<{exercise: string; weight: number; reps: number; isVolumePR?: boolean} | null>(null);

  // Rest timer with strong haptic feedback
  // Play sound effect using Web Audio API
  const playSound = (type: 'celebration' | 'timer') => {
    if (!storage.isSoundEnabled(type)) return;
    
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = type === 'celebration' ? 880 : 440;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      
      oscillator.start();
      
      if (type === 'celebration') {
        setTimeout(() => oscillator.frequency.value = 1047, 100);
        setTimeout(() => oscillator.frequency.value = 1319, 200);
        setTimeout(() => oscillator.stop(), 400);
      } else {
        setTimeout(() => oscillator.stop(), 200);
      }
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
      try {
        if ('vibrate' in navigator) {
          navigator.vibrate([300, 100, 300, 100, 500]); // Strong pattern
        }
      } catch (e) {
        console.log('Vibration not supported:', e);
      }
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
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate(50);
      }
    } catch (e) {}
  };
  
  // Delete exercise from current workout
  const deleteExercise = (exerciseIndex: number) => {
    if (workout.exercises.length <= 1) {
      alert('Cannot delete the last exercise. Use Cancel to discard the entire workout.');
      return;
    }
    
    const exerciseName = workout.exercises[exerciseIndex].exerciseName;
    if (confirm(`Remove "${exerciseName}" from this session?`)) {
      const newWorkout = { ...workout };
      newWorkout.exercises = workout.exercises.filter((_, i) => i !== exerciseIndex);
      onUpdate(newWorkout);
      // Haptic feedback for deletion
      try {
        if ('vibrate' in navigator) {
          navigator.vibrate([50, 50, 50]);
        }
      } catch (e) {}
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
        
        // Check for volume PR (total volume this exercise in this session)
        const currentVolume = exercise.sets
          .filter(s => s.completed || s.id === updatedSet.id)
          .reduce((sum, s) => sum + (s.weight * s.reps), 0);
        
        const lastSession = storage.getLastExerciseSession(exercise.exerciseId);
        const lastVolume = lastSession 
          ? lastSession.reduce((sum, s) => sum + (s.weight * s.reps), 0)
          : 0;
        
        const isVolumePR = currentVolume > lastVolume && lastVolume > 0;
        
        if (isPR) {
          setPrAchievement({
            exercise: exercise.exerciseName,
            weight: updatedSet.weight,
            reps: updatedSet.reps,
          });
          setTimeout(() => setPrAchievement(null), 3500);
          // Play celebration sound
          playSound('celebration');
          try {
            if ('vibrate' in navigator) {
              navigator.vibrate([100, 50, 100, 50, 200]); // PR vibration!
            }
          } catch (e) {}
        } else if (isVolumePR && setIndex === exercise.sets.length - 1) {
          // Volume PR - only show on last set to avoid spam
          setPrAchievement({
            exercise: exercise.exerciseName,
            weight: Math.round(currentVolume),
            reps: 0,
            isVolumePR: true,
          });
          setTimeout(() => setPrAchievement(null), 3500);
          try {
            if ('vibrate' in navigator) {
              navigator.vibrate([50, 30, 50, 30, 100]); // Lighter volume PR vibration
            }
          } catch (e) {}
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
            <div className="text-3xl">{prAchievement.isVolumePR ? '📈' : '🏆'}</div>
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
        <button onClick={onCancel} className="p-2 -ml-2 text-zinc-400">
          <X className="w-6 h-6" />
        </button>
        <h1 className="text-lg font-bold">{workout.name}</h1>
        <button
          onClick={onFinish}
          className="px-4 py-2 bg-emerald-600 rounded-lg text-sm font-medium"
        >
          Finish
        </button>
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
                onSwapExercise={(newExercise) => swapExercise(exIndex, newExercise)}
                onDelete={() => deleteExercise(exIndex)}
                canDelete={workout.exercises.length > 1}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Exercise Card
function ExerciseCard({ exercise, onUpdateSet, onSwapExercise, onDelete, canDelete }: {
  exercise: WorkoutExercise;
  onUpdateSet: (setIndex: number, updates: Partial<WorkoutSet>) => void;
  onSwapExercise: (newExercise: Exercise) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showExerciseSelector, setShowExerciseSelector] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const completedCount = exercise.sets.filter(s => s.completed).length;
  
  // Get all exercises for the selector
  const allExercises = useMemo(() => storage.getExercises(), []);
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
  
  // Get exercise notes and video from library
  const exerciseData = useMemo(() => {
    const exercises = storage.getExercises();
    const ex = exercises.find(e => e.id === exercise.exerciseId);
    return { notes: ex?.notes, videoUrl: ex?.videoUrl };
  }, [exercise.exerciseId]);
  
  // Helper to get comparison indicator for a set
  const getProgressIndicator = (setIndex: number, currentWeight: number, currentReps: number) => {
    if (!lastSession || setIndex >= lastSession.length) return null;
    const lastSet = lastSession[setIndex];
    
    if (currentWeight === 0 || currentReps === 0) return null; // No data yet
    
    const weightDiff = currentWeight - lastSet.weight;
    const repsDiff = currentReps - lastSet.reps;
    
    // Improved: either weight or reps increased (or both)
    if (weightDiff > 0 || repsDiff > 0) {
      return { icon: '🔺', color: 'text-green-400', label: 'Improved!' };
    }
    // Same
    if (weightDiff === 0 && repsDiff === 0) {
      return { icon: '➡️', color: 'text-zinc-400', label: 'Same as last' };
    }
    // Decreased
    return { icon: '🔻', color: 'text-red-400', label: 'Lower' };
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
              {filteredExercises.length === 0 ? (
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

      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          {/* Exercise Notes & Video */}
          {(exerciseData.notes || exerciseData.videoUrl) && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
              {exerciseData.notes && (
                <div className="mb-2">
                  <div className="text-xs font-medium text-blue-400 mb-1">📝 Notes</div>
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
                  <span>▶️</span>
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
                  <div className="col-span-2 flex justify-center">
                    <button
                      onClick={() => onUpdateSet(setIndex, { completed: !set.completed })}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                        set.completed 
                          ? 'bg-emerald-500 text-white' 
                          : 'bg-[#2e2e2e] text-zinc-400 hover:bg-[#3e3e3e]'
                      }`}
                    >
                      <Check className="w-5 h-5" />
                    </button>
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
                        <span>{indicator.icon}</span>
                        <span>{indicator.label}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
