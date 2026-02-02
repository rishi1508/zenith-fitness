import { useState } from 'react';
import { ChevronLeft, ChevronRight, X, Plus, Search, Dumbbell, Trash2 } from 'lucide-react';
import * as storage from '../storage';

export function ExerciseManagerView({ isDark, onBack, onExercisesChange }: {
  isDark: boolean;
  onBack: () => void;
  onExercisesChange: () => void;
}) {
  const [exercises, setExercises] = useState(() => storage.getExercises());
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMuscleGroup, setNewMuscleGroup] = useState<string>('chest');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedExerciseId, setExpandedExerciseId] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [editingVideoUrl, setEditingVideoUrl] = useState<string | null>(null);
  
  const muscleGroups = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core', 'full_body', 'other'];
  
  const filteredExercises = exercises.filter(ex =>
    ex.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    ex.muscleGroup.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const handleAdd = () => {
    if (!newName.trim()) return;
    storage.addCustomExercise(newName.trim(), newMuscleGroup);
    setExercises(storage.getExercises());
    setNewName('');
    setIsAdding(false);
    onExercisesChange();
  };
  
  const handleDelete = (id: string, name: string) => {
    if (confirm(`Delete exercise "${name}"?\n\nWarning: This will affect all templates and workouts using this exercise.`)) {
      const allExercises = storage.getExercises().filter(e => e.id !== id);
      localStorage.setItem('zenith_exercises', JSON.stringify(allExercises));
      setExercises(allExercises);
      onExercisesChange();
    }
  };
  
  const handleSaveNotes = (exerciseId: string) => {
    const allExercises = storage.getExercises();
    const exerciseIndex = allExercises.findIndex(e => e.id === exerciseId);
    if (exerciseIndex >= 0) {
      allExercises[exerciseIndex] = {
        ...allExercises[exerciseIndex],
        notes: editingNotes?.trim() || undefined,
        videoUrl: editingVideoUrl?.trim() || undefined,
      };
      localStorage.setItem('zenith_exercises', JSON.stringify(allExercises));
      setExercises(allExercises);
      setEditingNotes(null);
      setEditingVideoUrl(null);
      setExpandedExerciseId(null);
      onExercisesChange();
    }
  };
  
  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">Exercise Library</h1>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="ml-auto p-2 bg-orange-500 rounded-lg hover:bg-orange-400 transition-colors"
        >
          {isAdding ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
        </button>
      </div>
      
      {/* Add New Exercise */}
      {isAdding && (
        <div className={`rounded-xl p-4 ${isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'}`}>
          <div className="space-y-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Exercise name"
              className={`w-full p-3 rounded-lg border ${
                isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-white border-gray-200'
              } focus:outline-none focus:border-orange-500`}
            />
            <select
              value={newMuscleGroup}
              onChange={(e) => setNewMuscleGroup(e.target.value)}
              className={`w-full p-3 rounded-lg border ${
                isDark ? 'bg-[#252525] border-[#3e3e3e] text-white' : 'bg-white border-gray-200'
              } focus:outline-none focus:border-orange-500`}
            >
              {muscleGroups.map(mg => (
                <option key={mg} value={mg}>
                  {mg.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </option>
              ))}
            </select>
            <button
              onClick={handleAdd}
              disabled={!newName.trim()}
              className="w-full py-3 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Add Exercise
            </button>
          </div>
        </div>
      )}
      
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
      
      {/* Exercise Count */}
      <div className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
        {filteredExercises.length} exercise{filteredExercises.length !== 1 ? 's' : ''}
        {searchQuery && ` matching "${searchQuery}"`}
      </div>
      
      {/* Exercise List */}
      <div className="space-y-2">
        {filteredExercises.map(exercise => {
          const isExpanded = expandedExerciseId === exercise.id;
          
          return (
            <div
              key={exercise.id}
              className={`rounded-xl overflow-hidden ${
                isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'
              }`}
            >
              <div className="p-4 flex items-center justify-between">
                <button
                  onClick={() => setExpandedExerciseId(isExpanded ? null : exercise.id)}
                  className="flex items-center gap-3 flex-1 text-left"
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    exercise.muscleGroup === 'chest' ? 'bg-blue-500/20' :
                    exercise.muscleGroup === 'back' ? 'bg-green-500/20' :
                    exercise.muscleGroup === 'legs' ? 'bg-purple-500/20' :
                    exercise.muscleGroup === 'shoulders' ? 'bg-yellow-500/20' :
                    exercise.muscleGroup === 'biceps' || exercise.muscleGroup === 'triceps' ? 'bg-red-500/20' :
                    'bg-orange-500/20'
                  }`}>
                    <Dumbbell className={`w-5 h-5 ${
                      exercise.muscleGroup === 'chest' ? 'text-blue-400' :
                      exercise.muscleGroup === 'back' ? 'text-green-400' :
                      exercise.muscleGroup === 'legs' ? 'text-purple-400' :
                      exercise.muscleGroup === 'shoulders' ? 'text-yellow-400' :
                      exercise.muscleGroup === 'biceps' || exercise.muscleGroup === 'triceps' ? 'text-red-400' :
                      'text-orange-400'
                    }`} />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">{exercise.name}</div>
                    <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                      {exercise.muscleGroup.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      {exercise.isCompound && ' • Compound'}
                      {exercise.notes && ' • Has notes'}
                    </div>
                  </div>
                  <ChevronRight className={`w-5 h-5 ${isDark ? 'text-zinc-500' : 'text-gray-400'} transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </button>
                {exercise.id.startsWith('custom_') || exercise.id.startsWith('imported_') ? (
                  <button
                    onClick={() => handleDelete(exercise.id, exercise.name)}
                    className={`p-2 rounded-lg transition-colors ml-2 ${
                      isDark ? 'text-zinc-500 hover:text-red-400 hover:bg-red-500/10' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                    }`}
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                ) : (
                  <div className={`text-xs px-2 py-1 rounded ml-2 ${isDark ? 'bg-[#252525] text-zinc-500' : 'bg-gray-100 text-gray-500'}`}>
                    Default
                  </div>
                )}
              </div>
              
              {/* Expanded notes editor */}
              {isExpanded && (
                <div className={`px-4 pb-4 border-t ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}>
                  <div className="pt-3 space-y-3">
                    <div className="space-y-2">
                      <label className={`text-sm font-medium ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
                        Personal Notes
                      </label>
                      <textarea
                        value={editingNotes ?? exercise.notes ?? ''}
                        onChange={(e) => setEditingNotes(e.target.value)}
                        placeholder="Add form cues, pain points, RPE targets..."
                        rows={3}
                        className={`w-full p-3 rounded-lg border ${
                          isDark ? 'bg-[#252525] border-[#3e3e3e] text-white placeholder-zinc-500' : 'bg-white border-gray-200 placeholder-gray-400'
                        } focus:outline-none focus:border-orange-500 resize-none`}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <label className={`text-sm font-medium ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
                        Video URL (optional)
                      </label>
                      <input
                        type="url"
                        value={editingVideoUrl ?? exercise.videoUrl ?? ''}
                        onChange={(e) => setEditingVideoUrl(e.target.value)}
                        placeholder="https://youtube.com/..."
                        className={`w-full p-3 rounded-lg border ${
                          isDark ? 'bg-[#252525] border-[#3e3e3e] text-white placeholder-zinc-500' : 'bg-white border-gray-200 placeholder-gray-400'
                        } focus:outline-none focus:border-orange-500`}
                      />
                    </div>
                    
                    <button
                      onClick={() => handleSaveNotes(exercise.id)}
                      className="w-full py-2 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-400 transition-colors"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
