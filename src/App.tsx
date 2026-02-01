import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Dumbbell, Calendar, TrendingUp, ChevronRight, 
  Check, Clock, Flame, Trophy, Search,
  ChevronLeft, X, Trash2, Timer, Target,
  Settings, Download, Upload, FileSpreadsheet, Copy, CheckCircle2,
  ClipboardList, Plus, Edit3, Sun, Moon
} from 'lucide-react';
import type { Workout, WorkoutExercise, WorkoutSet, WorkoutTemplate, UserStats, WeeklyPlan, DayPlan, Exercise } from './types';
import * as storage from './storage';
import { UpdateChecker, VersionInfo } from './UpdateChecker';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';

type View = 'home' | 'workout' | 'history' | 'templates' | 'active' | 'progress' | 'settings' | 'exercises';
type Theme = 'dark' | 'light';

// Format volume: 1500 -> 1.5k, 1500000 -> 1.5t
function formatVolume(volume: number): string {
  if (volume >= 1000000) return (volume / 1000000).toFixed(1) + 't';
  if (volume >= 1000) return (volume / 1000).toFixed(1) + 'k';
  return volume.toString();
}

// Splash Screen - shows immediately, dismissed when data is loaded
function SplashScreen() {
  return (
    <div className="fixed inset-0 bg-[#0f0f0f] flex flex-col items-center justify-center z-50">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center mb-4 animate-pulse shadow-lg shadow-orange-500/20">
        <Flame className="w-10 h-10 text-white" />
      </div>
      <h1 className="text-2xl font-bold text-white mb-2">Zenith Fitness</h1>
      <p className="text-zinc-500 text-sm">Track. Improve. Dominate.</p>
      <div className="flex gap-1 mt-6">
        <div className="w-2 h-2 rounded-full bg-orange-500 animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-2 h-2 rounded-full bg-orange-500 animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-2 h-2 rounded-full bg-orange-500 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}

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
              icon={<ClipboardList />} 
              label="Templates" 
              active={view === 'templates'} 
              onClick={() => navigateTo('templates')} 
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

// Weekly Plan Selector - shows active plan, day selector, and start button
function WeeklyPlanSelector({ isDark, onStartWorkout }: {
  isDark: boolean;
  onStartWorkout: (template: WorkoutTemplate) => void;
}) {
  const [plans] = useState(() => storage.getWeeklyPlans());
  const [activePlanId, setActivePlanId] = useState(() => storage.getActivePlanId() || plans[0]?.id);
  const [selectedDayNum, setSelectedDayNum] = useState(() => storage.getLastUsedDay() || 1);
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  
  const activePlan = plans.find(p => p.id === activePlanId);
  const workoutDays = activePlan?.days.filter(d => !d.isRestDay) || [];
  const selectedDay = activePlan?.days.find(d => d.dayNumber === selectedDayNum);
  
  // Sync active plan to storage
  const handlePlanChange = (planId: string) => {
    setActivePlanId(planId);
    storage.setActivePlanId(planId);
    setShowPlanPicker(false);
    // Reset to first workout day of new plan
    const newPlan = plans.find(p => p.id === planId);
    const firstWorkoutDay = newPlan?.days.find(d => !d.isRestDay);
    if (firstWorkoutDay) {
      setSelectedDayNum(firstWorkoutDay.dayNumber);
      storage.setLastUsedDay(firstWorkoutDay.dayNumber);
    }
  };
  
  const handleDayChange = (dayNum: number) => {
    setSelectedDayNum(dayNum);
    storage.setLastUsedDay(dayNum);
  };
  
  // Convert DayPlan to WorkoutTemplate for starting workout
  const startWorkoutForDay = () => {
    if (!selectedDay || selectedDay.isRestDay || !activePlan) return;
    
    // Create workout name with plan name (e.g., "4FB+1Arms - Day 1")
    const workoutName = `${activePlan.name} - ${selectedDay.name}`;
    
    const template: WorkoutTemplate = {
      id: `${activePlanId}_day_${selectedDay.dayNumber}`,
      name: workoutName,
      type: 'custom',
      exercises: selectedDay.exercises,
      weeklyPlanId: activePlanId || undefined,
    };
    
    onStartWorkout(template);
  };
  
  if (plans.length === 0) {
    return (
      <div className={`rounded-xl p-6 text-center ${isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'}`}>
        <Dumbbell className="w-10 h-10 mx-auto mb-2 text-zinc-500 opacity-50" />
        <p className="text-zinc-500">No workout plans available</p>
        <p className="text-xs text-zinc-600 mt-1">Import from Google Sheets in Settings</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-3">
      {/* Active Plan Label */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Start Workout</h2>
        <button
          onClick={() => setShowPlanPicker(!showPlanPicker)}
          className={`text-sm px-3 py-1 rounded-lg transition-colors ${
            isDark 
              ? 'bg-[#252525] text-orange-400 hover:bg-[#2e2e2e]' 
              : 'bg-orange-50 text-orange-600 hover:bg-orange-100'
          }`}
        >
          {activePlan?.name || 'Select Plan'}
        </button>
      </div>
      
      {/* Plan Picker Modal */}
      {showPlanPicker && (
        <div className={`rounded-xl p-3 border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
          <div className="text-xs text-zinc-500 mb-2">Switch Weekly Plan:</div>
          <div className="space-y-1">
            {plans.map(plan => (
              <button
                key={plan.id}
                onClick={() => handlePlanChange(plan.id)}
                className={`w-full text-left p-3 rounded-lg transition-colors ${
                  plan.id === activePlanId
                    ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                    : isDark ? 'hover:bg-[#252525]' : 'hover:bg-gray-100'
                }`}
              >
                <div className="font-medium">{plan.name}</div>
                <div className="text-xs text-zinc-500">
                  {plan.days.filter(d => !d.isRestDay).length} workout days
                  {plan.isImported && ' • Imported'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* Day Selector Dropdown */}
      {activePlan && !showPlanPicker && (
        <>
          <select
            value={selectedDayNum}
            onChange={(e) => handleDayChange(Number(e.target.value))}
            className={`w-full p-4 rounded-xl border text-base font-medium appearance-none cursor-pointer ${
              isDark 
                ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white' 
                : 'bg-white border-gray-200 text-gray-900'
            } focus:outline-none focus:border-orange-500`}
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23666'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', backgroundSize: '20px' }}
          >
            {workoutDays.map(day => (
              <option key={day.dayNumber} value={day.dayNumber}>
                {day.name} ({day.exercises.length} exercises)
              </option>
            ))}
          </select>
          
          {/* Selected Day Preview */}
          {selectedDay && !selectedDay.isRestDay && (
            <div className={`rounded-xl p-4 ${isDark ? 'bg-[#252525]' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                  <Dumbbell className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <div className="font-medium">{selectedDay.name}</div>
                  <div className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                    {selectedDay.exercises.length} exercises
                  </div>
                </div>
              </div>
              
              {/* Exercise list preview */}
              <div className={`text-xs space-y-1 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                {selectedDay.exercises.slice(0, 5).map((ex, i) => (
                  <div key={i}>• {ex.exerciseName}</div>
                ))}
                {selectedDay.exercises.length > 5 && (
                  <div>+ {selectedDay.exercises.length - 5} more</div>
                )}
              </div>
            </div>
          )}
          
          {/* Start Button */}
          {selectedDay && !selectedDay.isRestDay && (
            <button
              onClick={startWorkoutForDay}
              className="w-full py-4 bg-gradient-to-r from-orange-500 to-red-600 rounded-xl font-semibold text-white shadow-lg shadow-orange-500/20 hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <Flame className="w-5 h-5" />
              Start Workout
            </button>
          )}
        </>
      )}
    </div>
  );
}

// Volume Line Chart Component - interactive SVG line chart
function VolumeLineChart({ sessions, isDark }: { 
  sessions: Array<{ date: string; volume: number; maxWeight: number; maxReps: number; sets: { weight: number; reps: number }[] }>;
  isDark: boolean;
}) {
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  
  // Get last 15 sessions
  const data = sessions.slice(-15);
  if (data.length === 0) {
    return (
      <div className={`rounded-xl p-4 ${isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'}`}>
        <div className="text-sm font-medium mb-3">Volume per Session</div>
        <div className={`text-center py-8 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
          No session data yet
        </div>
      </div>
    );
  }
  
  const maxVolume = Math.max(...data.map(s => s.volume), 1);
  const minVolume = Math.min(...data.map(s => s.volume));
  const range = maxVolume - minVolume || 1;
  
  // Chart dimensions
  const width = 300;
  const height = 120;
  const padding = { top: 10, right: 10, bottom: 25, left: 10 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  
  // Calculate points
  const points = data.map((session, i) => ({
    x: padding.left + (i / Math.max(data.length - 1, 1)) * chartWidth,
    y: padding.top + chartHeight - ((session.volume - minVolume) / range) * chartHeight,
    session,
    index: i,
  }));
  
  // Create path
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  
  return (
    <div className={`rounded-xl p-4 ${isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'}`}>
      <div className="text-sm font-medium mb-3">Volume per Session</div>
      
      {/* Selected point detail */}
      {selectedPoint !== null && data[selectedPoint] && (
        <div className={`text-xs mb-2 p-2 rounded-lg ${isDark ? 'bg-[#252525]' : 'bg-gray-100'}`}>
          <div className="font-medium text-orange-400">
            {new Date(data[selectedPoint].date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
          <div className={isDark ? 'text-zinc-400' : 'text-gray-600'}>
            Volume: {Math.round(data[selectedPoint].volume)} · Max: {data[selectedPoint].maxWeight}kg × {data[selectedPoint].maxReps}
          </div>
        </div>
      )}
      
      <svg 
        viewBox={`0 0 ${width} ${height}`} 
        className="w-full h-32"
        onMouseLeave={() => setSelectedPoint(null)}
      >
        {/* Grid lines */}
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} 
          stroke={isDark ? '#333' : '#ddd'} strokeWidth="1" />
        <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} 
          stroke={isDark ? '#333' : '#ddd'} strokeWidth="1" />
        
        {/* Area fill */}
        <path
          d={`${pathD} L ${points[points.length - 1]?.x || 0} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`}
          fill="url(#volumeGradient)"
          opacity="0.3"
        />
        
        {/* Line */}
        <path
          d={pathD}
          fill="none"
          stroke="#f97316"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={selectedPoint === i ? 6 : 4}
              fill={selectedPoint === i ? '#f97316' : isDark ? '#1a1a1a' : '#fff'}
              stroke="#f97316"
              strokeWidth="2"
              className="cursor-pointer transition-all"
              onClick={() => setSelectedPoint(selectedPoint === i ? null : i)}
              onMouseEnter={() => setSelectedPoint(i)}
            />
          </g>
        ))}
        
        {/* Gradient definition */}
        <defs>
          <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      
      {/* X-axis labels */}
      <div className="flex justify-between text-[9px] mt-1" style={{ paddingLeft: padding.left, paddingRight: padding.right }}>
        {data.length > 0 && (
          <>
            <span className={isDark ? 'text-zinc-600' : 'text-gray-400'}>
              {new Date(data[0].date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
            <span className={isDark ? 'text-zinc-600' : 'text-gray-400'}>
              {new Date(data[data.length - 1].date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// Weekly Insights Card
function WeeklyInsightsCard({ workouts }: { workouts: Workout[] }) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  
  const thisWeekWorkouts = workouts.filter(w => 
    w.completed && w.type !== 'rest' && new Date(w.date) >= weekStart
  );
  
  const lastWeekWorkouts = workouts.filter(w => {
    const d = new Date(w.date);
    return w.completed && w.type !== 'rest' && d >= lastWeekStart && d < weekStart;
  });
  
  const calculateVolume = (ws: Workout[]) => ws.reduce((total, w) => 
    total + w.exercises.reduce((et, e) => 
      et + e.sets.reduce((st, s) => st + (s.completed ? s.weight * s.reps : 0), 0), 0), 0);
  
  const thisWeekVolume = calculateVolume(thisWeekWorkouts);
  const lastWeekVolume = calculateVolume(lastWeekWorkouts);
  const volumeChange = lastWeekVolume > 0 ? ((thisWeekVolume - lastWeekVolume) / lastWeekVolume * 100) : 0;
  
  if (thisWeekWorkouts.length === 0 && lastWeekWorkouts.length === 0) return null;
  
  return (
    <div className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-5 h-5 text-indigo-400" />
        <span className="font-medium">This Week</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-2xl font-bold">{formatVolume(thisWeekVolume)}</div>
          <div className="text-sm text-zinc-400 flex items-center gap-1">
            Volume
            {volumeChange !== 0 && (
              <span className={volumeChange > 0 ? 'text-emerald-400' : 'text-red-400'}>
                {volumeChange > 0 ? '↑' : '↓'}{Math.abs(volumeChange).toFixed(0)}%
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-2xl font-bold">{thisWeekWorkouts.length}</div>
          <div className="text-sm text-zinc-400">
            Workouts
            {lastWeekWorkouts.length > 0 && (
              <span className="text-zinc-500"> (was {lastWeekWorkouts.length})</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Home View
function HomeView({ stats, workouts, isDark, onStartWorkout, onViewHistory }: {
  stats: UserStats | null;
  workouts: Workout[];
  isDark: boolean;
  onStartWorkout: (template: WorkoutTemplate) => void;
  onViewHistory: () => void;
}) {
  const today = new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  // Daily motivation quotes
  const quotes = [
    "The only bad workout is the one that didn't happen.",
    "Your body can stand almost anything. It's your mind you have to convince.",
    "Progress, not perfection.",
    "The pain you feel today will be the strength you feel tomorrow.",
    "Discipline is choosing between what you want now and what you want most.",
    "Your future self will thank you.",
    "Every rep counts. Every set matters.",
    "Consistency beats intensity.",
    "Strong mind, strong body.",
    "You don't have to be great to start, but you have to start to be great.",
    "Results happen over time, not overnight.",
    "The gym is my therapy.",
  ];
  const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000);
  const todaysQuote = quotes[dayOfYear % quotes.length];
  
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold">Hey Rishi! 💪</h1>
        <p className="text-zinc-400">{dayNames[today.getDay()]}, {today.toLocaleDateString('en-IN', { month: 'long', day: 'numeric' })}</p>
        <p className="text-sm text-orange-400/80 mt-1 italic">"{todaysQuote}"</p>
      </div>

      {/* Stats Cards - simplified to useful metrics */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard 
          icon={<Target className="text-emerald-400" />}
          value={stats?.thisWeekWorkouts || 0}
          label="This Week"
          suffix="/5"
          color="emerald"
        />
        <StatCard 
          icon={<Trophy className="text-orange-400" />}
          value={stats?.totalWorkouts || 0}
          label="Total Workouts"
          color="orange"
        />
      </div>

      {/* Weekly Insights */}
      <WeeklyInsightsCard workouts={workouts} />

      {/* Weekly Plan Selection & Start */}
      <WeeklyPlanSelector 
        isDark={isDark}
        onStartWorkout={onStartWorkout}
      />

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
  value: number | string;
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
          />
        ))}
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
  
  // Get last session data for progressive overload tracking
  const lastSession = useMemo(() => 
    storage.getLastExerciseSession(exercise.exerciseId), 
    [exercise.exerciseId]
  );
  
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

// History View
// History Workout Card - expandable to show exercise details
function HistoryWorkoutCard({ workout, isDark, onDelete }: {
  workout: Workout;
  isDark: boolean;
  onDelete: () => void;
}) {
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

function HistoryView({ workouts, isDark, onBack, onDelete }: {
  workouts: Workout[];
  isDark: boolean;
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
                  <HistoryWorkoutCard 
                    key={workout.id}
                    workout={workout}
                    isDark={isDark}
                    onDelete={() => onDelete(workout.id)}
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

// Progress View
function ProgressView({ workouts, isDark, onBack }: {
  workouts: Workout[];
  isDark: boolean;
  onBack: () => void;
}) {
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const completedWorkouts = workouts.filter(w => w.completed && w.type !== 'rest');
  
  // Get ALL exercises from library, with session counts
  const exerciseList = useMemo(() => {
    const allExercises = storage.getExercises();
    const sessionCounts = new Map<string, number>();
    
    // Count sessions for each exercise
    completedWorkouts.forEach(workout => {
      workout.exercises.forEach(exercise => {
        sessionCounts.set(exercise.exerciseId, (sessionCounts.get(exercise.exerciseId) || 0) + 1);
      });
    });
    
    // Map all exercises with their session counts
    return allExercises.map(ex => ({
      id: ex.id,
      name: ex.name,
      sessionCount: sessionCounts.get(ex.id) || 0,
    })).sort((a, b) => b.sessionCount - a.sessionCount || a.name.localeCompare(b.name));
  }, [completedWorkouts]);

  // Get data for selected exercise
  const exerciseData = useMemo(() => {
    if (!selectedExercise) return null;
    
    const sessions: { date: string; volume: number; maxWeight: number; maxReps: number; sets: { weight: number; reps: number }[] }[] = [];
    let prWeight = 0;
    let prReps = 0;
    let prDate = '';
    
    completedWorkouts
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .forEach(workout => {
        const exercise = workout.exercises.find(e => e.exerciseId === selectedExercise);
        if (exercise) {
          let sessionVolume = 0;
          let sessionMaxWeight = 0;
          let sessionMaxReps = 0;
          const completedSets: { weight: number; reps: number }[] = [];
          
          exercise.sets.forEach(set => {
            if (set.completed && set.weight > 0 && set.reps > 0) {
              const setVolume = set.weight * set.reps;
              sessionVolume += setVolume;
              completedSets.push({ weight: set.weight, reps: set.reps });
              
              if (set.weight > sessionMaxWeight) {
                sessionMaxWeight = set.weight;
                sessionMaxReps = set.reps;
              }
              
              // PR: highest weight × max reps WITH that weight
              if (set.weight > prWeight || (set.weight === prWeight && set.reps > prReps)) {
                prWeight = set.weight;
                prReps = set.reps;
                prDate = workout.date;
              }
            }
          });
          
          if (completedSets.length > 0) {
            sessions.push({
              date: workout.date,
              volume: sessionVolume,
              maxWeight: sessionMaxWeight,
              maxReps: sessionMaxReps,
              sets: completedSets,
            });
          }
        }
      });
    
    // Calculate trend (comparing last 3 sessions average volume to previous 3)
    let trend: 'improving' | 'declining' | 'stable' = 'stable';
    if (sessions.length >= 6) {
      const recent3 = sessions.slice(-3).reduce((sum, s) => sum + s.volume, 0) / 3;
      const previous3 = sessions.slice(-6, -3).reduce((sum, s) => sum + s.volume, 0) / 3;
      const change = ((recent3 - previous3) / previous3) * 100;
      if (change > 5) trend = 'improving';
      else if (change < -5) trend = 'declining';
    } else if (sessions.length >= 2) {
      const last = sessions[sessions.length - 1].volume;
      const secondLast = sessions[sessions.length - 2].volume;
      if (last > secondLast * 1.05) trend = 'improving';
      else if (last < secondLast * 0.95) trend = 'declining';
    }
    
    return {
      sessions,
      pr: { weight: prWeight, reps: prReps, date: prDate },
      trend,
      totalVolume: sessions.reduce((sum, s) => sum + s.volume, 0),
    };
  }, [selectedExercise, completedWorkouts]);

  // If an exercise is selected, show detail view
  if (selectedExercise && exerciseData) {
    const exerciseName = exerciseList.find(e => e.id === selectedExercise)?.name || '';
    
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-4">
          <button onClick={() => setSelectedExercise(null)} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-lg font-bold truncate">{exerciseName}</h1>
        </div>

        {/* PR Card */}
        <div className={`bg-gradient-to-br from-yellow-500/20 to-yellow-500/5 border border-yellow-500/30 rounded-xl p-4 ${!isDark && 'from-yellow-100 to-yellow-50'}`}>
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            <span className="text-sm font-medium text-yellow-600">Personal Record</span>
          </div>
          <div className="text-3xl font-bold">{exerciseData.pr.weight}kg × {exerciseData.pr.reps}</div>
          {exerciseData.pr.date && (
            <div className={`text-sm mt-1 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
              {new Date(exerciseData.pr.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          )}
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-2">
          <div className={`rounded-xl p-3 text-center ${isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'}`}>
            <div className="text-lg font-bold">{exerciseData.sessions.length}</div>
            <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Sessions</div>
          </div>
          <div className={`rounded-xl p-3 text-center ${isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'}`}>
            <div className="text-lg font-bold">{(exerciseData.totalVolume / 1000).toFixed(1)}t</div>
            <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Total Volume</div>
          </div>
          <div className={`border rounded-xl p-3 text-center ${
            exerciseData.trend === 'improving' ? 'bg-emerald-500/10 border-emerald-500/30' :
            exerciseData.trend === 'declining' ? 'bg-red-500/10 border-red-500/30' :
            isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'
          }`}>
            <div className={`text-lg font-bold ${
              exerciseData.trend === 'improving' ? 'text-emerald-400' :
              exerciseData.trend === 'declining' ? 'text-red-400' : ''
            }`}>
              {exerciseData.trend === 'improving' ? '↑' : exerciseData.trend === 'declining' ? '↓' : '→'}
            </div>
            <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Trend</div>
          </div>
        </div>

        {/* Volume Line Chart */}
        <VolumeLineChart 
          sessions={exerciseData.sessions} 
          isDark={isDark} 
        />

        {/* Recent Sessions */}
        <div className={`rounded-xl p-4 ${isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'}`}>
          <div className="text-sm font-medium mb-3">Recent Sessions</div>
          <div className="space-y-3">
            {exerciseData.sessions.slice(-5).reverse().map((session, i) => (
              <div key={i} className={`flex items-center justify-between py-2 border-b last:border-0 ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}>
                <div>
                  <div className="text-sm">{new Date(session.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                  <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                    {session.sets.map(s => `${s.weight}kg×${s.reps}`).join(', ')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium">{session.maxWeight}kg</div>
                  <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>{session.volume} vol</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Main progress view - exercise list
  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">Progress</h1>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className={`bg-gradient-to-br rounded-xl p-4 ${isDark ? 'from-orange-500/20 to-orange-500/5 border border-orange-500/20' : 'from-orange-100 to-orange-50 border border-orange-200'}`}>
          <div className="text-2xl font-bold">{completedWorkouts.length}</div>
          <div className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>Total Workouts</div>
        </div>
        <div className={`bg-gradient-to-br rounded-xl p-4 ${isDark ? 'from-emerald-500/20 to-emerald-500/5 border border-emerald-500/20' : 'from-emerald-100 to-emerald-50 border border-emerald-200'}`}>
          <div className="text-2xl font-bold">{exerciseList.length}</div>
          <div className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>Exercises Tracked</div>
        </div>
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
            isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white placeholder-zinc-500' : 'bg-white border-gray-200 placeholder-gray-400'
          } focus:outline-none focus:border-orange-500`}
        />
      </div>

      {/* Exercise List - tap to see details */}
      <div className={`rounded-xl overflow-hidden ${isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'}`}>
        <div className={`px-4 py-3 border-b ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-orange-400" />
            <span className="text-sm font-medium">Exercise Progress</span>
          </div>
          <div className={`text-xs mt-1 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
            {searchQuery ? `${exerciseList.filter(ex => ex.name.toLowerCase().includes(searchQuery.toLowerCase())).length} matching` : `${exerciseList.length} total exercises`} - Tap to see details
          </div>
        </div>
        <div className={`divide-y overflow-y-auto ${isDark ? 'divide-[#2e2e2e]' : 'divide-gray-200'}`} style={{ maxHeight: 'calc(100vh - 400px)' }}>
          {exerciseList.length === 0 ? (
            <div className={`px-4 py-8 text-center ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
              <Dumbbell className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <div>Complete workouts to see exercise progress</div>
            </div>
          ) : (
            exerciseList
              .filter(ex => ex.name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map(exercise => (
              <button
                key={exercise.id}
                onClick={() => setSelectedExercise(exercise.id)}
                className={`w-full px-4 py-3 flex items-center justify-between transition-colors ${isDark ? 'hover:bg-[#252525]' : 'hover:bg-gray-50'}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
                    <Dumbbell className="w-4 h-4 text-orange-400" />
                  </div>
                  <span className="text-sm">{exercise.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>{exercise.sessionCount} sessions</span>
                  <ChevronRight className={`w-4 h-4 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`} />
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Empty State */}
      {completedWorkouts.length === 0 && (
        <div className={`text-center py-8 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
          <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Complete some workouts to see your progress!</p>
        </div>
      )}
    </div>
  );
}

// Settings View - Import/Export
function SettingsView({ onBack, onDataChange, onNavigateToExercises, isDark }: {
  onBack: () => void;
  onDataChange: () => void;
  onNavigateToExercises?: () => void;
  isDark: boolean;
}) {
  const [sheetsUrl, setSheetsUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null);
  const [exportCsv, setExportCsv] = useState('');
  const [copied, setCopied] = useState(false);

  const handleImport = async () => {
    if (!sheetsUrl.trim()) {
      setImportResult({ success: false, message: 'Please enter a Google Sheets URL' });
      return;
    }
    
    setImporting(true);
    setImportResult(null);
    
    try {
      const result = await storage.importFromGoogleSheetsUrl(sheetsUrl);
      if (result.success) {
        setImportResult({ 
          success: true, 
          message: `Imported ${result.workoutsImported} workouts with ${result.exercisesFound} unique exercises!` 
        });
        onDataChange();
        setSheetsUrl('');
      } else {
        setImportResult({ 
          success: false, 
          message: result.errors.join('\n') || 'Import failed' 
        });
      }
    } catch (e) {
      setImportResult({ success: false, message: 'Import error: ' + (e instanceof Error ? e.message : 'Unknown') });
    } finally {
      setImporting(false);
    }
  };

  const handleExport = () => {
    const csv = storage.exportToCSV();
    setExportCsv(csv);
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(exportCsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = exportCsv;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      {/* Exercise Library Button */}
      {onNavigateToExercises && (
        <button
          onClick={onNavigateToExercises}
          className="w-full bg-orange-500 hover:bg-orange-400 text-white font-medium py-4 px-4 rounded-xl flex items-center justify-between transition-colors"
        >
          <div className="flex items-center gap-3">
            <Dumbbell className="w-5 h-5" />
            <span>Exercise Library</span>
          </div>
          <ChevronRight className="w-5 h-5" />
        </button>
      )}

      {/* Import from Google Sheets */}
      <div className={`rounded-xl p-4 border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center gap-2 mb-4">
          <FileSpreadsheet className="w-5 h-5 text-green-400" />
          <span className="font-medium">Import from Google Sheets</span>
        </div>
        
        <p className={`text-sm mb-4 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
          Import your existing workout history from Google Sheets. The sheet must be publicly accessible (Anyone with link can view).
        </p>
        
        <p className={`text-xs mb-4 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
          Expected format: Date, Exercise, Set1 Reps, Set1 Weight, Set2 Reps, Set2 Weight, Set3 Reps, Set3 Weight, Volume
        </p>
        
        <input
          type="url"
          value={sheetsUrl}
          onChange={(e) => setSheetsUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          className={`w-full rounded-lg px-4 py-3 text-sm border mb-3 ${
            isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-white border-gray-200'
          } focus:outline-none focus:border-orange-500`}
        />
        
        <button
          onClick={handleImport}
          disabled={importing}
          className="w-full bg-green-600 hover:bg-green-500 disabled:bg-green-800 disabled:opacity-50 text-white font-medium py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
        >
          {importing ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Importing...
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              Import Workouts
            </>
          )}
        </button>
        
        {importResult && (
          <div className={`mt-3 p-3 rounded-lg text-sm ${
            importResult.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {importResult.success ? <CheckCircle2 className="w-4 h-4 inline mr-2" /> : <X className="w-4 h-4 inline mr-2" />}
            {importResult.message}
          </div>
        )}
      </div>

      {/* Export to CSV */}
      <div className={`rounded-xl p-4 border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center gap-2 mb-4">
          <Upload className="w-5 h-5 text-blue-400" />
          <span className="font-medium">Export to CSV</span>
        </div>
        
        <p className={`text-sm mb-4 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
          Export your workout data as CSV. Copy and paste into Google Sheets to sync your data.
        </p>
        
        {!exportCsv ? (
          <button
            onClick={handleExport}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Generate CSV
          </button>
        ) : (
          <div className="space-y-3">
            <textarea
              value={exportCsv}
              readOnly
              className={`w-full h-32 rounded-lg px-3 py-2 text-xs font-mono resize-none border ${
                isDark ? 'bg-[#252525] border-[#3e3e3e] text-zinc-300' : 'bg-gray-50 border-gray-200 text-gray-700'
              }`}
            />
            <button
              onClick={copyToClipboard}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy to Clipboard
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* App Info */}
      <div className={`text-center text-xs space-y-1 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
        <p>Zenith Fitness v{__APP_VERSION__}</p>
        <p>Built with ⚡ by Zenith</p>
      </div>
    </div>
  );
}

// Exercise Manager View - Centralized exercise list management
function ExerciseManagerView({ isDark, onBack, onExercisesChange }: {
  isDark: boolean;
  onBack: () => void;
  onExercisesChange: () => void;
}) {
  const [exercises, setExercises] = useState(() => storage.getExercises());
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMuscleGroup, setNewMuscleGroup] = useState<string>('chest');
  const [searchQuery, setSearchQuery] = useState('');
  
  const muscleGroups = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core', 'full_body', 'other'];
  
  const filteredExercises = exercises.filter(ex =>
    ex.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    ex.muscleGroup.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const handleAdd = () => {
    if (!newName.trim()) return;
    storage.addCustomExercise(newName.trim(), newMuscleGroup);
    setExercises(storage.getExercises());
    setNewName('');
    setIsAdding(false);
    onExercisesChange();
  };
  
  const handleDelete = (id: string, name: string) => {
    if (confirm(`Delete exercise "${name}"?\n\nWarning: This will affect all templates and workouts using this exercise.`)) {
      const allExercises = storage.getExercises().filter(e => e.id !== id);
      localStorage.setItem('zenith_exercises', JSON.stringify(allExercises));
      setExercises(allExercises);
      onExercisesChange();
    }
  };
  
  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">Exercise Library</h1>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="ml-auto p-2 bg-orange-500 rounded-lg hover:bg-orange-400 transition-colors"
        >
          {isAdding ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
        </button>
      </div>
      
      {/* Add New Exercise */}
      {isAdding && (
        <div className={`rounded-xl p-4 ${isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'}`}>
          <div className="space-y-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Exercise name"
              className={`w-full p-3 rounded-lg border ${
                isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-white border-gray-200'
              } focus:outline-none focus:border-orange-500`}
            />
            <select
              value={newMuscleGroup}
              onChange={(e) => setNewMuscleGroup(e.target.value)}
              className={`w-full p-3 rounded-lg border ${
                isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-white border-gray-200'
              } focus:outline-none focus:border-orange-500`}
            >
              {muscleGroups.map(mg => (
                <option key={mg} value={mg}>
                  {mg.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </option>
              ))}
            </select>
            <button
              onClick={handleAdd}
              disabled={!newName.trim()}
              className="w-full py-3 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Add Exercise
            </button>
          </div>
        </div>
      )}
      
      {/* Search */}
      <div className="relative">
        <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search exercises..."
          className={`w-full pl-10 pr-4 py-3 rounded-lg border ${
            isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white placeholder-zinc-500' : 'bg-white border-gray-200 placeholder-gray-400'
          } focus:outline-none focus:border-orange-500`}
        />
      </div>
      
      {/* Exercise Count */}
      <div className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
        {filteredExercises.length} exercise{filteredExercises.length !== 1 ? 's' : ''}
        {searchQuery && ` matching "${searchQuery}"`}
      </div>
      
      {/* Exercise List */}
      <div className="space-y-2">
        {filteredExercises.map(exercise => (
          <div
            key={exercise.id}
            className={`rounded-xl p-4 flex items-center justify-between ${
              isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'
            }`}
          >
            <div className="flex items-center gap-3 flex-1">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                exercise.muscleGroup === 'chest' ? 'bg-blue-500/20' :
                exercise.muscleGroup === 'back' ? 'bg-green-500/20' :
                exercise.muscleGroup === 'legs' ? 'bg-purple-500/20' :
                exercise.muscleGroup === 'shoulders' ? 'bg-yellow-500/20' :
                exercise.muscleGroup === 'biceps' || exercise.muscleGroup === 'triceps' ? 'bg-red-500/20' :
                'bg-orange-500/20'
              }`}>
                <Dumbbell className={`w-5 h-5 ${
                  exercise.muscleGroup === 'chest' ? 'text-blue-400' :
                  exercise.muscleGroup === 'back' ? 'text-green-400' :
                  exercise.muscleGroup === 'legs' ? 'text-purple-400' :
                  exercise.muscleGroup === 'shoulders' ? 'text-yellow-400' :
                  exercise.muscleGroup === 'biceps' || exercise.muscleGroup === 'triceps' ? 'text-red-400' :
                  'text-orange-400'
                }`} />
              </div>
              <div className="flex-1">
                <div className="font-medium">{exercise.name}</div>
                <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                  {exercise.muscleGroup.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  {exercise.isCompound && ' • Compound'}
                </div>
              </div>
            </div>
            {exercise.id.startsWith('custom_') || exercise.id.startsWith('imported_') ? (
              <button
                onClick={() => handleDelete(exercise.id, exercise.name)}
                className={`p-2 rounded-lg transition-colors ${
                  isDark ? 'text-zinc-500 hover:text-red-400 hover:bg-red-500/10' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                }`}
              >
                <Trash2 className="w-5 h-5" />
              </button>
            ) : (
              <div className={`text-xs px-2 py-1 rounded ${isDark ? 'bg-[#252525] text-zinc-500' : 'bg-gray-100 text-gray-500'}`}>
                Default
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
