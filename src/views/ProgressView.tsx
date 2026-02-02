import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Dumbbell, Search, TrendingUp, Trophy } from 'lucide-react';
import type { Workout } from '../types';
import * as storage from '../storage';
import { calculateEstimated1RM } from '../utils';
import { VolumeLineChart } from '../VolumeLineChart';

interface ProgressViewProps {
  workouts: Workout[];
  isDark: boolean;
  onBack: () => void;
}

export function ProgressView({ workouts, isDark, onBack }: ProgressViewProps) {
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const completedWorkouts = workouts.filter(w => w.completed && w.type !== 'rest');
  
  // Get ALL exercises from library, with session counts
  const exerciseList = useMemo(() => {
    const allExercises = storage.getExercises();
    const sessionCounts = new Map<string, number>();
    
    // Count sessions for each exercise
    completedWorkouts.forEach(workout => {
      workout.exercises.forEach(exercise => {
        sessionCounts.set(exercise.exerciseId, (sessionCounts.get(exercise.exerciseId) || 0) + 1);
      });
    });
    
    // Map all exercises with their session counts
    return allExercises.map(ex => ({
      id: ex.id,
      name: ex.name,
      sessionCount: sessionCounts.get(ex.id) || 0,
    })).sort((a, b) => b.sessionCount - a.sessionCount || a.name.localeCompare(b.name));
  }, [completedWorkouts]);

  // Get data for selected exercise
  const exerciseData = useMemo(() => {
    if (!selectedExercise) return null;
    
    const sessions: { date: string; volume: number; maxWeight: number; maxReps: number; sets: { weight: number; reps: number }[] }[] = [];
    let prWeight = 0;
    let prReps = 0;
    let prDate = '';
    
    completedWorkouts
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .forEach(workout => {
        const exercise = workout.exercises.find(e => e.exerciseId === selectedExercise);
        if (exercise) {
          let sessionVolume = 0;
          let sessionMaxWeight = 0;
          let sessionMaxReps = 0;
          const completedSets: { weight: number; reps: number }[] = [];
          
          exercise.sets.forEach(set => {
            if (set.completed && set.weight > 0 && set.reps > 0) {
              const setVolume = set.weight * set.reps;
              sessionVolume += setVolume;
              completedSets.push({ weight: set.weight, reps: set.reps });
              
              if (set.weight > sessionMaxWeight) {
                sessionMaxWeight = set.weight;
                sessionMaxReps = set.reps;
              }
              
              // PR: highest weight × max reps WITH that weight
              if (set.weight > prWeight || (set.weight === prWeight && set.reps > prReps)) {
                prWeight = set.weight;
                prReps = set.reps;
                prDate = workout.date;
              }
            }
          });
          
          if (completedSets.length > 0) {
            sessions.push({
              date: workout.date,
              volume: sessionVolume,
              maxWeight: sessionMaxWeight,
              maxReps: sessionMaxReps,
              sets: completedSets,
            });
          }
        }
      });
    
    // Calculate trend (comparing last 3 sessions average volume to previous 3)
    let trend: 'improving' | 'declining' | 'stable' = 'stable';
    if (sessions.length >= 6) {
      const recent3 = sessions.slice(-3).reduce((sum, s) => sum + s.volume, 0) / 3;
      const previous3 = sessions.slice(-6, -3).reduce((sum, s) => sum + s.volume, 0) / 3;
      const change = ((recent3 - previous3) / previous3) * 100;
      if (change > 5) trend = 'improving';
      else if (change < -5) trend = 'declining';
    } else if (sessions.length >= 2) {
      const last = sessions[sessions.length - 1].volume;
      const secondLast = sessions[sessions.length - 2].volume;
      if (last > secondLast * 1.05) trend = 'improving';
      else if (last < secondLast * 0.95) trend = 'declining';
    }
    
    return {
      sessions,
      pr: { weight: prWeight, reps: prReps, date: prDate },
      trend,
      totalVolume: sessions.reduce((sum, s) => sum + s.volume, 0),
    };
  }, [selectedExercise, completedWorkouts]);

  // If an exercise is selected, show detail view
  if (selectedExercise && exerciseData) {
    const exerciseName = exerciseList.find(e => e.id === selectedExercise)?.name || '';
    
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-4">
          <button onClick={() => setSelectedExercise(null)} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-lg font-bold truncate">{exerciseName}</h1>
        </div>

        {/* PR Card with Estimated 1RM */}
        <div className={`bg-gradient-to-br from-yellow-500/20 to-yellow-500/5 border border-yellow-500/30 rounded-xl p-4 ${!isDark && 'from-yellow-100 to-yellow-50'}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Trophy className="w-5 h-5 text-yellow-500" />
                <span className="text-sm font-medium text-yellow-600">Personal Record</span>
              </div>
              <div className="text-3xl font-bold">{exerciseData.pr.weight}kg × {exerciseData.pr.reps}</div>
              {exerciseData.pr.date && (
                <div className={`text-sm mt-1 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                  {new Date(exerciseData.pr.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              )}
            </div>
            {/* Estimated 1RM */}
            {exerciseData.pr.weight > 0 && (
              <div className={`text-right pl-4 border-l ${isDark ? 'border-yellow-500/30' : 'border-yellow-300'}`}>
                <div className={`text-xs mb-1 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>Est. 1RM</div>
                <div className="text-2xl font-bold text-yellow-500">
                  {calculateEstimated1RM(exerciseData.pr.weight, exerciseData.pr.reps)}kg
                </div>
                <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>Epley formula</div>
              </div>
            )}
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-2">
          <div className={`rounded-xl p-3 text-center ${isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'}`}>
            <div className="text-lg font-bold">{exerciseData.sessions.length}</div>
            <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Sessions</div>
          </div>
          <div className={`rounded-xl p-3 text-center ${isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'}`}>
            <div className="text-lg font-bold">{(exerciseData.totalVolume / 1000).toFixed(1)}t</div>
            <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Total Volume</div>
          </div>
          <div className={`border rounded-xl p-3 text-center ${
            exerciseData.trend === 'improving' ? 'bg-emerald-500/10 border-emerald-500/30' :
            exerciseData.trend === 'declining' ? 'bg-red-500/10 border-red-500/30' :
            isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'
          }`}>
            <div className={`text-lg font-bold ${
              exerciseData.trend === 'improving' ? 'text-emerald-400' :
              exerciseData.trend === 'declining' ? 'text-red-400' : ''
            }`}>
              {exerciseData.trend === 'improving' ? '↑' : exerciseData.trend === 'declining' ? '↓' : '→'}
            </div>
            <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Trend</div>
          </div>
        </div>

        {/* Volume Line Chart */}
        <VolumeLineChart sessions={exerciseData.sessions} />

        {/* Recent Sessions */}
        <div className={`rounded-xl p-4 ${isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'}`}>
          <div className="text-sm font-medium mb-3">Recent Sessions</div>
          <div className="space-y-3">
            {exerciseData.sessions.slice(-5).reverse().map((session, i) => (
              <div key={i} className={`flex items-center justify-between py-2 border-b last:border-0 ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}>
                <div>
                  <div className="text-sm">{new Date(session.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                  <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                    {session.sets.map(s => `${s.weight}kg×${s.reps}`).join(', ')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium">{session.maxWeight}kg</div>
                  <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>{session.volume} vol</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Main progress view - exercise list
  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">Progress</h1>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className={`bg-gradient-to-br rounded-xl p-4 ${isDark ? 'from-orange-500/20 to-orange-500/5 border border-orange-500/20' : 'from-orange-100 to-orange-50 border border-orange-200'}`}>
          <div className="text-2xl font-bold">{completedWorkouts.length}</div>
          <div className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>Total Workouts</div>
        </div>
        <div className={`bg-gradient-to-br rounded-xl p-4 ${isDark ? 'from-emerald-500/20 to-emerald-500/5 border border-emerald-500/20' : 'from-emerald-100 to-emerald-50 border border-emerald-200'}`}>
          <div className="text-2xl font-bold">{exerciseList.length}</div>
          <div className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>Exercises Tracked</div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search exercises..."
          className={`w-full pl-10 pr-4 py-3 rounded-lg border ${
            isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white placeholder-zinc-500' : 'bg-white border-gray-200 placeholder-gray-400'
          } focus:outline-none focus:border-orange-500`}
        />
      </div>

      {/* Exercise List - tap to see details */}
      <div className={`rounded-xl overflow-hidden ${isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'}`}>
        <div className={`px-4 py-3 border-b ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-orange-400" />
            <span className="text-sm font-medium">Exercise Progress</span>
          </div>
          <div className={`text-xs mt-1 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
            {searchQuery ? `${exerciseList.filter(ex => ex.name.toLowerCase().includes(searchQuery.toLowerCase())).length} matching` : `${exerciseList.length} total exercises`} - Tap to see details
          </div>
        </div>
        <div className={`divide-y overflow-y-auto ${isDark ? 'divide-[#2e2e2e]' : 'divide-gray-200'}`} style={{ maxHeight: 'calc(100vh - 400px)' }}>
          {exerciseList.length === 0 ? (
            <div className={`px-4 py-8 text-center ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
              <Dumbbell className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <div>Complete workouts to see exercise progress</div>
            </div>
          ) : (
            exerciseList
              .filter(ex => ex.name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map(exercise => (
              <button
                key={exercise.id}
                onClick={() => setSelectedExercise(exercise.id)}
                className={`w-full px-4 py-3 flex items-center justify-between transition-colors ${isDark ? 'hover:bg-[#252525]' : 'hover:bg-gray-50'}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
                    <Dumbbell className="w-4 h-4 text-orange-400" />
                  </div>
                  <span className="text-sm">{exercise.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>{exercise.sessionCount} sessions</span>
                  <ChevronRight className={`w-4 h-4 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`} />
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Empty State */}
      {completedWorkouts.length === 0 && (
        <div className={`text-center py-8 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
          <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Complete some workouts to see your progress!</p>
        </div>
      )}
    </div>
  );
}
