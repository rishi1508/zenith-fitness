import { Target, Trophy, ChevronRight, CloudOff, RefreshCw } from 'lucide-react';
import { useState, useEffect } from 'react';
import type { Workout, WorkoutTemplate, UserStats } from '../types';
import * as storage from '../storage';
import * as sync from '../sync';
import { StatCard, WeeklyInsightsCard } from '../components';
import { WeeklyPlanSelector } from '../components/WeeklyPlanSelector';
import { VersionInfo } from '../UpdateChecker';

interface HomeViewProps {
  stats: UserStats | null;
  workouts: Workout[];
  isDark: boolean;
  onStartWorkout: (template: WorkoutTemplate) => void;
  onViewHistory: () => void;
}

export function HomeView({ stats, workouts, isDark, onStartWorkout, onViewHistory }: HomeViewProps) {
  const [pendingCount, setPendingCount] = useState(() => sync.getPendingCount());
  const [syncing, setSyncing] = useState(false);
  
  // Check pending count periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setPendingCount(sync.getPendingCount());
    }, 5000);
    return () => clearInterval(interval);
  }, []);
  
  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await sync.processQueue();
      setPendingCount(sync.getPendingCount());
    } catch (err) {
      console.error('Sync failed:', err);
    }
    setSyncing(false);
  };
  
  const today = new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  // Daily motivation quotes
  const quotes = [
    "The only bad workout is the one that didn't happen.",
    "Your body can stand almost anything. It's your mind you have to convince.",
    "Progress, not perfection.",
    "The pain you feel today will be the strength you feel tomorrow.",
    "Discipline is choosing between what you want now and what you want most.",
    "Your future self will thank you.",
    "Every rep counts. Every set matters.",
    "Consistency beats intensity.",
    "Strong mind, strong body.",
    "You don't have to be great to start, but you have to start to be great.",
    "Results happen over time, not overnight.",
    "The gym is my therapy.",
  ];
  const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000);
  const todaysQuote = quotes[dayOfYear % quotes.length];
  
  // Check for consecutive workout days (suggest rest)
  const getConsecutiveWorkoutDays = () => {
    const sortedWorkouts = workouts
      .filter(w => w.completed && w.type !== 'rest')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    let consecutiveDays = 0;
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    
    for (const workout of sortedWorkouts) {
      const workoutDate = new Date(workout.date);
      workoutDate.setHours(0, 0, 0, 0);
      
      const daysDiff = Math.floor((todayDate.getTime() - workoutDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysDiff === consecutiveDays) {
        consecutiveDays++;
      } else {
        break;
      }
    }
    
    return consecutiveDays;
  };
  
  const consecutiveDays = getConsecutiveWorkoutDays();
  const shouldSuggestRest = consecutiveDays >= 3;
  
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Pending Sync Banner */}
      {pendingCount > 0 && (
        <div className={`rounded-xl p-3 border flex items-center justify-between ${
          isDark ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-yellow-50 border-yellow-200'
        }`}>
          <div className="flex items-center gap-2">
            <CloudOff className={`w-4 h-4 ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`} />
            <span className={`text-sm ${isDark ? 'text-yellow-300' : 'text-yellow-700'}`}>
              {pendingCount} workout{pendingCount > 1 ? 's' : ''} waiting to sync
            </span>
          </div>
          <button
            onClick={handleSyncNow}
            disabled={syncing}
            className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors ${
              isDark ? 'bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30' : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
            } ${syncing ? 'opacity-50' : ''}`}
          >
            <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      )}
      
      {/* Rest Day Suggestion */}
      {shouldSuggestRest && (
        <div className={`rounded-xl p-4 border ${
          isDark ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-200'
        }`}>
          <div className="flex items-start gap-3">
            <div className="text-2xl">💤</div>
            <div className="flex-1">
              <div className={`font-medium mb-1 ${isDark ? 'text-blue-300' : 'text-blue-900'}`}>
                Consider Taking a Rest Day
              </div>
              <div className={`text-sm ${isDark ? 'text-blue-400/80' : 'text-blue-700'}`}>
                You've worked out {consecutiveDays} days in a row. Recovery is when muscles grow!
              </div>
              <button
                onClick={() => {
                  const workout: Workout = {
                    id: `rest_${Date.now()}`,
                    date: new Date().toISOString(),
                    name: 'Rest Day',
                    type: 'rest',
                    exercises: [],
                    completed: true,
                  };
                  storage.saveWorkout(workout);
                  window.location.reload();
                }}
                className={`mt-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isDark ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                }`}
              >
                Log Rest Day
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold">Hey Rishi! 💪</h1>
        <p className={`${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>{dayNames[today.getDay()]}, {today.toLocaleDateString('en-IN', { month: 'long', day: 'numeric' })}</p>
        <p className="text-sm text-orange-400/80 mt-1 italic">"{todaysQuote}"</p>
      </div>

      {/* Stats Cards - simplified to useful metrics */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard 
          icon={<Target className="text-emerald-400" />}
          value={stats?.thisWeekWorkouts || 0}
          label="This Week"
          suffix="/5"
          color="emerald"
        />
        <StatCard 
          icon={<Trophy className="text-orange-400" />}
          value={stats?.totalWorkouts || 0}
          label="Total Workouts"
          color="orange"
        />
      </div>

      {/* Weekly Insights */}
      <WeeklyInsightsCard workouts={workouts} />

      {/* Weekly Plan Selection & Start */}
      <WeeklyPlanSelector 
        isDark={isDark}
        onStartWorkout={onStartWorkout}
      />

      {/* Recent History */}
      {stats?.lastWorkoutDate && (
        <button
          onClick={onViewHistory}
          className="w-full text-left text-sm text-zinc-500 flex items-center gap-2"
        >
          Last workout: {new Date(stats.lastWorkoutDate).toLocaleDateString()}
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      {/* Version Info */}
      <VersionInfo />
    </div>
  );
}
