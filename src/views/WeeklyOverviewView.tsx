import { Calendar, ChevronLeft, ChevronRight, Check, Target, Dumbbell } from 'lucide-react';
import * as storage from '../storage';

// Weekly Overview View - 7-day calendar grid
export function WeeklyOverviewView({ isDark, onBack, onStartDay }: {
  isDark: boolean;
  onBack: () => void;
  onStartDay: (dayIndex: number) => void;
}) {
  const activePlan = storage.getActivePlan();
  const workouts = storage.getWorkouts();
  
  if (!activePlan) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold">Week View</h1>
        </div>
        <div className={`p-8 rounded-xl border text-center ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
          <Calendar className={`w-12 h-12 mx-auto mb-3 ${isDark ? 'text-zinc-600' : 'text-gray-400'}`} />
          <p className={`font-medium mb-2 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>No Active Plan</p>
          <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
            Set an active plan in Templates to see your weekly schedule here.
          </p>
        </div>
      </div>
    );
  }
  
  // Get this week's workouts (last 7 days)
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - 6); // Last 7 days
  
  const thisWeekWorkouts = workouts.filter(w => {
    const workoutDate = new Date(w.date);
    return workoutDate >= startOfWeek && workoutDate <= today && w.completed;
  });
  
  // Map workouts to day names for easy lookup
  const workoutsByDayName = new Map<string, typeof workouts>();
  thisWeekWorkouts.forEach(w => {
    const dayName = activePlan.days.find(d => w.name.includes(d.name))?.name || '';
    if (dayName) {
      const existing = workoutsByDayName.get(dayName) || [];
      workoutsByDayName.set(dayName, [...existing, w]);
    }
  });
  
  const lastUsedDay = storage.getLastUsedDay() ?? 0;
  const totalDays = activePlan.days.length;
  const workoutDays = activePlan.days.filter(d => !d.isRestDay);
  
  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Week View</h1>
          <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>{activePlan.name}</p>
        </div>
      </div>
      
      {/* Week Progress */}
      <div className={`p-4 rounded-xl border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
        <div className="flex justify-between items-center mb-2">
          <span className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>This Week Progress</span>
          <span className="text-sm font-medium text-orange-400">
            {thisWeekWorkouts.length}/{workoutDays.length} workouts
          </span>
        </div>
        <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-[#2e2e2e]' : 'bg-gray-200'}`}>
          <div
            className="h-full bg-gradient-to-r from-orange-500 to-red-500 transition-all"
            style={{ width: `${(thisWeekWorkouts.length / workoutDays.length) * 100}%` }}
          />
        </div>
      </div>
      
      {/* Day Cards Grid */}
      <div className="grid grid-cols-1 gap-3">
        {activePlan.days.map((day, index) => {
          const isRestDay = day.isRestDay;
          const isToday = index === lastUsedDay;
          const workoutsForDay = workoutsByDayName.get(day.name) || [];
          const completedToday = workoutsForDay.length > 0;
          
          return (
            <button
              key={index}
              onClick={() => !isRestDay && onStartDay(index)}
              disabled={isRestDay}
              className={`p-4 rounded-xl border text-left transition-all ${
                isRestDay 
                  ? isDark ? 'bg-[#1a1a1a]/50 border-[#2e2e2e] opacity-60' : 'bg-gray-50 border-gray-200 opacity-60'
                  : completedToday
                  ? isDark ? 'bg-green-500/10 border-green-500/30' : 'bg-green-50 border-green-200'
                  : isToday
                  ? isDark ? 'bg-orange-500/10 border-orange-500/30' : 'bg-orange-50 border-orange-200'
                  : isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] hover:border-orange-500/50' : 'bg-white border-gray-200 hover:border-orange-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    isRestDay
                      ? isDark ? 'bg-zinc-700' : 'bg-gray-200'
                      : completedToday
                      ? 'bg-green-500/20'
                      : isToday
                      ? 'bg-orange-500/20'
                      : isDark ? 'bg-[#252525]' : 'bg-gray-100'
                  }`}>
                    {isRestDay ? (
                      <span className="text-lg">😴</span>
                    ) : completedToday ? (
                      <Check className="w-5 h-5 text-green-400" />
                    ) : isToday ? (
                      <Target className="w-5 h-5 text-orange-400" />
                    ) : (
                      <Dumbbell className={`w-5 h-5 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`} />
                    )}
                  </div>
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {day.name}
                      {isToday && (
                        <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded">Next Up</span>
                      )}
                      {completedToday && (
                        <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">✓ Done</span>
                      )}
                    </div>
                    <div className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                      {isRestDay ? 'Rest & Recovery' : `${day.exercises.length} exercises`}
                    </div>
                  </div>
                </div>
                {!isRestDay && <ChevronRight className={`w-5 h-5 ${isDark ? 'text-zinc-600' : 'text-gray-400'}`} />}
              </div>
            </button>
          );
        })}
      </div>
      
      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className={`p-4 rounded-xl border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
          <div className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Workout Days</div>
          <div className="text-2xl font-bold">{workoutDays.length}</div>
        </div>
        <div className={`p-4 rounded-xl border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
          <div className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Rest Days</div>
          <div className="text-2xl font-bold">{totalDays - workoutDays.length}</div>
        </div>
      </div>
    </div>
  );
}
