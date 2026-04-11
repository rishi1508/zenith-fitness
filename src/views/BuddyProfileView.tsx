import { useState, useEffect } from 'react';
import {
  ArrowLeft, Dumbbell, Flame, TrendingUp,
  MessageCircle, Clock, Target, Loader2, Zap, UserMinus,
} from 'lucide-react';
import type { UserProfile, Workout, UserStats, BuddyRelationship } from '../types';
import * as buddyService from '../buddyService';

interface BuddyProfileViewProps {
  buddyUid: string;
  buddyName: string;
  isDark: boolean;
  onBack: () => void;
  onOpenChat: (chatId: string, buddyName: string) => void;
  onStartWorkoutTogether: () => void;
}

export function BuddyProfileView({
  buddyUid, buddyName, isDark, onBack, onOpenChat, onStartWorkoutTogether,
}: BuddyProfileViewProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [buddy, setBuddy] = useState<BuddyRelationship | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [p, s, w, buddies] = await Promise.all([
          buddyService.getUserProfile(buddyUid),
          buddyService.getBuddyStats(buddyUid),
          buddyService.getBuddyWorkouts(buddyUid),
          buddyService.getBuddies(),
        ]);
        setProfile(p);
        setStats(s);
        setWorkouts(w.filter((wk) => wk.completed && wk.type !== 'rest')
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
        const rel = buddies.find((b) => b.users.includes(buddyUid));
        setBuddy(rel || null);
      } catch (err) {
        console.error('[BuddyProfile] Failed to load:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [buddyUid]);

  const handleRemoveBuddy = async () => {
    if (!buddy) return;
    if (!confirm(`Remove ${buddyName} as a buddy? You can always add them back later.`)) return;
    await buddyService.removeBuddy(buddy.id);
    onBack();
  };

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtleText = isDark ? 'text-zinc-400' : 'text-gray-500';
  const hoverBg = isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${hoverBg}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">Buddy Profile</h1>
      </div>

      {/* Profile Card */}
      <div className={`rounded-2xl border p-5 text-center ${cardBg} ${cardBorder}`}>
        <div className="relative inline-block mb-3">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-white font-bold text-3xl mx-auto">
            {buddyName.charAt(0).toUpperCase()}
          </div>
          {profile?.isWorkingOut && (
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-[#0f0f0f] flex items-center justify-center">
              <Dumbbell className="w-3.5 h-3.5 text-white" />
            </div>
          )}
        </div>
        <h2 className="text-lg font-bold">{buddyName}</h2>
        {profile?.isWorkingOut && (
          <div className="text-sm text-emerald-400 flex items-center justify-center gap-1 mt-1">
            <Flame className="w-4 h-4" />
            Working out: {profile.activeWorkoutName || 'In progress'}
          </div>
        )}
        {profile && !profile.isWorkingOut && profile.joinedAt && (
          <div className={`text-xs ${subtleText} mt-1`}>
            Joined {new Date(profile.joinedAt).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </div>
        )}
      </div>

      {/* Stats Grid */}
      {stats && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: <Dumbbell className="w-5 h-5" />, value: stats.totalWorkouts, label: 'Workouts', color: 'text-orange-400', bg: 'bg-orange-500/10' },
            { icon: <Flame className="w-5 h-5" />, value: `${stats.currentStreak}d`, label: 'Streak', color: 'text-red-400', bg: 'bg-red-500/10' },
            { icon: <TrendingUp className="w-5 h-5" />, value: stats.thisWeekWorkouts, label: 'This Week', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
            { icon: <Zap className="w-5 h-5" />, value: stats.avgVolumePerSession > 0 ? `${Math.round(stats.avgVolumePerSession / 1000)}k` : '0', label: 'Avg Volume (kg)', color: 'text-blue-400', bg: 'bg-blue-500/10' },
          ].map(({ icon, value, label, color, bg }, i) => (
            <div key={i} className={`rounded-xl border p-3 ${cardBg} ${cardBorder}`}>
              <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center ${color} mb-2`}>
                {icon}
              </div>
              <div className="text-lg font-bold">{value}</div>
              <div className={`text-xs ${subtleText}`}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Action Buttons */}
      {buddy && (
        <div className="flex gap-3">
          <button
            onClick={() => onOpenChat(buddy.chatId, buddyName)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-colors ${
              isDark ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-gray-100 hover:bg-gray-200'
            }`}
          >
            <MessageCircle className="w-4 h-4" /> Chat
          </button>
          <button
            onClick={() => onStartWorkoutTogether()}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity"
          >
            <Dumbbell className="w-4 h-4" /> Workout Together
          </button>
        </div>
      )}

      {/* Workout History */}
      <div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center justify-between w-full mb-2"
        >
          <h3 className="text-sm font-semibold">Workout History</h3>
          <span className={`text-xs ${subtleText}`}>
            {showHistory ? 'Hide' : `Show (${workouts.length})`}
          </span>
        </button>

        {showHistory && (
          <div className="space-y-2">
            {workouts.length === 0 ? (
              <p className={`text-sm text-center py-6 ${subtleText}`}>No workouts yet</p>
            ) : (
              workouts.slice(0, 20).map((w) => {
                const totalVolume = w.exercises.reduce((sum, ex) =>
                  sum + ex.sets.reduce((sSum, s) => sSum + (s.weight * s.reps), 0), 0
                );
                return (
                  <div
                    key={w.id}
                    className={`rounded-xl border p-3 ${cardBg} ${cardBorder}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="font-medium text-sm">{w.name}</div>
                      <div className={`text-xs ${subtleText}`}>
                        {new Date(w.date).toLocaleDateString('en-IN', {
                          day: 'numeric', month: 'short',
                        })}
                      </div>
                    </div>
                    <div className={`flex items-center gap-3 text-xs ${subtleText}`}>
                      <span className="flex items-center gap-1">
                        <Target className="w-3 h-3" /> {w.exercises.length} exercises
                      </span>
                      <span className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" /> {Math.round(totalVolume).toLocaleString()} kg
                      </span>
                      {w.duration && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {w.duration}m
                        </span>
                      )}
                    </div>
                    {/* Exercises list */}
                    <div className={`mt-2 text-xs ${subtleText}`}>
                      {w.exercises.map((ex) => (
                        <div key={ex.id} className="flex justify-between py-0.5">
                          <span>{ex.exerciseName}</span>
                          <span>
                            {ex.sets.filter((s) => s.completed).length} sets
                            {ex.sets.some((s) => s.weight > 0) &&
                              ` @ ${Math.max(...ex.sets.filter((s) => s.completed).map((s) => s.weight))}kg`
                            }
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
            {workouts.length > 20 && (
              <p className={`text-xs text-center ${subtleText}`}>
                Showing latest 20 of {workouts.length} workouts
              </p>
            )}
          </div>
        )}
      </div>

      {/* Remove Buddy */}
      {buddy && (
        <button
          onClick={handleRemoveBuddy}
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-colors ${
            isDark ? 'text-red-400 bg-red-500/10 hover:bg-red-500/20' : 'text-red-600 bg-red-50 hover:bg-red-100'
          }`}
        >
          <UserMinus className="w-4 h-4" /> Remove Buddy
        </button>
      )}
    </div>
  );
}
