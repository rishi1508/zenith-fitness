import { useEffect, useMemo, useState } from 'react';
import { Building2, Clock, Dumbbell, ScanLine, Trash2, Users } from 'lucide-react';
import type { Workout, WorkoutTemplate, GymClass, WorkoutSession } from '../../types';
import type { Theme } from '../../App';
import * as storage from '../../storage';
import * as buddyService from '../../buddyService';
import { useAuth } from '../../auth/AuthContext';
import { workoutDaySet, localIso, weekStartISO, addDays } from '../../streakService';
import { AUTO_FINISH_IDLE_MS } from '../../autoFinish';
import { computeDeloadSuggestion } from '../../deloadDetector';
import { DeloadSuggestion, WeeklyPlanSelector, Avatar } from '../../components';
import { useGym } from '../../gym/GymContext';
import { listenToClasses, upcomingSessions } from '../../gymService';
import { formatTime12h } from '../../gymMemberHelpers';
import { ZenCard } from '../zen';
import { Card, Button, Chip, Sheet, SectionHeader, WeekDots, ListRow, H2, SUB, CAPTION } from '../../ui';
import { NutritionRing, NutritionMacroRings } from '../nutrition';
import { getTargets, subscribeHealth } from '../../health';
import { rankByAffinity } from '../../buddyAffinity';
import { suggestNextDay } from '../../planProgress';
import { WorkoutTogetherSheet } from './WorkoutTogetherSheet';
import type { WeekDotState } from '../../ui';

interface HomeTabViewProps {
  theme: Theme;
  workouts: Workout[];
  activeWorkout: Workout | null;
  showBuddies: boolean;
  onStartWorkout: (template: WorkoutTemplate) => void;
  /** Host started a group session from the home card. */
  onSessionStart: (session: WorkoutSession) => void;
  onResumeWorkout: () => void;
  onDiscardWorkout: () => void;
  onOpenGymCheckin: () => void;
  onOpenGymJoin: () => void;
  onOpenBuddies: () => void;
  onOpenZen: (prompt?: string) => void;
  onOpenNutrition: () => void;
  /** Opens one buddy's profile. Falls back to the buddies list when absent. */
  onOpenBuddy?: (uid: string, name: string, photoURL?: string | null) => void;
  /** Anyone's face opens their public profile. */
  onOpenProfile?: (uid: string) => void;
}

function elapsedLabel(startedAt: string): string {
  const mins = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Home tab root (docs/REVAMP_SPEC.md §3): today card, week dots +
 *  streak nudge, paused-workout banner, deload suggestion, gym card
 *  (or "join a gym" prompt), buddies strip. */
export function HomeTabView({
  theme, workouts, activeWorkout, showBuddies, onStartWorkout, onSessionStart, onResumeWorkout, onDiscardWorkout,
  onOpenGymCheckin, onOpenGymJoin, onOpenBuddies, onOpenZen,
  onOpenNutrition, onOpenBuddy, onOpenProfile,
}: HomeTabViewProps) {
  const [hasTargets, setHasTargets] = useState(() => getTargets() != null);
  useEffect(() => subscribeHealth(() => setHasTargets(getTargets() != null)), []);
  const isDark = theme === 'dark';
  const { gym } = useGym();
  const { user } = useAuth();
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [togetherOpen, setTogetherOpen] = useState(false);
  // Bumped whenever the day/plan picker closes so the today-card re-reads
  // storage (WeeklyPlanSelector writes lastUsedDay/activePlanId directly).
  const [refreshTick, setRefreshTick] = useState(0);
  const deload = useMemo(() => computeDeloadSuggestion(workouts), [workouts]);

  const [pausedElapsed, setPausedElapsed] = useState('');
  useEffect(() => {
    if (!activeWorkout?.startedAt) { setPausedElapsed(''); return; }
    setPausedElapsed(elapsedLabel(activeWorkout.startedAt));
    const t = setInterval(() => setPausedElapsed(elapsedLabel(activeWorkout.startedAt!)), 10_000);
    return () => clearInterval(t);
  }, [activeWorkout?.startedAt]);

  /**
   * Which day to offer. A day the user picked by hand *today* wins — they
   * said what they wanted. Otherwise the plan decides (src/planProgress.ts):
   * the earliest day of this week's cycle they have not done, so finishing
   * Day 1 offers Day 2, and skipping ahead pulls them back to what is owed.
   */
  const today = useMemo(() => {
    const plan = storage.getActivePlan();
    const pickedToday = storage.getLastUsedDayDate() === localIso(new Date());
    const chosen = pickedToday ? storage.getLastUsedDay() : null;
    const suggestion = suggestNextDay(plan, workouts);
    const day = chosen != null
      ? plan?.days.find((d) => d.dayNumber === chosen) ?? suggestion?.day ?? null
      : suggestion?.day ?? null;
    return { plan, day, reason: chosen != null ? null : suggestion?.reason ?? null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick, workouts]);

  const lastTime = useMemo(() => {
    if (!today.day) return null;
    const completed = workouts
      .filter((w) => w.completed && w.type !== 'rest')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const match = completed.find((w) => w.name.endsWith(today.day!.name));
    if (!match) return null;
    const volume = match.exercises.reduce((sum, ex) => sum + ex.sets.reduce((s, set) => s + (set.completed ? set.weight * set.reps : 0), 0), 0);
    const parts = [match.duration ? `${match.duration}m` : null, volume > 0 ? `${(volume / 1000).toFixed(1)}t` : null].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  }, [today, workouts]);

  const weekDots = useMemo((): WeekDotState[] => {
    const trainedDays = workoutDaySet(workouts);
    const restDays = new Set(workouts.filter((w) => w.type === 'rest').map((w) => localIso(new Date(w.date))));
    const now = new Date();
    const ws = weekStartISO(now);
    const todayIso = localIso(now);
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(ws, i);
      if (trainedDays.has(d)) return 'on';
      if (d === todayIso) return 'today';
      if (restDays.has(d)) return 'rest';
      return 'off';
    });
  }, [workouts]);

  const streakSummary = useMemo(() => storage.getStreakSummary(workouts), [workouts]);
  const { shown } = streakSummary;
  const nudge = shown.thisWeekQualified
    ? `${shown.current} week streak at ${shown.level}★.`
    : shown.daysNeededThisWeek > 0
      ? `${shown.daysNeededThisWeek} more session${shown.daysNeededThisWeek > 1 ? 's' : ''} keeps your ${shown.level}★ streak at ${shown.current} week${shown.current === 1 ? '' : 's'}.`
      : 'Log a session to keep your streak alive.';

  const [gymClasses, setGymClasses] = useState<GymClass[] | null>(null);
  useEffect(() => {
    if (!gym?.id) { setGymClasses(null); return; }
    return listenToClasses(gym.id, setGymClasses);
  }, [gym?.id]);
  const nextClass = useMemo(() => upcomingSessions(gymClasses ?? [], new Date(), 1)[0] ?? null, [gymClasses]);

  const [buddyRows, setBuddyRows] = useState<Array<{ uid: string; name: string; photoURL?: string | null; sub: string; live: boolean }>>([]);
  useEffect(() => {
    if (!showBuddies || !user) return;
    let cancelled = false;
    const unsub = buddyService.listenToBuddies((rels) => {
      (async () => {
        // Most-interacted first (src/buddyAffinity.ts), not whatever order the
        // query happened to return.
        const byUid = new Map(rels.map((r) => [r.users.find((u) => u !== user.uid) ?? r.users[0], r]));
        const top = rankByAffinity([...byUid.keys()]).slice(0, 3);
        const rows = await Promise.all(
          top.map(async (uid) => {
            const r = byUid.get(uid)!;
            const otherUid = uid;
            const profile = await buddyService.getUserProfile(otherUid).catch(() => null);
            const name = profile?.displayName ?? r.userNames[otherUid] ?? 'Buddy';
            const sub = profile?.isWorkingOut
              ? `Training now${profile.activeWorkoutName ? ` · ${profile.activeWorkoutName}` : ''}`
              : profile?.lastActive
                ? `Last active ${new Date(profile.lastActive).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                : 'No recent activity';
            return { uid: otherUid, name, photoURL: profile?.photoURL, sub, live: !!profile?.isWorkingOut };
          }),
        );
        if (!cancelled) setBuddyRows(rows);
      })();
    });
    return () => { cancelled = true; unsub(); };
  }, [showBuddies, user]);

  return (
    <div className="space-y-4 animate-fadeIn">
      {activeWorkout && (
        <Card tone="accent">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-accent text-sm">Workout in progress</span>
            <span className={`flex items-center gap-1 text-xs font-mono ${SUB}`}>
              <Clock className="w-3.5 h-3.5" /> {pausedElapsed}
            </span>
          </div>
          <p className="text-sm text-text mb-1">
            {activeWorkout.name} · {activeWorkout.exercises.length} exercise{activeWorkout.exercises.length !== 1 ? 's' : ''}
          </p>
          <p className={`${SUB} mb-3`}>Finishes itself after {AUTO_FINISH_IDLE_MS / 3_600_000}h without activity.</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="md" icon={Trash2} onClick={onDiscardWorkout} className="flex-1">Discard</Button>
            <Button variant="primary" size="md" onClick={onResumeWorkout} className="flex-1">Resume</Button>
          </div>
        </Card>
      )}

      <DeloadSuggestion data={deload} isDark={isDark} />

      {today.plan && today.day && !today.day.isRestDay ? (
        <Card>
          <div className="flex items-center justify-between mb-1">
            <span className={CAPTION}>Today · {today.plan.name}</span>
            <Chip size="md">{today.day.name}</Chip>
          </div>
          <h2 className={`${H2} mb-1`}>{today.day.name}</h2>
          <p className={`${SUB} mb-3 line-clamp-1`}>
            {today.day.exercises.map((e) => e.exerciseName).join(' · ')}
          </p>
          {/* Start alone, or bring someone — the second is one tap, not a
              trip through the Buddies screen. */}
          <div className="flex gap-2" data-tour="start-workout">
            <Button
              variant="primary" size="lg" icon={Dumbbell} className="flex-1 min-w-0"
              onClick={() => onStartWorkout({
                id: `${today.plan!.id}_day_${today.day!.dayNumber}`,
                name: `${today.plan!.name} - ${today.day!.name}`,
                type: 'custom',
                exercises: today.day!.exercises,
                weeklyPlanId: today.plan!.id,
              })}
            >
              Start workout
            </Button>
            <button
              onClick={() => setTogetherOpen(true)}
              aria-label="Work out together"
              data-tour="together"
              title="Work out together"
              className="w-[52px] shrink-0 rounded-control border border-border text-accent flex items-center justify-center hover:border-accent/50 transition-colors"
            >
              <Users className="w-5 h-5" strokeWidth={1.75} />
            </button>
          </div>
          <div className="flex items-center justify-between mt-3 gap-2">
            <span className={`${SUB} min-w-0 truncate`}>
              {today.reason ?? (lastTime ? `Last time ${lastTime}` : 'No sessions logged yet')}
            </span>
            <button onClick={() => setDayPickerOpen(true)} className="shrink-0 whitespace-nowrap text-[13px] font-bold text-accent">Change day</button>
          </div>
        </Card>
      ) : (
        <Card className="flex flex-col items-center text-center gap-2 py-6">
          <p className={H2}>No active plan</p>
          <p className={SUB}>Create a weekly plan to get a "Start workout" card here.</p>
        </Card>
      )}

      <Card>
        <SectionHeader caption="This week" trailing={<span className="text-sm font-bold text-text">{shown.thisWeekDays} of {shown.level} days</span>} />
        <div className="mt-2"><WeekDots days={weekDots} /></div>
        <p className={`${SUB} mt-2`}>{nudge}</p>
      </Card>

      {hasTargets && (
        <Card onClick={onOpenNutrition} className="text-left" data-tour="nutrition-card">
          <div className="flex items-center justify-between gap-2">
            <span className={CAPTION}>Nutrition today</span>
            <span className="text-[13px] font-bold text-accent">Log food</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <NutritionRing size={84} showMacros={false} />
            <NutritionMacroRings size={50} className="flex-1" />
          </div>
        </Card>
      )}

      <ZenCard compact onAskZen={onOpenZen} />

      {gym ? (
        <ListRow
          icon={<Building2 className="w-[18px] h-[18px]" strokeWidth={1.75} />}
          iconTone="accent"
          title={gym.name}
          subtitle={nextClass ? `${nextClass.cls.name} ${formatTime12h(nextClass.cls.startTime)}` : 'No classes today'}
          trailing={<Chip icon={ScanLine} onClick={onOpenGymCheckin}>Check in</Chip>}
        />
      ) : (
        <Card className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-text">Is your gym on Zenith?</p>
            <p className={SUB}>Link your membership with a join code.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onOpenGymJoin}>Enter gym code</Button>
        </Card>
      )}

      {showBuddies && buddyRows.length > 0 && (
        <div className="space-y-2">
          <SectionHeader caption="Buddies" trailing={{ label: 'See all', onClick: onOpenBuddies }} />
          <Card padding="list">
            {buddyRows.map((b) => (
              <ListRow
                key={b.uid}
                leading={(
                  <button
                    onClick={(e) => { e.stopPropagation(); onOpenProfile?.(b.uid); }}
                    aria-label={`${b.name}'s profile`}
                    className="shrink-0"
                  >
                    <Avatar name={b.name} photoURL={b.photoURL} size="sm" />
                  </button>
                )}
                title={b.name}
                subtitle={b.sub}
                trailing={b.live ? <Chip on size="md">Live</Chip> : 'chevron'}
                onClick={() => (onOpenBuddy ? onOpenBuddy(b.uid, b.name, b.photoURL) : onOpenBuddies())}
              />
            ))}
          </Card>
        </div>
      )}

      {togetherOpen && (
        <WorkoutTogetherSheet
          plan={today.plan}
          initialDay={today.day}
          onClose={() => { setTogetherOpen(false); setRefreshTick((n) => n + 1); }}
          onStart={(session) => { setTogetherOpen(false); onSessionStart(session); }}
        />
      )}

      <Sheet open={dayPickerOpen} onClose={() => { setDayPickerOpen(false); setRefreshTick((n) => n + 1); }} title="Change day">
        <WeeklyPlanSelector isDark={isDark} onStartWorkout={(t) => { setDayPickerOpen(false); setRefreshTick((n) => n + 1); onStartWorkout(t); }} />
      </Sheet>
    </div>
  );
}
