import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Dumbbell, Plus, Search, Star, User } from 'lucide-react';
import * as storage from '../storage';
import type { Exercise, MuscleGroup } from '../types';
import { ExerciseForm } from '../components/ExerciseForm';
import { labelize } from '../exerciseUtils';
import type { ExerciseFormValues } from '../components/ExerciseForm';
import { canEditShared, createAndPublishExercise, publishExercise, deleteSharedExercise } from '../sharedExercises';
import { useAuth } from '../auth/AuthContext';
import { Card, Chip, EmptyState, IconButton, SectionHeader, Sheet, useConfirm, useToast, H2, SUB } from '../ui';
import { ExerciseRow } from './exercises/ExerciseRow';
import { MUSCLE_ORDER } from './exercises/muscleGroups';

/** Which slice of the library the chips are showing. */
type Scope = 'all' | 'favourites' | 'mine';

const SCOPES: { id: Scope; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'favourites', label: 'Favourites' },
  { id: 'mine', label: 'Created by me' },
];

/** Seeded exercises ship with the app — they cannot be deleted. */
function isSeed(ex: Exercise): boolean {
  return !ex.id.startsWith('custom_') && !ex.id.startsWith('imported_');
}

/** Published exercises carry their owner; unpublished local ones are the
 *  viewer's own as long as they are not part of the shipped seed. */
function isMine(ex: Exercise, uid: string | null): boolean {
  return ex.createdBy ? ex.createdBy === uid : !isSeed(ex);
}

/**
 * Lower is better. An exact name wins, then a prefix, then a word inside
 * the name, then anything else the term touched (muscle group, equipment).
 */
function rank(ex: Exercise, term: string): number {
  if (!term) return 0;
  const name = ex.name.toLowerCase();
  if (name === term) return 0;
  if (name.startsWith(term)) return 1;
  if (name.split(/\s+/).some((w) => w.startsWith(term))) return 2;
  if (name.includes(term)) return 3;
  return 4;
}

function matches(ex: Exercise, term: string): boolean {
  if (!term) return true;
  return ex.name.toLowerCase().includes(term)
    || ex.muscleGroup.toLowerCase().includes(term)
    || (ex.equipment ?? '').toLowerCase().includes(term);
}

/** Favourites float to the top of every list, then plain alphabetical. */
function byFavouriteThenName(a: Exercise, b: Exercise): number {
  if (!!a.isFavorite !== !!b.isFavorite) return a.isFavorite ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * The exercise library: search + scope chips + a muscle-group filter over a
 * list that is grouped by muscle group when nothing narrows it and flat and
 * ranked when something does. Rows expand into the shared `ExerciseForm`,
 * which is also what the "New exercise" sheet holds.
 */
export function ExerciseManagerView({ isDark, onBack, onExercisesChange }: {
  isDark: boolean;
  onBack: () => void;
  onExercisesChange: () => void;
}) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const { confirm: confirmDialog } = useConfirm();
  const { showToast } = useToast();

  const [exercises, setExercises] = useState(() => storage.getExercises());
  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [group, setGroup] = useState<MuscleGroup | 'all'>('all');
  const [expandedExerciseId, setExpandedExerciseId] = useState<string | null>(null);

  // The shared-library listener merges into storage in the background;
  // re-read so creator notes that just arrived show without a remount.
  useEffect(() => {
    const refresh = () => setExercises(storage.getExercises());
    window.addEventListener('zenith-data-refresh', refresh);
    return () => window.removeEventListener('zenith-data-refresh', refresh);
  }, []);

  // How many completed sessions each exercise appears in. One pass over the
  // local history at mount — history does not change while this view is up.
  const sessionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const workout of storage.getWorkouts()) {
      if (!workout.completed) continue;
      const seen = new Set<string>();
      for (const we of workout.exercises) {
        if (seen.has(we.exerciseId)) continue;
        seen.add(we.exerciseId);
        counts.set(we.exerciseId, (counts.get(we.exerciseId) ?? 0) + 1);
      }
    }
    return counts;
  }, []);

  const term = searchQuery.trim().toLowerCase();
  const narrowed = term.length > 0 || scope !== 'all' || group !== 'all';

  const visible = useMemo(() => exercises.filter((ex) =>
    (scope !== 'favourites' || ex.isFavorite)
    && (scope !== 'mine' || isMine(ex, uid))
    && (group === 'all' || ex.muscleGroup === group)
    && matches(ex, term),
  ), [exercises, scope, group, term, uid]);

  /** Flat ranked list — used whenever a search or a filter is active. */
  const ranked = useMemo(
    () => [...visible].sort((a, b) => (rank(a, term) - rank(b, term)) || byFavouriteThenName(a, b)),
    [visible, term],
  );

  /** Sections in training order; empty groups are dropped. */
  const sections = useMemo(() => MUSCLE_ORDER
    .map((g) => ({ group: g, items: visible.filter((ex) => ex.muscleGroup === g).sort(byFavouriteThenName) }))
    .filter((s) => s.items.length > 0), [visible]);

  const groupCounts = useMemo(() => {
    const counts = new Map<MuscleGroup, number>();
    for (const ex of exercises) counts.set(ex.muscleGroup, (counts.get(ex.muscleGroup) ?? 0) + 1);
    return counts;
  }, [exercises]);

  const favoriteCount = exercises.filter((e) => e.isFavorite).length;

  const clearFilters = () => { setSearchQuery(''); setScope('all'); setGroup('all'); };

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
    showToast(`Added ${values.name} to your library.`);
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
    showToast(`Saved ${values.name}.`);
  };

  const handleDelete = async (exercise: Exercise) => {
    if (!(await confirmDialog({ title: 'Delete exercise?', message: `Delete "${exercise.name}" from your library? Templates and workouts using it keep the name but lose the link.`, confirmLabel: 'Delete', tone: 'danger' }))) return;
    if (exercise.createdBy && canEditShared(exercise, uid)) {
      if (await confirmDialog({ title: 'Remove for everyone?', message: 'Also remove it from the shared library for everyone?', confirmLabel: 'Remove for everyone', tone: 'danger' })) {
        await deleteSharedExercise(exercise);
      }
    }
    const remaining = storage.getExercises().filter((e) => e.id !== exercise.id);
    storage.saveExercises(remaining);
    setExercises(remaining);
    if (expandedExerciseId === exercise.id) setExpandedExerciseId(null);
    onExercisesChange();
    showToast(`Removed ${exercise.name}.`);
  };

  const toggleFavorite = (exerciseId: string) => {
    storage.toggleExerciseFavorite(exerciseId);
    setExercises(storage.getExercises());
  };

  const renderRow = (exercise: Exercise, showGroup: boolean) => {
    const expanded = expandedExerciseId === exercise.id;
    const editable = canEditShared(exercise, uid);
    return (
      <ExerciseRow
        key={exercise.id}
        exercise={exercise}
        sessions={sessionCounts.get(exercise.id) ?? 0}
        showGroup={showGroup}
        creator={!isMine(exercise, uid) ? exercise.createdByName : undefined}
        expanded={expanded}
        deletable={!isSeed(exercise)}
        onToggle={() => setExpandedExerciseId(expanded ? null : exercise.id)}
        onToggleFavorite={() => toggleFavorite(exercise.id)}
        onDelete={() => { void handleDelete(exercise); }}
      >
        <ExerciseForm
          key={exercise.id}
          mode="edit"
          isDark={isDark}
          canEditShared={editable}
          creatorName={exercise.createdByName}
          excludeId={exercise.id}
          compact
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
      </ExerciseRow>
    );
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <IconButton icon={ArrowLeft} label="Back" onClick={onBack} />
        <div className="min-w-0 flex-1">
          <h1 className={`${H2} truncate`}>Exercise library</h1>
          <p className={SUB}>
            {exercises.length} exercise{exercises.length === 1 ? '' : 's'}
            {favoriteCount > 0 && ` · ${favoriteCount} favourite${favoriteCount === 1 ? '' : 's'}`}
          </p>
        </div>
        <IconButton icon={Plus} label="New exercise" onClick={() => setIsAdding(true)} />
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-subtle absolute left-3 top-1/2 -translate-y-1/2" strokeWidth={1.75} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search name, muscle or equipment…"
          className="w-full h-11 pl-9 pr-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
        />
      </div>

      <div className="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden">
        {SCOPES.map((s) => (
          <Chip
            key={s.id}
            on={scope === s.id}
            icon={s.id === 'favourites' ? Star : s.id === 'mine' ? User : undefined}
            onClick={() => setScope(s.id)}
          >
            {s.label}
          </Chip>
        ))}
      </div>

      <div className="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden">
        <Chip on={group === 'all'} onClick={() => setGroup('all')}>All groups</Chip>
        {MUSCLE_ORDER.filter((g) => (groupCounts.get(g) ?? 0) > 0).map((g) => (
          <Chip key={g} on={group === g} onClick={() => setGroup(g)}>
            {labelize(g)} <span className="font-normal opacity-60">{groupCounts.get(g)}</span>
          </Chip>
        ))}
      </div>

      {visible.length === 0 ? (
        exercises.length === 0 ? (
          <EmptyState
            icon={Dumbbell}
            title="No exercises yet"
            body="Add the lifts you actually train and they will show up in every plan and workout."
            action={{ label: 'New exercise', onClick: () => setIsAdding(true) }}
          />
        ) : (
          <EmptyState
            icon={Search}
            title="No matches"
            body="Try a shorter word, a different muscle group, or clear the filters."
            action={{ label: 'Clear filters', onClick: clearFilters }}
          />
        )
      ) : narrowed ? (
        <>
          <p className={SUB}>{visible.length} match{visible.length === 1 ? '' : 'es'}</p>
          <Card padding="list">{ranked.map((ex) => renderRow(ex, true))}</Card>
        </>
      ) : (
        sections.map((section) => (
          <div key={section.group} className="space-y-2">
            <SectionHeader caption={labelize(section.group)} trailing={<span className={SUB}>{section.items.length}</span>} />
            <Card padding="list">{section.items.map((ex) => renderRow(ex, false))}</Card>
          </div>
        ))
      )}

      <Sheet open={isAdding} onClose={() => setIsAdding(false)} title="New exercise">
        <ExerciseForm
          mode="create"
          isDark={isDark}
          canEditShared
          compact
          onSubmit={handleCreate}
          onCancel={() => setIsAdding(false)}
          onUseExisting={(ex) => {
            setIsAdding(false);
            clearFilters();
            setSearchQuery(ex.name);
            setExpandedExerciseId(ex.id);
          }}
        />
      </Sheet>
    </div>
  );
}
