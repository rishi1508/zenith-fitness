import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dumbbell, Calendar,
  Settings, ClipboardList, Sun, Moon, PartyPopper, Users, Layers, User as UserIcon,
} from 'lucide-react';
import type { Workout, WorkoutTemplate, UserStats, WorkoutSession } from './types';
import * as storage from './storage';
import { UpdateChecker } from './UpdateChecker';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { SplashScreen, NavButton, WorkoutTimer, NotificationToast, GroupSessionBar, PostWorkoutComparison } from './components';
import { HistoryView, ProgressView, SettingsView, ExerciseManagerView, HomeView, ActiveWorkoutView, WeeklyPlansView, WeeklyOverviewView, ComparisonView, LoginView, AnalysisView, BuddyView, BuddyProfileView, BuddyChatView, SessionLobbyView, BuddyComparisonView, ServicesView, BodyWeightView, CommonTemplatesView, ProfileLanding } from './views';
import * as buddyService from './buddyService';
import * as sessionService from './workoutSessionService';
import { computeMyCompareStats } from './buddyComparison';
import { flushPendingWrites } from './firestoreSync';
import { useAuth } from './auth/AuthContext';

type View = 'home' | 'workout' | 'history' | 'templates' | 'active' | 'progress' | 'settings' | 'exercises' | 'weekly' | 'compare' | 'analysis' | 'buddies' | 'buddy-profile' | 'buddy-chat' | 'buddy-compare' | 'session-lobby' | 'services' | 'body-weight' | 'common-templates' | 'profile';
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

  // Live counts of things that need the user's attention on the Buddies tab
  // (pending incoming requests + unread notifications) — drives the red badge
  // on the bottom nav.
  const [buddyAlertCount, setBuddyAlertCount] = useState(0);
  useEffect(() => {
    if (!user) { setBuddyAlertCount(0); return; }
    let reqs = 0;
    let notifs = 0;
    const update = () => setBuddyAlertCount(reqs + notifs);
    const unsubReqs = buddyService.listenToIncomingRequests((r) => {
      reqs = r.length;
      update();
    });
    const unsubNotifs = buddyService.listenToNotifications((n) => {
      notifs = n.length;
      update();
    });
    return () => { unsubReqs(); unsubNotifs(); };
  }, [user]);

  // Group workout session state
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [completedSession, setCompletedSession] = useState<WorkoutSession | null>(null);
  const [sessionMode, setSessionMode] = useState<'host' | 'participant' | null>(null);
  const [buddyProgress, setBuddyProgress] = useState<Map<string, { buddyName: string; weight: number; reps: number }>>(new Map());
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

  // Navigate with history tracking. Also pushes a browser history entry
  // so the Android/browser back button pops back INTO the app instead of
  // exiting the PWA.
  const navigateTo = useCallback((newView: View) => {
    if (newView !== view) {
      navigationHistory.current.push(newView);
      setView(newView);
      try { window.history.pushState({ zenith: navigationHistory.current.length }, ''); } catch { /* ignore */ }
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
    try { window.history.pushState({ zenith: navigationHistory.current.length }, ''); } catch { /* ignore */ }
  }, []);

  // Android / browser back button handler — intercepts popstate so the
  // PWA navigates within the app's own view stack instead of closing.
  useEffect(() => {
    // Seed a buffer state so the very first back press can be captured.
    try { window.history.pushState({ zenith: 'seed' }, ''); } catch { /* ignore */ }
    const onPop = () => {
      const handled = goBack();
      if (!handled) {
        // At the root view — keep the user in the app by refilling the
        // history buffer. (Intentional: user wants back-at-home to be a no-op
        // rather than closing the app.)
        try { window.history.pushState({ zenith: 'seed' }, ''); } catch { /* ignore */ }
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [goBack]);

  const loadData = useCallback(() => {
    // Fill in missed days with auto-rest so streaks reflect real consistency
    // (up to 7 days per gap). Idempotent so running on every mount is safe.
    storage.autoLogMissedRestDays();
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
      if (activeSessionId && activeWorkout.sessionId === activeSessionId) {
        if (sessionSyncTimer.current) clearTimeout(sessionSyncTimer.current);
        sessionSyncTimer.current = setTimeout(() => {
          sessionService.syncProgress(activeSessionId, activeWorkout.exercises);
        }, 2000);
      }
    }
  }, [activeWorkout, activeSessionId]);

  // When the host ends the session, every participant's app auto-saves their
  // in-progress workout so they don't lose what they logged.
  const finishWorkoutRef = useRef<((opts?: { skipValidation?: boolean; endSession?: boolean }) => void) | null>(null);
  useEffect(() => {
    if (!activeSessionId) return;
    const unsub = sessionService.listenToSession(activeSessionId, (s) => {
      if (!s) {
        setSessionMode(null);
        return;
      }
      // Determine host vs. participant for the current user
      if (user) {
        setSessionMode(s.hostUid === user.uid ? 'host' : 'participant');
      }
      if (s.status === 'completed' &&
          activeWorkout?.sessionId === activeSessionId &&
          !activeWorkout.completed) {
        finishWorkoutRef.current?.({ skipValidation: true });
      }
    });
    return unsub;
  }, [activeSessionId, activeWorkout, user]);

  // Listen to per-participant progress and compute each buddy's best set per
  // exercise (keyed by exercise name, case-insensitive). Used by ActiveWorkoutView
  // to show "Alice did 60kg × 10 reps" under the Last set line.
  useEffect(() => {
    if (!activeSessionId || !user) {
      setBuddyProgress(new Map());
      return;
    }
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const perBuddy = new Map<string, Map<string, { buddyName: string; weight: number; reps: number }>>();
    const recompute = () => {
      if (cancelled) return;
      const merged = new Map<string, { buddyName: string; weight: number; reps: number }>();
      for (const byName of perBuddy.values()) {
        for (const [k, v] of byName) {
          const existing = merged.get(k);
          if (!existing ||
              v.weight > existing.weight ||
              (v.weight === existing.weight && v.reps > existing.reps)) {
            merged.set(k, v);
          }
        }
      }
      setBuddyProgress(merged);
    };
    const setup = async () => {
      const unsubSession = sessionService.listenToSession(activeSessionId, (session) => {
        if (!session || cancelled) return;
        for (const [uid, p] of Object.entries(session.participants)) {
          if (uid === user.uid) continue;
          if (perBuddy.has(uid)) continue;
          const localMap = new Map<string, { buddyName: string; weight: number; reps: number }>();
          perBuddy.set(uid, localMap);
          const unsub = sessionService.listenToProgress(activeSessionId, uid, (progress) => {
            localMap.clear();
            if (progress) {
              for (const ex of progress.exercises) {
                let best: { weight: number; reps: number } | null = null;
                for (const s of ex.sets) {
                  if (!s.completed || s.weight <= 0 || s.reps <= 0) continue;
                  if (!best ||
                      s.weight > best.weight ||
                      (s.weight === best.weight && s.reps > best.reps)) {
                    best = { weight: s.weight, reps: s.reps };
                  }
                }
                if (best) {
                  localMap.set(ex.exerciseName.trim().toLowerCase(), {
                    buddyName: p.name,
                    weight: best.weight,
                    reps: best.reps,
                  });
                }
              }
            }
            recompute();
          });
          unsubs.push(unsub);
        }
      });
      unsubs.push(unsubSession);
    };
    setup();
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, [activeSessionId, user]);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('zenith_theme', theme); } catch {}
  }, [theme]);

  // Flush any in-flight localStorage → Firestore writes when the tab is
  // hidden / the app is closed, so edits made within the debounce window
  // aren't lost (which is what was eating exercise notes).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushPendingWrites();
    };
    const onBeforeUnload = () => { flushPendingWrites(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onBeforeUnload);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onBeforeUnload);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  const toggleTheme = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), []);

  // Keep a ref to the latest goBack so the Capacitor back-button handler
  // (registered only once, async) always uses the current closure instead of
  // an early-mount snapshot. The previous version re-registered the handler
  // every time goBack's identity changed AND threw away the cleanup function
  // returned from the async setup, so listeners piled up and stale ones
  // fired — which is why back was "closing the app": a stale goBack saw
  // navigationHistory=['home'] from first-paint, returned false, and we
  // called minimizeApp.
  const goBackRef = useRef(goBack);
  useEffect(() => { goBackRef.current = goBack; }, [goBack]);

  // Configure status bar and back button for Android — one-time setup.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cleanup: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: '#0f0f0f' });
        await StatusBar.show();
      } catch (e) {
        console.log('StatusBar setup error:', e);
      }

      try {
        const handler = await CapApp.addListener('backButton', () => {
          const handled = goBackRef.current?.();
          if (!handled) {
            // At root — keep the user in the app rather than minimize,
            // matching the "should not exit" expectation.
            // (CapApp.minimizeApp would send to background.)
          }
        });
        if (cancelled) {
          handler.remove();
        } else {
          cleanup = () => handler.remove();
        }
      } catch (e) {
        console.log('backButton listener failed:', e);
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const startWorkout = (template: WorkoutTemplate, sessionId?: string) => {
    // If there's already an active (paused) workout, ask to discard it first
    if (activeWorkout) {
      if (!confirm('You have an active workout in progress. Discard it and start a new one?')) {
        return;
      }
      // Clear the paused workout
      localStorage.removeItem('zenith_active_workout');
      setActiveWorkout(null);
    }

    // Starting a new PERSONAL workout (no sessionId) implies leaving any
    // prior group session context so the session bar doesn't bleed into
    // unrelated personal workouts.
    if (!sessionId && activeSessionId) {
      setActiveSessionId(null);
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
      ...(sessionId ? { sessionId } : {}),
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

  const finishWorkout: (opts?: { skipValidation?: boolean; endSession?: boolean }) => void = (opts) => {
    if (activeWorkout) {
      // Validate: every exercise must have at least one set with reps > 0 (unless auto-saved)
      if (!opts?.skipValidation) {
        const exercisesWithNoReps = activeWorkout.exercises.filter(ex =>
          !ex.sets.some(s => s.reps > 0)
        );
        if (exercisesWithNoReps.length > 0) {
          alert(`Please log at least one set for: ${exercisesWithNoReps.map(e => e.exerciseName).join(', ')}`);
          return;
        }
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
        sessionService.completeSession(activeSessionId, duration).then(async () => {
          // If the host is finishing, end the session for everyone.
          if (opts?.endSession) {
            try {
              await sessionService.finishSessionForAll(activeSessionId);
            } catch (e) {
              console.error('[Session] finishSessionForAll failed:', e);
            }
          }
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

  // Keep latest finishWorkout in a ref so the auto-save effect doesn't need to
  // re-subscribe every time the function identity changes.
  finishWorkoutRef.current = finishWorkout;

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
    <div className={`h-dvh flex flex-col overflow-hidden transition-colors duration-300 ${isDark ? 'bg-[#0f0f0f] text-white' : 'bg-gray-50 text-gray-900'}`}>
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
      <header className={`flex-none backdrop-blur-sm border-b px-4 z-10 transition-colors duration-300 ${isDark ? 'bg-[#0f0f0f]/95 border-[#2e2e2e]' : 'bg-white/95 border-gray-200'}`} style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)', paddingBottom: '12px' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* In-app icon = the app drawer icon from /public/icon.svg so
                they stay visually identical. */}
            <img src="/icon.svg" alt="" className="w-8 h-8 rounded-lg" />
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

      {/* Pinned group-session reminder — shown on every view EXCEPT the
          session's own active workout (where GroupSessionBar is rendered
          inline below) and personal workouts (where we hide it so it
          doesn't bleed into an unrelated session). */}
      {activeSessionId && view !== 'session-lobby' && !(view === 'active' && activeWorkout?.sessionId === activeSessionId) && !(view === 'active' && activeWorkout && activeWorkout.sessionId !== activeSessionId) && (
        <div className="px-4 pt-3">
          <GroupSessionBar
            sessionId={activeSessionId}
            showContinue
            onContinue={() => {
              if (activeWorkout?.sessionId === activeSessionId) {
                navigateTo('active');
              } else {
                navigateTo('session-lobby');
              }
            }}
          />
        </div>
      )}

      {/* Content */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 pb-24" style={{ overscrollBehavior: 'none' }}>
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
            {activeSessionId && activeWorkout.sessionId === activeSessionId && (
              <GroupSessionBar sessionId={activeSessionId} />
            )}
            <ActiveWorkoutView
              workout={activeWorkout}
              onUpdate={saveActiveWorkout}
              onFinish={() => finishWorkout({ endSession: sessionMode === 'host' })}
              onPause={pauseWorkout}
              onDiscard={discardWorkout}
              sessionMode={activeWorkout.sessionId === activeSessionId ? sessionMode : null}
              buddyProgress={activeWorkout.sessionId === activeSessionId ? buddyProgress : undefined}
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
        {view === 'services' && (
          <ServicesView
            isDark={isDark}
            onBack={() => goBack()}
            onOpenExerciseLibrary={() => navigateTo('exercises')}
            onOpenCommonTemplates={() => navigateTo('common-templates')}
            onOpenBodyWeight={() => navigateTo('body-weight')}
          />
        )}
        {view === 'body-weight' && (
          <BodyWeightView isDark={isDark} onBack={() => goBack()} />
        )}
        {view === 'common-templates' && (
          <CommonTemplatesView isDark={isDark} onBack={() => goBack()} />
        )}
        {view === 'profile' && (
          <ProfileLanding
            isDark={isDark}
            onViewAnalysis={() => navigateTo('analysis')}
            onViewProgress={() => navigateTo('progress')}
            onViewHistory={() => navigateTo('history')}
            stats={stats}
            workouts={workoutHistory}
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
              startWorkout(template, session.id);
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
              icon={<ClipboardList />}
              label="History"
              active={view === 'history'}
              onClick={() => navigateTo('history')}
            />
            <NavButton
              icon={<Layers />}
              label="Services"
              active={view === 'services' || view === 'body-weight' || view === 'common-templates' || view === 'exercises'}
              onClick={() => navigateTo('services')}
            />
            {!isGuest && (
              <NavButton
                icon={<Users />}
                label="Buddies"
                active={view === 'buddies' || view === 'buddy-profile' || view === 'buddy-chat' || view === 'buddy-compare'}
                onClick={() => navigateTo('buddies')}
                badge={buddyAlertCount}
              />
            )}
            <NavButton
              icon={<UserIcon />}
              label="Profile"
              active={view === 'profile' || view === 'analysis' || view === 'progress'}
              onClick={() => navigateTo('profile')}
            />
          </div>
        </nav>
      )}
    </div>
  );
}

export default App;
