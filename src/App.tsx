import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Dumbbell, Calendar, TrendingUp, ChevronRight, 
  Check, Clock, Flame, Search,
  ChevronLeft, X, Trash2, Target,
  Settings, ClipboardList, Plus, Edit3, Sun, Moon
} from 'lucide-react';
import type { Workout, WorkoutExercise, WorkoutSet, WorkoutTemplate, UserStats, WeeklyPlan, DayPlan, Exercise } from './types';
import * as storage from './storage';
import { UpdateChecker } from './UpdateChecker';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { SplashScreen, NavButton, WorkoutTimer } from './components';
import { HistoryView, ProgressView, SettingsView, ExerciseManagerView, HomeView } from './views';

type View = 'home' | 'workout' | 'history' | 'templates' | 'active' | 'progress' | 'settings' | 'exercises' | 'weekly';
type Theme = 'dark' | 'light';

function App() {
  const [view, setView] = useState<View>('home');
  const [stats, setStats] = useState<UserStats | null>(null);
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null);
  const [_templates, _setTemplates] = useState<WorkoutTemplate[]>([]); // LEGACY - kept for backward compat
  const [workoutHistory, setWorkoutHistory] = useState<Workout[]>([]);
  const [showSplash, setShowSplash] = useState(true);
  const [missingDays, setMissingDays] = useState<string[]>([]);
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationData, setCelebrationData] = useState<{name: string; exercises: number; duration?: number} | null>(null);
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem('zenith_theme') as Theme) || 'dark'; } 
    catch { return 'dark'; }
  });
  
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
    _setTemplates(storage.getTemplates()); // LEGACY
    setWorkoutHistory(storage.getWorkouts());
    // Check for missing days after splash
    const missing = storage.getMissingDays();
    setMissingDays(missing);
    // Data loaded, hide splash
    setShowSplash(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('zenith_theme', theme); } catch {}
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), []);

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
    // Remember this template as last used
    storage.setLastUsedTemplateId(template.id);
    
    // Get last weights for auto-fill
    const lastWeights = getLastWeightsForDay(template);
    
    const workout: Workout = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      name: template.name,
      type: template.type,
      exercises: template.exercises.map(ex => {
        // Auto-fill weights from last session - exact sets pattern
        const lastSets = lastWeights.get(ex.exerciseId) || [];
        return {
          id: crypto.randomUUID(),
          exerciseId: ex.exerciseId,
          exerciseName: ex.exerciseName,
          sets: Array.from({ length: ex.defaultSets }, (_, i) => ({
            id: crypto.randomUUID(),
            reps: 0, // Leave empty for user to fill
            weight: lastSets[i] || lastSets[lastSets.length - 1] || 0, // Use exact set pattern, fall back to last set weight
            completed: false,
          })),
        };
      }),
      completed: false,
      startedAt: new Date().toISOString(),
    };
    setActiveWorkout(workout);
    navigateTo('active');
  };
  
  // Helper: Get last weights used for each exercise - returns EXACT sets pattern
  const getLastWeightsForDay = (template: WorkoutTemplate): Map<string, number[]> => {
    const weights = new Map<string, number[]>();
    
    // Build a map of exerciseId -> array of weights from last workout
    // Look at ALL completed workouts and find last time each exercise was done
    const completedWorkouts = workoutHistory
      .filter(w => w.completed && w.type !== 'rest' && w.date < new Date().toISOString())
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // Most recent first
    
    // For each exercise in this template, find the last weights used
    template.exercises.forEach(templateEx => {
      // Find the most recent workout containing this exercise
      for (const workout of completedWorkouts) {
        const matchingEx = workout.exercises.find(ex => ex.exerciseId === templateEx.exerciseId);
        if (matchingEx) {
          const completedSets = matchingEx.sets.filter(s => s.completed && s.weight > 0);
          if (completedSets.length > 0) {
            // Extract the exact weight pattern from that workout
            const weightPattern = completedSets.map(s => s.weight);
            weights.set(templateEx.exerciseId, weightPattern);
            break; // Found the last workout for this exercise, move to next
          }
        }
      }
    });
    
    return weights;
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
      
      // Show celebration
      setCelebrationData({
        name: activeWorkout.name,
        exercises: activeWorkout.exercises.length,
        duration,
      });
      setShowCelebration(true);
      
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

  const handleBackfillRestDays = () => {
    storage.backfillRestDays(missingDays);
    setMissingDays([]);
    loadData();
  };

  const dismissMissingDays = () => {
    setMissingDays([]);
  };

  // Show splash screen
  if (showSplash) {
    return <SplashScreen />;
  }

  const isDark = theme === 'dark';
  
  return (
    <div className={`min-h-screen pb-20 transition-colors duration-300 ${isDark ? 'bg-[#0f0f0f] text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* Update Checker */}
      <UpdateChecker />
      
      {/* Missing Days Prompt */}
      {missingDays.length > 0 && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className={`max-w-sm w-full rounded-2xl p-6 space-y-4 ${isDark ? 'bg-[#1a1a1a]' : 'bg-white'}`}>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center">
                <Calendar className="w-6 h-6 text-orange-400" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Missing Days</h3>
                <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                  {missingDays.length} day{missingDays.length > 1 ? 's' : ''} without activity
                </p>
              </div>
            </div>
            
            <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
              We noticed you have {missingDays.length} day{missingDays.length > 1 ? 's' : ''} with no logged workouts. 
              Would you like to mark {missingDays.length > 1 ? 'them' : 'it'} as rest day{missingDays.length > 1 ? 's' : ''}?
            </p>
            
            <div className="flex gap-3">
              <button
                onClick={dismissMissingDays}
                className={`flex-1 py-3 rounded-xl font-medium transition-colors ${
                  isDark 
                    ? 'bg-zinc-800 hover:bg-zinc-700' 
                    : 'bg-gray-100 hover:bg-gray-200'
                }`}
              >
                Skip
              </button>
              <button
                onClick={handleBackfillRestDays}
                className="flex-1 py-3 rounded-xl font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity"
              >
                Log Rest Days
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Workout Completion Celebration */}
      {showCelebration && celebrationData && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className={`max-w-sm w-full rounded-2xl p-6 text-center space-y-4 ${isDark ? 'bg-[#1a1a1a]' : 'bg-white'} animate-fadeIn`}>
            <div className="text-6xl mb-2">🎉</div>
            <h2 className="text-2xl font-bold">Workout Complete!</h2>
            <p className={`${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
              Great job finishing <span className="font-semibold text-orange-400">{celebrationData.name}</span>!
            </p>
            
            <div className={`flex justify-center gap-6 py-4 ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-400">{celebrationData.exercises}</div>
                <div className="text-xs text-zinc-500">Exercises</div>
              </div>
              {celebrationData.duration && (
                <div className="text-center">
                  <div className="text-2xl font-bold text-emerald-400">{celebrationData.duration}m</div>
                  <div className="text-xs text-zinc-500">Duration</div>
                </div>
              )}
            </div>
            
            <button
              onClick={() => setShowCelebration(false)}
              className="w-full py-3 rounded-xl font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity"
            >
              Continue
            </button>
          </div>
        </div>
      )}
      
      {/* Header */}
      <header className={`sticky top-0 backdrop-blur-sm border-b px-4 z-10 transition-colors duration-300 ${isDark ? 'bg-[#0f0f0f]/95 border-[#2e2e2e]' : 'bg-white/95 border-gray-200'}`} style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)', paddingBottom: '12px' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
              <Flame className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg">Zenith Fitness</span>
          </div>
          <div className="flex items-center gap-2">
            {view === 'active' && activeWorkout?.startedAt && (
              <WorkoutTimer startTime={activeWorkout.startedAt} />
            )}
            {view !== 'active' && (
              <>
                <button 
                  onClick={toggleTheme}
                  className={`p-2 transition-colors ${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}
                  title={isDark ? 'Light mode' : 'Dark mode'}
                >
                  {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
                <button 
                  onClick={() => navigateTo('settings')}
                  className={`p-2 transition-colors ${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}
                >
                  <Settings className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="px-4 py-4">
        {view === 'home' && (
          <HomeView 
            stats={stats} 
            workouts={workoutHistory}
            isDark={isDark}
            onStartWorkout={startWorkout}
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
            isDark={isDark}
            onBack={() => goBack()}
            onDelete={(id) => {
              storage.deleteWorkout(id);
              loadData();
            }}
          />
        )}
        {view === 'templates' && (
          <WeeklyPlansView 
            isDark={isDark}
            onBack={() => goBack()}
            onPlansChange={loadData}
          />
        )}
        {view === 'progress' && (
          <ProgressView 
            workouts={workoutHistory}
            isDark={isDark}
            onBack={() => goBack()}
          />
        )}
        {view === 'settings' && (
          <SettingsView 
            onBack={() => goBack()}
            onDataChange={loadData}
            onNavigateToExercises={() => navigateTo('exercises')}
            isDark={isDark}
          />
        )}
        {view === 'weekly' && (
          <WeeklyOverviewView
            isDark={isDark}
            onBack={() => goBack()}
            onStartDay={(dayIndex) => {
              const activePlan = storage.getActivePlan();
              if (activePlan && activePlan.days[dayIndex]) {
                storage.setLastUsedDay(dayIndex);
                const dayPlan = activePlan.days[dayIndex];
                const template: WorkoutTemplate = {
                  id: `${activePlan.id}_day${dayIndex}`,
                  name: `${activePlan.name} - ${dayPlan.name}`,
                  type: 'custom',
                  exercises: dayPlan.exercises,
                  dayOfWeek: dayIndex,
                  weeklyPlanId: activePlan.id,
                };
                startWorkout(template);
              }
            }}
          />
        )}
        {view === 'exercises' && (
          <ExerciseManagerView
            isDark={isDark}
            onBack={() => goBack()}
            onExercisesChange={loadData}
          />
        )}
      </main>

      {/* Bottom Navigation */}
      {view !== 'active' && (
        <nav className={`fixed bottom-0 left-0 right-0 border-t px-4 py-2 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
          <div className="flex justify-around">
            <NavButton 
              icon={<Dumbbell />} 
              label="Workout" 
              active={view === 'home'} 
              onClick={() => { navigationHistory.current = ['home']; setView('home'); }} 
            />
            <NavButton 
              icon={<Calendar />} 
              label="Week" 
              active={view === 'weekly'} 
              onClick={() => navigateTo('weekly')} 
            />
            <NavButton 
              icon={<ClipboardList />} 
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

// Active Workout View
function ActiveWorkoutView({ workout, onUpdate, onFinish, onCancel }: {
  workout: Workout;
  onUpdate: (workout: Workout) => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const [restTimer, setRestTimer] = useState<number | null>(null);
  const [restTimeLeft, setRestTimeLeft] = useState(0);
  const [prAchievement, setPrAchievement] = useState<{exercise: string; weight: number; reps: number} | null>(null);

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
      
      // Track personal record if weight > 0
      const exercise = workout.exercises[exerciseIndex];
      if (updatedSet.weight > 0 && updatedSet.reps > 0) {
        const isPR = storage.checkAndUpdatePR(
          exercise.exerciseId,
          exercise.exerciseName,
          updatedSet.weight,
          updatedSet.reps
        );
        if (isPR) {
          setPrAchievement({
            exercise: exercise.exerciseName,
            weight: updatedSet.weight,
            reps: updatedSet.reps,
          });
          // Auto-dismiss after 3 seconds
          setTimeout(() => setPrAchievement(null), 3000);
          if (navigator.vibrate) {
            navigator.vibrate([100, 50, 100, 50, 200]); // Special PR vibration!
          }
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
      {/* PR Achievement Toast */}
      {prAchievement && (
        <div className="fixed top-4 left-4 right-4 z-50 animate-fadeIn">
          <div className="bg-gradient-to-r from-yellow-500 to-orange-500 rounded-xl p-4 shadow-lg shadow-orange-500/30 flex items-center gap-3">
            <div className="text-3xl">🏆</div>
            <div className="flex-1 text-white">
              <div className="font-bold">New Personal Record!</div>
              <div className="text-sm text-white/90">
                {prAchievement.exercise}: {prAchievement.weight}kg × {prAchievement.reps}
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

      {/* Rest Timer */}
      {restTimer !== null ? (
        <div className="bg-orange-500/20 border border-orange-500/30 rounded-xl p-4 flex items-center justify-between">
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
      ) : (
        <div className="flex gap-2">
          <span className="text-sm text-zinc-500 self-center">Rest:</span>
          {[60, 90, 120, 180].map(seconds => (
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

      {/* Exercises */}
      <div className="space-y-4">
        {workout.exercises.map((exercise, exIndex) => (
          <ExerciseCard
            key={exercise.id}
            exercise={exercise}
            onUpdateSet={(setIndex, updates) => updateSet(exIndex, setIndex, updates)}
            onSwapExercise={(newExercise) => swapExercise(exIndex, newExercise)}
          />
        ))}
      </div>

      </div>
  );
}

// Exercise Card
function ExerciseCard({ exercise, onUpdateSet, onSwapExercise }: {
  exercise: WorkoutExercise;
  onUpdateSet: (setIndex: number, updates: Partial<WorkoutSet>) => void;
  onSwapExercise: (newExercise: Exercise) => void;
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
          <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
            <Dumbbell className="w-5 h-5 text-orange-400" />
          </div>
          <div className="text-left">
            <div className="font-medium">{exercise.exerciseName}</div>
            <div className="text-sm text-zinc-500">{completedCount}/{exercise.sets.length} sets</div>
          </div>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExerciseSelector(true)}
            className="p-2 text-zinc-500 hover:text-orange-400 transition-colors"
            title="Swap exercise"
          >
            <Edit3 className="w-5 h-5" />
          </button>
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

// Weekly Plans View - Manage weekly workout plans
function WeeklyPlansView({ isDark, onBack, onPlansChange }: {
  isDark: boolean;
  onBack: () => void;
  onPlansChange: () => void;
}) {
  const [plans, setPlans] = useState(() => storage.getWeeklyPlans());
  const [editingPlan, setEditingPlan] = useState<WeeklyPlan | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  
  const handleDelete = (plan: WeeklyPlan) => {
    if (plan.id === 'default_plan') {
      alert('Cannot delete default plan');
      return;
    }
    if (confirm(`Delete "${plan.name}"?\n\nThis will permanently remove this weekly plan.`)) {
      storage.deleteWeeklyPlan(plan.id);
      setPlans(storage.getWeeklyPlans());
      onPlansChange();
    }
  };
  
  const handleSave = (plan: WeeklyPlan) => {
    storage.saveWeeklyPlan(plan);
    setPlans(storage.getWeeklyPlans());
    onPlansChange();
    setEditingPlan(null);
    setIsCreating(false);
  };
  
  const handleCancel = () => {
    setEditingPlan(null);
    setIsCreating(false);
  };
  
  const createNewPlan = () => {
    const newPlan: WeeklyPlan = {
      id: `custom_plan_${Date.now()}`,
      name: 'New Weekly Plan',
      days: [
        { dayNumber: 1, name: 'Day 1', exercises: [], isRestDay: false }
      ],
      isCustom: true,
    };
    setEditingPlan(newPlan);
    setIsCreating(true);
  };

  // Show edit view if editing
  if (editingPlan) {
    return (
      <EditWeeklyPlanView 
        plan={editingPlan}
        isNew={isCreating}
        isDark={isDark}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold">Weekly Plans</h1>
        </div>
        <button 
          onClick={createNewPlan}
          className="p-2 bg-orange-500 rounded-lg hover:bg-orange-400 transition-colors"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
        Manage your weekly workout plans. Each plan contains multiple days with their own exercises.
      </p>

      <div className="space-y-2">
        {plans.map(plan => {
          const workoutDays = plan.days.filter(d => !d.isRestDay);
          const activePlanId = storage.getActivePlanId();
          const isActive = plan.id === activePlanId;
          
          return (
            <div
              key={plan.id}
              className={`border rounded-xl overflow-hidden ${
                isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200 shadow-sm'
              } ${isActive ? 'ring-2 ring-green-500/50 border-green-500/50' : ''}`}
            >
              <div className={`p-4 ${isDark ? '' : 'bg-white'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                      <Calendar className="w-5 h-5 text-orange-400" />
                    </div>
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {plan.name}
                        {isActive && (
                          <span className="text-sm bg-green-500/20 text-green-400 px-3 py-1 rounded-lg font-semibold">✓ Active</span>
                        )}
                        {plan.isImported && (
                          <span className={`text-xs px-2 py-0.5 rounded ${isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'}`}>Imported</span>
                        )}
                        {plan.isCustom && (
                          <span className={`text-xs px-2 py-0.5 rounded ${isDark ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'}`}>Custom</span>
                        )}
                      </div>
                      <div className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                        {workoutDays.length} workout day{workoutDays.length !== 1 ? 's' : ''} • {plan.days.length - workoutDays.length} rest day{(plan.days.length - workoutDays.length) !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>
                  {!isActive && (
                    <button
                      onClick={() => {
                        storage.setActivePlanId(plan.id);
                        setPlans([...plans]); // Force re-render
                        onPlansChange();
                      }}
                      className={`text-xs px-3 py-1 rounded-lg transition-colors ${
                        isDark ? 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30' : 'bg-orange-100 text-orange-600 hover:bg-orange-200'
                      }`}
                    >
                      Set Active
                    </button>
                  )}
                </div>
              </div>
              
              {/* Action buttons */}
              <div className={`flex border-t ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}>
                <button
                  onClick={() => setEditingPlan(plan)}
                  className={`flex-1 py-2 text-sm flex items-center justify-center gap-1 transition-colors ${
                    isDark ? 'text-zinc-400 hover:text-white hover:bg-[#252525]' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  <Edit3 className="w-4 h-4" />
                  Edit
                </button>
                {plan.id !== 'default_plan' && (
                  <>
                    <div className={`w-px ${isDark ? 'bg-[#2e2e2e]' : 'bg-gray-200'}`} />
                    <button
                      onClick={() => handleDelete(plan)}
                      className={`flex-1 py-2 text-sm flex items-center justify-center gap-1 transition-colors ${
                        isDark ? 'text-zinc-400 hover:text-red-400 hover:bg-[#252525]' : 'text-gray-500 hover:text-red-500 hover:bg-gray-100'
                      }`}
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {plans.filter(p => p.isCustom).length === 0 && (
        <div className={`text-center py-6 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
          <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p>No custom plans yet</p>
          <p className="text-sm">Tap + to create your first weekly plan!</p>
        </div>
      )}
    </div>
  );
}

// Edit Weekly Plan View - Per-day input for creating weekly plans
function EditWeeklyPlanView({ plan, isNew, isDark, onSave, onCancel }: {
  plan: WeeklyPlan;
  isNew: boolean;
  isDark: boolean;
  onSave: (plan: WeeklyPlan) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(plan.name);
  const [days, setDays] = useState<DayPlan[]>(plan.days);
  const [editingDayIndex, setEditingDayIndex] = useState<number | null>(null);
  
  const addDay = () => {
    const newDay: DayPlan = {
      dayNumber: days.length + 1,
      name: `Day ${days.length + 1}`,
      exercises: [],
      isRestDay: false,
    };
    setDays([...days, newDay]);
  };
  
  const removeDay = (index: number) => {
    if (days.length <= 1) {
      alert('Plan must have at least one day');
      return;
    }
    const updated = days.filter((_, i) => i !== index);
    // Renumber days
    updated.forEach((d, i) => { d.dayNumber = i + 1; });
    setDays(updated);
  };
  
  const updateDay = (index: number, updatedDay: DayPlan) => {
    const updated = [...days];
    updated[index] = updatedDay;
    setDays(updated);
  };
  
  const toggleRestDay = (index: number) => {
    const updated = [...days];
    updated[index].isRestDay = !updated[index].isRestDay;
    if (updated[index].isRestDay) {
      updated[index].exercises = [];
      updated[index].name = `${updated[index].name.replace(' (Rest)', '')} (Rest)`;
    } else {
      updated[index].name = updated[index].name.replace(' (Rest)', '');
    }
    setDays(updated);
  };
  
  const handleSave = () => {
    if (!name.trim()) {
      alert('Please enter a plan name');
      return;
    }
    if (days.length === 0) {
      alert('Plan must have at least one day');
      return;
    }
    
    onSave({
      ...plan,
      name: name.trim(),
      days,
    });
  };
  
  // If editing a specific day
  if (editingDayIndex !== null) {
    return (
      <DayExerciseEditor
        day={days[editingDayIndex]}
        isDark={isDark}
        onSave={(updatedDay) => {
          updateDay(editingDayIndex, updatedDay);
          setEditingDayIndex(null);
        }}
        onCancel={() => setEditingDayIndex(null)}
      />
    );
  }
  
  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-4">
        <button onClick={onCancel} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">{isNew ? 'New Weekly Plan' : 'Edit Plan'}</h1>
      </div>
      
      {/* Plan Name */}
      <div>
        <label className={`text-sm mb-1 block ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>Plan Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., 4 Full Body + 1 Arms"
          className={`w-full rounded-lg px-4 py-3 border ${
            isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white' : 'bg-white border-gray-200'
          } focus:outline-none focus:border-orange-500`}
        />
      </div>
      
      {/* Days List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
            Days ({days.length} total, {days.filter(d => !d.isRestDay).length} workout)
          </label>
          <button
            onClick={addDay}
            className="text-sm text-orange-400 hover:text-orange-300 flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            Add Day
          </button>
        </div>
        
        <div className="space-y-2">
          {days.map((day, index) => (
            <div
              key={index}
              className={`rounded-xl p-4 border ${
                isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-medium ${
                  day.isRestDay 
                    ? isDark ? 'bg-zinc-700 text-zinc-400' : 'bg-gray-200 text-gray-500'
                    : 'bg-orange-500/20 text-orange-400'
                }`}>
                  {day.dayNumber}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{day.name}</div>
                  <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                    {day.isRestDay ? 'Rest Day' : `${day.exercises.length} exercise${day.exercises.length !== 1 ? 's' : ''}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleRestDay(index)}
                    className={`text-xs px-3 py-1 rounded-lg transition-colors ${
                      day.isRestDay
                        ? isDark ? 'bg-orange-500/20 text-orange-400' : 'bg-orange-100 text-orange-600'
                        : isDark ? 'bg-zinc-700 text-zinc-400' : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {day.isRestDay ? 'Make Workout' : 'Make Rest'}
                  </button>
                  {!day.isRestDay && (
                    <button
                      onClick={() => setEditingDayIndex(index)}
                      className={`p-2 rounded-lg transition-colors ${
                        isDark ? 'hover:bg-[#252525]' : 'hover:bg-gray-100'
                      }`}
                    >
                      <Edit3 className={`w-4 h-4 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`} />
                    </button>
                  )}
                  {days.length > 1 && (
                    <button
                      onClick={() => removeDay(index)}
                      className={`p-2 rounded-lg transition-colors ${
                        isDark ? 'hover:bg-red-500/10 text-zinc-500 hover:text-red-400' : 'hover:bg-red-50 text-gray-400 hover:text-red-500'
                      }`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Save/Cancel */}
      <div className="flex gap-3 pt-4">
        <button
          onClick={onCancel}
          className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
            isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e] text-zinc-400 hover:bg-[#252525]' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="flex-1 py-3 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-400 transition-colors"
        >
          {isNew ? 'Create Plan' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

// Day Exercise Editor - Edit exercises for a single day
function DayExerciseEditor({ day, isDark, onSave, onCancel }: {
  day: DayPlan;
  isDark: boolean;
  onSave: (day: DayPlan) => void;
  onCancel: () => void;
}) {
  const [dayName, setDayName] = useState(day.name);
  const [exercises, setExercises] = useState(day.exercises);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const allExercises = storage.getExercises();
  
  const filteredExercises = allExercises.filter(ex =>
    ex.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const addExercise = (exercise: Exercise) => {
    setExercises([...exercises, {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      defaultSets: 3,
      defaultReps: 10,
    }]);
    setShowExercisePicker(false);
    setSearchQuery('');
  };
  
  const removeExercise = (index: number) => {
    setExercises(exercises.filter((_, i) => i !== index));
  };
  
  const updateExercise = (index: number, field: 'defaultSets' | 'defaultReps', value: number) => {
    const updated = [...exercises];
    updated[index] = { ...updated[index], [field]: value };
    setExercises(updated);
  };
  
  const handleSave = () => {
    if (!dayName.trim()) {
      alert('Please enter a day name');
      return;
    }
    
    onSave({
      ...day,
      name: dayName.trim(),
      exercises,
    });
  };
  
  if (showExercisePicker) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-4">
          <button onClick={() => setShowExercisePicker(false)} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold">Add Exercise</h1>
        </div>
        
        {/* Search */}
        <div className="relative">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search exercises..."
            className={`w-full pl-10 pr-4 py-3 rounded-lg border ${
              isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white' : 'bg-white border-gray-200'
            } focus:outline-none focus:border-orange-500`}
            autoFocus
          />
        </div>
        
        {/* Exercise List */}
        <div className="space-y-2">
          {filteredExercises.map(exercise => (
            <button
              key={exercise.id}
              onClick={() => addExercise(exercise)}
              className={`w-full p-4 rounded-xl border text-left transition-colors ${
                isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] hover:bg-[#252525]' : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className="font-medium">{exercise.name}</div>
              <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                {exercise.muscleGroup.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                {exercise.isCompound && ' • Compound'}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-4">
        <button onClick={onCancel} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">Edit {day.name}</h1>
      </div>
      
      {/* Day Name */}
      <div>
        <label className={`text-sm mb-1 block ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>Day Name</label>
        <input
          type="text"
          value={dayName}
          onChange={(e) => setDayName(e.target.value)}
          placeholder="e.g., Full Body, Arms, Rest"
          className={`w-full rounded-lg px-4 py-3 border ${
            isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white' : 'bg-white border-gray-200'
          } focus:outline-none focus:border-orange-500`}
        />
      </div>
      
      {/* Exercises */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
            Exercises ({exercises.length})
          </label>
          <button
            onClick={() => setShowExercisePicker(true)}
            className="text-sm text-orange-400 hover:text-orange-300 flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            Add Exercise
          </button>
        </div>
        
        {exercises.length === 0 ? (
          <div className={`text-center py-8 rounded-xl border ${
            isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-zinc-500' : 'bg-gray-50 border-gray-200 text-gray-500'
          }`}>
            <Dumbbell className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No exercises yet</p>
            <p className="text-xs mt-1">Tap "Add Exercise" to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            {exercises.map((ex, index) => (
              <div
                key={index}
                className={`rounded-xl p-3 border ${
                  isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex-1 font-medium">{ex.exerciseName}</div>
                  <button
                    onClick={() => removeExercise(index)}
                    className={`p-1 rounded transition-colors ${
                      isDark ? 'hover:bg-red-500/10 text-zinc-500 hover:text-red-400' : 'hover:bg-red-50 text-gray-400 hover:text-red-500'
                    }`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Sets</label>
                    <input
                      type="number"
                      min="1"
                      value={ex.defaultSets}
                      onChange={(e) => updateExercise(index, 'defaultSets', parseInt(e.target.value) || 1)}
                      className={`w-full mt-1 px-3 py-2 rounded-lg border text-sm ${
                        isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-gray-50 border-gray-200'
                      } focus:outline-none focus:border-orange-500`}
                    />
                  </div>
                  <div className="flex-1">
                    <label className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Reps</label>
                    <input
                      type="number"
                      min="1"
                      value={ex.defaultReps}
                      onChange={(e) => updateExercise(index, 'defaultReps', parseInt(e.target.value) || 1)}
                      className={`w-full mt-1 px-3 py-2 rounded-lg border text-sm ${
                        isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-gray-50 border-gray-200'
                      } focus:outline-none focus:border-orange-500`}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Save/Cancel */}
      <div className="flex gap-3 pt-4">
        <button
          onClick={onCancel}
          className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
            isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e] text-zinc-400 hover:bg-[#252525]' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="flex-1 py-3 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-400 transition-colors"
        >
          Save Day
        </button>
      </div>
    </div>
  );
}

// Weekly Overview View - 7-day calendar grid
function WeeklyOverviewView({ isDark, onBack, onStartDay }: {
  isDark: boolean;
  onBack: () => void;
  onStartDay: (dayIndex: number) => void;
}) {
  const activePlan = storage.getActivePlan();
  const workouts = storage.getWorkouts();
  
  if (!activePlan) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold">Week View</h1>
        </div>
        <div className={`p-8 rounded-xl border text-center ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
          <Calendar className={`w-12 h-12 mx-auto mb-3 ${isDark ? 'text-zinc-600' : 'text-gray-400'}`} />
          <p className={`font-medium mb-2 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>No Active Plan</p>
          <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
            Set an active plan in Templates to see your weekly schedule here.
          </p>
        </div>
      </div>
    );
  }
  
  // Get this week's workouts (last 7 days)
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - 6); // Last 7 days
  
  const thisWeekWorkouts = workouts.filter(w => {
    const workoutDate = new Date(w.date);
    return workoutDate >= startOfWeek && workoutDate <= today && w.completed;
  });
  
  // Map workouts to day names for easy lookup
  const workoutsByDayName = new Map<string, Workout[]>();
  thisWeekWorkouts.forEach(w => {
    const dayName = activePlan.days.find(d => w.name.includes(d.name))?.name || '';
    if (dayName) {
      const existing = workoutsByDayName.get(dayName) || [];
      workoutsByDayName.set(dayName, [...existing, w]);
    }
  });
  
  const lastUsedDay = storage.getLastUsedDay() ?? 0;
  const totalDays = activePlan.days.length;
  const workoutDays = activePlan.days.filter(d => !d.isRestDay);
  
  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Week View</h1>
          <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>{activePlan.name}</p>
        </div>
      </div>
      
      {/* Week Progress */}
      <div className={`p-4 rounded-xl border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
        <div className="flex justify-between items-center mb-2">
          <span className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>This Week Progress</span>
          <span className="text-sm font-medium text-orange-400">
            {thisWeekWorkouts.length}/{workoutDays.length} workouts
          </span>
        </div>
        <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-[#2e2e2e]' : 'bg-gray-200'}`}>
          <div
            className="h-full bg-gradient-to-r from-orange-500 to-red-500 transition-all"
            style={{ width: `${(thisWeekWorkouts.length / workoutDays.length) * 100}%` }}
          />
        </div>
      </div>
      
      {/* Day Cards Grid */}
      <div className="grid grid-cols-1 gap-3">
        {activePlan.days.map((day, index) => {
          const isRestDay = day.isRestDay;
          const isToday = index === lastUsedDay;
          const workoutsForDay = workoutsByDayName.get(day.name) || [];
          const completedToday = workoutsForDay.length > 0;
          
          return (
            <button
              key={index}
              onClick={() => !isRestDay && onStartDay(index)}
              disabled={isRestDay}
              className={`p-4 rounded-xl border text-left transition-all ${
                isRestDay 
                  ? isDark ? 'bg-[#1a1a1a]/50 border-[#2e2e2e] opacity-60' : 'bg-gray-50 border-gray-200 opacity-60'
                  : completedToday
                  ? isDark ? 'bg-green-500/10 border-green-500/30' : 'bg-green-50 border-green-200'
                  : isToday
                  ? isDark ? 'bg-orange-500/10 border-orange-500/30' : 'bg-orange-50 border-orange-200'
                  : isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] hover:border-orange-500/50' : 'bg-white border-gray-200 hover:border-orange-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    isRestDay
                      ? isDark ? 'bg-zinc-700' : 'bg-gray-200'
                      : completedToday
                      ? 'bg-green-500/20'
                      : isToday
                      ? 'bg-orange-500/20'
                      : isDark ? 'bg-[#252525]' : 'bg-gray-100'
                  }`}>
                    {isRestDay ? (
                      <span className="text-lg">😴</span>
                    ) : completedToday ? (
                      <Check className="w-5 h-5 text-green-400" />
                    ) : isToday ? (
                      <Target className="w-5 h-5 text-orange-400" />
                    ) : (
                      <Dumbbell className={`w-5 h-5 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`} />
                    )}
                  </div>
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {day.name}
                      {isToday && (
                        <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded">Next Up</span>
                      )}
                      {completedToday && (
                        <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">✓ Done</span>
                      )}
                    </div>
                    <div className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                      {isRestDay ? 'Rest & Recovery' : `${day.exercises.length} exercises`}
                    </div>
                  </div>
                </div>
                {!isRestDay && <ChevronRight className={`w-5 h-5 ${isDark ? 'text-zinc-600' : 'text-gray-400'}`} />}
              </div>
            </button>
          );
        })}
      </div>
      
      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className={`p-4 rounded-xl border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
          <div className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Workout Days</div>
          <div className="text-2xl font-bold">{workoutDays.length}</div>
        </div>
        <div className={`p-4 rounded-xl border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
          <div className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Rest Days</div>
          <div className="text-2xl font-bold">{totalDays - workoutDays.length}</div>
        </div>
      </div>
    </div>
  );
}

export default App;
