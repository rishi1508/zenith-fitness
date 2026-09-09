import { useState } from 'react';
import {
  Calendar, ChevronLeft, ChevronRight, Clock,
  Copy, Dumbbell, Trash2, CheckCircle2, Share2, Edit3, Save, X
} from 'lucide-react';
import type { Exercise, Workout, WeeklyPlan } from '../types';
import * as storage from '../storage';
import { ShareWorkout } from '../components';
import { ExercisePickerSheet } from './exercises/ExercisePickerSheet';

import { useConfirm } from '../ui';
interface HistoryWorkoutCardProps {
  workout: Workout;
  isDark: boolean;
  onDelete: () => void;
  onSaveAsTemplate: () => void;
  onShare: () => void;
  onSave: (workout: Workout) => void;
}

function HistoryWorkoutCard({ workout, isDark, onDelete, onSaveAsTemplate, onShare, onSave }: HistoryWorkoutCardProps) {
  const { confirm: confirmDialog } = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editWorkout, setEditWorkout] = useState<Workout>(workout);
  /** Which exercise the picker is open for, while editing. */
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  const allExercises = swapIndex !== null ? storage.getExercises() : [];
  const isImported = workout.type === 'imported';
  const isRest = workout.type === 'rest';

  const startEditing = () => {
    setEditWorkout(JSON.parse(JSON.stringify(workout)));
    setEditing(true);
    setExpanded(true);
  };

  const saveEdits = () => {
    onSave(editWorkout);
    setEditing(false);
  };

  const cancelEditing = () => {
    setEditWorkout(JSON.parse(JSON.stringify(workout)));
    setEditing(false);
  };

  const updateSet = (exIndex: number, setIndex: number, field: 'weight' | 'reps', value: number) => {
    const updated = JSON.parse(JSON.stringify(editWorkout)) as Workout;
    updated.exercises[exIndex].sets[setIndex][field] = value;
    setEditWorkout(updated);
  };

  /** Logged the wrong movement — keep the sets, change what they were. */
  const swapExercise = (exIndex: number, replacement: Exercise) => {
    const updated = JSON.parse(JSON.stringify(editWorkout)) as Workout;
    updated.exercises[exIndex].exerciseId = replacement.id;
    updated.exercises[exIndex].exerciseName = replacement.name;
    setEditWorkout(updated);
    setSwapIndex(null);
  };

  const removeExercise = (exIndex: number) => {
    const updated = JSON.parse(JSON.stringify(editWorkout)) as Workout;
    updated.exercises.splice(exIndex, 1);
    setEditWorkout(updated);
  };
  
  const completedSets = workout.exercises.reduce((acc, ex) => 
    acc + ex.sets.filter(s => s.completed).length, 0
  );

  // For imported workouts, show exercise names in title
  const getTitle = () => {
    if (isImported && workout.exercises.length > 0) {
      const names = workout.exercises.map(ex => ex.exerciseName).slice(0, 2);
      const suffix = workout.exercises.length > 2 ? ` +${workout.exercises.length - 2}` : '';
      return names.join(', ') + suffix;
    }
    return workout.name;
  };

  return (
    <div className={`border rounded-xl overflow-hidden ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200 shadow-sm'}`}>
      {/* The row's actions are buttons, so the row itself cannot be one —
          nested buttons are invalid and React says so on every render. */}
      <div className="w-full p-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => !isRest && workout.exercises.length > 0 && setExpanded(!expanded)}
            className={`flex items-center gap-3 min-w-0 flex-1 text-left ${!isRest && workout.exercises.length > 0 ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              isRest 
                ? 'bg-zinc-500/20' 
                : isImported
                  ? 'bg-green-500/20'
                  : 'bg-orange-500/20'
            }`}>
              {isRest 
                ? <Clock className="w-5 h-5 text-zinc-400" />
                : <Dumbbell className={`w-5 h-5 ${isImported ? 'text-green-400' : 'text-orange-400'}`} />
              }
            </div>
            <div>
              <div className="font-medium flex items-center gap-2 flex-wrap">
                <span>{getTitle()}</span>
                {isImported && (
                  <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">
                    Imported
                  </span>
                )}
              </div>
              {!isRest && (
                <div className="text-sm text-zinc-500">
                  {workout.exercises.length} exercises • {completedSets} sets
                </div>
              )}
            </div>
          </button>
          <div className="flex items-center gap-1 shrink-0">
            {!isRest && workout.exercises.length > 0 && (
              <ChevronRight className={`w-5 h-5 text-zinc-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            )}
            {!isRest && workout.exercises.length > 0 && workout.completed && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onShare();
                }}
                className="p-2 text-zinc-500 hover:text-purple-400"
                title="Share workout"
              >
                <Share2 className="w-4 h-4" />
              </button>
            )}
            {!isRest && workout.exercises.length > 0 && !editing && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  startEditing();
                }}
                className="p-2 text-zinc-500 hover:text-blue-400"
                title="Edit workout"
              >
                <Edit3 className="w-4 h-4" />
              </button>
            )}
            {!isRest && workout.exercises.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSaveAsTemplate();
                }}
                className="p-2 text-zinc-500 hover:text-orange-400"
                title="Save as template"
              >
                <Copy className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (await confirmDialog({ title: 'Delete workout?', message: 'This workout will be removed from your history.', confirmLabel: 'Delete', tone: 'danger' })) {
                  onDelete();
                }
              }}
              className="p-2 text-zinc-500 hover:text-red-400"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      
      {/* Expanded exercise details */}
      {expanded && workout.exercises.length > 0 && (
        <div className={`px-4 pb-4 border-t pt-3 ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}>
          {editing && (
            <div className="flex items-center justify-end gap-2 mb-3">
              <button
                onClick={cancelEditing}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 ${isDark ? 'bg-[#252525] text-zinc-300' : 'bg-gray-100 text-gray-600'}`}
              >
                <X className="w-3 h-3" />
                Cancel
              </button>
              <button
                onClick={saveEdits}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white flex items-center gap-1"
              >
                <Save className="w-3 h-3" />
                Save
              </button>
            </div>
          )}
          <div className="space-y-3">
            {(editing ? editWorkout : workout).exercises.map((exercise, exIdx) => {
              const completedSets = exercise.sets.filter(s => s.completed);
              return (
                <div key={exIdx}>
                  {editing ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSwapIndex(exIdx)}
                        className={`flex-1 min-w-0 text-left text-sm font-medium flex items-center gap-1.5 ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}
                      >
                        <span className="truncate">{exercise.exerciseName}</span>
                        <Edit3 className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                      </button>
                      <button
                        onClick={() => removeExercise(exIdx)}
                        aria-label={`Remove ${exercise.exerciseName}`}
                        className="p-1.5 text-zinc-500 hover:text-red-400 shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className={`text-sm font-medium ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>{exercise.exerciseName}</div>
                  )}
                  {editing ? (
                    <div className="mt-2 space-y-1.5">
                      {exercise.sets.map((set, setIdx) => (
                        <div key={setIdx} className="flex items-center gap-2 text-sm">
                          <span className={`w-6 text-center text-xs ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>{setIdx + 1}</span>
                          <input
                            type="number"
                            value={set.weight || ''}
                            onChange={(e) => updateSet(exIdx, setIdx, 'weight', parseFloat(e.target.value) || 0)}
                            className={`w-20 px-2 py-1.5 rounded text-center text-sm border ${isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-gray-50 border-gray-200'} focus:outline-none focus:border-orange-500`}
                            placeholder="kg"
                          />
                          <span className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>kg</span>
                          <span className={`text-xs ${isDark ? 'text-zinc-600' : 'text-gray-300'}`}>x</span>
                          <input
                            type="number"
                            value={set.reps || ''}
                            onChange={(e) => updateSet(exIdx, setIdx, 'reps', parseInt(e.target.value) || 0)}
                            className={`w-16 px-2 py-1.5 rounded text-center text-sm border ${isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-gray-50 border-gray-200'} focus:outline-none focus:border-orange-500`}
                            placeholder="reps"
                          />
                          <span className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>reps</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={`text-xs mt-0.5 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                      {completedSets.length > 0 ? (
                        completedSets.map((set, j) => (
                          <span key={j}>
                            {j > 0 && ' \u2022 '}
                            {set.weight}kg x {set.reps}
                          </span>
                        ))
                      ) : (
                        `${exercise.sets.length} sets`
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <ExercisePickerSheet
            open={swapIndex !== null}
            title="Change exercise"
            action="swap"
            exercises={allExercises}
            onPick={(ex) => { if (swapIndex !== null) swapExercise(swapIndex, ex); }}
            onClose={() => setSwapIndex(null)}
          />
        </div>
      )}
    </div>
  );
}

interface HistoryViewProps {
  workouts: Workout[];
  isDark: boolean;
  onBack: () => void;
  onDelete: (id: string) => void;
}

export function HistoryView({ workouts, isDark, onBack, onDelete }: HistoryViewProps) {
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [workoutToShare, setWorkoutToShare] = useState<Workout | null>(null);
  
  const { promptText } = useConfirm();
  const handleSaveAsTemplate = async (workout: Workout) => {
    if (workout.exercises.length === 0) return;
    
    const templateName = await promptText({ title: 'Save as template', label: 'Template name', initial: workout.name.replace(/\s-\s\d{4}-\d{2}-\d{2}.*/, ''), confirmLabel: 'Save' });
    if (!templateName) return;
    
    // Create a new weekly plan from this workout
    const newPlan: WeeklyPlan = {
      id: `custom_${crypto.randomUUID()}`,
      name: templateName.trim(),
      isCustom: true,
      days: [
        {
          dayNumber: 1,
          name: 'Day 1',
          exercises: workout.exercises.map(ex => ({
            exerciseId: ex.exerciseId,
            exerciseName: ex.exerciseName,
            defaultSets: ex.sets.length,
            defaultReps: ex.sets[0]?.reps || 10,
          })),
        },
        {
          dayNumber: 2,
          name: 'Rest Day',
          exercises: [],
          isRestDay: true,
        },
      ],
    };
    
    // Save to storage
    storage.saveWeeklyPlan(newPlan);
    
    setToastMessage(`Saved as "${templateName}"`);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };
  
  // Group by date
  const grouped = workouts.reduce((acc, workout) => {
    const date = workout.date.split('T')[0];
    if (!acc[date]) acc[date] = [];
    acc[date].push(workout);
    return acc;
  }, {} as Record<string, Workout[]>);

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Toast Notification */}
      {showToast && (
        <div className="fixed top-4 left-4 right-4 z-50 animate-fadeIn">
          <div className={`rounded-xl p-4 shadow-lg flex items-center gap-3 ${
            isDark ? 'bg-green-500/20 border border-green-500/30' : 'bg-green-50 border border-green-200'
          }`}>
            <CheckCircle2 className="w-5 h-5 text-green-400" />
            <span className={isDark ? 'text-white' : 'text-gray-900'}>{toastMessage}</span>
          </div>
        </div>
      )}
      
      <div className="flex items-center gap-4">
        <button onClick={onBack} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">Workout History</h1>
      </div>

      {sortedDates.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No workouts logged yet</p>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedDates.map(date => (
            <div key={date}>
              <div className="text-sm text-zinc-500 mb-2">
                {new Date(date).toLocaleDateString('en-IN', { 
                  weekday: 'long', 
                  month: 'short', 
                  day: 'numeric' 
                })}
              </div>
              <div className="space-y-2">
                {grouped[date].map(workout => (
                  <HistoryWorkoutCard
                    key={workout.id}
                    workout={workout}
                    isDark={isDark}
                    onDelete={() => onDelete(workout.id)}
                    onSaveAsTemplate={() => handleSaveAsTemplate(workout)}
                    onShare={() => setWorkoutToShare(workout)}
                    onSave={(updated) => {
                      storage.saveWorkout(updated);
                      setToastMessage('Workout updated');
                      setShowToast(true);
                      setTimeout(() => setShowToast(false), 2000);
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Share Workout Modal */}
      {workoutToShare && (
        <ShareWorkout
          workout={workoutToShare}
          onClose={() => setWorkoutToShare(null)}
          isDark={isDark}
        />
      )}
    </div>
  );
}
