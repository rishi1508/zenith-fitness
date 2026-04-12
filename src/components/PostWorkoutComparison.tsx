import { Dumbbell, Clock, TrendingUp, Trophy, Flame, X } from 'lucide-react';
import { Avatar } from './Avatar';
import { useAuth } from '../auth/AuthContext';
import type { WorkoutSession, SessionParticipant } from '../types';

interface PostWorkoutComparisonProps {
  session: WorkoutSession;
  onClose: () => void;
}

export function PostWorkoutComparison({ session, onClose }: PostWorkoutComparisonProps) {
  const { user } = useAuth();
  const participants = Object.values(session.participants).filter(
    (p) => p.status === 'completed' || p.status === 'active'
  );

  // Determine winners for each category
  const maxVolume = Math.max(...participants.map((p) => p.totalVolume));
  const maxSets = Math.max(...participants.map((p) => p.completedSets));
  const minDuration = Math.min(...participants.filter((p) => p.duration).map((p) => p.duration!));

  const getVolumeWinner = (p: SessionParticipant) => p.totalVolume === maxVolume && maxVolume > 0;
  const getSetsWinner = (p: SessionParticipant) => p.completedSets === maxSets && maxSets > 0;
  const getSpeedWinner = (p: SessionParticipant) => p.duration === minDuration && minDuration > 0;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1a1a] rounded-2xl max-w-md w-full max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[#1a1a1a] p-5 pb-3 border-b border-[#2e2e2e] flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="w-5 h-5 text-yellow-400" />
              <h2 className="text-lg font-bold">Session Complete!</h2>
            </div>
            <p className="text-xs text-zinc-400">{session.workoutName}</p>
          </div>
          <button onClick={onClose} className="p-2 text-zinc-500 hover:text-zinc-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Participant Cards */}
          {participants
            .sort((a, b) => b.totalVolume - a.totalVolume) // Sort by volume (winner first)
            .map((p, index) => {
              const isMe = p.uid === user?.uid;
              const isFirst = index === 0;
              return (
                <div
                  key={p.uid}
                  className={`rounded-xl border p-4 ${
                    isFirst
                      ? 'border-yellow-500/30 bg-yellow-500/5'
                      : 'border-[#2e2e2e] bg-[#111]'
                  }`}
                >
                  {/* Name + Rank */}
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
                        {p.name} {isMe && <span className="text-zinc-500 font-normal">(You)</span>}
                      </div>
                      <div className="text-xs text-zinc-400">
                        {isFirst ? 'Most Volume' : `#${index + 1}`}
                      </div>
                    </div>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-3 gap-3">
                    <StatBox
                      icon={<Dumbbell className="w-3.5 h-3.5" />}
                      value={p.totalVolume > 0 ? `${Math.round(p.totalVolume / 1000 * 10) / 10}k` : '0'}
                      label="Volume (kg)"
                      highlight={getVolumeWinner(p)}
                    />
                    <StatBox
                      icon={<TrendingUp className="w-3.5 h-3.5" />}
                      value={String(p.completedSets)}
                      label="Sets"
                      highlight={getSetsWinner(p)}
                    />
                    <StatBox
                      icon={<Clock className="w-3.5 h-3.5" />}
                      value={p.duration ? `${p.duration}m` : '-'}
                      label="Duration"
                      highlight={getSpeedWinner(p)}
                    />
                  </div>
                </div>
              );
            })}

          {/* Motivational footer */}
          <div className="text-center py-2">
            <Flame className="w-8 h-8 text-orange-400 mx-auto mb-2" />
            <p className="text-sm text-zinc-400">
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

function StatBox({ icon, value, label, highlight }: {
  icon: React.ReactNode;
  value: string;
  label: string;
  highlight: boolean;
}) {
  return (
    <div className={`rounded-lg p-2 text-center ${
      highlight ? 'bg-orange-500/10 border border-orange-500/20' : 'bg-[#1a1a1a]'
    }`}>
      <div className={`flex items-center justify-center gap-1 mb-0.5 ${
        highlight ? 'text-orange-400' : 'text-zinc-500'
      }`}>
        {icon}
      </div>
      <div className={`text-sm font-bold ${highlight ? 'text-orange-400' : 'text-white'}`}>
        {value}
      </div>
      <div className="text-[10px] text-zinc-500">{label}</div>
    </div>
  );
}
