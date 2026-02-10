import { useState, useMemo } from 'react';
import { 
  ChevronLeft, Scale, 
  TrendingUp, TrendingDown, Minus, Dumbbell, Check
} from 'lucide-react';
import type { Workout } from '../types';

interface ComparisonViewProps {
  workouts: Workout[];
  isDark: boolean;
  onBack: () => void;
}

interface WorkoutStats {
  totalVolume: number;
  exerciseCount: number;
  setCount: number;
  avgWeightPerSet: number;
  duration?: number;
  exercises: Map<string, { name: string; volume: number; maxWeight: number; sets: number }>;
}

function calculateWorkoutStats(workout: Workout): WorkoutStats {
  const exercises = new Map<string, { name: string; volume: number; maxWeight: number; sets: number }>();
  let totalVolume = 0;
  let totalSets = 0;
  let totalWeight = 0;
  let setCount = 0;

  workout.exercises.forEach(ex => {
    let exVolume = 0;
    let exMaxWeight = 0;
    let exSets = 0;

    ex.sets.forEach(set => {
      if (set.completed && set.weight > 0 && set.reps > 0) {
        const volume = set.weight * set.reps;
        exVolume += volume;
        totalVolume += volume;
        totalWeight += set.weight;
        setCount++;
        exSets++;
        if (set.weight > exMaxWeight) exMaxWeight = set.weight;
      }
    });

    totalSets += exSets;
    exercises.set(ex.exerciseId, {
      name: ex.exerciseName,
      volume: exVolume,
      maxWeight: exMaxWeight,
      sets: exSets,
    });
  });

  return {
    totalVolume,
    exerciseCount: workout.exercises.length,
    setCount: totalSets,
    avgWeightPerSet: setCount > 0 ? Math.round(totalWeight / setCount) : 0,
    duration: workout.duration,
    exercises,
  };
}

export function ComparisonView({ workouts, isDark, onBack }: ComparisonViewProps) {
  const [workout1Id, setWorkout1Id] = useState<string | null>(null);
  const [workout2Id, setWorkout2Id] = useState<string | null>(null);
  const [selectingFor, setSelectingFor] = useState<1 | 2 | null>(null);

  // Filter to completed workouts only (exclude rest days)
  const completedWorkouts = useMemo(() => 
    workouts
      .filter(w => w.completed && w.type !== 'rest' && w.exercises.length > 0)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [workouts]
  );

  const workout1 = completedWorkouts.find(w => w.id === workout1Id);
  const workout2 = completedWorkouts.find(w => w.id === workout2Id);

  const stats1 = workout1 ? calculateWorkoutStats(workout1) : null;
  const stats2 = workout2 ? calculateWorkoutStats(workout2) : null;

  // Diff indicator component
  const DiffIndicator = ({ val1, val2, suffix = '', invert = false }: { val1: number; val2: number; suffix?: string; invert?: boolean }) => {
    if (!val1 || !val2) return null;
    const diff = val2 - val1;
    const pct = val1 !== 0 ? ((diff / val1) * 100).toFixed(0) : '∞';
    const isPositive = invert ? diff < 0 : diff > 0;
    const isNegative = invert ? diff > 0 : diff < 0;
    
    if (diff === 0) {
      return <span className="text-xs text-zinc-500 flex items-center gap-1"><Minus className="w-3 h-3" /> Same</span>;
    }
    return (
      <span className={`text-xs flex items-center gap-1 ${isPositive ? 'text-emerald-400' : isNegative ? 'text-red-400' : 'text-zinc-500'}`}>
        {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        {diff > 0 ? '+' : ''}{diff}{suffix} ({pct}%)
      </span>
    );
  };

  // Workout selector modal
  if (selectingFor !== null) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-4">
          <button onClick={() => setSelectingFor(null)} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-lg font-bold">Select Workout {selectingFor}</h1>
        </div>

        <div className={`rounded-xl overflow-hidden ${isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'}`}>
          <div className={`divide-y ${isDark ? 'divide-[#2e2e2e]' : 'divide-gray-200'}`} style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
            {completedWorkouts.length === 0 ? (
              <div className={`px-4 py-8 text-center ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                <Dumbbell className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <div>Complete some workouts first</div>
              </div>
            ) : (
              completedWorkouts.map(w => {
                const isSelected = (selectingFor === 1 && w.id === workout1Id) || (selectingFor === 2 && w.id === workout2Id);
                const isOtherSelected = (selectingFor === 1 && w.id === workout2Id) || (selectingFor === 2 && w.id === workout1Id);
                const stats = calculateWorkoutStats(w);
                
                return (
                  <button
                    key={w.id}
                    onClick={() => {
                      if (selectingFor === 1) setWorkout1Id(w.id);
                      else setWorkout2Id(w.id);
                      setSelectingFor(null);
                    }}
                    disabled={isOtherSelected}
                    className={`w-full px-4 py-3 text-left flex items-center justify-between transition-colors ${
                      isOtherSelected 
                        ? 'opacity-50 cursor-not-allowed' 
                        : isSelected 
                          ? isDark ? 'bg-orange-500/20' : 'bg-orange-100'
                          : isDark ? 'hover:bg-[#252525]' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        isSelected ? 'bg-orange-500' : 'bg-orange-500/20'
                      }`}>
                        {isSelected ? <Check className="w-5 h-5 text-white" /> : <Dumbbell className="w-5 h-5 text-orange-400" />}
                      </div>
                      <div>
                        <div className="font-medium">{w.name}</div>
                        <div className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                          {new Date(w.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-medium ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>
                        {(stats.totalVolume / 1000).toFixed(1)}t
                      </div>
                      <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                        {stats.exerciseCount} ex • {stats.setCount} sets
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }

  // Main comparison view
  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">Compare Workouts</h1>
      </div>

      {/* Workout Selectors */}
      <div className="grid grid-cols-2 gap-3">
        {/* Workout 1 */}
        <button
          onClick={() => setSelectingFor(1)}
          className={`p-4 rounded-xl border-2 border-dashed text-left transition-colors ${
            workout1 
              ? isDark ? 'border-blue-500/50 bg-blue-500/10' : 'border-blue-400 bg-blue-50'
              : isDark ? 'border-[#3e3e3e] hover:border-[#5e5e5e]' : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <div className={`text-xs font-medium mb-1 ${workout1 ? 'text-blue-400' : isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
            WORKOUT 1
          </div>
          {workout1 ? (
            <>
              <div className="font-medium truncate">{workout1.name}</div>
              <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                {new Date(workout1.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </div>
            </>
          ) : (
            <div className={isDark ? 'text-zinc-400' : 'text-gray-400'}>Tap to select</div>
          )}
        </button>

        {/* Workout 2 */}
        <button
          onClick={() => setSelectingFor(2)}
          className={`p-4 rounded-xl border-2 border-dashed text-left transition-colors ${
            workout2 
              ? isDark ? 'border-purple-500/50 bg-purple-500/10' : 'border-purple-400 bg-purple-50'
              : isDark ? 'border-[#3e3e3e] hover:border-[#5e5e5e]' : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <div className={`text-xs font-medium mb-1 ${workout2 ? 'text-purple-400' : isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
            WORKOUT 2
          </div>
          {workout2 ? (
            <>
              <div className="font-medium truncate">{workout2.name}</div>
              <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                {new Date(workout2.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </div>
            </>
          ) : (
            <div className={isDark ? 'text-zinc-400' : 'text-gray-400'}>Tap to select</div>
          )}
        </button>
      </div>

      {/* Clear Selection */}
      {(workout1 || workout2) && (
        <button
          onClick={() => { setWorkout1Id(null); setWorkout2Id(null); }}
          className={`w-full py-2 text-sm rounded-lg ${isDark ? 'bg-[#1a1a1a] text-zinc-400' : 'bg-gray-100 text-gray-500'}`}
        >
          Clear Selection
        </button>
      )}

      {/* Comparison Stats - Show when both selected */}
      {stats1 && stats2 && workout1 && workout2 && (
        <div className="space-y-4">
          {/* Overview Stats */}
          <div className={`rounded-xl p-4 ${isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'}`}>
            <div className="text-sm font-medium mb-3 flex items-center gap-2">
              <Scale className="w-4 h-4 text-orange-400" />
              Overall Comparison
            </div>
            
            <div className="space-y-3">
              {/* Total Volume */}
              <div className="flex items-center justify-between">
                <div className="text-blue-400 font-medium">{(stats1.totalVolume / 1000).toFixed(1)}t</div>
                <div className="text-center flex-1 px-2">
                  <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Volume</div>
                  <DiffIndicator val1={stats1.totalVolume} val2={stats2.totalVolume} suffix="kg" />
                </div>
                <div className="text-purple-400 font-medium">{(stats2.totalVolume / 1000).toFixed(1)}t</div>
              </div>

              {/* Set Count */}
              <div className="flex items-center justify-between">
                <div className="text-blue-400 font-medium">{stats1.setCount}</div>
                <div className="text-center flex-1 px-2">
                  <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Sets</div>
                  <DiffIndicator val1={stats1.setCount} val2={stats2.setCount} />
                </div>
                <div className="text-purple-400 font-medium">{stats2.setCount}</div>
              </div>

              {/* Avg Weight */}
              <div className="flex items-center justify-between">
                <div className="text-blue-400 font-medium">{stats1.avgWeightPerSet}kg</div>
                <div className="text-center flex-1 px-2">
                  <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Avg Weight</div>
                  <DiffIndicator val1={stats1.avgWeightPerSet} val2={stats2.avgWeightPerSet} suffix="kg" />
                </div>
                <div className="text-purple-400 font-medium">{stats2.avgWeightPerSet}kg</div>
              </div>

              {/* Duration (if available) */}
              {(stats1.duration || stats2.duration) && (
                <div className="flex items-center justify-between">
                  <div className="text-blue-400 font-medium">{stats1.duration || '-'}m</div>
                  <div className="text-center flex-1 px-2">
                    <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Duration</div>
                    {stats1.duration && stats2.duration && (
                      <DiffIndicator val1={stats1.duration} val2={stats2.duration} suffix="m" invert />
                    )}
                  </div>
                  <div className="text-purple-400 font-medium">{stats2.duration || '-'}m</div>
                </div>
              )}
            </div>
          </div>

          {/* Exercise-by-Exercise Comparison */}
          <div className={`rounded-xl p-4 ${isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'}`}>
            <div className="text-sm font-medium mb-3 flex items-center gap-2">
              <Dumbbell className="w-4 h-4 text-orange-400" />
              Exercise Breakdown
            </div>

            {/* Find common and unique exercises */}
            {(() => {
              const allExerciseIds = new Set([...stats1.exercises.keys(), ...stats2.exercises.keys()]);
              const rows = Array.from(allExerciseIds).map(id => {
                const ex1 = stats1.exercises.get(id);
                const ex2 = stats2.exercises.get(id);
                const name = ex1?.name || ex2?.name || id;
                return { id, name, ex1, ex2 };
              }).sort((a, b) => a.name.localeCompare(b.name));

              return (
                <div className="space-y-2">
                  {rows.map(({ id, name, ex1, ex2 }) => (
                    <div key={id} className={`py-2 border-b last:border-0 ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}>
                      <div className="text-sm font-medium mb-1">{name}</div>
                      <div className="flex items-center justify-between text-xs">
                        <div className={ex1 ? 'text-blue-400' : 'text-zinc-600'}>
                          {ex1 ? `${ex1.maxWeight}kg • ${ex1.volume}vol` : '—'}
                        </div>
                        <div className="flex-1 text-center px-2">
                          {ex1 && ex2 && (
                            <DiffIndicator val1={ex1.volume} val2={ex2.volume} />
                          )}
                          {!ex1 && <span className="text-purple-400/60">New in #2</span>}
                          {!ex2 && <span className="text-blue-400/60">Only in #1</span>}
                        </div>
                        <div className={ex2 ? 'text-purple-400' : 'text-zinc-600'}>
                          {ex2 ? `${ex2.maxWeight}kg • ${ex2.volume}vol` : '—'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Summary Card */}
          <div className={`rounded-xl p-4 ${
            stats2.totalVolume > stats1.totalVolume 
              ? 'bg-emerald-500/10 border border-emerald-500/30' 
              : stats2.totalVolume < stats1.totalVolume
                ? 'bg-red-500/10 border border-red-500/30'
                : isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'
          }`}>
            <div className="text-center">
              {stats2.totalVolume > stats1.totalVolume ? (
                <>
                  <TrendingUp className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                  <div className="font-medium text-emerald-400">
                    Workout 2 had {((stats2.totalVolume / stats1.totalVolume - 1) * 100).toFixed(0)}% more volume!
                  </div>
                  <div className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                    +{((stats2.totalVolume - stats1.totalVolume) / 1000).toFixed(1)} tonnes lifted
                  </div>
                </>
              ) : stats2.totalVolume < stats1.totalVolume ? (
                <>
                  <TrendingDown className="w-8 h-8 text-red-400 mx-auto mb-2" />
                  <div className="font-medium text-red-400">
                    Workout 2 had {((1 - stats2.totalVolume / stats1.totalVolume) * 100).toFixed(0)}% less volume
                  </div>
                  <div className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                    -{((stats1.totalVolume - stats2.totalVolume) / 1000).toFixed(1)} tonnes difference
                  </div>
                </>
              ) : (
                <>
                  <Minus className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
                  <div className="font-medium">Same total volume!</div>
                  <div className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                    Both workouts had {(stats1.totalVolume / 1000).toFixed(1)} tonnes
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {(!workout1 || !workout2) && (
        <div className={`text-center py-12 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
          <Scale className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="mb-2">Select two workouts to compare</p>
          <p className="text-sm">See how your performance changed over time</p>
        </div>
      )}
    </div>
  );
}
