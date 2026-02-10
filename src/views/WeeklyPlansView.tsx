import { useState } from 'react';
import { 
  Calendar, ChevronLeft, Trash2, 
  ClipboardList, Plus, Edit3, Search, Dumbbell
} from 'lucide-react';
import type { WeeklyPlan, DayPlan, Exercise } from '../types';
import * as storage from '../storage';

// Day Exercise Editor - Edit exercises for a single day (internal component)
function DayExerciseEditor({ day, isDark, onSave, onCancel }: {
  day: DayPlan;
  isDark: boolean;
  onSave: (day: DayPlan) => void;
  onCancel: () => void;
}) {
  const [dayName, setDayName] = useState(day.name);
  const [exercises, setExercises] = useState(day.exercises);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const allExercises = storage.getExercises();
  
  const filteredExercises = allExercises.filter(ex =>
    ex.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const addExercise = (exercise: Exercise) => {
    setExercises([...exercises, {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      defaultSets: 3,
      defaultReps: 10,
    }]);
    setShowExercisePicker(false);
    setSearchQuery('');
  };
  
  const removeExercise = (index: number) => {
    setExercises(exercises.filter((_, i) => i !== index));
  };
  
  const updateExercise = (index: number, field: 'defaultSets' | 'defaultReps', value: number) => {
    const updated = [...exercises];
    updated[index] = { ...updated[index], [field]: value };
    setExercises(updated);
  };
  
  const updateSupersetGroup = (index: number, group: string | undefined) => {
    const updated = [...exercises];
    updated[index] = { ...updated[index], supersetGroup: group };
    setExercises(updated);
  };
  
  // Available superset groups
  const supersetGroups = ['A', 'B', 'C', 'D'];
  
  const handleSave = () => {
    if (!dayName.trim()) {
      alert('Please enter a day name');
      return;
    }
    
    onSave({
      ...day,
      name: dayName.trim(),
      exercises,
    });
  };
  
  if (showExercisePicker) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-4">
          <button onClick={() => setShowExercisePicker(false)} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold">Add Exercise</h1>
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
              isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white' : 'bg-white border-gray-200'
            } focus:outline-none focus:border-orange-500`}
            autoFocus
          />
        </div>
        
        {/* Exercise List */}
        <div className="space-y-2">
          {filteredExercises.map(exercise => (
            <button
              key={exercise.id}
              onClick={() => addExercise(exercise)}
              className={`w-full p-4 rounded-xl border text-left transition-colors ${
                isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] hover:bg-[#252525]' : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className="font-medium">{exercise.name}</div>
              <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                {exercise.muscleGroup.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                {exercise.isCompound && ' • Compound'}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-4">
        <button onClick={onCancel} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">Edit {day.name}</h1>
      </div>
      
      {/* Day Name */}
      <div>
        <label className={`text-sm mb-1 block ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>Day Name</label>
        <input
          type="text"
          value={dayName}
          onChange={(e) => setDayName(e.target.value)}
          placeholder="e.g., Full Body, Arms, Rest"
          className={`w-full rounded-lg px-4 py-3 border ${
            isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white' : 'bg-white border-gray-200'
          } focus:outline-none focus:border-orange-500`}
        />
      </div>
      
      {/* Exercises */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
            Exercises ({exercises.length})
          </label>
          <button
            onClick={() => setShowExercisePicker(true)}
            className="text-sm text-orange-400 hover:text-orange-300 flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            Add Exercise
          </button>
        </div>
        
        {exercises.length === 0 ? (
          <div className={`text-center py-8 rounded-xl border ${
            isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-zinc-500' : 'bg-gray-50 border-gray-200 text-gray-500'
          }`}>
            <Dumbbell className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No exercises yet</p>
            <p className="text-xs mt-1">Tap "Add Exercise" to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            {exercises.map((ex, index) => (
              <div
                key={index}
                className={`rounded-xl p-3 border ${
                  isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex-1 font-medium">{ex.exerciseName}</div>
                  <button
                    onClick={() => removeExercise(index)}
                    className={`p-1 rounded transition-colors ${
                      isDark ? 'hover:bg-red-500/10 text-zinc-500 hover:text-red-400' : 'hover:bg-red-50 text-gray-400 hover:text-red-500'
                    }`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Sets</label>
                    <input
                      type="number"
                      min="1"
                      value={ex.defaultSets}
                      onChange={(e) => updateExercise(index, 'defaultSets', parseInt(e.target.value) || 1)}
                      className={`w-full mt-1 px-3 py-2 rounded-lg border text-sm ${
                        isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-gray-50 border-gray-200'
                      } focus:outline-none focus:border-orange-500`}
                    />
                  </div>
                  <div className="flex-1">
                    <label className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Reps</label>
                    <input
                      type="number"
                      min="1"
                      value={ex.defaultReps}
                      onChange={(e) => updateExercise(index, 'defaultReps', parseInt(e.target.value) || 1)}
                      className={`w-full mt-1 px-3 py-2 rounded-lg border text-sm ${
                        isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-gray-50 border-gray-200'
                      } focus:outline-none focus:border-orange-500`}
                    />
                  </div>
                  <div className="w-20">
                    <label className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>Superset</label>
                    <select
                      value={ex.supersetGroup || ''}
                      onChange={(e) => updateSupersetGroup(index, e.target.value || undefined)}
                      className={`w-full mt-1 px-2 py-2 rounded-lg border text-sm ${
                        isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-gray-50 border-gray-200'
                      } focus:outline-none focus:border-purple-500 ${ex.supersetGroup ? 'border-purple-500/50' : ''}`}
                    >
                      <option value="">—</option>
                      {supersetGroups.map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Save/Cancel */}
      <div className="flex gap-3 pt-4">
        <button
          onClick={onCancel}
          className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
            isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e] text-zinc-400 hover:bg-[#252525]' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="flex-1 py-3 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-400 transition-colors"
        >
          Save Day
        </button>
      </div>
    </div>
  );
}

// Edit Weekly Plan View - Per-day input for creating weekly plans (internal component)
function EditWeeklyPlanView({ plan, isNew, isDark, onSave, onCancel }: {
  plan: WeeklyPlan;
  isNew: boolean;
  isDark: boolean;
  onSave: (plan: WeeklyPlan) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(plan.name);
  const [days, setDays] = useState<DayPlan[]>(plan.days);
  const [editingDayIndex, setEditingDayIndex] = useState<number | null>(null);
  
  const addDay = () => {
    const newDay: DayPlan = {
      dayNumber: days.length + 1,
      name: `Day ${days.length + 1}`,
      exercises: [],
      isRestDay: false,
    };
    setDays([...days, newDay]);
  };
  
  const removeDay = (index: number) => {
    if (days.length <= 1) {
      alert('Plan must have at least one day');
      return;
    }
    const updated = days.filter((_, i) => i !== index);
    // Renumber days
    updated.forEach((d, i) => { d.dayNumber = i + 1; });
    setDays(updated);
  };
  
  const updateDay = (index: number, updatedDay: DayPlan) => {
    const updated = [...days];
    updated[index] = updatedDay;
    setDays(updated);
  };
  
  const toggleRestDay = (index: number) => {
    const updated = [...days];
    updated[index].isRestDay = !updated[index].isRestDay;
    if (updated[index].isRestDay) {
      updated[index].exercises = [];
      updated[index].name = `${updated[index].name.replace(' (Rest)', '')} (Rest)`;
    } else {
      updated[index].name = updated[index].name.replace(' (Rest)', '');
    }
    setDays(updated);
  };
  
  const handleSave = () => {
    if (!name.trim()) {
      alert('Please enter a plan name');
      return;
    }
    if (days.length === 0) {
      alert('Plan must have at least one day');
      return;
    }
    
    onSave({
      ...plan,
      name: name.trim(),
      days,
    });
  };
  
  // If editing a specific day
  if (editingDayIndex !== null) {
    return (
      <DayExerciseEditor
        day={days[editingDayIndex]}
        isDark={isDark}
        onSave={(updatedDay) => {
          updateDay(editingDayIndex, updatedDay);
          setEditingDayIndex(null);
        }}
        onCancel={() => setEditingDayIndex(null)}
      />
    );
  }
  
  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-4">
        <button onClick={onCancel} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">{isNew ? 'New Weekly Plan' : 'Edit Plan'}</h1>
      </div>
      
      {/* Plan Name */}
      <div>
        <label className={`text-sm mb-1 block ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>Plan Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., 4 Full Body + 1 Arms"
          className={`w-full rounded-lg px-4 py-3 border ${
            isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white' : 'bg-white border-gray-200'
          } focus:outline-none focus:border-orange-500`}
        />
      </div>
      
      {/* Days List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
            Days ({days.length} total, {days.filter(d => !d.isRestDay).length} workout)
          </label>
          <button
            onClick={addDay}
            className="text-sm text-orange-400 hover:text-orange-300 flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            Add Day
          </button>
        </div>
        
        <div className="space-y-2">
          {days.map((day, index) => (
            <div
              key={index}
              className={`rounded-xl p-4 border ${
                isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-medium ${
                  day.isRestDay 
                    ? isDark ? 'bg-zinc-700 text-zinc-400' : 'bg-gray-200 text-gray-500'
                    : 'bg-orange-500/20 text-orange-400'
                }`}>
                  {day.dayNumber}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{day.name}</div>
                  <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                    {day.isRestDay ? 'Rest Day' : `${day.exercises.length} exercise${day.exercises.length !== 1 ? 's' : ''}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleRestDay(index)}
                    className={`text-xs px-3 py-1 rounded-lg transition-colors ${
                      day.isRestDay
                        ? isDark ? 'bg-orange-500/20 text-orange-400' : 'bg-orange-100 text-orange-600'
                        : isDark ? 'bg-zinc-700 text-zinc-400' : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {day.isRestDay ? 'Make Workout' : 'Make Rest'}
                  </button>
                  {!day.isRestDay && (
                    <button
                      onClick={() => setEditingDayIndex(index)}
                      className={`p-2 rounded-lg transition-colors ${
                        isDark ? 'hover:bg-[#252525]' : 'hover:bg-gray-100'
                      }`}
                    >
                      <Edit3 className={`w-4 h-4 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`} />
                    </button>
                  )}
                  {days.length > 1 && (
                    <button
                      onClick={() => removeDay(index)}
                      className={`p-2 rounded-lg transition-colors ${
                        isDark ? 'hover:bg-red-500/10 text-zinc-500 hover:text-red-400' : 'hover:bg-red-50 text-gray-400 hover:text-red-500'
                      }`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Save/Cancel */}
      <div className="flex gap-3 pt-4">
        <button
          onClick={onCancel}
          className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
            isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e] text-zinc-400 hover:bg-[#252525]' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="flex-1 py-3 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-400 transition-colors"
        >
          {isNew ? 'Create Plan' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

// Weekly Plans View - Manage weekly workout plans (main exported component)
export function WeeklyPlansView({ isDark, onBack, onPlansChange }: {
  isDark: boolean;
  onBack: () => void;
  onPlansChange: () => void;
}) {
  const [plans, setPlans] = useState(() => storage.getWeeklyPlans());
  const [editingPlan, setEditingPlan] = useState<WeeklyPlan | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  
  const handleDelete = (plan: WeeklyPlan) => {
    if (plan.id === 'default_plan') {
      alert('Cannot delete default plan');
      return;
    }
    if (confirm(`Delete "${plan.name}"?\n\nThis will permanently remove this weekly plan.`)) {
      storage.deleteWeeklyPlan(plan.id);
      setPlans(storage.getWeeklyPlans());
      onPlansChange();
    }
  };
  
  const handleSave = (plan: WeeklyPlan) => {
    storage.saveWeeklyPlan(plan);
    setPlans(storage.getWeeklyPlans());
    onPlansChange();
    setEditingPlan(null);
    setIsCreating(false);
  };
  
  const handleCancel = () => {
    setEditingPlan(null);
    setIsCreating(false);
  };
  
  const createNewPlan = () => {
    const newPlan: WeeklyPlan = {
      id: `custom_plan_${Date.now()}`,
      name: 'New Weekly Plan',
      days: [
        { dayNumber: 1, name: 'Day 1', exercises: [], isRestDay: false }
      ],
      isCustom: true,
    };
    setEditingPlan(newPlan);
    setIsCreating(true);
  };

  // Show edit view if editing
  if (editingPlan) {
    return (
      <EditWeeklyPlanView 
        plan={editingPlan}
        isNew={isCreating}
        isDark={isDark}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold">Weekly Plans</h1>
        </div>
        <button 
          onClick={createNewPlan}
          className="p-2 bg-orange-500 rounded-lg hover:bg-orange-400 transition-colors"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
        Manage your weekly workout plans. Each plan contains multiple days with their own exercises.
      </p>

      <div className="space-y-2">
        {plans.map(plan => {
          const workoutDays = plan.days.filter(d => !d.isRestDay);
          const activePlanId = storage.getActivePlanId();
          const isActive = plan.id === activePlanId;
          
          return (
            <div
              key={plan.id}
              className={`border rounded-xl overflow-hidden ${
                isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200 shadow-sm'
              } ${isActive ? 'ring-2 ring-green-500/50 border-green-500/50' : ''}`}
            >
              <div className={`p-4 ${isDark ? '' : 'bg-white'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                      <Calendar className="w-5 h-5 text-orange-400" />
                    </div>
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {plan.name}
                        {isActive && (
                          <span className="text-sm bg-green-500/20 text-green-400 px-3 py-1 rounded-lg font-semibold">✓ Active</span>
                        )}
                        {plan.isImported && (
                          <span className={`text-xs px-2 py-0.5 rounded ${isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'}`}>Imported</span>
                        )}
                        {plan.isCustom && (
                          <span className={`text-xs px-2 py-0.5 rounded ${isDark ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'}`}>Custom</span>
                        )}
                      </div>
                      <div className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                        {workoutDays.length} workout day{workoutDays.length !== 1 ? 's' : ''} • {plan.days.length - workoutDays.length} rest day{(plan.days.length - workoutDays.length) !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>
                  {!isActive && (
                    <button
                      onClick={() => {
                        storage.setActivePlanId(plan.id);
                        setPlans([...plans]); // Force re-render
                        onPlansChange();
                      }}
                      className={`text-xs px-3 py-1 rounded-lg transition-colors ${
                        isDark ? 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30' : 'bg-orange-100 text-orange-600 hover:bg-orange-200'
                      }`}
                    >
                      Set Active
                    </button>
                  )}
                </div>
              </div>
              
              {/* Action buttons */}
              <div className={`flex border-t ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}>
                <button
                  onClick={() => setEditingPlan(plan)}
                  className={`flex-1 py-2 text-sm flex items-center justify-center gap-1 transition-colors ${
                    isDark ? 'text-zinc-400 hover:text-white hover:bg-[#252525]' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  <Edit3 className="w-4 h-4" />
                  Edit
                </button>
                {plan.id !== 'default_plan' && (
                  <>
                    <div className={`w-px ${isDark ? 'bg-[#2e2e2e]' : 'bg-gray-200'}`} />
                    <button
                      onClick={() => handleDelete(plan)}
                      className={`flex-1 py-2 text-sm flex items-center justify-center gap-1 transition-colors ${
                        isDark ? 'text-zinc-400 hover:text-red-400 hover:bg-[#252525]' : 'text-gray-500 hover:text-red-500 hover:bg-gray-100'
                      }`}
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {plans.filter(p => p.isCustom).length === 0 && (
        <div className={`text-center py-6 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
          <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p>No custom plans yet</p>
          <p className="text-sm">Tap + to create your first weekly plan!</p>
        </div>
      )}
    </div>
  );
}
