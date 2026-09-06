import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X, Plus, Search, Dumbbell, Trash2, Star, FileText, User } from 'lucide-react';
import * as storage from '../storage';
import type { Exercise } from '../types';
import { ExerciseForm } from '../components/ExerciseForm';
import { labelize } from '../exerciseUtils';
import type { ExerciseFormValues } from '../components/ExerciseForm';
import { canEditShared, createAndPublishExercise, publishExercise, deleteSharedExercise } from '../sharedExercises';
import { useAuth } from '../auth/AuthContext';

export function ExerciseManagerView({ isDark, onBack, onExercisesChange }: {
  isDark: boolean;
  onBack: () => void;
  onExercisesChange: () => void;
}) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [exercises, setExercises] = useState(() => storage.getExercises());
  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedExerciseId, setExpandedExerciseId] = useState<string | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  // The shared-library listener merges into storage in the background;
  // re-read so creator notes that just arrived show without a remount.
  useEffect(() => {
    const refresh = () => setExercises(storage.getExercises());
    window.addEventListener('zenith-data-refresh', refresh);
    return () => window.removeEventListener('zenith-data-refresh', refresh);
  }, []);

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

  const handleCreate = (values: ExerciseFormValues) => {
    createAndPublishExercise({
      name: values.name,
      muscleGroup: values.muscleGroup,
      category: values.category,
      equipment: values.equipment,
      sharedNotes: values.sharedNotes || undefined,
      notes: values.notes || undefined,
      videoUrl: values.videoUrl || undefined,
    });
    setExercises(storage.getExercises());
    setIsAdding(false);
    onExercisesChange();
  };

  const handleSave = (exercise: Exercise, values: ExerciseFormValues) => {
    const editable = canEditShared(exercise, uid);
    // Non-creators may only change what is theirs: personal notes.
    const patch: Partial<Exercise> = editable
      ? {
        name: values.name,
        muscleGroup: values.muscleGroup,
        category: values.category,
        equipment: values.equipment,
        sharedNotes: values.sharedNotes,
        notes: values.notes,
        videoUrl: values.videoUrl,
      }
      : { notes: values.notes };
    const updated = storage.updateExercise(exercise.id, patch);
    if (updated && editable && uid) void publishExercise(updated);
    setExercises(storage.getExercises());
    setExpandedExerciseId(null);
    onExercisesChange();
  };

  const handleDelete = async (exercise: Exercise) => {
    if (!confirm(`Delete "${exercise.name}" from your library?\n\nWarning: templates and workouts using it keep the name but lose the link.`)) return;
    if (exercise.createdBy && canEditShared(exercise, uid)) {
      if (confirm('Also remove it from the shared library for everyone?')) {
        await deleteSharedExercise(exercise);
      }
    }
    const remaining = storage.getExercises().filter(e => e.id !== exercise.id);
    storage.saveExercises(remaining);
    setExercises(remaining);
    onExercisesChange();
  };

  const card = isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200';
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';
  const isSeed = (ex: Exercise) => !ex.id.startsWith('custom_') && !ex.id.startsWith('imported_');

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className={`p-2 -ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold">Exercise Library</h1>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="ml-auto p-2 bg-orange-500 rounded-lg hover:bg-orange-400 transition-colors text-white"
        >
          {isAdding ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
        </button>
      </div>

      {/* Add New Exercise */}
      {isAdding && (
        <div className={`rounded-xl p-4 ${card}`}>
          <div className="font-semibold mb-3">New exercise</div>
          <ExerciseForm
            mode="create"
            isDark={isDark}
            canEditShared
            onSubmit={handleCreate}
            onCancel={() => setIsAdding(false)}
            onUseExisting={(ex) => { setIsAdding(false); setSearchQuery(ex.name); setExpandedExerciseId(ex.id); }}
          />
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
      <div className={`text-sm ${subtle}`}>
        {filteredExercises.length} exercise{filteredExercises.length !== 1 ? 's' : ''}
        {showFavoritesOnly && ' (favorites)'}
        {searchQuery && ` matching "${searchQuery}"`}
      </div>

      {/* Exercise List */}
      <div className="space-y-2">
        {filteredExercises.map(exercise => {
          const isExpanded = expandedExerciseId === exercise.id;
          const mine = !exercise.createdBy || exercise.createdBy === uid;
          const editable = canEditShared(exercise, uid);

          return (
            <div key={exercise.id} className={`rounded-xl overflow-hidden ${card}`}>
              <div className="p-4 flex items-center justify-between">
                <button
                  onClick={() => setExpandedExerciseId(isExpanded ? null : exercise.id)}
                  className="flex items-center gap-3 flex-1 text-left min-w-0"
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
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
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{exercise.name}</div>
                    <div className={`text-xs ${subtle} flex flex-wrap items-center gap-x-1.5`}>
                      <span>{labelize(exercise.muscleGroup)}</span>
                      <span>• {labelize(exercise.category ?? (exercise.isCompound ? 'compound' : 'isolation'))}</span>
                      {exercise.equipment && <span>• {labelize(exercise.equipment)}</span>}
                      {exercise.sharedNotes && <span className="inline-flex items-center gap-0.5 text-blue-400"><FileText className="w-3 h-3" /> notes</span>}
                      {exercise.notes && <span className="inline-flex items-center gap-0.5 text-emerald-400"><FileText className="w-3 h-3" /> mine</span>}
                      {!mine && exercise.createdByName && (
                        <span className="inline-flex items-center gap-0.5"><User className="w-3 h-3" /> {exercise.createdByName}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className={`w-5 h-5 flex-shrink-0 ${isDark ? 'text-zinc-500' : 'text-gray-400'} transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
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
                {!isSeed(exercise) ? (
                  <button
                    onClick={() => handleDelete(exercise)}
                    className={`p-2 rounded-lg transition-colors ${
                      isDark ? 'text-zinc-500 hover:text-red-400 hover:bg-red-500/10' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                    }`}
                    title="Remove from your library"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                ) : (
                  <div className={`text-xs px-2 py-1 rounded ${isDark ? 'bg-[#252525] text-zinc-500' : 'bg-gray-100 text-gray-500'}`}>
                    Default
                  </div>
                )}
              </div>

              {/* Expanded editor */}
              {isExpanded && (
                <div className={`px-4 pb-4 border-t pt-3 ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}>
                  <ExerciseForm
                    key={exercise.id}
                    mode="edit"
                    isDark={isDark}
                    canEditShared={editable}
                    creatorName={exercise.createdByName}
                    excludeId={exercise.id}
                    initial={{
                      name: exercise.name,
                      muscleGroup: exercise.muscleGroup,
                      category: exercise.category ?? (exercise.isCompound ? 'compound' : 'isolation'),
                      equipment: exercise.equipment,
                      sharedNotes: exercise.sharedNotes ?? '',
                      notes: exercise.notes ?? '',
                      videoUrl: exercise.videoUrl ?? '',
                    }}
                    onSubmit={(values) => handleSave(exercise, values)}
                    onCancel={() => setExpandedExerciseId(null)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
