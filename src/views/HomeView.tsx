import { useState, useEffect } from 'react';
import { ChevronRight, Settings, Trash2, ArrowRight, Clock } from 'lucide-react';
import type { Workout, WorkoutTemplate } from '../types';
import { WeeklyPlanSelector } from '../components/WeeklyPlanSelector';
import { VersionInfo } from '../UpdateChecker';
import { useAuth } from '../auth/AuthContext';

interface HomeViewProps {
  workouts: Workout[];
  isDark: boolean;
  onStartWorkout: (template: WorkoutTemplate) => void;
  onViewHistory: () => void;
  onManagePlans?: () => void;
  activeWorkout?: Workout | null;
  onResumeWorkout?: () => void;
  onDiscardWorkout?: () => void;
}

export function HomeView({ workouts, isDark, onStartWorkout, onViewHistory, onManagePlans, activeWorkout, onResumeWorkout, onDiscardWorkout }: HomeViewProps) {
  const { user } = useAuth();
  const firstName = user?.displayName?.split(' ')[0] || 'Champ';

  // Elapsed timer for paused workout banner
  const [pausedElapsed, setPausedElapsed] = useState('');
  useEffect(() => {
    if (!activeWorkout?.startedAt) {
      setPausedElapsed('');
      return;
    }
    const formatElapsed = () => {
      const startTime = new Date(activeWorkout.startedAt!).getTime();
      const diffMs = Date.now() - startTime;
      const totalMinutes = Math.floor(diffMs / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      if (hours > 0) return `${hours}h ${minutes}m`;
      return `${minutes}m`;
    };
    setPausedElapsed(formatElapsed());
    const interval = setInterval(() => setPausedElapsed(formatElapsed()), 10000);
    return () => clearInterval(interval);
  }, [activeWorkout?.startedAt]);

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
      {/* Paused Workout Banner */}
      {activeWorkout && onResumeWorkout && onDiscardWorkout && (
        <div className={`rounded-xl p-4 border-2 ${
          isDark ? 'bg-orange-500/10 border-orange-500/50' : 'bg-orange-50 border-orange-300'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-orange-400">Workout in progress</div>
            <div className={`flex items-center gap-1 text-sm font-mono ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
              <Clock className="w-3.5 h-3.5" />
              {pausedElapsed}
            </div>
          </div>
          <div className={`text-sm mb-3 ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>
            {activeWorkout.name} &middot; {activeWorkout.exercises.length} exercise{activeWorkout.exercises.length !== 1 ? 's' : ''}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onDiscardWorkout}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                isDark
                  ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Trash2 className="w-4 h-4" />
              Discard
            </button>
            <button
              onClick={onResumeWorkout}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <ArrowRight className="w-4 h-4" />
              Resume
            </button>
          </div>
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
