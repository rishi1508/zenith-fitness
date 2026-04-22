import { useState, useEffect } from 'react';
import { X, Dumbbell, AlertCircle, Loader2, ChevronRight, Calendar } from 'lucide-react';
import type { WeeklyPlan, DayPlan } from '../types';
import * as storage from '../storage';
import * as sessionService from '../workoutSessionService';
import * as buddyService from '../buddyService';

interface StartSessionModalProps {
  buddyUid: string;
  buddyName: string;
  buddyPhotoURL?: string | null;
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
  buddyUid, buddyName, buddyPhotoURL, onClose, onStarted,
}: StartSessionModalProps) {
  const plan: WeeklyPlan | null = storage.getActivePlan();
  const activeDays = plan ? plan.days.filter((d) => !d.isRestDay && d.exercises.length > 0) : [];
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(
    activeDays.length === 1 ? plan!.days.indexOf(activeDays[0]) : null,
  );
  const [busyStatus, setBusyStatus] = useState<'checking' | 'available' | 'busy' | 'error'>('checking');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await buddyService.getUserProfile(buddyUid);
        if (cancelled) return;
        if (profile?.isWorkingOut) setBusyStatus('busy');
        else setBusyStatus('available');
      } catch {
        if (!cancelled) setBusyStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [buddyUid]);

  const start = async (day: DayPlan) => {
    if (!plan) return;
    setStarting(true);
    setError(null);
    try {
      const sid = await sessionService.createSession(
        `${plan.name} - ${day.name}`,
        'custom',
        day.exercises,
      );
      try {
        await sessionService.inviteToSession(sid, buddyUid, buddyName, buddyPhotoURL || null);
      } catch (inviteErr) {
        console.error('[StartSession] invite failed', inviteErr);
      }
      onStarted(sid);
    } catch (err) {
      console.error('[StartSession] createSession failed', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStarting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a1a] w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#1a1a1a] p-4 border-b border-[#2e2e2e] flex items-center justify-between">
          <div>
            <h3 className="font-bold">Workout with {buddyName}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Pick a day from your active plan</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-500 hover:text-white rounded-lg hover:bg-[#252525]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-sm">
          {/* Busy check */}
          {busyStatus === 'checking' && (
            <div className="flex items-center gap-2 text-zinc-500 text-xs">
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
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
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
                        ? 'opacity-40 cursor-not-allowed border-[#2e2e2e]'
                        : selected
                          ? 'border-orange-500/60 bg-orange-500/10'
                          : 'border-[#2e2e2e] hover:border-orange-500/40'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${selected ? 'bg-orange-500/20 text-orange-400' : 'bg-[#252525] text-zinc-400'}`}>
                        <Calendar className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{day.name}</div>
                        <div className="text-[11px] text-zinc-500">
                          {day.isRestDay
                            ? 'Rest day'
                            : `${day.exercises.length} exercise${day.exercises.length === 1 ? '' : 's'}`}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 ${selected ? 'text-orange-400' : 'text-zinc-600'}`} />
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
        </div>

        {/* Footer action */}
        <div className="sticky bottom-0 bg-[#1a1a1a] border-t border-[#2e2e2e] p-4">
          <button
            onClick={() => {
              if (plan && selectedDayIndex !== null) start(plan.days[selectedDayIndex]);
            }}
            disabled={
              starting ||
              busyStatus === 'busy' ||
              !plan ||
              activeDays.length === 0 ||
              selectedDayIndex === null
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
