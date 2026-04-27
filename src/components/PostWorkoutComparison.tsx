import { useEffect, useState } from 'react';
import { Dumbbell, Clock, TrendingUp, Trophy, Flame, X, Crown, Loader2 } from 'lucide-react';
import { Avatar } from './Avatar';
import { useAuth } from '../auth/AuthContext';
import type { WorkoutSession, SessionParticipant, SessionProgress } from '../types';
import * as sessionService from '../workoutSessionService';

interface PostWorkoutComparisonProps {
  session: WorkoutSession;
  isDark?: boolean;
  onClose: () => void;
}

/**
 * Post-session result screen. Earlier this only showed each
 * participant's session-total volume / sets / duration, which made
 * almost-equal sessions look like ties even when one buddy crushed a
 * specific lift. We now also fetch each participant's detailed progress
 * subdoc and compute a per-exercise breakdown:
 *
 *   - For shared exercises (both did them) → show who lifted heavier
 *     (top working-set weight) and who did more total volume on that
 *     lift, with a winner badge per row.
 *   - For exercises only one person did (e.g. you did Incline Bench,
 *     buddy did Incline DB Press) → list them in a "Solo lifts"
 *     section so it's clear they weren't compared.
 *
 * Exercise-name match is case-insensitive on a trimmed name. Different
 * machine variants (Incline Bench vs Incline DB Press) are intentionally
 * treated as distinct lifts — fuzzy matching here would silently merge
 * unrelated exercises and produce misleading "winner" claims.
 */
export function PostWorkoutComparison({ session, isDark = true, onClose }: PostWorkoutComparisonProps) {
  const { user } = useAuth();
  const participants = Object.values(session.participants).filter(
    (p) => p.status === 'completed' || p.status === 'active'
  );

  const [progressByUid, setProgressByUid] = useState<Map<string, SessionProgress> | null>(null);
  useEffect(() => {
    let cancelled = false;
    sessionService
      .getAllProgress(session.id, participants.map((p) => p.uid))
      .then((m) => { if (!cancelled) setProgressByUid(m); });
    return () => { cancelled = true; };
  }, [session.id, participants.length]);

  // Determine winners for each session-level category
  const maxVolume = Math.max(...participants.map((p) => p.totalVolume));
  const maxSets = Math.max(...participants.map((p) => p.completedSets));
  const minDuration = Math.min(...participants.filter((p) => p.duration).map((p) => p.duration!));
  const getVolumeWinner = (p: SessionParticipant) => p.totalVolume === maxVolume && maxVolume > 0;
  const getSetsWinner = (p: SessionParticipant) => p.completedSets === maxSets && maxSets > 0;
  const getSpeedWinner = (p: SessionParticipant) => p.duration === minDuration && minDuration > 0;

  // Theme tokens — we previously hardcoded dark, which clashed in light mode.
  const overlay = 'bg-black/70 backdrop-blur-sm';
  const surface = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const surfaceBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtleText = isDark ? 'text-zinc-400' : 'text-gray-500';
  const dimText = isDark ? 'text-zinc-500' : 'text-gray-400';
  const cardBgInactive = isDark ? 'bg-[#111]' : 'bg-gray-50';
  const tileBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const winnerTileText = 'text-orange-500';
  const closeBtnHover = isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-gray-500 hover:text-gray-700';

  return (
    <div className={`fixed inset-0 ${overlay} flex items-center justify-center z-50 p-4`}>
      <div className={`${surface} rounded-2xl max-w-md w-full max-h-[85vh] overflow-y-auto border ${surfaceBorder}`}>
        {/* Header */}
        <div className={`sticky top-0 ${surface} p-5 pb-3 border-b ${surfaceBorder} flex items-center justify-between`}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="w-5 h-5 text-yellow-400" />
              <h2 className="text-lg font-bold">Session Complete!</h2>
            </div>
            <p className={`text-xs ${subtleText}`}>{session.workoutName}</p>
          </div>
          <button onClick={onClose} className={`p-2 ${closeBtnHover}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Participant Cards (session totals) */}
          {participants
            .sort((a, b) => b.totalVolume - a.totalVolume)
            .map((p, index) => {
              const isMe = p.uid === user?.uid;
              const isFirst = index === 0;
              return (
                <div
                  key={p.uid}
                  className={`rounded-xl border p-4 ${
                    isFirst
                      ? 'border-yellow-500/30 bg-yellow-500/5'
                      : `${surfaceBorder} ${cardBgInactive}`
                  }`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="relative">
                      <Avatar name={p.name} photoURL={p.photoURL} size="lg" />
                      {isFirst && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-yellow-500 flex items-center justify-center text-[10px]">
                          👑
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="font-bold">
                        {p.name} {isMe && <span className={`${dimText} font-normal`}>(You)</span>}
                      </div>
                      <div className={`text-xs ${subtleText}`}>
                        {isFirst ? 'Most Volume' : `#${index + 1}`}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <StatBox
                      icon={<Dumbbell className="w-3.5 h-3.5" />}
                      value={p.totalVolume > 0 ? `${Math.round(p.totalVolume / 1000 * 10) / 10}k` : '0'}
                      label="Volume (kg)"
                      highlight={getVolumeWinner(p)}
                      isDark={isDark}
                    />
                    <StatBox
                      icon={<TrendingUp className="w-3.5 h-3.5" />}
                      value={String(p.completedSets)}
                      label="Sets"
                      highlight={getSetsWinner(p)}
                      isDark={isDark}
                    />
                    <StatBox
                      icon={<Clock className="w-3.5 h-3.5" />}
                      value={p.duration ? `${p.duration}m` : '-'}
                      label="Duration"
                      highlight={getSpeedWinner(p)}
                      isDark={isDark}
                    />
                  </div>
                </div>
              );
            })}

          {/* Per-exercise breakdown */}
          <PerExerciseBreakdown
            participants={participants}
            progressByUid={progressByUid}
            myUid={user?.uid || ''}
            isDark={isDark}
            tileBg={tileBg}
            surfaceBorder={surfaceBorder}
            subtleText={subtleText}
            dimText={dimText}
            winnerTileText={winnerTileText}
          />

          {/* Motivational footer */}
          <div className="text-center py-2">
            <Flame className="w-8 h-8 text-orange-400 mx-auto mb-2" />
            <p className={`text-sm ${subtleText}`}>
              Great session! Working out together beats solo every time.
            </p>
          </div>

          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl font-medium text-sm bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function StatBox({ icon, value, label, highlight, isDark }: {
  icon: React.ReactNode;
  value: string;
  label: string;
  highlight: boolean;
  isDark: boolean;
}) {
  const inactiveBg = isDark ? 'bg-[#1a1a1a]' : 'bg-gray-100';
  const inactiveValue = isDark ? 'text-white' : 'text-gray-900';
  return (
    <div className={`rounded-lg p-2 text-center ${
      highlight ? 'bg-orange-500/10 border border-orange-500/20' : inactiveBg
    }`}>
      <div className={`flex items-center justify-center gap-1 mb-0.5 ${
        highlight ? 'text-orange-400' : isDark ? 'text-zinc-500' : 'text-gray-500'
      }`}>
        {icon}
      </div>
      <div className={`text-sm font-bold ${highlight ? 'text-orange-400' : inactiveValue}`}>
        {value}
      </div>
      <div className={`text-[10px] ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>{label}</div>
    </div>
  );
}

interface ExerciseStat {
  uid: string;
  name: string;
  topWeight: number; // best working-set weight (kg)
  topReps: number;   // reps on the top-weight set
  volume: number;    // total volume (sum of weight*reps for completed sets)
  sets: number;
}

function aggregate(progress: SessionProgress | undefined, uid: string): Map<string, ExerciseStat> {
  const map = new Map<string, ExerciseStat>();
  if (!progress) return map;
  for (const ex of progress.exercises) {
    const key = ex.exerciseName.trim().toLowerCase();
    let topWeight = 0;
    let topReps = 0;
    let volume = 0;
    let sets = 0;
    for (const s of ex.sets) {
      if (!s.completed || s.weight <= 0 || s.reps <= 0) continue;
      sets++;
      volume += s.weight * s.reps;
      if (s.weight > topWeight || (s.weight === topWeight && s.reps > topReps)) {
        topWeight = s.weight;
        topReps = s.reps;
      }
    }
    if (sets > 0) {
      map.set(key, { uid, name: ex.exerciseName, topWeight, topReps, volume, sets });
    }
  }
  return map;
}

function PerExerciseBreakdown({
  participants, progressByUid, myUid, isDark, tileBg, surfaceBorder, subtleText, dimText, winnerTileText,
}: {
  participants: SessionParticipant[];
  progressByUid: Map<string, SessionProgress> | null;
  myUid: string;
  isDark: boolean;
  tileBg: string;
  surfaceBorder: string;
  subtleText: string;
  dimText: string;
  winnerTileText: string;
}) {
  if (progressByUid === null) {
    return (
      <div className={`flex items-center justify-center gap-2 text-xs ${subtleText} py-3`}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading exercise breakdown…
      </div>
    );
  }

  // Build per-uid maps and union of all exercise keys.
  const byUid = new Map<string, Map<string, ExerciseStat>>();
  const keyOrder: string[] = []; // preserve first-seen order for stable rendering
  for (const p of participants) {
    const m = aggregate(progressByUid.get(p.uid), p.uid);
    byUid.set(p.uid, m);
    for (const k of m.keys()) {
      if (!keyOrder.includes(k)) keyOrder.push(k);
    }
  }
  if (keyOrder.length === 0) {
    return null;
  }

  const shared: string[] = [];
  const solo: string[] = [];
  for (const k of keyOrder) {
    const presence = participants.filter((p) => byUid.get(p.uid)?.has(k));
    if (presence.length >= 2) shared.push(k);
    else solo.push(k);
  }

  const nameOf = (uid: string) =>
    participants.find((p) => p.uid === uid)?.name || 'Buddy';

  const formatVolume = (v: number) =>
    v >= 10000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : Math.round(v).toLocaleString();

  return (
    <div className="space-y-3">
      {shared.length > 0 && (
        <div className="space-y-2">
          <div className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>
            Head-to-head exercises
          </div>
          {shared.map((k) => {
            const stats = participants
              .map((p) => byUid.get(p.uid)?.get(k))
              .filter((s): s is ExerciseStat => !!s);
            const heaviest = stats.reduce((a, b) => (b.topWeight > a.topWeight ? b : a));
            const allTied = stats.every((s) => s.topWeight === heaviest.topWeight);
            const mostVolume = stats.reduce((a, b) => (b.volume > a.volume ? b : a));
            const exerciseName = stats[0].name;
            return (
              <div key={k} className={`rounded-xl border p-3 ${surfaceBorder} ${tileBg}`}>
                <div className="font-medium text-sm mb-2">{exerciseName}</div>
                <div className="space-y-1.5">
                  {stats.map((s) => {
                    const isMe = s.uid === myUid;
                    const heaviestHere = !allTied && s.uid === heaviest.uid;
                    const volumeKingHere = s.uid === mostVolume.uid && stats.length > 1 && mostVolume.volume > 0 && stats.some((o) => o.uid !== s.uid && o.volume !== s.volume);
                    return (
                      <div key={s.uid} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate">
                            {nameOf(s.uid)}{isMe ? <span className={`${dimText}`}> (You)</span> : null}
                          </span>
                          {heaviestHere && (
                            <span className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${winnerTileText} bg-orange-500/10`}>
                              <Crown className="w-2.5 h-2.5" /> Heaviest
                            </span>
                          )}
                          {volumeKingHere && !heaviestHere && (
                            <span className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase text-blue-400 bg-blue-500/10`}>
                              <TrendingUp className="w-2.5 h-2.5" /> Most volume
                            </span>
                          )}
                        </div>
                        <div className={`font-mono ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>
                          {s.topWeight}kg × {s.topReps}{' '}
                          <span className={`${dimText}`}>· {formatVolume(s.volume)} kg vol · {s.sets} sets</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {solo.length > 0 && (
        <div className="space-y-2">
          <div className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>
            Solo lifts (not compared)
          </div>
          <div className={`rounded-xl border p-3 space-y-1.5 ${surfaceBorder} ${tileBg}`}>
            {solo.map((k) => {
              const stat = participants
                .map((p) => byUid.get(p.uid)?.get(k))
                .find((s): s is ExerciseStat => !!s)!;
              const owner = nameOf(stat.uid);
              const isMe = stat.uid === myUid;
              return (
                <div key={k} className="flex items-center justify-between text-xs">
                  <div className="min-w-0">
                    <span className="truncate">{stat.name}</span>{' '}
                    <span className={`${dimText}`}>
                      — {isMe ? 'you' : owner} only
                    </span>
                  </div>
                  <div className={`font-mono ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>
                    {stat.topWeight}kg × {stat.topReps}{' '}
                    <span className={`${dimText}`}>· {stat.sets} sets</span>
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
