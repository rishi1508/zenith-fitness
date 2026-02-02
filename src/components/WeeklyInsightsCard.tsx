import { TrendingUp } from 'lucide-react';
import type { Workout } from '../types';
import { formatVolume } from '../utils';

interface WeeklyInsightsCardProps {
  workouts: Workout[];
}

export function WeeklyInsightsCard({ workouts }: WeeklyInsightsCardProps) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  
  const thisWeekWorkouts = workouts.filter(w => 
    w.completed && w.type !== 'rest' && new Date(w.date) >= weekStart
  );
  
  const lastWeekWorkouts = workouts.filter(w => {
    const d = new Date(w.date);
    return w.completed && w.type !== 'rest' && d >= lastWeekStart && d < weekStart;
  });
  
  const calculateVolume = (ws: Workout[]) => ws.reduce((total, w) => 
    total + w.exercises.reduce((et, e) => 
      et + e.sets.reduce((st, s) => st + (s.completed ? s.weight * s.reps : 0), 0), 0), 0);
  
  const thisWeekVolume = calculateVolume(thisWeekWorkouts);
  const lastWeekVolume = calculateVolume(lastWeekWorkouts);
  const volumeChange = lastWeekVolume > 0 ? ((thisWeekVolume - lastWeekVolume) / lastWeekVolume * 100) : 0;
  
  if (thisWeekWorkouts.length === 0 && lastWeekWorkouts.length === 0) return null;
  
  return (
    <div className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-5 h-5 text-indigo-400" />
        <span className="font-medium">This Week</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-2xl font-bold">{formatVolume(thisWeekVolume)}</div>
          <div className="text-sm text-zinc-400 flex items-center gap-1">
            Volume
            {volumeChange !== 0 && (
              <span className={volumeChange > 0 ? 'text-emerald-400' : 'text-red-400'}>
                {volumeChange > 0 ? '↑' : '↓'}{Math.abs(volumeChange).toFixed(0)}%
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-2xl font-bold">{thisWeekWorkouts.length}</div>
          <div className="text-sm text-zinc-400">
            Workouts
            {lastWeekWorkouts.length > 0 && (
              <span className="text-zinc-500"> (was {lastWeekWorkouts.length})</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
