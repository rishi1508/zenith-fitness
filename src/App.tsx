import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Dumbbell, Calendar, TrendingUp, 
  Flame, Settings, ClipboardList, Sun, Moon
} from 'lucide-react';
import type { Workout, WorkoutTemplate, UserStats } from './types';
import * as storage from './storage';
import { UpdateChecker } from './UpdateChecker';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { SplashScreen, NavButton, WorkoutTimer } from './components';
import { HistoryView, ProgressView, SettingsView, ExerciseManagerView, HomeView, ActiveWorkoutView, WeeklyPlansView, WeeklyOverviewView, ComparisonView } from './views';

type View = 'home' | 'workout' | 'history' | 'templates' | 'active' | 'progress' | 'settings' | 'exercises' | 'weekly' | 'compare';
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
    
    // CRITICAL: Restore active workout if one was in progress (screen timeout fix)
    try {
      const savedActiveWorkout = localStorage.getItem('zenith_active_workout');
      if (savedActiveWorkout) {
        const workout = JSON.parse(savedActiveWorkout);
        setActiveWorkout(workout);
        setView('active');
        console.log('[Recovery] Restored active workout session');
      }
    } catch (e) {
      console.error('[Recovery] Failed to restore active workout:', e);
    }
    
    // Data loaded, hide splash
    setShowSplash(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);
  
  // CRITICAL: Persist active workout to localStorage on every change (screen timeout fix)
  useEffect(() => {
    if (activeWorkout) {
      try {
        localStorage.setItem('zenith_active_workout', JSON.stringify(activeWorkout));
      } catch (e) {
        console.error('[Persist] Failed to save active workout:', e);
      }
    }
  }, [activeWorkout]);

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
      
      // Auto-complete all sets that have weight and reps filled in
      const exercisesWithCompletedSets = activeWorkout.exercises.map(ex => ({
        ...ex,
        sets: ex.sets.map(set => ({
          ...set,
          // Mark set as completed if it has valid data (weight > 0 OR reps > 0)
          completed: set.completed || (set.weight > 0 || set.reps > 0),
        })),
      }));
      
      const finished = {
        ...activeWorkout,
        exercises: exercisesWithCompletedSets,
        completed: true,
        completedAt,
        duration,
      };
      storage.saveWorkout(finished);
      
      // Clear the persisted active workout (session is done)
      localStorage.removeItem('zenith_active_workout');
      
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
      // Clear the persisted active workout
      localStorage.removeItem('zenith_active_workout');
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
            onNavigateToCompare={() => navigateTo('compare')}
          />
        )}
        {view === 'compare' && (
          <ComparisonView
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

export default App;
