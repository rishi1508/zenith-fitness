import { useState } from 'react';
import { 
  Calendar, ChevronLeft, ChevronRight, Clock, 
  Copy, Dumbbell, Trash2, CheckCircle2
} from 'lucide-react';
import type { Workout, WeeklyPlan } from '../types';
import * as storage from '../storage';

interface HistoryWorkoutCardProps {
  workout: Workout;
  isDark: boolean;
  onDelete: () => void;
  onSaveAsTemplate: () => void;
}

function HistoryWorkoutCard({ workout, isDark, onDelete, onSaveAsTemplate }: HistoryWorkoutCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isImported = workout.type === 'imported';
  const isRest = workout.type === 'rest';
  
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
      <button
        onClick={() => !isRest && workout.exercises.length > 0 && setExpanded(!expanded)}
        className={`w-full p-4 text-left ${!isRest && workout.exercises.length > 0 ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
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
          </div>
          <div className="flex items-center gap-2">
            {!isRest && workout.exercises.length > 0 && (
              <ChevronRight className={`w-5 h-5 text-zinc-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
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
                <Copy className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm('Delete this workout?')) {
                  onDelete();
                }
              }}
              className="p-2 text-zinc-500 hover:text-red-400"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </button>
      
      {/* Expanded exercise details */}
      {expanded && workout.exercises.length > 0 && (
        <div className="px-4 pb-4 border-t border-[#2e2e2e] pt-3">
          <div className="space-y-3">
            {workout.exercises.map((exercise, i) => {
              const completedSets = exercise.sets.filter(s => s.completed);
              return (
                <div key={i} className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-zinc-300">{exercise.exerciseName}</div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {completedSets.length > 0 ? (
                        completedSets.map((set, j) => (
                          <span key={j}>
                            {j > 0 && ' • '}
                            {set.weight}kg × {set.reps}
                          </span>
                        ))
                      ) : (
                        `${exercise.sets.length} sets`
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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
  
  const handleSaveAsTemplate = (workout: Workout) => {
    if (workout.exercises.length === 0) return;
    
    const templateName = prompt('Enter a name for this template:', workout.name.replace(/\s-\s\d{4}-\d{2}-\d{2}.*/, ''));
    if (!templateName) return;
    
    // Create a new weekly plan from this workout
    const newPlan: WeeklyPlan = {
      id: `custom_${Date.now()}`,
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
    const existingPlans = storage.getWeeklyPlans();
    existingPlans.push(newPlan);
    localStorage.setItem('zenith_weekly_plans', JSON.stringify(existingPlans));
    
    setToastMessage(`✓ Saved as "${templateName}"`);
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
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
