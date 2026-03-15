import { useState, useEffect } from 'react';
import { CloudOff, RefreshCw, ChevronRight, Settings } from 'lucide-react';
import type { Workout, WorkoutTemplate } from '../types';
import * as sync from '../sync';
import { WeeklyPlanSelector } from '../components/WeeklyPlanSelector';
import { VersionInfo } from '../UpdateChecker';
import { useAuth } from '../auth/AuthContext';

interface HomeViewProps {
  workouts: Workout[];
  isDark: boolean;
  onStartWorkout: (template: WorkoutTemplate) => void;
  onViewHistory: () => void;
  onManagePlans?: () => void;
}

export function HomeView({ workouts, isDark, onStartWorkout, onViewHistory, onManagePlans }: HomeViewProps) {
  const { user } = useAuth();
  const firstName = user?.displayName?.split(' ')[0] || 'Champ';
  const [pendingCount, setPendingCount] = useState(() => sync.getPendingCount());
  const [syncing, setSyncing] = useState(false);

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

  return (
    <div className="space-y-4 animate-fadeIn">
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

      {/* Greeting — compact */}
      <div>
        <h1 className="text-2xl font-bold">Hey {firstName}!</h1>
        <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
          {dayNames[today.getDay()]}, {today.toLocaleDateString('en-IN', { month: 'long', day: 'numeric' })}
        </p>
        <p className="text-xs text-orange-400/80 mt-0.5 italic">"{todaysQuote}"</p>
      </div>

      {/* Plan Selection & Start Workout — the main action */}
      <WeeklyPlanSelector
        isDark={isDark}
        onStartWorkout={onStartWorkout}
      />

      {/* Manage Plans */}
      {onManagePlans && (
        <button
          onClick={onManagePlans}
          className={`w-full flex items-center justify-center gap-2 text-sm py-2 rounded-lg transition-colors ${
            isDark ? 'text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1a]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
          }`}
        >
          <Settings className="w-4 h-4" />
          Manage Plans
        </button>
      )}

      {/* Last Workout */}
      {(() => {
        const completedWorkouts = workouts.filter(w => w.completed && w.type !== 'rest');
        if (completedWorkouts.length === 0) return null;
        const last = completedWorkouts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
        return (
          <button
            onClick={onViewHistory}
            className={`w-full text-left text-sm flex items-center gap-2 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}
          >
            Last workout: {new Date(last.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            <ChevronRight className="w-4 h-4" />
          </button>
        );
      })()}

      {/* Version Info */}
      <VersionInfo />
    </div>
  );
}
