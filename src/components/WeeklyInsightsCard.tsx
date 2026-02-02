import { TrendingUp, Flame, Trophy, Target, Calendar } from 'lucide-react';
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
  
  // Calculate current streak (consecutive workout days)
  const calculateStreak = () => {
    const completedWorkouts = workouts
      .filter(w => w.completed && w.type !== 'rest')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    if (completedWorkouts.length === 0) return 0;
    
    let streak = 0;
    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    
    // Check if worked out today or yesterday to start the streak
    const lastWorkoutDate = new Date(completedWorkouts[0].date);
    lastWorkoutDate.setHours(0, 0, 0, 0);
    
    const daysSinceLastWorkout = Math.floor((currentDate.getTime() - lastWorkoutDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceLastWorkout > 1) return 0; // Streak broken
    
    // Count unique workout dates
    const uniqueDates = new Set<string>();
    completedWorkouts.forEach(w => {
      const d = new Date(w.date);
      d.setHours(0, 0, 0, 0);
      uniqueDates.add(d.toISOString().split('T')[0]);
    });
    
    const sortedDates = Array.from(uniqueDates).sort().reverse();
    
    for (let i = 0; i < sortedDates.length; i++) {
      const checkDate = new Date(sortedDates[i]);
      const expectedDate = new Date(currentDate);
      expectedDate.setDate(expectedDate.getDate() - i);
      
      // Allow for 1 day gap (rest days count)
      const diff = Math.abs(checkDate.getTime() - expectedDate.getTime()) / (1000 * 60 * 60 * 24);
      if (diff <= 1) {
        streak++;
      } else {
        break;
      }
    }
    
    return streak;
  };
  
  // Count PRs this week (exercises with higher weight than any previous)
  const countPRsThisWeek = () => {
    let prCount = 0;
    const exerciseMaxes = new Map<string, number>();
    
    // Build historical maxes (before this week)
    workouts
      .filter(w => w.completed && new Date(w.date) < weekStart)
      .forEach(w => {
        w.exercises.forEach(e => {
          const maxWeight = Math.max(...e.sets.filter(s => s.completed).map(s => s.weight), 0);
          const current = exerciseMaxes.get(e.name) || 0;
          if (maxWeight > current) exerciseMaxes.set(e.name, maxWeight);
        });
      });
    
    // Check this week for PRs
    thisWeekWorkouts.forEach(w => {
      w.exercises.forEach(e => {
        const maxWeight = Math.max(...e.sets.filter(s => s.completed).map(s => s.weight), 0);
        const historical = exerciseMaxes.get(e.name) || 0;
        if (maxWeight > historical && maxWeight > 0) {
          prCount++;
          exerciseMaxes.set(e.name, maxWeight); // Update so we don't count same PR twice
        }
      });
    });
    
    return prCount;
  };
  
  // Calculate weekly goal progress (assume 4-5 workouts is the goal)
  const weeklyGoal = 5;
  const goalProgress = Math.min((thisWeekWorkouts.length / weeklyGoal) * 100, 100);
  
  const streak = calculateStreak();
  const prCount = countPRsThisWeek();
  
  if (thisWeekWorkouts.length === 0 && lastWeekWorkouts.length === 0) return null;
  
  return (
    <div className="space-y-3">
      {/* Main Insights Card */}
      <div className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-400" />
            <span className="font-medium">This Week</span>
          </div>
          {streak >= 3 && (
            <div className="flex items-center gap-1 text-orange-400 text-sm">
              <Flame className="w-4 h-4" />
              {streak} day streak!
            </div>
          )}
        </div>
        
        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4 mb-3">
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
              {lastWeekWorkouts.length > 0 && thisWeekWorkouts.length !== lastWeekWorkouts.length && (
                <span className={thisWeekWorkouts.length > lastWeekWorkouts.length ? 'text-emerald-400' : 'text-zinc-500'}>
                  {' '}({thisWeekWorkouts.length > lastWeekWorkouts.length ? '+' : ''}{thisWeekWorkouts.length - lastWeekWorkouts.length})
                </span>
              )}
            </div>
          </div>
        </div>
        
        {/* Weekly Goal Progress Bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-zinc-400">
            <span>Weekly Goal</span>
            <span>{thisWeekWorkouts.length}/{weeklyGoal} workouts</span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all ${
                goalProgress >= 100 ? 'bg-gradient-to-r from-emerald-500 to-green-400' :
                goalProgress >= 60 ? 'bg-gradient-to-r from-indigo-500 to-purple-500' :
                'bg-gradient-to-r from-orange-500 to-red-500'
              }`}
              style={{ width: `${goalProgress}%` }}
            />
          </div>
        </div>
      </div>
      
      {/* Secondary Stats Row */}
      {(streak > 0 || prCount > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {streak > 0 && (
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-500/20 rounded-lg flex items-center justify-center">
                <Flame className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <div className="text-xl font-bold">{streak}</div>
                <div className="text-xs text-zinc-400">Day Streak</div>
              </div>
            </div>
          )}
          {prCount > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-500/20 rounded-lg flex items-center justify-center">
                <Trophy className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <div className="text-xl font-bold">{prCount}</div>
                <div className="text-xs text-zinc-400">PRs This Week</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
