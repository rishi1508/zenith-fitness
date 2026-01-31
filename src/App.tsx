import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Dumbbell, Calendar, TrendingUp, ChevronRight, 
  Check, Clock, Flame, Trophy,
  ChevronLeft, X, Trash2, Timer, Target
} from 'lucide-react';
import type { Workout, WorkoutExercise, WorkoutSet, WorkoutTemplate, UserStats } from './types';
import * as storage from './storage';
import { UpdateChecker, VersionInfo } from './UpdateChecker';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';

type View = 'home' | 'workout' | 'history' | 'templates' | 'active' | 'progress';

function App() {
  const [view, setView] = useState<View>('home');
  const [stats, setStats] = useState<UserStats | null>(null);
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null);
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [workoutHistory, setWorkoutHistory] = useState<Workout[]>([]);
  
  // Navigation history for back button support
  const navigationHistory = useRef<View[]>(['home']);

  // Navigate with history tracking
  const navigateTo = useCallback((newView: View) => {
    if (newView !== view) {
      navigationHistory.current.push(newView);
      setView(newView);
    }
  }, [view]);

  // Go back in navigation history
  const goBack = useCallback(() => {
    if (navigationHistory.current.length > 1) {
      navigationHistory.current.pop(); // Remove current
      const previousView = navigationHistory.current[navigationHistory.current.length - 1];
      setView(previousView);
      return true;
    }
    return false; // No history, let app close
  }, []);

  const loadData = useCallback(() => {
    setStats(storage.calculateStats());
    setTemplates(storage.getTemplates());
    setWorkoutHistory(storage.getWorkouts());
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Configure status bar and back button for Android
  useEffect(() => {
    const setupNative = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          // Show status bar with dark background, light icons
          await StatusBar.setStyle({ style: Style.Dark });
          await StatusBar.setBackgroundColor({ color: '#0f0f0f' });
          await StatusBar.show();
        } catch (e) {
          console.log('StatusBar setup error:', e);
        }

        // Handle Android back button
        const backHandler = await CapApp.addListener('backButton', () => {
          if (!goBack()) {
            // No navigation history, minimize app instead of closing
            CapApp.minimizeApp();
          }
        });

        return () => {
          backHandler.remove();
        };
      }
    };

    setupNative();
  }, [goBack]);

  const startWorkout = (template: WorkoutTemplate) => {
    const workout: Workout = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      name: template.name,
      type: template.type,
      exercises: template.exercises.map(ex => ({
        id: crypto.randomUUID(),
        exerciseId: ex.exerciseId,
        exerciseName: ex.exerciseName,
        sets: Array.from({ length: ex.defaultSets }, () => ({
          id: crypto.randomUUID(),
          reps: ex.defaultReps,
          weight: 0,
          completed: false,
        })),
      })),
      completed: false,
      startedAt: new Date().toISOString(),
    };
    setActiveWorkout(workout);
    navigateTo('active');
  };

  const saveActiveWorkout = (workout: Workout) => {
    storage.saveWorkout(workout);
    setActiveWorkout(workout);
  };

  const finishWorkout = () => {
    if (activeWorkout) {
      const completedAt = new Date().toISOString();
      const duration = activeWorkout.startedAt 
        ? Math.floor((Date.now() - new Date(activeWorkout.startedAt).getTime()) / 60000)
        : undefined;
      
      const finished = {
        ...activeWorkout,
        completed: true,
        completedAt,
        duration,
      };
      storage.saveWorkout(finished);
      setActiveWorkout(null);
      loadData();
      // Reset navigation history since we completed a workout
      navigationHistory.current = ['home'];
      setView('home');
    }
  };

  const cancelWorkout = () => {
    if (activeWorkout && confirm('Discard this workout?')) {
      setActiveWorkout(null);
      // Reset navigation history since we cancelled
      navigationHistory.current = ['home'];
      setView('home');
    }
  };

  const logRestDay = () => {
    const restWorkout: Workout = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      name: 'Rest Day',
      type: 'rest',
      exercises: [],
      completed: true,
      completedAt: new Date().toISOString(),
    };
    storage.saveWorkout(restWorkout);
    loadData();
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white pb-20">
      {/* Update Checker */}
      <UpdateChecker />
      
      {/* Header */}
      <header className="sticky top-0 bg-[#0f0f0f]/95 backdrop-blur-sm border-b border-[#2e2e2e] px-4 py-3 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
              <Flame className="w-5 h-5" />
            </div>
            <span className="font-bold text-lg">Zenith Fitness</span>
          </div>
          {view === 'active' && activeWorkout?.startedAt && (
            <WorkoutTimer startTime={activeWorkout.startedAt} />
          )}
        </div>
      </header>

      {/* Content */}
      <main className="px-4 py-4">
        {view === 'home' && (
          <HomeView 
            stats={stats} 
            templates={templates}
            onStartWorkout={startWorkout}
            onLogRest={logRestDay}
            onViewHistory={() => navigateTo('history')}
          />
        )}
        {view === 'active' && activeWorkout && (
          <ActiveWorkoutView 
            workout={activeWorkout}
            onUpdate={saveActiveWorkout}
            onFinish={finishWorkout}
            onCancel={cancelWorkout}
          />
        )}
        {view === 'history' && (
          <HistoryView 
            workouts={workoutHistory}
            onBack={() => goBack()}
            onDelete={(id) => {
              storage.deleteWorkout(id);
              loadData();
            }}
          />
        )}
        {view === 'progress' && (
          <ProgressView 
            workouts={workoutHistory}
            onBack={() => goBack()}
          />
        )}
      </main>

      {/* Bottom Navigation */}
      {view !== 'active' && (
        <nav className="fixed bottom-0 left-0 right-0 bg-[#1a1a1a] border-t border-[#2e2e2e] px-4 py-2">
          <div className="flex justify-around">
            <NavButton 
              icon={<Dumbbell />} 
              label="Workout" 
              active={view === 'home'} 
              onClick={() => { navigationHistory.current = ['home']; setView('home'); }} 
            />
            <NavButton 
              icon={<Calendar />} 
              label="History" 
              active={view === 'history'} 
              onClick={() => navigateTo('history')} 
            />
            <NavButton 
              icon={<TrendingUp />} 
              label="Progress" 
              active={view === 'progress'} 
              onClick={() => navigateTo('progress')} 
            />
          </div>
        </nav>
      )}
    </div>
  );
}

// Navigation Button
function NavButton({ icon, label, active, onClick }: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
        active ? 'text-orange-400' : 'text-zinc-500'
      }`}
    >
      <span className="w-6 h-6">{icon}</span>
      <span className="text-xs">{label}</span>
    </button>
  );
}

// Workout Timer
function WorkoutTimer({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(startTime).getTime();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <div className="flex items-center gap-2 text-orange-400">
      <Timer className="w-4 h-4" />
      <span className="font-mono">{mins}:{secs.toString().padStart(2, '0')}</span>
    </div>
  );
}

// Home View
function HomeView({ stats, templates, onStartWorkout, onLogRest, onViewHistory }: {
  stats: UserStats | null;
  templates: WorkoutTemplate[];
  onStartWorkout: (template: WorkoutTemplate) => void;
  onLogRest: () => void;
  onViewHistory: () => void;
}) {
  const today = new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold">Hey Rishi! 💪</h1>
        <p className="text-zinc-400">{dayNames[today.getDay()]}, {today.toLocaleDateString('en-IN', { month: 'long', day: 'numeric' })}</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard 
          icon={<Flame className="text-orange-400" />}
          value={stats?.currentStreak || 0}
          label="Day Streak"
          color="orange"
        />
        <StatCard 
          icon={<Target className="text-emerald-400" />}
          value={stats?.thisWeekWorkouts || 0}
          label="This Week"
          suffix="/5"
          color="emerald"
        />
        <StatCard 
          icon={<Trophy className="text-yellow-400" />}
          value={stats?.longestStreak || 0}
          label="Best Streak"
          color="yellow"
        />
        <StatCard 
          icon={<Dumbbell className="text-indigo-400" />}
          value={stats?.totalWorkouts || 0}
          label="Total Workouts"
          color="indigo"
        />
      </div>

      {/* Quick Actions */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Start Workout</h2>
        <div className="space-y-2">
          {templates.map(template => (
            <button
              key={template.id}
              onClick={() => onStartWorkout(template)}
              className="w-full bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-4 flex items-center justify-between hover:border-orange-500/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  template.type === 'arms' ? 'bg-purple-500/20' : 'bg-orange-500/20'
                }`}>
                  <Dumbbell className={`w-5 h-5 ${
                    template.type === 'arms' ? 'text-purple-400' : 'text-orange-400'
                  }`} />
                </div>
                <div className="text-left">
                  <div className="font-medium">{template.name}</div>
                  <div className="text-sm text-zinc-500">{template.exercises.length} exercises</div>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-zinc-500" />
            </button>
          ))}
        </div>
      </div>

      {/* Rest Day Button */}
      <button
        onClick={onLogRest}
        className="w-full bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-4 flex items-center justify-center gap-2 text-zinc-400 hover:border-zinc-500/50 transition-colors"
      >
        <Clock className="w-5 h-5" />
        <span>Log Rest Day</span>
      </button>

      {/* Recent History */}
      {stats?.lastWorkoutDate && (
        <button
          onClick={onViewHistory}
          className="w-full text-left text-sm text-zinc-500 flex items-center gap-2"
        >
          Last workout: {new Date(stats.lastWorkoutDate).toLocaleDateString()}
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      {/* Version Info */}
      <VersionInfo />
    </div>
  );
}

// Stat Card
function StatCard({ icon, value, label, suffix, color }: {
  icon: React.ReactNode;
  value: number;
  label: string;
  suffix?: string;
  color: string;
}) {
  const colorClasses: Record<string, string> = {
    orange: 'from-orange-500/20 to-orange-500/5 border-orange-500/20',
    emerald: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/20',
    yellow: 'from-yellow-500/20 to-yellow-500/5 border-yellow-500/20',
    indigo: 'from-indigo-500/20 to-indigo-500/5 border-indigo-500/20',
  };

  return (
    <div className={`bg-gradient-to-br ${colorClasses[color]} border rounded-xl p-4`}>
      <div className="w-8 h-8 mb-2">{icon}</div>
      <div className="text-2xl font-bold">
        {value}{suffix && <span className="text-sm text-zinc-500">{suffix}</span>}
      </div>
      <div className="text-sm text-zinc-400">{label}</div>
    </div>
  );
}

// Active Workout View
function ActiveWorkoutView({ workout, onUpdate, onFinish, onCancel }: {
  workout: Workout;
  onUpdate: (workout: Workout) => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const [restTimer, setRestTimer] = useState<number | null>(null);
  const [restTimeLeft, setRestTimeLeft] = useState(0);

  // Rest timer
  useEffect(() => {
    if (restTimer === null) return;
    
    if (restTimeLeft <= 0) {
      setRestTimer(null);
      // Vibrate if supported
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
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
      
      // Track personal record if weight > 0
      const exercise = workout.exercises[exerciseIndex];
      if (updatedSet.weight > 0 && updatedSet.reps > 0) {
        const isPR = storage.checkAndUpdatePR(
          exercise.exerciseId,
          exercise.exerciseName,
          updatedSet.weight,
          updatedSet.reps
        );
        if (isPR && navigator.vibrate) {
          navigator.vibrate([100, 50, 100, 50, 200]); // Special PR vibration!
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
    <div className="space-y-4 animate-fadeIn pb-20">
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

      {/* Rest Timer */}
      {restTimer !== null && (
        <div className="bg-orange-500/20 border border-orange-500/30 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="w-6 h-6 text-orange-400" />
            <div>
              <div className="text-sm text-orange-400">Rest Timer</div>
              <div className="text-2xl font-bold font-mono">{restTimeLeft}s</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => setRestTimeLeft(t => t + 30)}
              className="px-3 py-1 bg-orange-500/30 rounded-lg text-sm"
            >
              +30s
            </button>
            <button 
              onClick={() => setRestTimer(null)}
              className="px-3 py-1 bg-zinc-700 rounded-lg text-sm"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Exercises */}
      <div className="space-y-4">
        {workout.exercises.map((exercise, exIndex) => (
          <ExerciseCard
            key={exercise.id}
            exercise={exercise}
            onUpdateSet={(setIndex, updates) => updateSet(exIndex, setIndex, updates)}
          />
        ))}
      </div>

      {/* Quick Rest Buttons */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#1a1a1a] border-t border-[#2e2e2e] p-4">
        <div className="flex gap-2 justify-center">
          <span className="text-sm text-zinc-500 mr-2">Rest:</span>
          {[60, 90, 120, 180].map(secs => (
            <button
              key={secs}
              onClick={() => startRestTimer(secs)}
              className="px-3 py-2 bg-[#252525] rounded-lg text-sm hover:bg-[#2e2e2e]"
            >
              {secs >= 60 ? `${secs / 60}m` : `${secs}s`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Exercise Card
function ExerciseCard({ exercise, onUpdateSet }: {
  exercise: WorkoutExercise;
  onUpdateSet: (setIndex: number, updates: Partial<WorkoutSet>) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const completedCount = exercise.sets.filter(s => s.completed).length;

  return (
    <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
            <Dumbbell className="w-5 h-5 text-orange-400" />
          </div>
          <div className="text-left">
            <div className="font-medium">{exercise.exerciseName}</div>
            <div className="text-sm text-zinc-500">{completedCount}/{exercise.sets.length} sets</div>
          </div>
        </div>
        <ChevronRight className={`w-5 h-5 text-zinc-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 text-xs text-zinc-500 px-2">
            <div className="col-span-2">SET</div>
            <div className="col-span-4">WEIGHT (kg)</div>
            <div className="col-span-4">REPS</div>
            <div className="col-span-2"></div>
          </div>

          {/* Sets */}
          {exercise.sets.map((set, setIndex) => (
            <div 
              key={set.id} 
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
          ))}
        </div>
      )}
    </div>
  );
}

// History View
function HistoryView({ workouts, onBack, onDelete }: {
  workouts: Workout[];
  onBack: () => void;
  onDelete: (id: string) => void;
}) {
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
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 -ml-2 text-zinc-400">
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
                  <div 
                    key={workout.id}
                    className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          workout.type === 'rest' 
                            ? 'bg-zinc-500/20' 
                            : 'bg-orange-500/20'
                        }`}>
                          {workout.type === 'rest' 
                            ? <Clock className="w-5 h-5 text-zinc-400" />
                            : <Dumbbell className="w-5 h-5 text-orange-400" />
                          }
                        </div>
                        <div>
                          <div className="font-medium">{workout.name}</div>
                          {workout.type !== 'rest' && (
                            <div className="text-sm text-zinc-500">
                              {workout.exercises.length} exercises • 
                              {workout.exercises.reduce((acc, ex) => 
                                acc + ex.sets.filter(s => s.completed).length, 0
                              )} sets
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (confirm('Delete this workout?')) {
                            onDelete(workout.id);
                          }
                        }}
                        className="p-2 text-zinc-500 hover:text-red-400"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Progress View
function ProgressView({ workouts, onBack }: {
  workouts: Workout[];
  onBack: () => void;
}) {
  const records = storage.getPersonalRecords();
  const completedWorkouts = workouts.filter(w => w.completed && w.type !== 'rest');
  
  // Calculate total volume lifted
  const totalVolume = completedWorkouts.reduce((total, workout) => {
    return total + workout.exercises.reduce((exTotal, exercise) => {
      return exTotal + exercise.sets.reduce((setTotal, set) => {
        if (set.completed && set.weight && set.reps) {
          return setTotal + (set.weight * set.reps);
        }
        return setTotal;
      }, 0);
    }, 0);
  }, 0);
  
  // Get workout count by week (last 8 weeks)
  const weeklyStats: { week: string; count: number; volume: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - (weekStart.getDay() + 7 * i));
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    
    const weekWorkouts = completedWorkouts.filter(w => {
      const date = new Date(w.date);
      return date >= weekStart && date <= weekEnd;
    });
    
    const weekVolume = weekWorkouts.reduce((total, workout) => {
      return total + workout.exercises.reduce((exTotal, exercise) => {
        return exTotal + exercise.sets.reduce((setTotal, set) => {
          if (set.completed && set.weight && set.reps) {
            return setTotal + (set.weight * set.reps);
          }
          return setTotal;
        }, 0);
      }, 0);
    }, 0);
    
    weeklyStats.push({
      week: `W${8 - i}`,
      count: weekWorkouts.length,
      volume: Math.round(weekVolume),
    });
  }
  
  const maxCount = Math.max(...weeklyStats.map(w => w.count), 5);
  
  // Get exercise progress (last weight used for each exercise)
  const exerciseProgress: { name: string; lastWeight: number; lastReps: number; date: string }[] = [];
  const exerciseMap = new Map<string, { name: string; lastWeight: number; lastReps: number; date: string }>();
  
  // Sort by date ascending to get the most recent
  [...completedWorkouts].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .forEach(workout => {
      workout.exercises.forEach(exercise => {
        const lastCompletedSet = [...exercise.sets].reverse().find(s => s.completed && s.weight > 0);
        if (lastCompletedSet) {
          exerciseMap.set(exercise.exerciseId, {
            name: exercise.exerciseName,
            lastWeight: lastCompletedSet.weight,
            lastReps: lastCompletedSet.reps,
            date: workout.date,
          });
        }
      });
    });
  
  exerciseMap.forEach(value => exerciseProgress.push(value));
  exerciseProgress.sort((a, b) => b.lastWeight - a.lastWeight);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 -ml-2 text-zinc-400">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">Progress</h1>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-orange-500/20 to-orange-500/5 border border-orange-500/20 rounded-xl p-4">
          <div className="text-2xl font-bold">{completedWorkouts.length}</div>
          <div className="text-sm text-zinc-400">Total Workouts</div>
        </div>
        <div className="bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
          <div className="text-2xl font-bold">{records.length}</div>
          <div className="text-sm text-zinc-400">Personal Records</div>
        </div>
        <div className="col-span-2 bg-gradient-to-br from-purple-500/20 to-purple-500/5 border border-purple-500/20 rounded-xl p-4">
          <div className="text-2xl font-bold">{(totalVolume / 1000).toFixed(1)}t</div>
          <div className="text-sm text-zinc-400">Total Volume Lifted</div>
        </div>
      </div>

      {/* Weekly Chart */}
      <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-4">
        <div className="text-sm font-medium mb-4">Weekly Workouts</div>
        <div className="flex items-end gap-2 h-24">
          {weeklyStats.map((week, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div 
                className="w-full bg-orange-500/60 rounded-t transition-all"
                style={{ height: `${(week.count / maxCount) * 100}%`, minHeight: week.count > 0 ? '8px' : '0' }}
              />
              <div className="text-xs text-zinc-500">{week.week}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Personal Records */}
      {records.length > 0 && (
        <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Trophy className="w-5 h-5 text-yellow-400" />
            <span className="text-sm font-medium">Personal Records</span>
          </div>
          <div className="space-y-3">
            {records.slice(0, 10).map((record, i) => (
              <div key={record.exerciseId} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded bg-yellow-500/20 flex items-center justify-center text-xs font-bold text-yellow-400">
                    {i + 1}
                  </div>
                  <span className="text-sm">{record.exerciseName}</span>
                </div>
                <div className="text-right">
                  <div className="font-medium">{record.weight}kg × {record.reps}</div>
                  <div className="text-xs text-zinc-500">
                    {new Date(record.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Exercise Weights */}
      {exerciseProgress.length > 0 && (
        <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-5 h-5 text-blue-400" />
            <span className="text-sm font-medium">Recent Exercise Weights</span>
          </div>
          <div className="space-y-2">
            {exerciseProgress.slice(0, 8).map(ex => (
              <div key={ex.name} className="flex items-center justify-between py-1">
                <span className="text-sm text-zinc-300">{ex.name}</span>
                <span className="text-sm font-medium">{ex.lastWeight}kg × {ex.lastReps}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {completedWorkouts.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Complete some workouts to see your progress!</p>
        </div>
      )}
    </div>
  );
}

export default App;
