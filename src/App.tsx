import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Dumbbell, Calendar, TrendingUp, ChevronRight, 
  Check, Clock, Flame, Trophy,
  ChevronLeft, X, Trash2, Timer, Target,
  Settings, Download, Upload, FileSpreadsheet, Copy, CheckCircle2,
  ClipboardList, Plus, Edit3, Save, Sun, Moon
} from 'lucide-react';
import type { Workout, WorkoutExercise, WorkoutSet, WorkoutTemplate, UserStats } from './types';
import * as storage from './storage';
import { UpdateChecker, VersionInfo } from './UpdateChecker';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';

type View = 'home' | 'workout' | 'history' | 'templates' | 'active' | 'progress' | 'settings';
type Theme = 'dark' | 'light';

// Format volume: 1500 -> 1.5k, 1500000 -> 1.5t
function formatVolume(volume: number): string {
  if (volume >= 1000000) return (volume / 1000000).toFixed(1) + 't';
  if (volume >= 1000) return (volume / 1000).toFixed(1) + 'k';
  return volume.toString();
}

// Splash Screen
function SplashScreen({ onFinish }: { onFinish: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onFinish, 1500);
    return () => clearTimeout(timer);
  }, [onFinish]);

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
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [workoutHistory, setWorkoutHistory] = useState<Workout[]>([]);
  const [showSplash, setShowSplash] = useState(true);
  const [missingDays, setMissingDays] = useState<string[]>([]);
  const [lastTemplateId, setLastTemplateId] = useState<string | null>(null);
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
    setTemplates(storage.getTemplates());
    setWorkoutHistory(storage.getWorkouts());
    setLastTemplateId(storage.getLastUsedTemplateId());
    // Check for missing days after splash
    const missing = storage.getMissingDays();
    setMissingDays(missing);
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
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
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
      
      {/* Header */}
      <header className={`sticky top-0 backdrop-blur-sm border-b px-4 py-3 z-10 transition-colors duration-300 ${isDark ? 'bg-[#0f0f0f]/95 border-[#2e2e2e]' : 'bg-white/95 border-gray-200'}`}>
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
            templates={templates}
            lastTemplate={lastTemplateId ? templates.find(t => t.id === lastTemplateId) : null}
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
        {view === 'templates' && (
          <TemplatesView 
            templates={templates}
            onBack={() => goBack()}
            onStartWorkout={(template) => {
              startWorkout(template);
            }}
            onTemplatesChange={loadData}
          />
        )}
        {view === 'progress' && (
          <ProgressView 
            workouts={workoutHistory}
            onBack={() => goBack()}
          />
        )}
        {view === 'settings' && (
          <SettingsView 
            onBack={() => goBack()}
            onDataChange={loadData}
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

// Home View
function HomeView({ stats, templates, lastTemplate, onStartWorkout, onLogRest, onViewHistory }: {
  stats: UserStats | null;
  templates: WorkoutTemplate[];
  lastTemplate: WorkoutTemplate | null | undefined;
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

      {/* Quick Continue - show if there's a last used template */}
      {lastTemplate && (
        <button
          onClick={() => onStartWorkout(lastTemplate)}
          className="w-full bg-gradient-to-r from-orange-500 to-red-600 rounded-xl p-4 flex items-center justify-between shadow-lg shadow-orange-500/20"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-white/20 flex items-center justify-center">
              <Flame className="w-6 h-6 text-white" />
            </div>
            <div className="text-left">
              <div className="text-white font-semibold">Continue with {lastTemplate.name}</div>
              <div className="text-white/70 text-sm">{lastTemplate.exercises.length} exercises</div>
            </div>
          </div>
          <ChevronRight className="w-6 h-6 text-white/70" />
        </button>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard 
          icon={<Dumbbell className="text-orange-400" />}
          value={formatVolume(stats?.totalVolume || 0)}
          label="Total Volume"
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
          icon={<TrendingUp className="text-yellow-400" />}
          value={formatVolume(stats?.avgVolumePerSession || 0)}
          label="Avg/Session"
          color="yellow"
        />
        <StatCard 
          icon={<Trophy className="text-indigo-400" />}
          value={stats?.totalWorkouts || 0}
          label="Total Workouts"
          color="indigo"
        />
      </div>

      {/* Quick Actions */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Start Workout</h2>
        <div className="space-y-2">
          {(() => {
            const lastUsedId = storage.getLastUsedTemplateId();
            // Sort: last used first, then the rest
            const sortedTemplates = [...templates].sort((a, b) => {
              if (a.id === lastUsedId) return -1;
              if (b.id === lastUsedId) return 1;
              return 0;
            });
            return sortedTemplates.map(template => {
              const isLastUsed = template.id === lastUsedId;
              return (
                <button
                  key={template.id}
                  onClick={() => onStartWorkout(template)}
                  className={`w-full bg-[#1a1a1a] border rounded-xl p-4 flex items-center justify-between transition-colors ${
                    isLastUsed 
                      ? 'border-orange-500/50 ring-1 ring-orange-500/20' 
                      : 'border-[#2e2e2e] hover:border-orange-500/50'
                  }`}
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
                      <div className="font-medium flex items-center gap-2">
                        {template.name}
                        {isLastUsed && (
                          <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">
                            Last used
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-zinc-500">{template.exercises.length} exercises</div>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-zinc-500" />
                </button>
              );
            });
          })()}
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
// History Workout Card - expandable to show exercise details
function HistoryWorkoutCard({ workout, onDelete }: {
  workout: Workout;
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
    <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl overflow-hidden">
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
                  <HistoryWorkoutCard 
                    key={workout.id}
                    workout={workout}
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

// Templates View - Manage workout templates
function TemplatesView({ templates, onBack, onStartWorkout, onTemplatesChange }: {
  templates: WorkoutTemplate[];
  onBack: () => void;
  onStartWorkout: (template: WorkoutTemplate) => void;
  onTemplatesChange: () => void;
}) {
  const [editingTemplate, setEditingTemplate] = useState<WorkoutTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const defaultIds = storage.getDefaultTemplateIds();
  
  const handleDelete = (template: WorkoutTemplate) => {
    if (defaultIds.includes(template.id)) {
      alert('Cannot delete default templates');
      return;
    }
    if (confirm(`Delete "${template.name}"?`)) {
      storage.deleteTemplate(template.id);
      onTemplatesChange();
    }
  };
  
  const handleSave = (template: WorkoutTemplate) => {
    storage.saveTemplate(template);
    onTemplatesChange();
    setEditingTemplate(null);
    setIsCreating(false);
  };
  
  const handleCancel = () => {
    setEditingTemplate(null);
    setIsCreating(false);
  };
  
  const createNewTemplate = () => {
    const newTemplate: WorkoutTemplate = {
      id: `custom-${Date.now()}`,
      name: 'New Workout',
      type: 'custom',
      exercises: [],
    };
    setEditingTemplate(newTemplate);
    setIsCreating(true);
  };

  // Show edit view if editing
  if (editingTemplate) {
    return (
      <EditTemplateView 
        template={editingTemplate}
        isNew={isCreating}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 -ml-2 text-zinc-400">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold">Workout Templates</h1>
        </div>
        <button 
          onClick={createNewTemplate}
          className="p-2 bg-orange-500 rounded-lg hover:bg-orange-400 transition-colors"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <p className="text-sm text-zinc-400">
        Choose a template to start a workout, or create your own custom routine.
      </p>

      <div className="space-y-2">
        {templates.map(template => {
          const isDefault = defaultIds.includes(template.id);
          return (
            <div
              key={template.id}
              className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl overflow-hidden"
            >
              <button
                onClick={() => onStartWorkout(template)}
                className="w-full p-4 flex items-center gap-3 hover:bg-[#252525] transition-colors"
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  template.type === 'arms' ? 'bg-purple-500/20' :
                  template.type === 'custom' ? 'bg-blue-500/20' : 'bg-orange-500/20'
                }`}>
                  <Dumbbell className={`w-5 h-5 ${
                    template.type === 'arms' ? 'text-purple-400' :
                    template.type === 'custom' ? 'text-blue-400' : 'text-orange-400'
                  }`} />
                </div>
                <div className="flex-1 text-left">
                  <div className="font-medium flex items-center gap-2">
                    {template.name}
                    {template.type === 'custom' && (
                      <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">Custom</span>
                    )}
                  </div>
                  <div className="text-sm text-zinc-500">{template.exercises.length} exercises</div>
                </div>
                <ChevronRight className="w-5 h-5 text-zinc-500" />
              </button>
              
              {/* Action buttons for custom templates */}
              {!isDefault && (
                <div className="flex border-t border-[#2e2e2e]">
                  <button
                    onClick={() => setEditingTemplate(template)}
                    className="flex-1 py-2 text-sm text-zinc-400 hover:text-white hover:bg-[#252525] flex items-center justify-center gap-1 transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                    Edit
                  </button>
                  <div className="w-px bg-[#2e2e2e]" />
                  <button
                    onClick={() => handleDelete(template)}
                    className="flex-1 py-2 text-sm text-zinc-400 hover:text-red-400 hover:bg-[#252525] flex items-center justify-center gap-1 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {templates.filter(t => !defaultIds.includes(t.id)).length === 0 && (
        <div className="text-center py-6 text-zinc-500">
          <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p>No custom templates yet</p>
          <p className="text-sm">Tap + to create your first one!</p>
        </div>
      )}
    </div>
  );
}

// Edit Template View
function EditTemplateView({ template, isNew, onSave, onCancel }: {
  template: WorkoutTemplate;
  isNew: boolean;
  onSave: (template: WorkoutTemplate) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template.name);
  const [exercises, setExercises] = useState(template.exercises);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const allExercises = storage.getExercises();
  
  const addExercise = (exercise: { id: string; name: string }) => {
    setExercises([...exercises, {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      defaultSets: 3,
      defaultReps: 10,
    }]);
    setShowExercisePicker(false);
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
    if (!name.trim()) {
      alert('Please enter a template name');
      return;
    }
    if (exercises.length === 0) {
      alert('Please add at least one exercise');
      return;
    }
    
    onSave({
      ...template,
      name: name.trim(),
      exercises,
    });
  };
  
  // Group exercises by muscle group for picker
  const exercisesByGroup = allExercises.reduce((acc, ex) => {
    if (!acc[ex.muscleGroup]) acc[ex.muscleGroup] = [];
    acc[ex.muscleGroup].push(ex);
    return acc;
  }, {} as Record<string, typeof allExercises>);

  if (showExercisePicker) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-4">
          <button onClick={() => setShowExercisePicker(false)} className="p-2 -ml-2 text-zinc-400">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold">Add Exercise</h1>
        </div>
        
        {Object.entries(exercisesByGroup).map(([group, groupExercises]) => (
          <div key={group} className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl overflow-hidden">
            <div className="px-4 py-2 border-b border-[#2e2e2e] bg-[#252525]">
              <span className="text-sm font-medium capitalize">{group}</span>
            </div>
            <div className="divide-y divide-[#2e2e2e]">
              {groupExercises.map(ex => {
                const alreadyAdded = exercises.some(e => e.exerciseId === ex.id);
                return (
                  <button
                    key={ex.id}
                    onClick={() => !alreadyAdded && addExercise(ex)}
                    disabled={alreadyAdded}
                    className={`w-full px-4 py-3 text-left flex items-center justify-between ${
                      alreadyAdded ? 'opacity-50' : 'hover:bg-[#252525]'
                    } transition-colors`}
                  >
                    <span className="text-sm">{ex.name}</span>
                    {alreadyAdded ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Plus className="w-4 h-4 text-zinc-500" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onCancel} className="p-2 -ml-2 text-zinc-400">
            <X className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold">{isNew ? 'New Template' : 'Edit Template'}</h1>
        </div>
        <button 
          onClick={handleSave}
          className="px-4 py-2 bg-orange-500 rounded-lg hover:bg-orange-400 flex items-center gap-2 transition-colors"
        >
          <Save className="w-4 h-4" />
          Save
        </button>
      </div>
      
      {/* Template Name */}
      <div>
        <label className="text-sm text-zinc-400 mb-1 block">Template Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Upper Body Day"
          className="w-full bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg px-4 py-3 focus:outline-none focus:border-orange-500"
        />
      </div>
      
      {/* Exercises */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm text-zinc-400">Exercises</label>
          <button
            onClick={() => setShowExercisePicker(true)}
            className="text-sm text-orange-400 flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
        
        {exercises.length === 0 ? (
          <div className="bg-[#1a1a1a] border border-dashed border-[#3e3e3e] rounded-xl p-6 text-center">
            <Dumbbell className="w-8 h-8 mx-auto mb-2 text-zinc-600" />
            <p className="text-sm text-zinc-500">No exercises yet</p>
            <button
              onClick={() => setShowExercisePicker(true)}
              className="mt-2 text-sm text-orange-400"
            >
              + Add your first exercise
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {exercises.map((ex, i) => (
              <div key={i} className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium">{ex.exerciseName}</span>
                  <button
                    onClick={() => removeExercise(i)}
                    className="text-zinc-500 hover:text-red-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="text-xs text-zinc-500 mb-1 block">Sets</label>
                    <input
                      type="number"
                      value={ex.defaultSets}
                      onChange={(e) => updateExercise(i, 'defaultSets', parseInt(e.target.value) || 1)}
                      min={1}
                      max={10}
                      className="w-full bg-[#252525] border border-[#3e3e3e] rounded-lg px-3 py-2 text-center"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-zinc-500 mb-1 block">Reps</label>
                    <input
                      type="number"
                      value={ex.defaultReps}
                      onChange={(e) => updateExercise(i, 'defaultReps', parseInt(e.target.value) || 1)}
                      min={1}
                      max={100}
                      className="w-full bg-[#252525] border border-[#3e3e3e] rounded-lg px-3 py-2 text-center"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Progress View
function ProgressView({ workouts, onBack }: {
  workouts: Workout[];
  onBack: () => void;
}) {
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const completedWorkouts = workouts.filter(w => w.completed && w.type !== 'rest');
  
  // Get all unique exercises from workout history
  const exerciseList = useMemo(() => {
    const exerciseMap = new Map<string, { id: string; name: string; sessionCount: number }>();
    completedWorkouts.forEach(workout => {
      workout.exercises.forEach(exercise => {
        const existing = exerciseMap.get(exercise.exerciseId);
        if (existing) {
          existing.sessionCount++;
        } else {
          exerciseMap.set(exercise.exerciseId, {
            id: exercise.exerciseId,
            name: exercise.exerciseName,
            sessionCount: 1,
          });
        }
      });
    });
    return Array.from(exerciseMap.values()).sort((a, b) => b.sessionCount - a.sessionCount);
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
              
              // PR is the highest weight lifted (with any reps)
              if (set.weight > prWeight) {
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
    const maxVolume = Math.max(...exerciseData.sessions.map(s => s.volume), 1);
    
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-4">
          <button onClick={() => setSelectedExercise(null)} className="p-2 -ml-2 text-zinc-400">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-lg font-bold truncate">{exerciseName}</h1>
        </div>

        {/* PR Card */}
        <div className="bg-gradient-to-br from-yellow-500/20 to-yellow-500/5 border border-yellow-500/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="w-5 h-5 text-yellow-400" />
            <span className="text-sm font-medium text-yellow-400">Personal Record</span>
          </div>
          <div className="text-3xl font-bold">{exerciseData.pr.weight}kg × {exerciseData.pr.reps}</div>
          {exerciseData.pr.date && (
            <div className="text-sm text-zinc-400 mt-1">
              {new Date(exerciseData.pr.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          )}
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-3 text-center">
            <div className="text-lg font-bold">{exerciseData.sessions.length}</div>
            <div className="text-xs text-zinc-500">Sessions</div>
          </div>
          <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-3 text-center">
            <div className="text-lg font-bold">{(exerciseData.totalVolume / 1000).toFixed(1)}t</div>
            <div className="text-xs text-zinc-500">Total Volume</div>
          </div>
          <div className={`border rounded-xl p-3 text-center ${
            exerciseData.trend === 'improving' ? 'bg-emerald-500/10 border-emerald-500/30' :
            exerciseData.trend === 'declining' ? 'bg-red-500/10 border-red-500/30' :
            'bg-[#1a1a1a] border-[#2e2e2e]'
          }`}>
            <div className={`text-lg font-bold ${
              exerciseData.trend === 'improving' ? 'text-emerald-400' :
              exerciseData.trend === 'declining' ? 'text-red-400' : ''
            }`}>
              {exerciseData.trend === 'improving' ? '↑' : exerciseData.trend === 'declining' ? '↓' : '→'}
            </div>
            <div className="text-xs text-zinc-500">Trend</div>
          </div>
        </div>

        {/* Volume Chart */}
        <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-4">
          <div className="text-sm font-medium mb-3">Volume per Session</div>
          <div className="flex items-end gap-1 h-32 overflow-x-auto">
            {exerciseData.sessions.slice(-15).map((session, i) => (
              <div key={i} className="flex-shrink-0 w-8 flex flex-col items-center gap-1">
                <div className="text-[10px] text-zinc-500 mb-1">{Math.round(session.volume)}</div>
                <div 
                  className="w-full bg-orange-500/70 rounded-t transition-all"
                  style={{ height: `${(session.volume / maxVolume) * 80}%`, minHeight: '4px' }}
                />
                <div className="text-[9px] text-zinc-600">
                  {new Date(session.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }).replace(' ', '\n')}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Sessions */}
        <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-4">
          <div className="text-sm font-medium mb-3">Recent Sessions</div>
          <div className="space-y-3">
            {exerciseData.sessions.slice(-5).reverse().map((session, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-[#2e2e2e] last:border-0">
                <div>
                  <div className="text-sm">{new Date(session.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                  <div className="text-xs text-zinc-500">
                    {session.sets.map(s => `${s.weight}kg×${s.reps}`).join(', ')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium">{session.maxWeight}kg</div>
                  <div className="text-xs text-zinc-500">{session.volume} vol</div>
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
        <button onClick={onBack} className="p-2 -ml-2 text-zinc-400">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">Progress</h1>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-orange-500/20 to-orange-500/5 border border-orange-500/20 rounded-xl p-4">
          <div className="text-2xl font-bold">{completedWorkouts.length}</div>
          <div className="text-sm text-zinc-400">Total Workouts</div>
        </div>
        <div className="bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
          <div className="text-2xl font-bold">{exerciseList.length}</div>
          <div className="text-sm text-zinc-400">Exercises Tracked</div>
        </div>
      </div>

      {/* Exercise List - tap to see details */}
      <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#2e2e2e]">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-orange-400" />
            <span className="text-sm font-medium">Exercise Progress</span>
          </div>
          <div className="text-xs text-zinc-500 mt-1">Tap an exercise to see detailed analysis</div>
        </div>
        <div className="divide-y divide-[#2e2e2e]">
          {exerciseList.length === 0 ? (
            <div className="px-4 py-8 text-center text-zinc-500">
              <Dumbbell className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <div>Complete workouts to see exercise progress</div>
            </div>
          ) : (
            exerciseList.slice(0, 20).map(exercise => (
              <button
                key={exercise.id}
                onClick={() => setSelectedExercise(exercise.id)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#252525] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
                    <Dumbbell className="w-4 h-4 text-orange-400" />
                  </div>
                  <span className="text-sm">{exercise.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">{exercise.sessionCount} sessions</span>
                  <ChevronRight className="w-4 h-4 text-zinc-500" />
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Empty State */}
      {completedWorkouts.length === 0 && (
        <div className="text-center py-8 text-zinc-500">
          <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Complete some workouts to see your progress!</p>
        </div>
      )}
    </div>
  );
}

// Settings View - Import/Export
function SettingsView({ onBack, onDataChange }: {
  onBack: () => void;
  onDataChange: () => void;
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
        <button onClick={onBack} className="p-2 -ml-2 text-zinc-400">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      {/* Import from Google Sheets */}
      <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <FileSpreadsheet className="w-5 h-5 text-green-400" />
          <span className="font-medium">Import from Google Sheets</span>
        </div>
        
        <p className="text-sm text-zinc-400 mb-4">
          Import your existing workout history from Google Sheets. The sheet must be publicly accessible (Anyone with link can view).
        </p>
        
        <p className="text-xs text-zinc-500 mb-4">
          Expected format: Date, Exercise, Set1 Reps, Set1 Weight, Set2 Reps, Set2 Weight, Set3 Reps, Set3 Weight, Volume
        </p>
        
        <input
          type="url"
          value={sheetsUrl}
          onChange={(e) => setSheetsUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          className="w-full bg-[#252525] border border-[#3e3e3e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-orange-500 mb-3"
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
      <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <Upload className="w-5 h-5 text-blue-400" />
          <span className="font-medium">Export to CSV</span>
        </div>
        
        <p className="text-sm text-zinc-400 mb-4">
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
              className="w-full h-32 bg-[#252525] border border-[#3e3e3e] rounded-lg px-3 py-2 text-xs font-mono text-zinc-300 resize-none"
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
      <div className="text-center text-xs text-zinc-500 space-y-1">
        <p>Zenith Fitness v{__APP_VERSION__}</p>
        <p>Built with ⚡ by Zenith</p>
      </div>
    </div>
  );
}

export default App;
