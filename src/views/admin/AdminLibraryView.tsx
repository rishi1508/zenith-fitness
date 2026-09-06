import { useEffect, useState } from 'react';
import { ArrowLeft, Dumbbell, Trash2 } from 'lucide-react';
import type { SharedExerciseDoc } from '../../sharedExercises';
import { deleteSharedExerciseById, listAllSharedExercises } from '../../sharedExercises';
import { Card, EmptyState, IconButton, ListRow, Skeleton, useToast, H1 } from '../../ui';

const INPUT_CLS = 'w-full rounded-control px-3 h-11 text-sm bg-surface-2 border border-border text-text placeholder-subtle focus:outline-none focus:border-accent';

/** Admin console (docs/REVAMP_SPEC.md §5): browse + remove entries from
 *  the shared exercise library (firestore.rules already restricts
 *  delete to the creator or an admin). */
export function AdminLibraryView({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<SharedExerciseDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { showToast } = useToast();

  const load = () => {
    setLoading(true);
    listAllSharedExercises()
      .then((docs) => setItems([...docs].sort((a, b) => a.name.localeCompare(b.name))))
      .catch((err) => showToast(err instanceof Error ? err.message : 'Could not load the library.', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { (async () => { load(); })(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (ex: SharedExerciseDoc) => {
    if (!confirm(`Remove "${ex.name}" from the shared library? Existing local copies are unaffected.`)) return;
    try {
      await deleteSharedExerciseById(ex.id);
      showToast('Removed from the shared library.');
      setItems((prev) => prev.filter((i) => i.id !== ex.id));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not remove it.', 'error');
    }
  };

  const term = search.trim().toLowerCase();
  const filtered = items.filter((i) => !term || i.name.toLowerCase().includes(term));

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-2">
        <IconButton icon={ArrowLeft} label="Back" onClick={onBack} />
        <h1 className={`${H1} flex-1`}>Shared library</h1>
      </div>

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search exercises" className={INPUT_CLS} />

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Dumbbell} title="Nothing here" body="No shared exercises match your search." />
      ) : (
        <Card padding="list">
          {filtered.map((ex) => (
            <ListRow
              key={ex.id}
              icon={Dumbbell}
              title={ex.name}
              subtitle={`${ex.muscleGroup} · ${ex.createdByName ?? ex.createdBy}`}
              trailing={<IconButton icon={Trash2} label={`Remove ${ex.name}`} onClick={() => handleDelete(ex)} />}
            />
          ))}
        </Card>
      )}
    </div>
  );
}
