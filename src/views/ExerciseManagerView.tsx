import { useState } from 'react';
import { ChevronLeft, ChevronRight, X, Plus, Search, Dumbbell, Trash2, Star } from 'lucide-react';
import * as storage from '../storage';
import type { Exercise, ExerciseCategory } from '../types';
import { addToSharedExerciseLibrary } from '../firestoreSync';

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
  // Drafts are SEEDED with the exercise's current values when it's
  // expanded, so:
  //   1. Switching between exercises doesn't leak draft text from one
  //      into another's textarea.
  //   2. Saving while only one field was edited doesn't null-overwrite
  //      the others — every field reflects either the user's edit or
  //      the original value, never a stale draft from a different
  //      exercise.
  // Earlier these were nullable and the save path coerced null →
  // undefined, silently wiping notes / video URLs that the user
  // didn't intentionally clear.
  const [editingNotes, setEditingNotes] = useState<string>('');
  const [editingVideoUrl, setEditingVideoUrl] = useState<string>('');
  const [editingCategory, setEditingCategory] = useState<ExerciseCategory>('isolation');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  
  const muscleGroups = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core', 'full_body', 'other'];
  
  const filteredExercises = exercises
    .filter(ex => !showFavoritesOnly || ex.isFavorite)
    .filter(ex =>
      ex.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ex.muscleGroup.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      // Favorites first, then alphabetical
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return a.name.localeCompare(b.name);
    });
  
  const toggleFavorite = (exerciseId: string) => {
    storage.toggleExerciseFavorite(exerciseId);
    setExercises(storage.getExercises());
  };
  
  const favoriteCount = exercises.filter(e => e.isFavorite).length;
  
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
      storage.saveExercises(allExercises);
      setExercises(allExercises);
      onExercisesChange();
    }
  };
  
  // Expand / collapse an exercise. On EXPAND we seed the draft fields
  // from the exercise itself — that way the textarea always shows
  // THAT exercise's notes (not a leftover draft from a different one),
  // and Save can read all three drafts as the source of truth without
  // null-coercing them.
  const handleToggleExpand = (exercise: Exercise) => {
    if (expandedExerciseId === exercise.id) {
      setExpandedExerciseId(null);
      return;
    }
    setExpandedExerciseId(exercise.id);
    setEditingNotes(exercise.notes ?? '');
    setEditingVideoUrl(exercise.videoUrl ?? '');
    setEditingCategory(
      exercise.category ?? (exercise.isCompound ? 'compound' : 'isolation'),
    );
  };

  const handleSaveNotes = (exerciseId: string) => {
    // Read fresh from storage in case a cloud sync landed mid-edit.
    const allExercises = storage.getExercises();
    const exerciseIndex = allExercises.findIndex(e => e.id === exerciseId);
    if (exerciseIndex < 0) return;

    const existing = allExercises[exerciseIndex];
    const trimmedNotes = editingNotes.trim();
    const trimmedVideoUrl = editingVideoUrl.trim();
    const updated: Exercise = {
      ...existing,
      // Empty string means user explicitly cleared the field → store
      // undefined. Non-empty stores the trimmed text. Fields the user
      // never opened don't reach this code path because the save
      // button is only inside the expanded panel.
      notes: trimmedNotes ? trimmedNotes : undefined,
      videoUrl: trimmedVideoUrl ? trimmedVideoUrl : undefined,
      category: editingCategory,
    };
    allExercises[exerciseIndex] = updated;
    storage.saveExercises(allExercises);
    // Propagate the edit to the shared exercise library so every buddy
    // who has the same exercise gets the updated notes / video on their
    // next pull. Fire-and-forget — the local save is the source of
    // truth; cross-device is best-effort.
    addToSharedExerciseLibrary(updated).catch((err) =>
      console.error('[Exercises] Failed to share notes:', err),
    );
    setExercises(allExercises);
    setExpandedExerciseId(null);
    onExercisesChange();
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
      
      {/* Search + Favorites Filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
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
        <button
          onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
          className={`px-4 py-3 rounded-lg border flex items-center gap-2 transition-colors ${
            showFavoritesOnly
              ? 'bg-yellow-500 border-yellow-500 text-black'
              : isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-zinc-400' : 'bg-white border-gray-200 text-gray-500'
          }`}
        >
          <Star className={`w-5 h-5 ${showFavoritesOnly ? 'fill-current' : ''}`} />
          {favoriteCount > 0 && <span className="text-sm">{favoriteCount}</span>}
        </button>
      </div>
      
      {/* Exercise Count */}
      <div className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
        {filteredExercises.length} exercise{filteredExercises.length !== 1 ? 's' : ''}
        {showFavoritesOnly && ' (favorites)'}
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
                  onClick={() => handleToggleExpand(exercise)}
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
                {/* Favorite Toggle */}
                <button
                  onClick={() => toggleFavorite(exercise.id)}
                  className={`p-2 rounded-lg transition-colors ${
                    exercise.isFavorite
                      ? 'text-yellow-400'
                      : isDark ? 'text-zinc-600 hover:text-yellow-400' : 'text-gray-300 hover:text-yellow-500'
                  }`}
                >
                  <Star className={`w-5 h-5 ${exercise.isFavorite ? 'fill-current' : ''}`} />
                </button>
                {exercise.id.startsWith('custom_') || exercise.id.startsWith('imported_') ? (
                  <button
                    onClick={() => handleDelete(exercise.id, exercise.name)}
                    className={`p-2 rounded-lg transition-colors ${
                      isDark ? 'text-zinc-500 hover:text-red-400 hover:bg-red-500/10' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                    }`}
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                ) : (
                  <div className={`text-xs px-2 py-1 rounded ${isDark ? 'bg-[#252525] text-zinc-500' : 'bg-gray-100 text-gray-500'}`}>
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
                        value={editingNotes}
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
                        value={editingVideoUrl}
                        onChange={(e) => setEditingVideoUrl(e.target.value)}
                        placeholder="https://youtube.com/..."
                        className={`w-full p-3 rounded-lg border ${
                          isDark ? 'bg-[#252525] border-[#3e3e3e] text-white placeholder-zinc-500' : 'bg-white border-gray-200 placeholder-gray-400'
                        } focus:outline-none focus:border-orange-500`}
                      />
                    </div>

                    {/* Category — drives the smart rest-timer defaults */}
                    <div className="space-y-2">
                      <label className={`text-sm font-medium ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
                        Category
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {(['compound','isolation','cardio','core','other'] as const).map((cat) => {
                          const active = editingCategory === cat;
                          return (
                            <button
                              key={cat}
                              onClick={() => setEditingCategory(cat)}
                              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                                active
                                  ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white'
                                  : isDark
                                    ? 'bg-[#252525] text-zinc-400 hover:bg-[#303030]'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              }`}
                            >
                              {cat.charAt(0).toUpperCase() + cat.slice(1)}
                            </button>
                          );
                        })}
                      </div>
                      <div className={`text-[11px] ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                        Compound exercises get a longer default rest (3 min) than isolation (75 s).
                      </div>
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
