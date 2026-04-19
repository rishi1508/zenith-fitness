import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dumbbell, Calendar, TrendingUp, BarChart3,
  Flame, Settings, ClipboardList, Sun, Moon, PartyPopper, Users,
} from 'lucide-react';
import type { Workout, WorkoutTemplate, UserStats, WorkoutSession } from './types';
import * as storage from './storage';
import { UpdateChecker } from './UpdateChecker';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { SplashScreen, NavButton, WorkoutTimer, NotificationToast, GroupSessionBar, PostWorkoutComparison } from './components';
import { HistoryView, ProgressView, SettingsView, ExerciseManagerView, HomeView, ActiveWorkoutView, WeeklyPlansView, WeeklyOverviewView, ComparisonView, LoginView, AnalysisView, BuddyView, BuddyProfileView, BuddyChatView, SessionLobbyView, BuddyComparisonView } from './views';
import * as buddyService from './buddyService';
import * as sessionService from './workoutSessionService';
import { computeMyCompareStats } from './buddyComparison';
import { useAuth } from './auth/AuthContext';

type View = 'home' | 'workout' | 'history' | 'templates' | 'active' | 'progress' | 'settings' | 'exercises' | 'weekly' | 'compare' | 'analysis' | 'buddies' | 'buddy-profile' | 'buddy-chat' | 'buddy-compare' | 'session-lobby';
type Theme = 'dark' | 'light';

function App() {
  const { user, loading: authLoading, isGuest } = useAuth();
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
    try { return storage.getEffectiveTheme(); } 
    catch { return 'dark'; }
  });
  
  // Buddy view context (which buddy are we viewing / chatting with)
  const [buddyContext, setBuddyContext] = useState<{ uid: string; name: string; chatId?: string; photoURL?: string | null }>({ uid: '', name: '' });

  // Group workout session state
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [completedSession, setCompletedSession] = useState<WorkoutSession | null>(null);
  const sessionSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-theme check every minute when in auto mode
  useEffect(() => {
    const settings = storage.getThemeSettings();
    if (settings.mode !== 'auto') return;
    
    const checkTheme = () => {
      const effective = storage.getEffectiveTheme();
      if (effective !== theme) setTheme(effective);
    };
    
    const interval = setInterval(checkTheme, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [theme]);
  
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
    // If in active workout, pause instead of discarding
    if (view === 'active' && activeWorkout) {
      navigationHistory.current = ['home'];
      setView('home');
      return true;
    }
    if (navigationHistory.current.length > 1) {
      navigationHistory.current.pop(); // Remove current
      const previousView = navigationHistory.current[navigationHistory.current.length - 1];
      setView(previousView);
      return true;
    }
    return false; // No history, let app close
  }, [view, activeWorkout]);

  // Open a group workout session (used by buddy invites and notification toasts)
  const openSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    navigationHistory.current.push('session-lobby');
    setView('session-lobby');
  }, []);

  const loadData = useCallback(() => {
    // Rebuild PRs from workout history so stored records stay consistent with the
    // current max-weight-then-reps hierarchy (also heals records from older logic).
    storage.recomputePersonalRecords();
    setStats(storage.calculateStats());
    _setTemplates(storage.getTemplates()); // LEGACY
    setWorkoutHistory(storage.getWorkouts());
    // Check for missing days after splash
    const missing = storage.getMissingDays();
    setMissingDays(missing);
    
    // CRITICAL: Restore active workout if one was in progress (screen timeout fix)
    // Restored workout stays paused on home screen -- user can resume via banner
    try {
      const savedActiveWorkout = localStorage.getItem('zenith_active_workout');
      if (savedActiveWorkout) {
        const workout = JSON.parse(savedActiveWorkout);
        setActiveWorkout(workout);
        console.log('[Recovery] Restored active workout session (paused on home)');
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

  // Upsert public profile stats (including buddy-comparison snapshot) so
  // buddies can read them without needing raw workout access.
  const upsertMyProfileStats = useCallback(() => {
    if (!user) return;
    try {
      const freshStats = storage.calculateStats();
      const compareStats = computeMyCompareStats(
        storage.getWorkouts(),
        storage.getExercises(),
      );
      buddyService.upsertUserProfile(freshStats, compareStats);
    } catch (err) {
      console.error('[App] upsertMyProfileStats failed:', err);
    }
  }, [user]);

  // Sync profile on mount (so existing users update the new compareStats field
  // as soon as they open the updated app).
  useEffect(() => {
    upsertMyProfileStats();
  }, [upsertMyProfileStats]);

  // Listen for data refresh events from auth/sync layer
  // Profile upsert happens HERE (after sync) to avoid stale stats from previous account
  useEffect(() => {
    const handler = () => {
      loadData();
      upsertMyProfileStats();
    };
    window.addEventListener('zenith-data-refresh', handler);
    return () => window.removeEventListener('zenith-data-refresh', handler);
  }, [loadData, upsertMyProfileStats]);
  
  // CRITICAL: Persist active workout to localStorage on every change (screen timeout fix)
  // Also sync progress to Firestore when in a group session (debounced 2s)
  useEffect(() => {
    if (activeWorkout) {
      try {
        localStorage.setItem('zenith_active_workout', JSON.stringify(activeWorkout));
      } catch (e) {
        console.error('[Persist] Failed to save active workout:', e);
      }
      // Group session sync
      if (activeSessionId) {
        if (sessionSyncTimer.current) clearTimeout(sessionSyncTimer.current);
        sessionSyncTimer.current = setTimeout(() => {
          sessionService.syncProgress(activeSessionId, activeWorkout.exercises);
        }, 2000);
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
    // If there's already an active (paused) workout, ask to discard it first
    if (activeWorkout) {
      if (!confirm('You have an active workout in progress. Discard it and start a new one?')) {
        return;
      }
      // Clear the paused workout
      localStorage.removeItem('zenith_active_workout');
      setActiveWorkout(null);
    }

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

    // Notify buddies & set working-out status
    if (user) {
      buddyService.setWorkingOutStatus(true, workout.name, workout.startedAt);
      buddyService.notifyBuddiesWorkoutStarted(workout.name);
    }
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
      // Validate: every exercise must have at least one set with reps > 0
      const exercisesWithNoReps = activeWorkout.exercises.filter(ex =>
        !ex.sets.some(s => s.reps > 0)
      );
      if (exercisesWithNoReps.length > 0) {
        alert(`Please log at least one set for: ${exercisesWithNoReps.map(e => e.exerciseName).join(', ')}`);
        return;
      }

      const completedAt = new Date().toISOString();
      const duration = activeWorkout.startedAt
        ? Math.floor((Date.now() - new Date(activeWorkout.startedAt).getTime()) / 60000)
        : undefined;

      // Filter out empty sets (0 reps) and mark valid sets as completed
      const exercisesClean = activeWorkout.exercises.map(ex => ({
        ...ex,
        sets: ex.sets
          .filter(set => set.reps > 0)
          .map(set => ({
            ...set,
            completed: true,
          })),
      }));

      const finished = {
        ...activeWorkout,
        exercises: exercisesClean,
        completed: true,
        completedAt,
        duration,
      };
      storage.saveWorkout(finished);

      // Clear the persisted active workout (session is done)
      localStorage.removeItem('zenith_active_workout');

      // Clear working-out status for buddies + refresh public profile stats
      if (user) {
        buddyService.setWorkingOutStatus(false);
        upsertMyProfileStats();
      }

      // Complete group session if in one
      if (activeSessionId && duration) {
        sessionService.syncProgress(activeSessionId, finished.exercises);
        sessionService.completeSession(activeSessionId, duration).then(() => {
          // Listen for session completion to show comparison
          const unsub = sessionService.listenToSession(activeSessionId, (s) => {
            if (s && s.status === 'completed') {
              setCompletedSession(s);
              unsub();
            }
          });
          // Auto-cleanup listener after 30 min
          setTimeout(() => unsub(), 30 * 60 * 1000);
        });
      }

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

  const pauseWorkout = useCallback(() => {
    // Navigate to home but keep activeWorkout in state + localStorage
    navigationHistory.current = ['home'];
    setView('home');
  }, []);

  const discardWorkout = useCallback(() => {
    if (activeWorkout && confirm('Discard this workout? All progress will be lost.')) {
      // Clear the persisted active workout
      localStorage.removeItem('zenith_active_workout');
      setActiveWorkout(null);
      // Clear working-out status
      if (user) buddyService.setWorkingOutStatus(false);
      // Reset navigation history since we discarded
      navigationHistory.current = ['home'];
      setView('home');
    }
  }, [activeWorkout, user]);

  const handleBackfillRestDays = () => {
    storage.backfillRestDays(missingDays);
    setMissingDays([]);
    loadData();
  };

  const dismissMissingDays = () => {
    setMissingDays([]);
  };

  // Show splash while loading auth or data
  if (showSplash || authLoading) {
    return <SplashScreen />;
  }

  const isDark = theme === 'dark';

  // Show login if not authenticated and not in guest mode
  if (!user && !isGuest) {
    return <LoginView isDark={isDark} />;
  }
  
  return (
    <div className={`min-h-screen pb-20 transition-colors duration-300 ${isDark ? 'bg-[#0f0f0f] text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* Update Checker */}
      <UpdateChecker />
      {user && <NotificationToast onOpenSession={openSession} />}
      
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
            <div className="mb-2"><PartyPopper className="w-16 h-16 text-orange-400 mx-auto" /></div>
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
            workouts={workoutHistory}
            isDark={isDark}
            onStartWorkout={startWorkout}
            onViewHistory={() => navigateTo('history')}
            onManagePlans={() => navigateTo('templates')}
            activeWorkout={activeWorkout}
            onResumeWorkout={() => navigateTo('active')}
            onDiscardWorkout={discardWorkout}
          />
        )}
        {view === 'active' && activeWorkout && (
          <>
            {activeSessionId && <GroupSessionBar sessionId={activeSessionId} />}
            <ActiveWorkoutView
              workout={activeWorkout}
              onUpdate={saveActiveWorkout}
              onFinish={finishWorkout}
              onPause={pauseWorkout}
              onDiscard={discardWorkout}
            />
          </>
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
            onThemeChange={(newTheme) => setTheme(newTheme)}
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
        {view === 'analysis' && (
          <AnalysisView
            stats={stats}
            workouts={workoutHistory}
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
        {view === 'buddies' && (
          <BuddyView
            isDark={isDark}
            onBack={() => goBack()}
            onViewProfile={(uid, name, photoURL) => {
              setBuddyContext({ uid, name, photoURL });
              navigateTo('buddy-profile');
            }}
            onOpenChat={(chatId, name, photoURL) => {
              setBuddyContext((prev) => ({ ...prev, chatId, name, photoURL }));
              navigateTo('buddy-chat');
            }}
            onOpenSession={openSession}
          />
        )}
        {view === 'buddy-profile' && buddyContext.uid && (
          <BuddyProfileView
            buddyUid={buddyContext.uid}
            buddyName={buddyContext.name}
            isDark={isDark}
            onBack={() => goBack()}
            onOpenChat={(chatId, name) => {
              setBuddyContext((prev) => ({ ...prev, chatId, name, photoURL: prev.photoURL }));
              navigateTo('buddy-chat');
            }}
            onStartSession={(sessionId) => {
              setActiveSessionId(sessionId);
              navigateTo('session-lobby');
            }}
            onCompare={(uid, name, photoURL) => {
              setBuddyContext({ uid, name, photoURL });
              navigateTo('buddy-compare');
            }}
          />
        )}
        {view === 'buddy-compare' && buddyContext.uid && (
          <BuddyComparisonView
            buddyUid={buddyContext.uid}
            buddyName={buddyContext.name}
            buddyPhotoURL={buddyContext.photoURL}
            isDark={isDark}
            onBack={() => goBack()}
          />
        )}
        {view === 'buddy-chat' && buddyContext.chatId && (
          <BuddyChatView
            chatId={buddyContext.chatId}
            buddyUid={buddyContext.uid}
            buddyName={buddyContext.name}
            buddyPhotoURL={buddyContext.photoURL}
            isDark={isDark}
            onBack={() => goBack()}
            onStartSession={openSession}
          />
        )}
        {view === 'session-lobby' && activeSessionId && (
          <SessionLobbyView
            sessionId={activeSessionId}
            isDark={isDark}
            onBack={() => {
              setActiveSessionId(null);
              goBack();
            }}
            onSessionStart={(session) => {
              // Session started! Create workout from template and go to active view
              const template: WorkoutTemplate = {
                id: `session_${session.id}`,
                name: session.workoutName,
                type: session.workoutType,
                exercises: session.templateExercises,
              };
              startWorkout(template);
            }}
          />
        )}
      </main>

      {/* Post-Workout Group Comparison Modal */}
      {completedSession && (
        <PostWorkoutComparison
          session={completedSession}
          onClose={() => {
            setCompletedSession(null);
            setActiveSessionId(null);
          }}
        />
      )}

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
              icon={<BarChart3 />}
              label="Analysis"
              active={view === 'analysis'}
              onClick={() => navigateTo('analysis')}
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
            {!isGuest && (
              <NavButton
                icon={<Users />}
                label="Buddies"
                active={view === 'buddies' || view === 'buddy-profile' || view === 'buddy-chat'}
                onClick={() => navigateTo('buddies')}
              />
            )}
          </div>
        </nav>
      )}
    </div>
  );
}

export default App;
