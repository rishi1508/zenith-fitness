import { useState } from 'react';
import { Dumbbell, Flame } from 'lucide-react';
import type { WorkoutTemplate } from '../types';
import * as storage from '../storage';

interface WeeklyPlanSelectorProps {
  isDark: boolean;
  onStartWorkout: (template: WorkoutTemplate) => void;
}

export function WeeklyPlanSelector({ isDark, onStartWorkout }: WeeklyPlanSelectorProps) {
  const [plans] = useState(() => storage.getWeeklyPlans());
  const [activePlanId, setActivePlanId] = useState(() => storage.getActivePlanId() || plans[0]?.id);
  const [selectedDayNum, setSelectedDayNum] = useState(() => storage.getLastUsedDay() || 1);
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  
  const activePlan = plans.find(p => p.id === activePlanId);
  const workoutDays = activePlan?.days.filter(d => !d.isRestDay) || [];
  const selectedDay = activePlan?.days.find(d => d.dayNumber === selectedDayNum);
  
  // Sync active plan to storage
  const handlePlanChange = (planId: string) => {
    setActivePlanId(planId);
    storage.setActivePlanId(planId);
    setShowPlanPicker(false);
    // Reset to first workout day of new plan
    const newPlan = plans.find(p => p.id === planId);
    const firstWorkoutDay = newPlan?.days.find(d => !d.isRestDay);
    if (firstWorkoutDay) {
      setSelectedDayNum(firstWorkoutDay.dayNumber);
      storage.setLastUsedDay(firstWorkoutDay.dayNumber);
    }
  };
  
  const handleDayChange = (dayNum: number) => {
    setSelectedDayNum(dayNum);
    storage.setLastUsedDay(dayNum);
  };
  
  // Convert DayPlan to WorkoutTemplate for starting workout
  const startWorkoutForDay = () => {
    if (!selectedDay || selectedDay.isRestDay || !activePlan) return;
    
    // Create workout name with plan name (e.g., "4FB+1Arms - Day 1")
    const workoutName = `${activePlan.name} - ${selectedDay.name}`;
    
    const template: WorkoutTemplate = {
      id: `${activePlanId}_day_${selectedDay.dayNumber}`,
      name: workoutName,
      type: 'custom',
      exercises: selectedDay.exercises,
      weeklyPlanId: activePlanId || undefined,
    };
    
    onStartWorkout(template);
  };
  
  if (plans.length === 0) {
    return (
      <div className={`rounded-xl p-6 text-center ${isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'}`}>
        <Dumbbell className="w-10 h-10 mx-auto mb-2 text-zinc-500 opacity-50" />
        <p className="text-zinc-500">No workout plans available</p>
        <p className="text-xs text-zinc-600 mt-1">Import from Google Sheets in Settings</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-3">
      {/* Active Plan Label */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Start Workout</h2>
        <button
          onClick={() => setShowPlanPicker(!showPlanPicker)}
          className={`text-sm px-3 py-1 rounded-lg transition-colors ${
            isDark 
              ? 'bg-[#252525] text-orange-400 hover:bg-[#2e2e2e]' 
              : 'bg-orange-50 text-orange-600 hover:bg-orange-100'
          }`}
        >
          {activePlan?.name || 'Select Plan'}
        </button>
      </div>
      
      {/* Plan Picker Modal */}
      {showPlanPicker && (
        <div className={`rounded-xl p-3 border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
          <div className="text-xs text-zinc-500 mb-2">Switch Weekly Plan:</div>
          <div className="space-y-1">
            {plans.map(plan => (
              <button
                key={plan.id}
                onClick={() => handlePlanChange(plan.id)}
                className={`w-full text-left p-3 rounded-lg transition-colors ${
                  plan.id === activePlanId
                    ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                    : isDark ? 'hover:bg-[#252525]' : 'hover:bg-gray-100'
                }`}
              >
                <div className="font-medium">{plan.name}</div>
                <div className="text-xs text-zinc-500">
                  {plan.days.filter(d => !d.isRestDay).length} workout days
                  {plan.isImported && ' • Imported'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* Day Selector Dropdown */}
      {activePlan && !showPlanPicker && (
        <>
          <select
            value={selectedDayNum}
            onChange={(e) => handleDayChange(Number(e.target.value))}
            className={`w-full p-4 rounded-xl border text-base font-medium appearance-none cursor-pointer ${
              isDark 
                ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white' 
                : 'bg-white border-gray-200 text-gray-900'
            } focus:outline-none focus:border-orange-500`}
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23666'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', backgroundSize: '20px' }}
          >
            {workoutDays.map(day => (
              <option key={day.dayNumber} value={day.dayNumber}>
                {day.name} ({day.exercises.length} exercises)
              </option>
            ))}
          </select>
          
          {/* Selected Day Preview */}
          {selectedDay && !selectedDay.isRestDay && (
            <div className={`rounded-xl p-4 ${isDark ? 'bg-[#252525]' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                  <Dumbbell className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <div className="font-medium">{selectedDay.name}</div>
                  <div className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                    {selectedDay.exercises.length} exercises
                  </div>
                </div>
              </div>
              
              {/* Exercise list preview */}
              <div className={`text-xs space-y-1 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                {selectedDay.exercises.slice(0, 5).map((ex, i) => (
                  <div key={i}>• {ex.exerciseName}</div>
                ))}
                {selectedDay.exercises.length > 5 && (
                  <div>+ {selectedDay.exercises.length - 5} more</div>
                )}
              </div>
            </div>
          )}
          
          {/* Start Button */}
          {selectedDay && !selectedDay.isRestDay && (
            <button
              onClick={startWorkoutForDay}
              className="w-full py-4 bg-gradient-to-r from-orange-500 to-red-600 rounded-xl font-semibold text-white shadow-lg shadow-orange-500/20 hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <Flame className="w-5 h-5" />
              Start Workout
            </button>
          )}
        </>
      )}
    </div>
  );
}
