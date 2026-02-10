import { useState, useEffect } from 'react';
import { Target, ChevronDown, ChevronUp, Check } from 'lucide-react';
import type { VolumeGoal, WeeklyVolumeProgress, MuscleGroup } from '../types';
import * as storage from '../storage';

interface VolumeGoalsProps {
  isDark: boolean;
}

const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  legs: 'Legs',
  core: 'Core',
  full_body: 'Full Body',
  other: 'Other',
};

const MUSCLE_EMOJIS: Record<MuscleGroup, string> = {
  chest: '💪',
  back: '🔙',
  shoulders: '🏋️',
  biceps: '💪',
  triceps: '💪',
  legs: '🦵',
  core: '🎯',
  full_body: '🏃',
  other: '❓',
};

export function VolumeGoals({ isDark }: VolumeGoalsProps) {
  const [goals, setGoals] = useState<VolumeGoal[]>(() => storage.getVolumeGoals());
  const [progress, setProgress] = useState<WeeklyVolumeProgress[]>(() => storage.getWeeklyVolumeProgress());
  const [expanded, setExpanded] = useState(false);
  
  const enabledGoals = goals.filter(g => g.enabled);
  const hasGoals = enabledGoals.length > 0;
  
  // Refresh progress
  useEffect(() => {
    setProgress(storage.getWeeklyVolumeProgress());
  }, [goals]);
  
  const toggleGoal = (muscleGroup: MuscleGroup) => {
    const updatedGoals = goals.map(g => 
      g.muscleGroup === muscleGroup ? { ...g, enabled: !g.enabled } : g
    );
    storage.setVolumeGoals(updatedGoals);
    setGoals(updatedGoals);
  };
  
  const updateTargetSets = (muscleGroup: MuscleGroup, targetSets: number) => {
    const updatedGoals = goals.map(g =>
      g.muscleGroup === muscleGroup ? { ...g, targetSets: Math.max(1, targetSets) } : g
    );
    storage.setVolumeGoals(updatedGoals);
    setGoals(updatedGoals);
  };
  
  // Progress bar color based on completion
  const getProgressColor = (percent: number) => {
    if (percent >= 100) return 'bg-emerald-500';
    if (percent >= 75) return 'bg-yellow-500';
    if (percent >= 50) return 'bg-orange-500';
    return 'bg-red-500';
  };
  
  return (
    <div className={`rounded-xl border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${isDark ? 'bg-indigo-500/20' : 'bg-indigo-100'}`}>
            <Target className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="text-left">
            <div className="font-medium">Weekly Volume Goals</div>
            <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
              {hasGoals 
                ? `${enabledGoals.length} muscle group${enabledGoals.length > 1 ? 's' : ''} tracked`
                : 'Set targets for each muscle group'
              }
            </div>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-5 h-5 text-zinc-500" /> : <ChevronDown className="w-5 h-5 text-zinc-500" />}
      </button>
      
      {/* Expanded Content */}
      {expanded && (
        <div className={`px-4 pb-4 border-t ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}>
          {/* Progress Overview (if goals exist) */}
          {hasGoals && progress.length > 0 && (
            <div className="pt-4 pb-3 space-y-3">
              <div className={`text-xs font-medium ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
                This Week's Progress
              </div>
              {progress.map(p => (
                <div key={p.muscleGroup} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{MUSCLE_EMOJIS[p.muscleGroup]} {MUSCLE_LABELS[p.muscleGroup]}</span>
                    <span className={`font-medium ${p.percentComplete >= 100 ? 'text-emerald-400' : ''}`}>
                      {p.completedSets}/{p.targetSets} sets
                      {p.percentComplete >= 100 && <Check className="inline w-4 h-4 ml-1" />}
                    </span>
                  </div>
                  <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-[#2e2e2e]' : 'bg-gray-200'}`}>
                    <div 
                      className={`h-full transition-all ${getProgressColor(p.percentComplete)}`}
                      style={{ width: `${Math.min(100, p.percentComplete)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {/* Goal Settings */}
          <div className={`pt-3 border-t ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}>
            <div className={`text-xs font-medium mb-3 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
              Set Weekly Targets
            </div>
            <div className="space-y-2">
              {goals.filter(g => g.muscleGroup !== 'full_body' && g.muscleGroup !== 'other').map(goal => (
                <div 
                  key={goal.muscleGroup}
                  className={`flex items-center justify-between py-2 ${
                    goal.enabled ? '' : 'opacity-50'
                  }`}
                >
                  <button
                    onClick={() => toggleGoal(goal.muscleGroup)}
                    className="flex items-center gap-2"
                  >
                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                      goal.enabled 
                        ? 'bg-indigo-500 border-indigo-500' 
                        : isDark ? 'border-[#3e3e3e]' : 'border-gray-300'
                    }`}>
                      {goal.enabled && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <span className="text-sm">{MUSCLE_EMOJIS[goal.muscleGroup]} {MUSCLE_LABELS[goal.muscleGroup]}</span>
                  </button>
                  
                  {goal.enabled && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => updateTargetSets(goal.muscleGroup, goal.targetSets - 1)}
                        className={`px-2 py-1 rounded text-sm ${isDark ? 'bg-[#252525]' : 'bg-gray-100'}`}
                      >
                        −
                      </button>
                      <span className={`w-8 text-center text-sm font-medium ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>
                        {goal.targetSets}
                      </span>
                      <button
                        onClick={() => updateTargetSets(goal.muscleGroup, goal.targetSets + 1)}
                        className={`px-2 py-1 rounded text-sm ${isDark ? 'bg-[#252525]' : 'bg-gray-100'}`}
                      >
                        +
                      </button>
                      <span className={`text-xs ml-1 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>sets</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          
          {/* Info */}
          <div className={`text-xs text-center pt-3 mt-3 border-t ${isDark ? 'border-[#2e2e2e] text-zinc-500' : 'border-gray-200 text-gray-500'}`}>
            Based on completed workouts this week (Sun-Sat)
          </div>
        </div>
      )}
    </div>
  );
}
