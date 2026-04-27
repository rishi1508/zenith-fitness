import { useState, useEffect, useRef } from 'react';
import { X, Dumbbell, AlertCircle, Loader2, ChevronRight, Calendar } from 'lucide-react';
import type { WeeklyPlan, DayPlan, WorkoutSession } from '../types';
import * as storage from '../storage';
import * as sessionService from '../workoutSessionService';
import * as buddyService from '../buddyService';

interface StartSessionModalProps {
  buddyUid: string;
  buddyName: string;
  buddyPhotoURL?: string | null;
  /** Honor app theme. Earlier this modal was hardcoded dark which made
   *  it look out of place in light mode. */
  isDark?: boolean;
  onClose: () => void;
  /** Fired after both session creation and invite succeed. */
  onStarted: (sessionId: string) => void;
}

/**
 * Centralised "pick a day and invite a buddy to work out together" flow.
 * Used by BuddyView, BuddyProfileView, and BuddyChatView so every entry
 * point:
 *   - shows the host a day picker from their active plan,
 *   - refuses to invite a buddy who is already mid-workout (either
 *     personal or in another session) by reading userProfile.isWorkingOut,
 *   - surfaces any Firestore permission / rules error inline.
 */
export function StartSessionModal({
  buddyUid, buddyName, buddyPhotoURL, isDark = true, onClose, onStarted,
}: StartSessionModalProps) {
  const plan: WeeklyPlan | null = storage.getActivePlan();
  const activeDays = plan ? plan.days.filter((d) => !d.isRestDay && d.exercises.length > 0) : [];
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(
    activeDays.length === 1 ? plan!.days.indexOf(activeDays[0]) : null,
  );
  const [busyStatus, setBusyStatus] = useState<'checking' | 'available' | 'busy' | 'error'>('checking');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Existing open session this user is already hosting. If set, we
  // refuse to create a second session (which would deliver a duplicate
  // invite to the buddy) and instead offer a "Continue to existing
  // session" jump.
  const [existingSession, setExistingSession] = useState<WorkoutSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [profile, openHosted] = await Promise.all([
          buddyService.getUserProfile(buddyUid),
          sessionService.getMyOpenHostedSessions(),
        ]);
        if (cancelled) return;
        if (profile?.isWorkingOut) setBusyStatus('busy');
        else setBusyStatus('available');
        // If we already have an open session, surface it. The user must
        // either continue or cancel the existing one before starting a
        // new invite.
        if (openHosted.length > 0) {
          setExistingSession(openHosted[0]);
        }
      } catch {
        if (!cancelled) setBusyStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [buddyUid]);

  const start = async (day: DayPlan) => {
    if (!plan) return;
    // Belt-and-suspenders: even if the UI mis-renders, do NOT create a
    // second session while one is open.
    if (existingSession) {
      setError('You already have an open session. Continue or cancel it first.');
      return;
    }
    setStarting(true);
    setError(null);
    let sid: string | null = null;
    try {
      sid = await sessionService.createSession(
        `${plan.name} - ${day.name}`,
        'custom',
        day.exercises,
      );
    } catch (err) {
      console.error('[StartSession] createSession failed', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStarting(false);
      return;
    }
    // Session created — now try to invite. If the invite fails, we
    // show the error inline and let the host decide whether to
    // proceed anyway (Continue without invite) or back out. Previously
    // we swallowed the error and landed the host in a lobby with no
    // buddy invited and no indication why.
    try {
      await sessionService.inviteToSession(sid, buddyUid, buddyName, buddyPhotoURL || null);
      onStarted(sid);
    } catch (inviteErr) {
      console.error('[StartSession] invite failed', inviteErr);
      setError(
        (inviteErr instanceof Error ? inviteErr.message : 'Invite failed') +
        ' — session was created. Tap Continue anyway to invite from the lobby.',
      );
      // Expose a one-tap Continue action via a flag
      pendingSidRef.current = sid;
      setStarting(false);
    }
  };
  const cancelExisting = async () => {
    if (!existingSession) return;
    try {
      await sessionService.cancelSession(existingSession.id);
      setExistingSession(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel existing session');
    }
  };
  const pendingSidRef = useRef<string | null>(null);

  // Theme-aware surface classes. Defaults match the prior dark-only
  // styling so callers that haven't been migrated still look correct.
  const surfaceBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const headerBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtleText = isDark ? 'text-zinc-500' : 'text-gray-500';
  const subtleHover = isDark ? 'text-zinc-500 hover:text-white hover:bg-[#252525]' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100';
  const tileBorderIdle = isDark ? 'border-[#2e2e2e] hover:border-orange-500/40' : 'border-gray-200 hover:border-orange-500/60';
  const tileBgInactive = isDark ? 'bg-[#252525] text-zinc-400' : 'bg-gray-100 text-gray-500';
  const chevronIdleColor = isDark ? 'text-zinc-600' : 'text-gray-400';

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center animate-fadeIn"
      onClick={onClose}
    >
      <div
        className={`${surfaceBg} w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`sticky top-0 ${surfaceBg} p-4 border-b ${headerBorder} flex items-center justify-between`}>
          <div>
            <h3 className="font-bold">Workout with {buddyName}</h3>
            <p className={`text-xs ${subtleText} mt-0.5`}>Pick a day from your active plan</p>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg ${subtleHover}`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-sm">
          {existingSession && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 text-orange-300 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <div>
                  You already have an open session
                  {existingSession.workoutName ? ` ("${existingSession.workoutName}")` : ''}.
                  Continue it or cancel it before inviting {buddyName} to a new one.
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onStarted(existingSession.id)}
                    className="px-2.5 py-1 rounded text-[11px] font-medium bg-orange-500 text-white hover:bg-orange-600"
                  >
                    Continue existing
                  </button>
                  <button
                    onClick={cancelExisting}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium ${
                      isDark ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Cancel it
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Busy check */}
          {busyStatus === 'checking' && (
            <div className={`flex items-center gap-2 ${subtleText} text-xs`}>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking availability…
            </div>
          )}
          {busyStatus === 'busy' && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                {buddyName} is already in a workout. Wait for them to finish, or
                send them a message in chat.
              </span>
            </div>
          )}
          {busyStatus === 'error' && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Couldn't check {buddyName}'s status — proceed at your own risk.</span>
            </div>
          )}

          {/* Plan check */}
          {!plan && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
              You don't have an active plan. Set one on the Workout screen first.
            </div>
          )}

          {plan && activeDays.length === 0 && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
              Your plan has no days with exercises yet. Add exercises to at least
              one day before starting a session.
            </div>
          )}

          {/* Day picker */}
          {plan && activeDays.length > 0 && (
            <div className="space-y-2">
              <div className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>
                Select a day
              </div>
              {plan.days.map((day, i) => {
                const disabled = day.isRestDay || day.exercises.length === 0;
                const selected = selectedDayIndex === i;
                return (
                  <button
                    key={i}
                    disabled={disabled}
                    onClick={() => setSelectedDayIndex(i)}
                    className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                      disabled
                        ? `opacity-40 cursor-not-allowed ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`
                        : selected
                          ? 'border-orange-500/60 bg-orange-500/10'
                          : tileBorderIdle
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${selected ? 'bg-orange-500/20 text-orange-400' : tileBgInactive}`}>
                        <Calendar className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{day.name}</div>
                        <div className={`text-[11px] ${subtleText}`}>
                          {day.isRestDay
                            ? 'Rest day'
                            : `${day.exercises.length} exercise${day.exercises.length === 1 ? '' : 's'}`}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 ${selected ? 'text-orange-400' : chevronIdleColor}`} />
                  </button>
                );
              })}
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs whitespace-pre-wrap">
              {error}
            </div>
          )}
          {pendingSidRef.current && (
            <button
              onClick={() => {
                const sid = pendingSidRef.current;
                if (sid) onStarted(sid);
              }}
              className="w-full py-2 rounded-lg text-xs font-medium bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 transition-colors"
            >
              Continue to lobby anyway
            </button>
          )}
        </div>

        {/* Footer action */}
        <div className={`sticky bottom-0 ${surfaceBg} border-t ${headerBorder} p-4`}>
          <button
            onClick={() => {
              if (plan && selectedDayIndex !== null) start(plan.days[selectedDayIndex]);
            }}
            disabled={
              starting ||
              busyStatus === 'busy' ||
              !plan ||
              activeDays.length === 0 ||
              selectedDayIndex === null ||
              !!existingSession
            }
            className="w-full py-3 rounded-xl font-medium text-sm bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center justify-center gap-2"
          >
            {starting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Dumbbell className="w-4 h-4" />
            )}
            {starting ? 'Starting…' : 'Start workout together'}
          </button>
        </div>
      </div>
    </div>
  );
}
