import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { Calendar, PartyPopper, Trophy, TimerOff, Users, X } from 'lucide-react';
import type { Workout, WorkoutTemplate, UserStats, WorkoutSession } from './types';
import * as storage from './storage';
import { UpdateChecker } from './UpdateChecker';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  ACTIVITY_THROTTLE_MS, AUTO_FINISH_CHECK_MS, buildAutoFinishedWorkout, formatEndedAt,
  isIdlePastThreshold, lastActivityMs, participantIsActive,
} from './autoFinish';
import {
  SplashScreen, NotificationToast, GroupSessionBar, PostWorkoutComparison, OfflineBanner, OfflineGate,
  PushPermissionPrompt, SessionInviteBanner, WelcomeTour, BadgeUnlockModal,
} from './components';
import { tourSeen } from './tourState';
import { effectiveProfilePhoto } from './profilePhoto';
import { useElasticScroll } from './hooks/useElasticScroll';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { ActiveWorkoutView, LoginView } from './views';
import type { GymView, GymNavParams } from './views';
import { HomeTabView, TrainTabView, HealthTabView } from './views/tabs';
import { localDateISO as healthToday } from './health';
import type { MealSlot } from './types';
import { AppShell } from './shell/AppShell';
import { lazyNamed } from './lazyView';
import { Skeleton } from './ui';

// Lazy route chunks (docs: AUDIT 2026-09-07 batch 5). Tab roots, the active
// workout and login stay eager; everything below loads on first visit.
const HistoryView = lazyNamed(() => import('./views/HistoryView'), 'HistoryView');
const ProgressView = lazyNamed(() => import('./views/ProgressView'), 'ProgressView');
const SettingsView = lazyNamed(() => import('./views/SettingsView'), 'SettingsView');
const ExerciseManagerView = lazyNamed(() => import('./views/ExerciseManagerView'), 'ExerciseManagerView');
const WeeklyPlansView = lazyNamed(() => import('./views/WeeklyPlansView'), 'WeeklyPlansView');
const WeeklyOverviewView = lazyNamed(() => import('./views/WeeklyOverviewView'), 'WeeklyOverviewView');
const AnalysisView = lazyNamed(() => import('./views/AnalysisView'), 'AnalysisView');
const ComparisonView = lazyNamed(() => import('./views/ComparisonView'), 'ComparisonView');
const BuddyView = lazyNamed(() => import('./views/BuddyView'), 'BuddyView');
const BuddyChatView = lazyNamed(() => import('./views/BuddyChatView'), 'BuddyChatView');
const SessionLobbyView = lazyNamed(() => import('./views/SessionLobbyView'), 'SessionLobbyView');
const BuddyComparisonView = lazyNamed(() => import('./views/BuddyComparisonView'), 'BuddyComparisonView');
const BodyWeightView = lazyNamed(() => import('./views/BodyWeightView'), 'BodyWeightView');
const CommonTemplatesView = lazyNamed(() => import('./views/CommonTemplatesView'), 'CommonTemplatesView');
const BodyMeasurementsView = lazyNamed(() => import('./views/BodyMeasurementsView'), 'BodyMeasurementsView');
const JoinGymView = lazyNamed(() => import('./views/gym'), 'JoinGymView');
const GymHomeView = lazyNamed(() => import('./views/gym'), 'GymHomeView');
const CheckinView = lazyNamed(() => import('./views/gym'), 'CheckinView');
const ClassesView = lazyNamed(() => import('./views/gym'), 'ClassesView');
const ClassDetailView = lazyNamed(() => import('./views/gym'), 'ClassDetailView');
const AnnouncementsView = lazyNamed(() => import('./views/gym'), 'AnnouncementsView');
const MembershipView = lazyNamed(() => import('./views/gym'), 'MembershipView');
const GymDashboardView = lazyNamed(() => import('./views/gym'), 'GymDashboardView');
const GymOpsView = lazyNamed(() => import('./views/gym'), 'GymOpsView');
const MembersView = lazyNamed(() => import('./views/gym'), 'MembersView');
const MemberDetailView = lazyNamed(() => import('./views/gym'), 'MemberDetailView');
const CheckinConsoleView = lazyNamed(() => import('./views/gym'), 'CheckinConsoleView');
const GymLibraryView = lazyNamed(() => import('./views/gym'), 'GymLibraryView');
const GymPlansView = lazyNamed(() => import('./views/gym'), 'GymPlansView');
const ClassesManageView = lazyNamed(() => import('./views/gym'), 'ClassesManageView');
const GymSettingsView = lazyNamed(() => import('./views/gym'), 'GymSettingsView');
const CreateGymView = lazyNamed(() => import('./views/gym'), 'CreateGymView');
const ZenChatView = lazyNamed(() => import('./views/zen'), 'ZenChatView');
const InsightsView = lazyNamed(() => import('./views/zen'), 'InsightsView');
const NutritionTodayView = lazyNamed(() => import('./views/nutrition'), 'NutritionTodayView');
const FoodSearchView = lazyNamed(() => import('./views/nutrition'), 'FoodSearchView');
const TargetsView = lazyNamed(() => import('./views/nutrition'), 'TargetsView');
const FoodScanView = lazyNamed(() => import('./views/nutrition/scan'), 'FoodScanView');
const PhaseView = lazyNamed(() => import('./views/phase'), 'PhaseView');
const ActivityView = lazyNamed(() => import('./views/activity'), 'ActivityView');
const EnergyView = lazyNamed(() => import('./views/energy'), 'EnergyView');
const ProfileView = lazyNamed(() => import('./views/profile'), 'ProfileView');
const AdminGymsView = lazyNamed(() => import('./views/admin'), 'AdminGymsView');
const AdminUsersView = lazyNamed(() => import('./views/admin'), 'AdminUsersView');
const AdminLibraryView = lazyNamed(() => import('./views/admin'), 'AdminLibraryView');

function ViewFallback() {
  return (
    <div className="space-y-3 animate-fadeIn" aria-busy="true">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
import { tabRoot } from './shell/tabs';
import type { Tab } from './shell/tabs';
import { levelForVolume } from './levels';
import { feedback } from './feedback';
import { startActivityAutoSync } from './activity';
import { claimGymInvite } from './gymStaffHelpers';
import { syncBuddyFollows } from './followService';
import { installCaptureRestore } from './captureRestore';
import { PremiumGate } from './premium';
import type { RestoreOutcome } from './captureRestore';
import { refreshBadges } from './badgeSync';
import { badgeById } from './badges';
import type { BadgeDef } from './badges';
import { createPost, workoutSummary } from './gymFeed';
import { workoutEnergy } from './energy';
import { getHealthProfile } from './health';
import { recordBuddyInteraction } from './buddyAffinity';
import { LevelUpModal } from './components/LevelUpModal';
import * as buddyService from './buddyService';
import * as sessionService from './workoutSessionService';
import { templateFromWorkout, templatesEqual, reconcileWorkoutWithTemplate } from './sessionTemplateReconcile';
import { computeMyCompareStats } from './buddyComparison';
import { flushPendingWrites } from './firestoreSync';
import { autoRegisterPushIfNeeded, attachPushTapHandler } from './pushService';
import { consumeBack } from './backHandlerRegistry';
import { syncWorkoutToHealth } from './healthSync';
import { useAuth } from './auth/AuthContext';
import { useGym } from './gym/GymContext';

import { useToast, useConfirm } from './ui';
/** The screens an "add food" flow passes through — popped off the history
 *  once the food is in the diary (see `showDiary`). */
const ADD_FOOD_VIEWS = new Set<View>(['food-search', 'food-scan']);

export type View = 'home' | 'workout' | 'train' | 'health' | 'you' | 'history' | 'templates' | 'active' | 'progress' | 'settings' | 'exercises' | 'weekly' | 'compare' | 'analysis' | 'buddies' | 'buddy-profile' | 'buddy-chat' | 'buddy-compare' | 'session-lobby' | 'body-weight' | 'body-measurements' | 'common-templates' | 'insights' | 'zen' | GymView | 'admin-gyms' | 'admin-users' | 'admin-library' | 'nutrition' | 'food-search' | 'food-scan' | 'nutrition-targets' | 'activity' | 'energy' | 'phase' | 'profile';
export type Theme = 'dark' | 'light';

function App() {
  const { user, loading: authLoading, isGuest } = useAuth();
  const { gym, role: gymRole, loading: gymLoading, hasGymHint } = useGym();
  // While the gym is still loading, trust what this device remembers: adding
  // the My Gym tab 300 ms after launch shifted the whole bar under the thumb.
  const showGymTab = !!gym || (gymLoading && hasGymHint);
  const [view, setView] = useState<View>('home');
  // Nav params for the gym screens (which class / which member) — the
  // gym itself comes from useGym(), not from this state. See
  // docs/GYM_TIER_A_SPEC.md §6.1.
  const [gymNav, setGymNav] = useState<GymNavParams>({});
  // Follow-up prompt from a ZenCard daily note, consumed once by
  // ZenChatView after seeding its composer (see openZen below).
  const [zenPrefill, setZenPrefill] = useState<string | null>(null);
  // Pending "Level N unlocked" celebration, set by loadData after a workout.
  const [levelUp, setLevelUp] = useState<{ from: number; to: number; volume: number } | null>(null);
  // Shown once per device, after the first sign-in settles.
  const [showTour, setShowTour] = useState(false);
  /** Whose profile the `profile` route is showing. */
  const [profileUid, setProfileUid] = useState<string | null>(null);
  /** Badges earned just now, celebrated one after another. */
  const [unlocked, setUnlocked] = useState<BadgeDef[]>([]);
  // A self-uploaded avatar lives on the profile document, not in Auth
  // (src/profilePhoto.ts) — so the shell reads it from there.
  const [myPhoto, setMyPhoto] = useState<string | null>(() => effectiveProfilePhoto(null));
  useEffect(() => {
    const sync = () => setMyPhoto(effectiveProfilePhoto(user?.photoURL));
    sync();
    window.addEventListener('zenith-profile-photo', sync);
    return () => window.removeEventListener('zenith-profile-photo', sync);
  }, [user?.photoURL]);
  // The active workout is the one screen outside AppShell, so it needs its
  // own elastic scroll wiring.
  const activeScrollRef = useRef<HTMLElement>(null);
  const activeContentRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();
  const { confirm: confirmDialog } = useConfirm();
  // Which day/meal the food search or plate scan adds to (docs/HEALTH_SPEC.md §7).
  const [foodNav, setFoodNav] = useState<{ date: string; meal: MealSlot }>({ date: healthToday(), meal: 'snacks' });
  // True once this device has heard from the cloud for the signed-in user
  // (or knows there is no cloud to hear from). Gates first-run seeding.
  const syncSettledRef = useRef(false);
  // A photo that came back after Android recycled the app behind the camera
  // (src/captureRestore.ts). Held until auth settles, then routed.
  const [restoredCapture, setRestoredCapture] = useState<RestoreOutcome | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null);
  const [workoutHistory, setWorkoutHistory] = useState<Workout[]>([]);
  const [showSplash, setShowSplash] = useState(true);
  const [missingDays, setMissingDays] = useState<string[]>([]);
  // Banner shown after the idle auto-finish closed (or discarded) a
  // forgotten workout. Auto-dismisses.
  const [autoFinishNotice, setAutoFinishNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!autoFinishNotice) return;
    const t = setTimeout(() => setAutoFinishNotice(null), 12_000);
    return () => clearTimeout(t);
  }, [autoFinishNotice]);
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationData, setCelebrationData] = useState<{
    name: string;
    exercises: number;
    duration?: number;
    /** New all-time PRs achieved in this session. Computed at finish
     *  time by comparing each exercise's session-best to the snapshot
     *  of records from BEFORE the workout was saved. Surfaces here so
     *  even a typo'd-then-corrected set still gets celebrated when its
     *  final value beats the user's previous best. */
    prs?: Array<{ exercise: string; weight: number; reps: number; isFirstEver: boolean }>;
    /** Calories burned above resting, from src/energy.ts. */
    kcal?: number;
    /** True when the profile was too thin for a personalised figure. */
    kcalEstimated?: boolean;
    /** The saved session, so it can be shared to the gym feed from here. */
    workout?: Workout;
  } | null>(null);
  /** null = not offered yet, 'sharing' | 'shared' once the user has tapped. */
  const [shareState, setShareState] = useState<null | 'sharing' | 'shared'>(null);
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
    }, user.uid);
    return () => { unsubReqs(); unsubNotifs(); };
  }, [user]);

  // Group workout session state
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [completedSession, setCompletedSession] = useState<WorkoutSession | null>(null);
  const [sessionMode, setSessionMode] = useState<'host' | 'participant' | null>(null);
  // Per-exercise (lowercased) → array of buddies who've worked on
  // that exercise in the current session. We keep an ARRAY (not a
  // single buddy) so 3-person sessions correctly show "Rohit did
  // 15×10" AND "Sahil did 12×10" stacked under each set row, instead
  // of dropping the second buddy on merge.
  const [buddyProgress, setBuddyProgress] = useState<Map<string, Array<{ buddyName: string; sets: Array<{ weight: number; reps: number }> }>>>(new Map());
  const sessionSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounce handle for the host-only template broadcast — fast
  // (500ms) so participants see structural changes promptly without
  // hammering Firestore on every keystroke.
  const templateSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last seen `currentTemplateExercises` for the active session, used
  // by the participant-side reconcile to compute diffs against the
  // previous broadcast instead of re-applying the full template each
  // time a snapshot fires.
  const lastSeenTemplateRef = useRef<import('./types').TemplateExercise[] | null>(null);

  // Online/offline probe + "Proceed offline" acknowledgement. Once the
  // user dismisses the gate we don't show it again this session — they
  // can still reconnect via the thin banner.
  const { state: connState, retry: retryConnection } = useOnlineStatus();
  const [dismissedOfflineGate, setDismissedOfflineGate] = useState(false);

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

  // Navigate to a gym screen, stashing which class/member it's about
  // (the gym itself always comes from useGym()). Passed to every gym
  // view as `onNavigate`.
  const navigateToGym = useCallback((target: GymView, params?: GymNavParams) => {
    setGymNav(params ?? {});
    navigateTo(target);
  }, [navigateTo]);

  // Where every "add food" flow ends: the diary for that day, not the
  // screen you added from. Rewinds the history past the add screens so
  // back from the diary goes where the flow started, not into it again.
  const showDiary = useCallback((date: string) => {
    setFoodNav((n) => ({ ...n, date }));
    const history = navigationHistory.current;
    while (history.length > 1 && ADD_FOOD_VIEWS.has(history[history.length - 1])) history.pop();
    if (history[history.length - 1] !== 'nutrition') history.push('nutrition');
    setView('nutrition');
    try { window.history.pushState({ zenith: history.length }, ''); } catch { /* ignore */ }
  }, []);

  // Open Zen, optionally pre-filling the composer with a follow-up
  // prompt from a ZenCard daily note (src/views/zen/ZenChatView.tsx).
  const openZen = useCallback((prompt?: string) => {
    if (prompt) setZenPrefill(prompt);
    navigateTo('zen');
  }, [navigateTo]);

  // Tab tap → navigate to its root view and reset the history stack
  // (docs/REVAMP_SPEC.md §3), same pattern as the post-workout /
  // session-cancel resets elsewhere in this file.
  const navigateToTab = useCallback((tab: Tab) => {
    const root = tabRoot[tab];
    navigationHistory.current = [root];
    setView(root);
    try { window.history.pushState({ zenith: 1 }, ''); } catch { /* ignore */ }
  }, []);

  // Go back in navigation history
  const goBack = useCallback(() => {
    // If in active workout, pause instead of discarding
    if (view === 'active' && activeWorkout) {
      navigationHistory.current = ['home'];
      setView('home');
      return true;
    }
    if (navigationHistory.current.length > 1) {
      const current = navigationHistory.current.pop(); // Remove current
      const previousView = navigationHistory.current[navigationHistory.current.length - 1];
      // Profiles stack on top of profiles (followers → a person → their
      // followers…). The view name alone cannot say whose; keep the uids.
      if (current === 'profile') {
        profileStack.current.pop();
        if (previousView === 'profile') setProfileUid(profileStack.current[profileStack.current.length - 1] ?? null);
      }
      setView(previousView);
      return true;
    }
    return false; // No history, let app close
  }, [view, activeWorkout]);
  const profileStack = useRef<string[]>([]);

  // Open a group workout session (used by buddy invites and notification toasts)
  /** Anyone's face, anywhere, opens their profile. */
  const openProfile = useCallback((uid: string) => {
    profileStack.current.push(uid);
    setProfileUid(uid);
    navigationHistory.current.push('profile');
    setView('profile');
    try { window.history.pushState({ zenith: navigationHistory.current.length }, ''); } catch { /* ignore */ }
  }, []);

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
      // Give any open modal (e.g. StreakModal) first dibs. If one
      // absorbs the back press, don't also pop the view stack — just
      // refill the history buffer so the next back still fires popstate.
      if (consumeBack()) {
        try { window.history.pushState({ zenith: 'seed' }, ''); } catch { /* ignore */ }
        return;
      }
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
    // Which workout (if any) is in progress — read FIRST so the orphan
    // prune below never touches it.
    let savedActiveWorkout: Workout | null = null;
    try {
      const raw = localStorage.getItem('zenith_active_workout');
      if (raw) savedActiveWorkout = JSON.parse(raw) as Workout;
    } catch (e) {
      console.error('[Recovery] Failed to parse active workout:', e);
    }
    // saveActiveWorkout writes the in-progress workout into history on
    // every edit; a discarded / abandoned session used to leave that
    // `completed: false` copy behind as an empty History card.
    storage.pruneOrphanedIncompleteWorkouts(savedActiveWorkout?.id ?? null);
    // Fill in missed days with auto-rest so streaks reflect real consistency
    // (up to 7 days per gap). Idempotent so running on every mount is safe.
    storage.autoLogMissedRestDays();
    // Rebuild PRs from workout history so stored records stay consistent with the
    // current max-weight-then-reps hierarchy (also heals records from older logic).
    storage.recomputePersonalRecords();
    const freshStats = storage.calculateStats();
    setStats(freshStats);
    // Experience level (src/levels.ts). The first run after this shipped just
    // records where the user already is — nobody gets a burst of confetti for
    // history they logged months ago. After that, crossing a threshold shows
    // the achievement once.
    // Only once the cloud has been consulted: on a fresh device the first
    // pass runs on an empty log and used to seed "level 1", which the real
    // history then "beat" with confetti for months-old lifting.
    if (syncSettledRef.current) {
      const reached = levelForVolume(freshStats.totalVolume).level;
      const seen = storage.getSeenLevel();
      if (seen === 0) storage.setSeenLevel(reached);
      else if (reached > seen) {
        setLevelUp({ from: seen, to: reached, volume: freshStats.totalVolume });
        feedback('levelUp');
      }
    }
    // Badges are derived from exactly this data, so this is the moment to
    // re-check them (src/badgeSync.ts). New ones surface as a toast rather
    // than a modal — a badge is a nod, not an interruption.
    void refreshBadges().then((added) => {
      const defs = added.map(badgeById).filter((b): b is NonNullable<typeof b> => !!b);
      if (defs.length > 0) setUnlocked(defs);
    });
    setWorkoutHistory(storage.getWorkouts());
    // Check for missing days after splash
    const missing = storage.getMissingDays();
    setMissingDays(missing);
    
    // CRITICAL: Restore active workout if one was in progress (screen timeout fix)
    // Restored workout stays paused on home screen -- user can resume via
    // banner. The idle auto-finish effect runs as soon as this lands in
    // state, so a workout forgotten for days is closed right here.
    // `?? null` matters: App is never unmounted across a sign-out, so without
    // it the previous account's paused workout stayed in state and the next
    // account could resume and save it as their own.
    setActiveWorkout(savedActiveWorkout ?? null);
    if (savedActiveWorkout) {
      // If the saved workout was part of a buddy session, restore the
      // session id too. The existing session-status watcher will then
      // reattach: if the host ended / cancelled the session while we
      // were closed, the watcher's status='completed' branch saves
      // our workout to history (skipValidation), and the
      // status='cancelled' branch discards it.
      if (savedActiveWorkout.sessionId) {
        setActiveSessionId(savedActiveWorkout.sessionId);
      }
      console.log('[Recovery] Restored active workout session (paused on home)');
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
        freshStats.streakLevel ?? 1,
      );
      buddyService.upsertUserProfile(freshStats, compareStats);
    } catch (err) {
      console.error('[App] upsertMyProfileStats failed:', err);
    }
  }, [user]);

  // The public profile is written only AFTER the cloud pull (the refresh
  // event below) — on a fresh device the mount-time stats are all zeros and
  // used to overwrite a real profile with them.

  // Guests and signed-out visitors have nothing to pull: their local data is
  // the truth, so first-run seeding may proceed at once.
  useEffect(() => {
    if (authLoading || user) return;
    if (!syncSettledRef.current) { syncSettledRef.current = true; loadData(); }
  }, [authLoading, user, loadData]);

  // Listen for data refresh events from auth/sync layer
  // Profile upsert happens HERE (after sync) to avoid stale stats from previous account
  useEffect(() => {
    const handler = () => {
      syncSettledRef.current = true;
      loadData();
      upsertMyProfileStats();
      // A guest who signed in to an existing account: their guest log was set
      // aside rather than merged (src/auth/AuthContext.tsx parkGuestData).
      try {
        if (localStorage.getItem('zenith_device_guest_backup') && !sessionStorage.getItem('zenith_guest_backup_told')) {
          sessionStorage.setItem('zenith_guest_backup_told', '1');
          showToast('Your guest workouts were kept as a backup — Settings › Data & backup.', 'info');
        }
      } catch { /* ignore */ }
    };
    window.addEventListener('zenith-data-refresh', handler);
    return () => window.removeEventListener('zenith-data-refresh', handler);
  }, [loadData, upsertMyProfileStats, showToast]);

  // Everything that belongs to one account, cleared when the account changes.
  // App stays mounted across sign-out/sign-in, so state does not reset itself.
  const lastUidRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const uid = user?.uid ?? null;
    if (lastUidRef.current !== undefined && lastUidRef.current !== uid) {
      setActiveWorkout(null);
      setActiveSessionId(null);
      setCompletedSession(null);
      setBuddyContext({ uid: '', name: '' });
      setProfileUid(null);
      syncSettledRef.current = false;
    }
    lastUidRef.current = uid;
  }, [user]);
  
  // CRITICAL: Persist active workout to localStorage on every change (screen timeout fix)
  // Also sync progress to Firestore when in a group session (debounced 2s)
  // AND, if we're the host of an active session, broadcast our current
  // exercise list as the live template so non-host participants
  // reconcile their workouts with our changes (debounced 500ms).
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
        // Host-only template broadcast — fast (500ms) so participants
        // see structural changes promptly. We don't sync set values
        // (that's per-user via syncProgress); only the EXERCISE LIST
        // and per-exercise SET COUNT, derived via templateFromWorkout.
        if (sessionMode === 'host') {
          if (templateSyncTimer.current) clearTimeout(templateSyncTimer.current);
          templateSyncTimer.current = setTimeout(() => {
            sessionService.syncHostTemplate(
              activeSessionId,
              templateFromWorkout(activeWorkout),
            );
          }, 500);
        }
      }
    }
  }, [activeWorkout, activeSessionId, sessionMode]);

  // When the host ends the session, every participant's app auto-saves their
  // in-progress workout so they don't lose what they logged.
  const finishWorkoutRef = useRef<((opts?: { skipValidation?: boolean; endSession?: boolean }) => void) | null>(null);
  /** Session whose participants have already been credited with a shared workout. */
  const creditedSessionsRef = useRef<string | null>(null);
  // Same ref pattern for saveActiveWorkout so the session-listener's
  // closure (which fires from inside the host-template effect) always
  // calls the latest function instead of an early-mount snapshot.
  const saveActiveWorkoutRef = useRef<((workout: import('./types').Workout) => void) | null>(null);
  // Same reason: the session listener must be able to start a workout without
  // re-subscribing every time `startWorkout` or `activeWorkout` changes.
  const startWorkoutRef = useRef<((t: WorkoutTemplate, sessionId?: string) => void) | null>(null);
  const activeWorkoutRef = useRef<Workout | null>(null);
  const completedSessionRef = useRef<WorkoutSession | null>(null);
  useEffect(() => { completedSessionRef.current = completedSession; }, [completedSession]);
  useEffect(() => {
    if (!activeSessionId) {
      // Reset template snapshot when leaving a session so next attach
      // starts fresh (and a stale snapshot doesn't trigger phantom
      // diffs on the next session).
      lastSeenTemplateRef.current = null;
      return;
    }
    const unsub = sessionService.listenToSession(activeSessionId, (s) => {
      if (!s) {
        setSessionMode(null);
        return;
      }
      // Training together is the strongest "we actually interact" signal —
      // credit every other participant once per session (src/buddyAffinity.ts).
      if (s.status === 'active' && user && creditedSessionsRef.current !== activeSessionId) {
        creditedSessionsRef.current = activeSessionId;
        for (const uid of Object.keys(s.participants ?? {})) {
          if (uid !== user.uid) recordBuddyInteraction(uid, 'session');
        }
      }
      // Determine host vs. participant for the current user
      const iAmHost = !!user && s.hostUid === user.uid;
      if (user) {
        setSessionMode(iAmHost ? 'host' : 'participant');
      }

      // The host pressing Start has to start it for everyone, from wherever
      // they happen to be standing. Only the lobby used to react to this, so
      // a buddy who accepted from a toast and then wandered off just watched
      // nothing happen (reported 2026-09-09).
      if (s.status === 'active' && user && !iAmHost && !activeWorkoutRef.current) {
        startWorkoutRef.current?.({
          id: `session_${s.id}`,
          name: s.workoutName,
          type: s.workoutType,
          exercises: s.currentTemplateExercises ?? s.templateExercises,
        }, s.id);
      }
      // PARTICIPANT-SIDE: reconcile our workout when the host's live
      // template changes (they added/removed/swapped an exercise or
      // added/removed sets). Skip when WE are the host (our workout
      // IS the source of truth) and when the session is no longer
      // active (post-completion changes shouldn't mutate our workout).
      if (
        !iAmHost &&
        activeWorkoutRef.current?.sessionId === activeSessionId &&
        s.status === 'active' &&
        s.currentTemplateExercises
      ) {
        const prev = lastSeenTemplateRef.current ?? s.templateExercises ?? [];
        const next = s.currentTemplateExercises;
        if (!templatesEqual(prev, next)) {
          const reconciled = reconcileWorkoutWithTemplate(activeWorkoutRef.current, next, prev);
          if (reconciled) {
            // Use saveActiveWorkout to also persist + sync our progress.
            saveActiveWorkoutRef.current?.(reconciled);
          }
          lastSeenTemplateRef.current = next;
        }
      }
      // Pick up any custom exercises broadcast by other participants
      // during this session. We add them to the local library if
      // they're not already present (by id OR by case-insensitive
      // name). Without this, when a buddy creates a new exercise
      // mid-session we'd never see it locally — leading to either a
      // missing exercise referenced in their progress or, worse, the
      // user re-creating it with a different id and ending up with
      // duplicates.
      if (s.customExercises && s.customExercises.length > 0) {
        try {
          const local = storage.getExercises();
          const localIds = new Set(local.map((e) => e.id));
          const localNames = new Set(local.map((e) => e.name.trim().toLowerCase()));
          const toAdd = s.customExercises.filter(
            (e) => !localIds.has(e.id) && !localNames.has(e.name.trim().toLowerCase())
          );
          if (toAdd.length > 0) {
            storage.saveExercises([...local, ...toAdd]);
          }
        } catch (err) {
          console.warn('[Session] failed to merge custom exercises:', err);
        }
      }
      if (s.status === 'completed' &&
          activeWorkoutRef.current?.sessionId === activeSessionId &&
          !activeWorkoutRef.current.completed) {
        finishWorkoutRef.current?.({ skipValidation: true });
      }
      // Drive the post-workout comparison modal from here too, so we
      // don't need a second short-lived listener inside finishWorkout.
      if (s.status === 'completed' && !completedSessionRef.current) {
        setCompletedSession(s);
      }
      if (s.status === 'cancelled' &&
          activeWorkoutRef.current?.sessionId === activeSessionId) {
        // Host cancelled the session → drop our local workout (don't
        // save to history) and bounce back to home. Await the status
        // write so a quick app-close doesn't leave the public profile
        // stuck on "isWorkingOut: true".
        localStorage.removeItem('zenith_active_workout');
        setActiveWorkout(null);
        setActiveSessionId(null);
        if (user) {
          buddyService.setWorkingOutStatus(false)
            .catch((e) => console.warn('[Session] clear isWorkingOut failed:', e));
        }
        navigationHistory.current = ['home'];
        setView('home');
        showToast('The host cancelled this workout session.', 'info');
      }
    });
    return unsub;
  // Reads the live workout and the completed-session flag through refs, so a
  // set edit (which changes `activeWorkout` on every keystroke) does not tear
  // the Firestore listener down and re-attach it — a document read per
  // keystroke, and the whole host/participant decision re-run each time.
  }, [activeSessionId, user, showToast]);

  // Listen to per-participant progress and capture each buddy's full
  // ordered list of completed sets per exercise (keyed by exercise name,
  // case-insensitive). Used by ActiveWorkoutView to show "Alice did
  // 60kg × 10 reps" beside each of YOUR set rows — set N maps to buddy's
  // set N.
  //
  // For 3-person sessions we keep ALL buddies who logged data for an
  // exercise — the consumer renders one line per buddy below each set.
  // Earlier we kept only the first-seen buddy per exercise on merge,
  // which made the second buddy disappear from the per-set hint line.
  useEffect(() => {
    if (!activeSessionId || !user) {
      setBuddyProgress(new Map());
      return;
    }
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const perBuddy = new Map<string, Map<string, { buddyName: string; sets: Array<{ weight: number; reps: number }> }>>();
    const recompute = () => {
      if (cancelled) return;
      const merged = new Map<string, Array<{ buddyName: string; sets: Array<{ weight: number; reps: number }> }>>();
      for (const byName of perBuddy.values()) {
        for (const [k, v] of byName) {
          let bucket = merged.get(k);
          if (!bucket) {
            bucket = [];
            merged.set(k, bucket);
          }
          // Avoid duplicates if the same buddy somehow appears twice.
          if (!bucket.some((b) => b.buddyName === v.buddyName)) {
            bucket.push(v);
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
          const localMap = new Map<string, { buddyName: string; sets: Array<{ weight: number; reps: number }> }>();
          perBuddy.set(uid, localMap);
          const unsub = sessionService.listenToProgress(activeSessionId, uid, (progress) => {
            localMap.clear();
            if (progress) {
              for (const ex of progress.exercises) {
                const sets: Array<{ weight: number; reps: number }> = [];
                for (const s of ex.sets) {
                  // Only include sets the buddy has actually logged. We
                  // accept (completed) OR (reps > 0 & weight > 0) so the
                  // buddy's reps appear the moment they enter a value,
                  // even before they tap the checkmark.
                  if ((s.completed || s.reps > 0) && s.weight > 0) {
                    sets.push({ weight: s.weight, reps: s.reps });
                  }
                }
                if (sets.length > 0) {
                  localMap.set(ex.exerciseName.trim().toLowerCase(), {
                    buddyName: p.name,
                    sets,
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
    try { localStorage.setItem('zenith_theme', theme); } catch { /* storage unavailable (private mode) */ }
  }, [theme]);

  // Heartbeat → userProfile.lastActive every 45 s while the user is
  // signed in + a beat on every visibility change so buddies see the
  // online/offline dot flip quickly.
  useEffect(() => {
    if (!user) return;
    buddyService.touchHeartbeat();
    const interval = setInterval(() => buddyService.touchHeartbeat(), 45_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') buddyService.touchHeartbeat();
    };
    document.addEventListener('visibilitychange', onVis);
    // Self-heal push registration: if the user previously granted
    // permission but no token is saved (rule denial, cache clear, FCM
    // rotation, etc.), silently re-register now.
    autoRegisterPushIfNeeded().catch((err) => console.warn('[Push] auto-register error:', err));
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [user]);

  // Tap-to-open-chat: when the user taps an Android system push (or clicks
  // a web notification), pushService emits a `zenith-push-tap` CustomEvent
  // carrying { chatId, type, fromUid, fromName }. We route it here to the
  // matching chat view. Runs once per mount.
  useEffect(() => {
    const detach = attachPushTapHandler();
    const onTap = (e: Event) => {
      const detail = (e as CustomEvent<Record<string, string>>).detail || {};
      console.info('[Push] tap handler firing — routing detail:', detail);
      if (detail.type === 'chat_message' || detail.type === 'workout_invite') {
        if (detail.chatId && detail.fromUid) {
          setBuddyContext({
            uid: detail.fromUid,
            chatId: detail.chatId,
            name: detail.fromName || 'Buddy',
          });
          navigateTo('buddy-chat');
        } else {
          console.warn('[Push] tap missing chatId or fromUid — cannot open chat:', detail);
        }
      } else if (detail.type === 'session_invite' && detail.sessionId) {
        openSession(detail.sessionId);
      }
    };
    window.addEventListener('zenith-push-tap', onTap);
    return () => {
      window.removeEventListener('zenith-push-tap', onTap);
      detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        console.warn('StatusBar setup error:', e);
      }

      try {
        const handler = await CapApp.addListener('backButton', () => {
          // Any open modal (StreakModal, etc.) gets first dibs on the
          // Android hardware back press.
          if (consumeBack()) return;
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
        console.error('backButton listener failed:', e);
      }
    })();

    // The retained camera result, if this launch is a recreate. Registered
    // here, in the same one-time setup, so it is listening before the first
    // paint settles.
    const disposeRestore = installCaptureRestore(setRestoredCapture);

    return () => {
      cancelled = true;
      cleanup?.();
      disposeRestore();
    };
  }, []);

  // Route the restored photo once we know who is signed in — navigating
  // before that would be undone by the first-paint routing.
  useEffect(() => {
    if (!restoredCapture || authLoading || !user) return;
    const { purpose, extra, ok } = restoredCapture;
    setRestoredCapture(null);
    if (!ok) {
      showToast('Android closed Zenith while the camera was open, so that photo was lost. Try again.', 'error');
      return;
    }
    if (purpose === 'food-scan') {
      if (extra?.date && extra?.meal) setFoodNav({ date: extra.date, meal: extra.meal as MealSlot });
      navigateTo('food-scan');
    } else {
      // Feed and announcement composers live under the My Gym tab; the
      // screen picks the photo up with consumeRestoredPhoto on mount.
      navigateTo('gym-home');
    }
    showToast('Picked your photo back up after Android restarted the app.');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- navigateTo/showToast are stable callbacks
  }, [restoredCapture, authLoading, user]);

  const startWorkout = async (template: WorkoutTemplate, sessionId?: string) => {
    // Already running this session's workout — the lobby can call us again
    // on a re-render; just show it instead of asking to discard it.
    if (sessionId && activeWorkout?.sessionId === sessionId) {
      navigateTo('active');
      return;
    }
    // If there's already an active (paused) workout, ask to discard it first
    if (activeWorkout) {
      if (!(await confirmDialog({ title: 'Discard current workout?', message: 'You have an active workout in progress. Discard it and start a new one?', confirmLabel: 'Discard', tone: 'danger' }))) {
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
      lastActivityAt: new Date().toISOString(),
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
    // Every edit is an interaction — restarts the idle auto-finish clock.
    const stamped: Workout = { ...workout, lastActivityAt: new Date().toISOString() };
    storage.saveWorkout(stamped);
    setActiveWorkout(stamped);
  };
  saveActiveWorkoutRef.current = saveActiveWorkout;

  // One-shot guard: prevents finishing the same workout twice. Matters
  // in the session flow where the host's manual finishWorkout AND the
  // status='completed' listener can both fire back-to-back and
  // double-save the workout to history. Reset whenever a new activeWorkout
  // is started.
  const finishedOnceRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeWorkout && finishedOnceRef.current !== activeWorkout.id) {
      finishedOnceRef.current = null;
    }
  }, [activeWorkout]);

  const finishWorkout: (opts?: { skipValidation?: boolean; endSession?: boolean }) => void = (opts) => {
    if (activeWorkout) {
      if (finishedOnceRef.current === activeWorkout.id) return; // already saved
      finishedOnceRef.current = activeWorkout.id;
      // Validate: every exercise must have at least one set with reps > 0 (unless auto-saved)
      if (!opts?.skipValidation) {
        const exercisesWithNoReps = activeWorkout.exercises.filter(ex =>
          !ex.sets.some(s => s.reps > 0)
        );
        if (exercisesWithNoReps.length > 0) {
          showToast(`Log at least one set for: ${exercisesWithNoReps.map(e => e.exerciseName).join(', ')}`, 'error');
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

      // Snapshot the user's PRs from BEFORE we save the workout. Since
      // we no longer persist PRs mid-session (see ActiveWorkoutView's
      // updateSet), this snapshot reflects the user's true historical
      // best — independent of any in-session typos.
      const preSessionRecords = storage.getPersonalRecords();
      const preSessionPRMap = new Map<string, { weight: number; reps: number }>();
      for (const r of preSessionRecords) {
        preSessionPRMap.set(r.exerciseId, { weight: r.weight, reps: r.reps });
        preSessionPRMap.set(r.exerciseName.trim().toLowerCase(), { weight: r.weight, reps: r.reps });
      }
      // Compute session-best per exercise from the FINAL (cleaned) set
      // data and identify which ones beat the snapshot. This is what
      // gets shown in the celebration screen.
      const sessionPRs: Array<{ exercise: string; weight: number; reps: number; isFirstEver: boolean }> = [];
      for (const ex of exercisesClean) {
        let best: { weight: number; reps: number } | null = null;
        for (const s of ex.sets) {
          if (!s.completed || s.weight <= 0 || s.reps <= 0) continue;
          if (!best || s.weight > best.weight || (s.weight === best.weight && s.reps > best.reps)) {
            best = { weight: s.weight, reps: s.reps };
          }
        }
        if (!best) continue;
        const prev = preSessionPRMap.get(ex.exerciseId)
          ?? preSessionPRMap.get(ex.exerciseName.trim().toLowerCase());
        const isPR = !prev
          || best.weight > prev.weight
          || (best.weight === prev.weight && best.reps > prev.reps);
        if (isPR) {
          sessionPRs.push({
            exercise: ex.exerciseName,
            weight: best.weight,
            reps: best.reps,
            isFirstEver: !prev,
          });
        }
      }

      if (!storage.saveWorkout(finished)) {
        // Storage refused (full). The active workout stays exactly where it
        // is; a celebration for a session that was written nowhere is worse
        // than an error.
        showToast('Could not save this workout — the device is out of storage. Free some space and try Finish again.', 'error');
        return;
      }
      // Now that the workout is in history, rebuild PR records from
      // scratch. Idempotent — and crucially this is the ONLY place that
      // writes records in the active-session flow. Earlier we'd persist
      // a PR on every set completion, so a typo'd 150kg×10 became the
      // record and a corrected 15kg×10 silently failed to update it.
      storage.recomputePersonalRecords();

      // Fire-and-forget push to iOS HealthKit / Android Health Connect
      // when the user has enabled sync. No-op on web or when the plugin
      // isn't installed.
      syncWorkoutToHealth(finished).catch(() => { /* best-effort */ });

      // Clear the persisted active workout (session is done)
      localStorage.removeItem('zenith_active_workout');

      // Clear working-out status for buddies + refresh public profile stats
      if (user) {
        buddyService.setWorkingOutStatus(false);
        upsertMyProfileStats();
      }

      // Complete group session if in one. We DON'T spin up a new listener
      // here — the top-level session-status effect (further up in App.tsx)
      // already watches status='completed' / 'cancelled' for auto-save &
      // auto-cancel. It sets `completedSession` for the post-workout
      // comparison, which avoids the 30-min setTimeout leak we had
      // before.
      if (activeSessionId && duration !== undefined) {
        sessionService.syncProgress(activeSessionId, finished.exercises);
        sessionService.completeSession(activeSessionId, duration)
          .catch((err) => console.error('[Session] completeSession failed:', err))
          .then(async () => {
            if (opts?.endSession) {
              try {
                await sessionService.finishSessionForAll(activeSessionId);
              } catch (e) {
                console.error('[Session] finishSessionForAll failed:', e);
              }
            }
          });
      }

      // Calories burned, priced per exercise from its MET and the user's own
      // resting rate (src/energy.ts) — a headline number, not a footnote.
      const burn = workoutEnergy(
        { exercises: exercisesClean, duration },
        {
          profile: getHealthProfile(),
          weightKg: storage.getLatestBodyWeight()?.weight ?? 0,
          library: storage.getExercises(),
        },
      );

      // Show celebration
      setCelebrationData({
        name: activeWorkout.name,
        exercises: activeWorkout.exercises.length,
        duration,
        prs: sessionPRs,
        kcal: burn.activeKcal > 0 ? burn.activeKcal : undefined,
        kcalEstimated: burn.estimated,
        workout: finished,
      });
      setShareState(null);
      setShowCelebration(true);
      feedback('workoutComplete');
      
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

  // ---- Idle auto-finish (see src/autoFinish.ts) ----

  /** Close an idle workout as of `endedAt` (the last interaction). */
  const autoFinishWorkout = (workout: Workout, endedAt: string, inSession: boolean) => {
    if (finishedOnceRef.current === workout.id) return;
    finishedOnceRef.current = workout.id;

    const finished = buildAutoFinishedWorkout(workout, endedAt);
    const endedLabel = formatEndedAt(endedAt);
    localStorage.removeItem('zenith_active_workout');

    if (finished) {
      storage.saveWorkout(finished);
      storage.recomputePersonalRecords();
      syncWorkoutToHealth(finished).catch(() => { /* best-effort */ });
      setAutoFinishNotice(`"${workout.name}" was finished for you — no activity since ${endedLabel}.`);
    } else {
      // Nothing logged: drop it (and the incomplete copy in history)
      // rather than save an empty workout.
      storage.deleteWorkout(workout.id);
      setAutoFinishNotice(`An empty workout from ${endedLabel} was discarded — no sets were logged.`);
    }

    if (inSession && workout.sessionId) {
      const sid = workout.sessionId;
      const duration = finished?.duration ?? 0;
      (async () => {
        try {
          if (finished) await sessionService.syncProgress(sid, finished.exercises);
          await sessionService.completeSession(sid, duration);
          // Everyone is idle (checked by the caller) → close the session
          // so the other participants' apps save their workouts too.
          await sessionService.endSessionIdle(sid, endedAt);
        } catch (err) {
          console.error('[AutoFinish] session wrap-up failed:', err);
        }
      })();
    }

    if (user) {
      buddyService.setWorkingOutStatus(false).catch(() => { /* best-effort */ });
      upsertMyProfileStats();
    }
    setActiveWorkout(null);
    loadData();
    if (view === 'active') {
      navigationHistory.current = ['home'];
      setView('home');
    }
  };

  /**
   * Decide whether the open workout has been idle long enough. For a
   * group session, also require every OTHER active participant to be
   * idle — one buddy still lifting keeps the session (and our workout)
   * open; we simply re-check a minute later.
   */
  const autoFinishInFlightRef = useRef(false);
  const checkIdleAutoFinish = async () => {
    if (!activeWorkout || autoFinishInFlightRef.current) return;
    if (!isIdlePastThreshold(activeWorkout)) return;
    autoFinishInFlightRef.current = true;
    try {
      const inSession = !!activeWorkout.sessionId && activeSessionId === activeWorkout.sessionId;
      if (inSession && activeWorkout.sessionId) {
        let session: WorkoutSession | null = null;
        try {
          session = await sessionService.getSession(activeWorkout.sessionId);
        } catch (err) {
          console.warn('[AutoFinish] could not read session, retrying later:', err);
          return;
        }
        if (session && session.status !== 'active') {
          // Completed / cancelled elsewhere → the session listener
          // saves or discards our workout; nothing to do here.
          return;
        }
        if (session) {
          const othersActive = Object.values(session.participants).some(
            (p) => p.uid !== user?.uid && participantIsActive(p, session!.startedAt),
          );
          if (othersActive) return;
        }
      }
      autoFinishWorkout(activeWorkout, new Date(lastActivityMs(activeWorkout)).toISOString(), inSession);
    } finally {
      autoFinishInFlightRef.current = false;
    }
  };
  useEffect(() => {
    if (authLoading || (!user && !isGuest)) return;
    if (!tourSeen()) setShowTour(true);
  }, [authLoading, user, isGuest]);

  // Buddies made before following existed still count as follows, and each
  // side can only write its own edge — so catch up once a day.
  useEffect(() => {
    if (!user) return;
    const unsub = buddyService.listenToBuddies((rels) => {
      const others = rels.map((r) => r.users.find((u) => u !== user.uid)).filter((u): u is string => !!u);
      void syncBuddyFollows(others);
    });
    return unsub;
  }, [user]);

  // A membership a gym set up before this person had an account: claim it on
  // the first sign-in with that email (src/gymStaffHelpers.ts).
  useEffect(() => {
    if (!user?.email) return;
    void claimGymInvite().then((gymId) => {
      if (gymId) showToast('You have been added to your gym.');
    });
  }, [user?.email, showToast]);

  // Health Connect keeps itself current in the background — the energy
  // ledger reads steps and sleep from the cache on every screen, not just
  // the Activity one (src/activity/autoSync.ts).
  useEffect(() => {
    if (!user) return;
    return startActivityAutoSync();
  }, [user]);

  useElasticScroll(activeScrollRef, activeContentRef, view === 'active');

  startWorkoutRef.current = startWorkout;
  activeWorkoutRef.current = activeWorkout;

  const checkIdleAutoFinishRef = useRef(checkIdleAutoFinish);
  checkIdleAutoFinishRef.current = checkIdleAutoFinish;

  // Run the idle check: right away (covers the restore-on-launch case),
  // every minute while the app is open, and whenever it returns to the
  // foreground (tab visible / Capacitor appStateChange).
  useEffect(() => {
    if (!activeWorkout) return;
    let cancelled = false;
    const check = () => { if (!cancelled) void checkIdleAutoFinishRef.current(); };
    check();
    const interval = setInterval(check, AUTO_FINISH_CHECK_MS);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    let capHandle: PluginListenerHandle | null = null;
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) check(); })
        .then((h) => { if (cancelled) h.remove(); else capHandle = h; })
        .catch((e) => console.warn('[AutoFinish] appStateChange listener failed:', e));
    }
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
      capHandle?.remove();
    };
    // Re-arm per workout, not per edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkout?.id]);

  // Any tap / key press while a workout is open counts as "active in the
  // app" — restarts the idle clock (throttled) so someone browsing
  // History mid-session isn't auto-finished. In a group session we also
  // stamp our participant entry so buddies' clients see us as active.
  const lastActivityStampRef = useRef(0);
  useEffect(() => {
    if (!activeWorkout) return;
    const sessionId = activeWorkout.sessionId && activeSessionId === activeWorkout.sessionId
      ? activeWorkout.sessionId : null;
    const onInteract = () => {
      const now = Date.now();
      if (now - lastActivityStampRef.current < ACTIVITY_THROTTLE_MS) return;
      lastActivityStampRef.current = now;
      const iso = new Date(now).toISOString();
      setActiveWorkout((w) => (w ? { ...w, lastActivityAt: iso } : w));
      if (sessionId) sessionService.touchParticipantActivity(sessionId);
    };
    window.addEventListener('pointerdown', onInteract, { passive: true });
    window.addEventListener('keydown', onInteract);
    return () => {
      window.removeEventListener('pointerdown', onInteract);
      window.removeEventListener('keydown', onInteract);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkout?.id, activeWorkout?.sessionId, activeSessionId]);

  const pauseWorkout = useCallback(() => {
    // Navigate to home but keep activeWorkout in state + localStorage
    navigationHistory.current = ['home'];
    setView('home');
  }, []);

  const discardWorkout = useCallback(async () => {
    if (!activeWorkout) return;
    const tiedSessionId = activeWorkout.sessionId;
    const isSessionWorkout = tiedSessionId && activeSessionId === tiedSessionId;
    const prompt = isSessionWorkout && sessionMode === 'host'
      ? 'Cancel the group session? Everyone\'s progress will be discarded — this can\'t be undone.'
      : 'Discard this workout? All progress will be lost.';
    const isHostCancel = isSessionWorkout && sessionMode === 'host';
    if (!(await confirmDialog({ title: isHostCancel ? 'Cancel group session?' : 'Discard workout?', message: prompt, confirmLabel: isHostCancel ? 'Cancel session' : 'Discard', tone: 'danger' }))) return;

    if (isSessionWorkout && sessionMode === 'host') {
      // Host-only path: tear down the shared session so every
      // participant's app sees status='cancelled' and auto-discards.
      try {
        await sessionService.cancelSession(tiedSessionId!);
      } catch (err) {
        console.error('[Session] cancel failed:', err);
        showToast(`Couldn't cancel the session: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
        return;
      }
      setActiveSessionId(null);
    }

    localStorage.removeItem('zenith_active_workout');
    // Also drop the incomplete copy saveActiveWorkout put in history.
    storage.deleteWorkout(activeWorkout.id);
    setActiveWorkout(null);
    if (user) buddyService.setWorkingOutStatus(false);
    navigationHistory.current = ['home'];
    setView('home');
    loadData();
  }, [activeWorkout, activeSessionId, sessionMode, user, loadData, confirmDialog, showToast]);

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
      {/* Thin persistent banner when we're offline — sits above everything
          else and can't be dismissed (only fixed by reconnecting). */}
      <OfflineBanner state={connState} onRetry={retryConnection} />
      {/* First-launch gate: blocks UI until the user retries or
          explicitly chooses to proceed offline. */}
      {!dismissedOfflineGate && !(view === 'active' && activeWorkout) && (
        <OfflineGate
          state={connState}
          onRetry={retryConnection}
          onProceedOffline={() => setDismissedOfflineGate(true)}
        />
      )}
      {user && (
        <NotificationToast
          onOpenSession={openSession}
          onOpenChat={(uid, chatId, name) => {
            setBuddyContext((prev) => ({ ...prev, uid, chatId, name, photoURL: prev.photoURL }));
            navigateTo('buddy-chat');
          }}
          onOpenBuddies={() => navigateTo('buddies')}
        />
      )}
      {user && <PushPermissionPrompt userUid={user.uid} isDark={isDark} />}

      {/* Idle auto-finish notice */}
      {autoFinishNotice && (
        <div className="fixed left-4 right-4 z-[60] animate-fadeIn" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 64px)' }}>
          <div className={`rounded-xl p-3 shadow-lg flex items-start gap-3 border ${
            isDark ? 'bg-[#1a1a1a] border-orange-500/40 text-zinc-200' : 'bg-white border-orange-300 text-gray-800'
          }`}>
            <TimerOff className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">{autoFinishNotice}</div>
            <button onClick={() => setAutoFinishNotice(null)} className={isDark ? 'text-zinc-500 hover:text-white' : 'text-gray-400 hover:text-gray-700'} aria-label="Dismiss">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      
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
          <div className={`max-w-sm w-full rounded-2xl p-6 text-center space-y-4 ${isDark ? 'bg-[#1a1a1a]' : 'bg-white'} animate-fadeIn max-h-[90vh] overflow-y-auto`}>
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
              {celebrationData.kcal !== undefined && (
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-400">{celebrationData.kcal}</div>
                  <div className="text-xs text-zinc-500">kcal burned</div>
                </div>
              )}
              {celebrationData.prs && celebrationData.prs.length > 0 && (
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-400">{celebrationData.prs.length}</div>
                  <div className="text-xs text-zinc-500">{celebrationData.prs.length === 1 ? 'PR' : 'PRs'}</div>
                </div>
              )}
            </div>

            {celebrationData.prs && celebrationData.prs.length > 0 && (
              <div className={`rounded-xl border p-3 text-left ${
                isDark ? 'bg-yellow-500/5 border-yellow-500/25' : 'bg-yellow-50 border-yellow-300'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  <Trophy className="w-4 h-4 text-yellow-500" />
                  <div className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-yellow-300' : 'text-yellow-700'}`}>
                    New Personal Records
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {celebrationData.prs.map((pr) => (
                    <li key={pr.exercise} className="flex items-center justify-between text-sm">
                      <span className={`truncate ${isDark ? 'text-zinc-200' : 'text-gray-800'}`}>
                        {pr.exercise}
                        {pr.isFirstEver && (
                          <span className={`ml-1.5 text-[10px] uppercase tracking-wider ${isDark ? 'text-yellow-300/80' : 'text-yellow-600'}`}>
                            first
                          </span>
                        )}
                      </span>
                      <span className={`font-mono font-semibold ${isDark ? 'text-yellow-300' : 'text-yellow-700'}`}>
                        {pr.weight}kg × {pr.reps}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Offer the gym feed here, where the session is fresh — but
                only ever as an offer: nothing posts on its own. */}
            {gym && celebrationData.workout && (
              <button
                onClick={() => {
                  const workout = celebrationData.workout;
                  if (!workout || shareState) return;
                  setShareState('sharing');
                  createPost(gym.id, { workout: workoutSummary(workout, celebrationData.prs?.length ?? 0) })
                    .then(() => { setShareState('shared'); showToast(`Shared with ${gym.name}`); })
                    .catch(() => { setShareState(null); showToast('Could not share that — try the Feed tab.', 'error'); });
                }}
                disabled={shareState !== null}
                className={`w-full py-3 rounded-xl font-medium border transition-colors flex items-center justify-center gap-2 ${
                  shareState === 'shared'
                    ? 'border-emerald-500/40 text-emerald-400'
                    : isDark ? 'border-[#3e3e3e] text-zinc-200 hover:bg-[#252525]' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                } disabled:opacity-70`}
              >
                <Users className="w-4 h-4" />
                {shareState === 'shared' ? `Shared with ${gym.name}`
                  : shareState === 'sharing' ? 'Sharing…'
                    : `Share with ${gym.name}`}
              </button>
            )}

            <button
              onClick={() => setShowCelebration(false)}
              className="w-full py-3 rounded-xl font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity"
            >
              Continue
            </button>
          </div>
        </div>
      )}
      
      {view === 'active' && activeWorkout ? (
        <>
          {/* The active workout is the one view rendered outside AppShell, so
              it has to provide what the shell normally does: the status-bar
              inset (the same expression AppBar uses — without it the header
              sat under the notch) and a scroll region, because the app root is
              `h-dvh … overflow-hidden`. Without the latter the exercise list is
              clipped at the first screen and the rest of the workout is
              unreachable (reported 2026-09-08: "only shows the first
              exercise"). */}
          <div
            className="flex-1 flex flex-col min-h-0"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 18px)' }}
          >
            {activeSessionId && activeWorkout.sessionId === activeSessionId && (
              <GroupSessionBar sessionId={activeSessionId} isDark={isDark} />
            )}
            <main
              ref={activeScrollRef}
              className="flex-1 overflow-y-auto overflow-x-hidden px-5"
              style={{ overscrollBehavior: 'none', overflowAnchor: 'none' }}
            >
              <div ref={activeContentRef} className="mx-auto w-full lg:max-w-[760px] lg:py-6">
              <ActiveWorkoutView
                workout={activeWorkout}
                onUpdate={saveActiveWorkout}
                onFinish={() => finishWorkout({ endSession: sessionMode === 'host' })}
                onPause={pauseWorkout}
                onDiscard={discardWorkout}
                sessionMode={activeWorkout.sessionId === activeSessionId ? sessionMode : null}
                buddyProgress={activeWorkout.sessionId === activeSessionId ? buddyProgress : undefined}
                />
              </div>
            </main>
          </div>
        </>
      ) : (
      <AppShell
        view={view}
        onTabChange={navigateToTab}
        hasGym={showGymTab}
        gymName={gym?.name}
        isGymOwner={gymRole === 'owner'}
        firstName={user?.displayName?.split(' ')[0] || 'Champ'}
        stats={stats}
        isDark={isDark}
        showBuddiesIcon={!isGuest}
        buddyAlertCount={buddyAlertCount}
        onOpenBuddies={() => navigateTo('buddies')}
        onOpenSettings={() => navigateTo('settings')}
        onOpenGymSettings={() => navigateToGym('gym-settings')}
        userName={user?.displayName || 'Anonymous'}
        userSub={user?.email ?? undefined}
        userAvatar={myPhoto ? <img src={myPhoto} alt="" className="w-8 h-8 rounded-full object-cover" referrerPolicy="no-referrer" /> : undefined}
        userPhotoURL={myPhoto}
        onOpenProfile={() => navigateToTab('you')}
        banner={(
          <>
            {!activeSessionId && <SessionInviteBanner onOpen={openSession} />}
            {activeSessionId && view !== 'session-lobby' ? (
          <div className="px-5 pt-2">
            <GroupSessionBar
              sessionId={activeSessionId}
              isDark={isDark}
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
            ) : null}
          </>
        )}
      >
        <Suspense fallback={<ViewFallback />}>
        {view === 'home' && (
          <HomeTabView
            theme={theme}
            workouts={workoutHistory}
            activeWorkout={activeWorkout}
            showBuddies={!isGuest}
            onStartWorkout={startWorkout}
            onResumeWorkout={() => navigateTo('active')}
            onDiscardWorkout={discardWorkout}
            onOpenGymCheckin={() => navigateToGym('gym-checkin')}
            onOpenGymJoin={() => navigateToGym('gym-join')}
            onOpenBuddies={() => navigateTo('buddies')}
            onOpenZen={openZen}
            onSessionStart={(session) => startWorkout({
              id: `session_${session.id}`,
              name: session.workoutName,
              type: session.workoutType,
              exercises: session.templateExercises,
            }, session.id)}
            onOpenNutrition={() => { setFoodNav((n) => ({ ...n, date: healthToday() })); navigateTo('nutrition'); }}
            onOpenProfile={openProfile}
            onOpenBuddy={(uid, name, photoURL) => {
              recordBuddyInteraction(uid, 'profile');
              setBuddyContext({ uid, name, photoURL });
              navigateTo('buddy-profile');
            }}
          />
        )}
        {view === 'train' && (
          <TrainTabView
            theme={theme}
            onStartWorkout={startWorkout}
            onOpenWeeklyPlans={() => navigateTo('templates')}
            onOpenExercises={() => navigateTo('exercises')}
            onOpenCommonTemplates={() => navigateTo('common-templates')}
            onOpenGymPlans={() => navigateToGym('gym-plans')}
            onOpenHistory={() => navigateTo('history')}
            onOpenProgress={() => navigateTo('progress')}
          />
        )}
        {view === 'health' && (
          <HealthTabView
            onOpenZen={openZen}
            onOpenBodyWeight={() => navigateTo('body-weight')}
            onOpenBodyMeasurements={() => navigateTo('body-measurements')}
            onOpenInsights={() => navigateTo('insights')}
            onOpenNutrition={() => { setFoodNav((n) => ({ ...n, date: healthToday() })); navigateTo('nutrition'); }}
            onOpenPhase={() => navigateTo('phase')}
            onOpenActivity={() => navigateTo('activity')}
            onOpenEnergy={() => navigateTo('energy')}
            onJoinGym={() => navigateToGym('gym-join')}
          />
        )}
        {view === 'you' && (
          <ProfileView
            isDark={isDark}
            onOpenProgress={() => navigateTo('progress')}
            onOpenAnalysis={() => navigateTo('analysis')}
            onOpenHistory={() => navigateTo('history')}
            onOpenBuddies={() => navigateTo('buddies')}
            onOpenSettings={() => navigateTo('settings')}
            onOpenAdminGyms={() => navigateTo('admin-gyms')}
            onOpenAdminUsers={() => navigateTo('admin-users')}
            onOpenAdminLibrary={() => navigateTo('admin-library')}
            onOpenProfileUid={openProfile}
            onJoinGym={() => navigateToGym('gym-join')}
          />
        )}
        {view === 'history' && (
          <HistoryView 
            workouts={workoutHistory}
            isDark={isDark}
            onBack={() => goBack()}
            onChanged={loadData}
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
          <PremiumGate feature="analysis" onJoinGym={() => navigateToGym('gym-join')} onBack={() => goBack()}>
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
          </PremiumGate>
        )}
        {view === 'exercises' && (
          <ExerciseManagerView
            isDark={isDark}
            onBack={() => goBack()}
            onExercisesChange={loadData}
          />
        )}
        {/* Gym OS lite (Tier A) — placeholder routes, see docs/GYM_TIER_A_SPEC.md §6. */}
        {view === 'gym-join' && (
          <JoinGymView isDark={isDark} onBack={() => goBack()} onNavigate={navigateToGym} onOpenProfile={openProfile} gymId={gym?.id} />
        )}
        {view === 'gym-home' && (
          <GymHomeView isDark={isDark} onBack={() => goBack()} onNavigate={navigateToGym} onOpenProfile={openProfile} gymId={gym?.id} />
        )}
        {view === 'gym-checkin' && (
          <CheckinView isDark={isDark} onBack={() => goBack()} onNavigate={navigateToGym} onOpenProfile={openProfile} gymId={gym?.id} />
        )}
        {view === 'gym-classes' && (
          <ClassesView isDark={isDark} onBack={() => goBack()} onNavigate={navigateToGym} onOpenProfile={openProfile} gymId={gym?.id} />
        )}
        {view === 'gym-class' && (
          <ClassDetailView isDark={isDark} onBack={() => goBack()} onNavigate={navigateToGym} onOpenProfile={openProfile} gymId={gym?.id} classId={gymNav.classId} />
        )}
        {view === 'gym-announcements' && (
          <AnnouncementsView isDark={isDark} onBack={() => goBack()} onNavigate={navigateToGym} onOpenProfile={openProfile} gymId={gym?.id} />
        )}
        {view === 'gym-membership' && (
          <MembershipView isDark={isDark} onBack={() => goBack()} onNavigate={navigateToGym} onOpenProfile={openProfile} gymId={gym?.id} />
        )}
        {view === 'gym-ops' && (
          <GymOpsView isDark={isDark} onBack={() => goBack()} onNavigate={navigateToGym} onOpenProfile={openProfile} gymId={gym?.id} />
        )}
        {view === 'gym-dashboard' && (
          <GymDashboardView isDark={isDark} onBack={() => goBack()} onNavigate={navigateToGym} onOpenProfile={openProfile} gymId={gym?.id} />
        )}
        {view === 'gym-members' && (
          <MembersView isDark={isDark} onBack={() => goBack()} onNavigate={navigateToGym} onOpenProfile={openProfile} gymId={gym?.id} membersFilter={gymNav.membersFilter} />
        )}
        {view === 'gym-member' && (
          <MemberDetailView isDark={isDark} onBack={() => goBack()} onNavigate={navigateToGym} onOpenProfile={openProfile} gymId={gym?.id} memberUid={gymNav.memberUid} />
        )}
        {view === 'gym-console' && (
          <CheckinConsoleView isDark={isDark} onBack={() => goBack()} onNavigate={navigateToGym} onOpenProfile={openProfile} gymId={gym?.id} />
        )}
        {view === 'gym-library' && (
          <GymLibraryView isDark={isDark} onBack={() => goBack()} onNavigate={navigateToGym} onOpenProfile={openProfile} gymId={gym?.id} />
        )}
        {view === 'gym-plans' && (
          <GymPlansView isDark={isDark} onBack={() => goBack()} onNavigate={navigateToGym} onOpenProfile={openProfile} gymId={gym?.id} />
        )}
        {view === 'gym-classes-manage' && (
          <ClassesManageView isDark={isDark} onBack={() => goBack()} onNavigate={navigateToGym} onOpenProfile={openProfile} gymId={gym?.id} />
        )}
        {view === 'gym-settings' && (
          <GymSettingsView isDark={isDark} onBack={() => goBack()} onNavigate={navigateToGym} onOpenProfile={openProfile} gymId={gym?.id} />
        )}
        {view === 'gym-create' && (
          <CreateGymView isDark={isDark} onBack={() => goBack()} onNavigate={navigateToGym} onOpenProfile={openProfile} />
        )}
        {view === 'nutrition' && (
          <NutritionTodayView
            onBack={() => goBack()}
            initialDate={foodNav.date}
            onAddFood={(date, meal) => { setFoodNav({ date, meal }); navigateTo('food-search'); }}
            onOpenTargets={() => navigateTo('nutrition-targets')}
          />
        )}
        {view === 'food-search' && (
          <FoodSearchView
            date={foodNav.date} meal={foodNav.meal}
            onBack={() => goBack()}
            onAdded={() => showDiary(foodNav.date)}
            onOpenScan={() => navigateTo('food-scan')}
          />
        )}
        {view === 'food-scan' && (
          <FoodScanView
            date={foodNav.date} meal={foodNav.meal}
            onBack={() => goBack()}
            onAdded={() => showDiary(foodNav.date)}
          />
        )}
        {view === 'activity' && (
          <ActivityView onBack={() => goBack()} />
        )}
        {view === 'profile' && (
          <ProfileView
            uid={profileUid ?? undefined}
            isDark={isDark}
            onBack={() => goBack()}
            onOpenProgress={() => navigateTo('progress')}
            onOpenAnalysis={() => navigateTo('analysis')}
            onOpenHistory={() => navigateTo('history')}
            onOpenBuddies={() => navigateTo('buddies')}
            onOpenSettings={() => navigateTo('settings')}
            onOpenAdminGyms={() => navigateTo('admin-gyms')}
            onOpenAdminUsers={() => navigateTo('admin-users')}
            onOpenAdminLibrary={() => navigateTo('admin-library')}
            onOpenProfileUid={openProfile}
            onOpenChat={(uid, name, photoURL) => {
              setBuddyContext((prev) => ({ ...prev, uid, name, photoURL }));
              navigateTo('buddy-profile');
            }}
            onJoinGym={() => navigateToGym('gym-join')}
          />
        )}
        {view === 'energy' && (
          <PremiumGate feature="advanced-analytics" onJoinGym={() => navigateToGym('gym-join')} onBack={() => goBack()}>
            <EnergyView onBack={() => goBack()} onAskZen={openZen} />
          </PremiumGate>
        )}
        {view === 'nutrition-targets' && (
          <TargetsView onBack={() => goBack()} />
        )}
        {view === 'phase' && (
          <PremiumGate feature="advanced-analytics" onJoinGym={() => navigateToGym('gym-join')} onBack={() => goBack()}>
            <PhaseView isDark={isDark} onBack={() => goBack()} onOpenBodyWeight={() => navigateTo('body-weight')} />
          </PremiumGate>
        )}
        {view === 'insights' && (
          <PremiumGate feature="analysis" onJoinGym={() => navigateToGym('gym-join')} onBack={() => goBack()}>
            <InsightsView isDark={isDark} onBack={() => goBack()} />
          </PremiumGate>
        )}
        {view === 'admin-gyms' && (
          <AdminGymsView onBack={() => goBack()} />
        )}
        {view === 'admin-users' && (
          <AdminUsersView onBack={() => goBack()} />
        )}
        {view === 'admin-library' && (
          <AdminLibraryView onBack={() => goBack()} />
        )}
        {view === 'zen' && (
          <PremiumGate feature="zen" onJoinGym={() => navigateToGym('gym-join')} onBack={() => goBack()}>
            <ZenChatView
              onBack={() => goBack()}
              initialPrompt={zenPrefill}
              onConsumePrompt={() => setZenPrefill(null)}
            />
          </PremiumGate>
        )}
        {view === 'body-weight' && (
          <BodyWeightView isDark={isDark} onBack={() => goBack()} />
        )}
        {view === 'body-measurements' && (
          <BodyMeasurementsView isDark={isDark} onBack={() => goBack()} />
        )}
        {view === 'common-templates' && (
          <CommonTemplatesView isDark={isDark} onBack={() => goBack()} />
        )}
        {view === 'buddies' && (
          <BuddyView
            isDark={isDark}
            onBack={() => goBack()}
            onViewProfile={(uid, name, photoURL) => {
              recordBuddyInteraction(uid, 'profile');
              setBuddyContext({ uid, name, photoURL });
              navigateTo('buddy-profile');
            }}
            onOpenChat={(uid, chatId, name, photoURL) => {
              recordBuddyInteraction(uid, 'message');
              setBuddyContext({ uid, chatId, name, photoURL });
              navigateTo('buddy-chat');
            }}
            onOpenSession={openSession}
            onJoinGym={() => navigateToGym('gym-join')}
          />
        )}
        {view === 'buddy-profile' && buddyContext.uid && (
          <ProfileView
            uid={buddyContext.uid}
            isDark={isDark}
            onBack={() => goBack()}
            onOpenProgress={() => navigateTo('progress')}
            onOpenAnalysis={() => navigateTo('analysis')}
            onOpenHistory={() => navigateTo('history')}
            onOpenBuddies={() => navigateTo('buddies')}
            onOpenSettings={() => navigateTo('settings')}
            onOpenAdminGyms={() => navigateTo('admin-gyms')}
            onOpenAdminUsers={() => navigateTo('admin-users')}
            onOpenAdminLibrary={() => navigateTo('admin-library')}
            onOpenProfileUid={openProfile}
            onOpenChat={(uid, name, photoURL) => {
              // The chat id is on the buddy relationship, which is the only
              // place it is authoritative.
              void buddyService.getBuddies().then((rels) => {
                const rel = rels.find((r) => r.users.includes(uid));
                if (!rel) { showToast('Add them as a buddy to chat.', 'error'); return; }
                setBuddyContext({ uid, name, photoURL, chatId: rel.chatId });
                navigateTo('buddy-chat');
              }).catch(() => showToast('Could not open that chat.', 'error'));
            }}
            onCompare={(uid, name, photoURL) => {
              setBuddyContext({ uid, name, photoURL });
              navigateTo('buddy-compare');
            }}
            onStartSession={(uid, name, photoURL) => {
              setBuddyContext({ uid, name, photoURL });
              navigateTo('buddies');
            }}
            onJoinGym={() => navigateToGym('gym-join')}
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
        </Suspense>
      </AppShell>
      )}

      {/* First run: a short guided tour, skippable at every step. */}
      {showTour && (
        <WelcomeTour
          onDone={() => { setShowTour(false); navigateToTab('home'); }}
          onGoToTab={(tab) => navigateToTab(tab)}
        />
      )}

      {unlocked.length > 0 && <BadgeUnlockModal badges={unlocked} onClose={() => setUnlocked([])} />}

      {levelUp && (
        <LevelUpModal
          level={levelUp.to}
          from={levelUp.from}
          totalVolumeKg={levelUp.volume}
          gymName={gym?.name}
          onShareToGym={gym ? async () => {
            await createPost(gym.id, {
              achievement: {
                label: `Level ${levelUp.to} unlocked`,
                detail: `${Math.round(levelUp.volume / 1000)} t lifted all time`,
              },
            });
          } : undefined}
          onClose={() => { storage.setSeenLevel(levelUp.to); setLevelUp(null); }}
        />
      )}

      {/* Post-Workout Group Comparison Modal */}
      {completedSession && (
        <PostWorkoutComparison
          session={completedSession}
          isDark={isDark}
          onClose={() => {
            setCompletedSession(null);
            setActiveSessionId(null);
          }}
        />
      )}
    </div>
  );
}

export default App;
