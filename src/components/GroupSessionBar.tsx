import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Dumbbell, Check, Play, StopCircle } from 'lucide-react';
import { Avatar } from './Avatar';
import { useAuth } from '../auth/AuthContext';
import type { WorkoutSession, SessionParticipant, SessionReaction } from '../types';
import * as sessionService from '../workoutSessionService';

const { REACTION_EMOJIS } = sessionService;

interface GroupSessionBarProps {
  sessionId: string;
  /** Show a "Continue" button that returns the user to the session lobby / active workout. */
  showContinue?: boolean;
  /** Honor app theme. The floating reactions card and the per-buddy
   *  progress-bar track were hardcoded dark which looked wrong in light
   *  mode. */
  isDark?: boolean;
  onContinue?: () => void;
}

export function GroupSessionBar({ sessionId, showContinue, isDark = true, onContinue }: GroupSessionBarProps) {
  const { user } = useAuth();
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [, setReactions] = useState<SessionReaction[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<{ id: string; emoji: string; fromName: string }[]>([]);
  const seenReactionIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsub = sessionService.listenToSession(sessionId, setSession);
    return unsub;
  }, [sessionId]);

  useEffect(() => {
    const unsub = sessionService.listenToReactions(sessionId, (r) => {
      setReactions(r);
      // Show new reactions as floating toasts
      for (const reaction of r) {
        if (!seenReactionIds.current.has(reaction.id) && reaction.fromUid !== user?.uid) {
          seenReactionIds.current.add(reaction.id);
          const floater = { id: reaction.id, emoji: reaction.emoji, fromName: reaction.fromName };
          setFloatingReactions((prev) => [...prev, floater]);
          setTimeout(() => {
            setFloatingReactions((prev) => prev.filter((f) => f.id !== floater.id));
          }, 3000);
        }
      }
    });
    return unsub;
  }, [sessionId, user]);

  if (!session || session.status !== 'active') return null;

  const isHost = session.hostUid === user?.uid;
  const participants = Object.values(session.participants).filter(
    (p) => p.status === 'active' || p.status === 'completed'
  );
  const others = participants.filter((p) => p.uid !== user?.uid);
  const buddyName = others[0]?.name || 'your buddy';

  const handleEndSession = async () => {
    if (!confirm('End the session for everyone? Each participant\'s progress will be saved.')) return;
    try {
      await sessionService.finishSessionForAll(sessionId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to end session');
    }
  };

  const getProgressPercent = (p: SessionParticipant) =>
    p.totalSets > 0 ? Math.round((p.completedSets / p.totalSets) * 100) : 0;

  return (
    <div className="mb-3">
      {/* Floating Reactions */}
      {floatingReactions.length > 0 && (
        <div className="fixed top-20 right-4 z-40 space-y-1">
          {floatingReactions.map((r) => (
            <div
              key={r.id}
              className={`animate-fadeIn rounded-xl px-3 py-1.5 shadow-lg text-sm flex items-center gap-2 border ${
                isDark
                  ? 'bg-[#1a1a1a] border-[#2e2e2e]'
                  : 'bg-white border-gray-200'
              }`}
            >
              <span className="text-lg">{r.emoji}</span>
              <span className={`text-xs ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>{r.fromName}</span>
            </div>
          ))}
        </div>
      )}

      {/* Compact Bar */}
      <div className="rounded-xl bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/20 overflow-hidden">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {others.map((p) => (
                <div key={p.uid} className="relative">
                  <Avatar
                    name={p.name}
                    photoURL={p.photoURL}
                    size="sm"
                    presence={p.status === 'active' ? 'in-workout' : p.status === 'joined' ? 'online' : undefined}
                  />
                  {p.status === 'completed' && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 flex items-center justify-center">
                      <Check className="w-2 h-2 text-white" />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <span className="text-xs font-medium text-orange-400">
              {showContinue ? `Session with ${buddyName} active` : `${participants.length} working out together`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {showContinue && onContinue && (
              <button
                onClick={(e) => { e.stopPropagation(); onContinue(); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors"
              >
                <Play className="w-3 h-3" /> Continue
              </button>
            )}
            {isHost && (
              <button
                onClick={(e) => { e.stopPropagation(); handleEndSession(); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
                title="End session for everyone"
              >
                <StopCircle className="w-3 h-3" /> End
              </button>
            )}
            {!showContinue && (
              <div className="flex gap-0.5">
                {REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={(e) => {
                      e.stopPropagation();
                      sessionService.sendReaction(sessionId, emoji);
                    }}
                    className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center text-sm transition-colors"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-zinc-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-zinc-500" />
            )}
          </div>
        </button>

        {/* Expanded: Detailed progress per buddy */}
        {expanded && (
          <div className="px-3 pb-3 space-y-2 border-t border-orange-500/10">
            {participants.map((p) => {
              const percent = getProgressPercent(p);
              const isMe = p.uid === user?.uid;
              return (
                <div key={p.uid} className="pt-2">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Avatar
                    name={p.name}
                    photoURL={p.photoURL}
                    size="sm"
                    presence={p.status === 'active' ? 'in-workout' : p.status === 'joined' ? 'online' : undefined}
                  />
                      <div>
                        <span className="text-xs font-medium">
                          {p.name} {isMe && <span className="text-zinc-500">(You)</span>}
                        </span>
                        {p.status === 'completed' ? (
                          <div className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                            <Check className="w-2.5 h-2.5" /> Done{p.duration ? ` in ${p.duration}m` : ''}
                          </div>
                        ) : (
                          <div className="text-[10px] text-zinc-500">
                            {p.currentExercise || 'Getting ready...'}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold text-orange-400">{percent}%</div>
                      <div className="text-[10px] text-zinc-500">
                        {p.completedSets}/{p.totalSets} sets
                      </div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-zinc-800' : 'bg-gray-200'}`}>
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        p.status === 'completed'
                          ? 'bg-emerald-500'
                          : isMe
                            ? 'bg-gradient-to-r from-orange-500 to-red-500'
                            : 'bg-blue-500'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  {/* Volume */}
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-zinc-500 flex items-center gap-0.5">
                      <Dumbbell className="w-2.5 h-2.5" />
                      {p.totalVolume > 0 ? `${Math.round(p.totalVolume).toLocaleString()} kg` : '0 kg'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
