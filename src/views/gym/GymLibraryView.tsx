import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Dumbbell, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymExercise } from '../../types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { deleteGymExercise, listenToGymExercises, saveGymExercise } from '../../gymLibrary';
import { labelize } from '../../exerciseUtils';
import { ExerciseForm } from '../../components/ExerciseForm';
import { VideoModal } from '../../components';
import { Card, EmptyState, IconButton, Sheet, useConfirm, useToast, H1, SUB, CAPTION } from '../../ui';

/**
 * The gym's own exercise library — the trainer's movements with the
 * trainer's videos. Members browse and watch; staff add, edit and remove.
 * During a workout the same videos open from the exercise card
 * (src/gymLibrary.ts feeds the pickers).
 */
export function GymLibraryView({ isDark, onBack }: GymViewProps) {
  const { gym, role } = useGym();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const isStaff = role === 'trainer' || role === 'manager' || role === 'owner' || isAdmin(user?.uid);

  const [items, setItems] = useState<GymExercise[] | null>(null);
  const [editing, setEditing] = useState<GymExercise | 'new' | null>(null);
  const [playing, setPlaying] = useState<GymExercise | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!gym?.id) return;
    return listenToGymExercises(gym.id, setItems);
  }, [gym?.id]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((e) => !q || e.name.toLowerCase().includes(q) || labelize(e.muscleGroup).toLowerCase().includes(q));
  }, [items, query]);

  const remove = async (e: GymExercise) => {
    if (!gym) return;
    const ok = await confirm({ title: `Remove ${e.name}?`, message: 'Members keep the sets they logged; the video and cues stop showing.', confirmLabel: 'Remove', tone: 'danger' });
    if (!ok) return;
    try { await deleteGymExercise(gym.id, e.id); showToast('Removed.'); }
    catch (err) { showToast(err instanceof Error ? err.message : 'Could not remove.', 'error'); }
  };

  if (!gym) return null;

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-2">
        <button aria-label="Back" onClick={onBack} className="w-10 h-10 -ml-2 shrink-0 flex items-center justify-center rounded-control text-muted hover:text-text transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className={H1}>Exercise videos</h1>
          <p className={`${CAPTION} mt-0.5`}>{gym.name} · {items?.length ?? 0} exercise{items?.length === 1 ? '' : 's'}</p>
        </div>
        {isStaff && <IconButton icon={Plus} label="Add exercise" onClick={() => setEditing('new')} />}
      </div>

      {(items?.length ?? 0) > 6 && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label="Search gym exercises"
          className="w-full h-11 px-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
        />
      )}

      {items === null ? (
        <Card><p className={SUB}>Loading…</p></Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Dumbbell}
          title={isStaff ? 'No exercises yet' : 'Nothing here yet'}
          body={isStaff
            ? 'Add the movements you coach, with your own video for each. Members see them in the exercise picker and can watch the video mid-set.'
            : `${gym.name} has not added exercise videos yet.`}
          action={isStaff ? { label: 'Add the first exercise', onClick: () => setEditing('new') } : undefined}
        />
      ) : (
        <Card padding="list">
          {shown.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => (e.videoUrl ? setPlaying(e) : undefined)}
                disabled={!e.videoUrl}
                aria-label={e.videoUrl ? `Watch ${e.name}` : `${e.name} has no video`}
                className={`w-10 h-10 shrink-0 rounded-control flex items-center justify-center ${e.videoUrl ? 'bg-accent text-white' : 'bg-surface-2 text-subtle'}`}
              >
                {e.videoUrl ? <Play className="w-4 h-4" /> : <Dumbbell className="w-4 h-4" strokeWidth={1.75} />}
              </button>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => (e.videoUrl ? setPlaying(e) : isStaff ? setEditing(e) : undefined)}>
                <div className="text-sm font-semibold text-text truncate">{e.name}</div>
                <div className={`${SUB} truncate`}>
                  {[labelize(e.muscleGroup), e.equipment ? labelize(e.equipment) : null, e.videoUrl ? 'Video' : 'No video'].filter(Boolean).join(' · ')}
                </div>
              </button>
              {isStaff && (
                <>
                  <IconButton icon={Pencil} label={`Edit ${e.name}`} size="sm" onClick={() => setEditing(e)} />
                  <IconButton icon={Trash2} label={`Remove ${e.name}`} size="sm" onClick={() => { void remove(e); }} />
                </>
              )}
            </div>
          ))}
          {shown.length === 0 && <p className={`${SUB} px-4 py-6 text-center`}>Nothing matches.</p>}
        </Card>
      )}

      {playing?.videoUrl && <VideoModal url={playing.videoUrl} title={playing.name} onClose={() => setPlaying(null)} />}

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add exercise' : 'Edit exercise'}>
        {editing !== null && (
          <>
            <p className={`${SUB} mb-3`}>Paste a YouTube link (unlisted is fine) or a video file link. Cues show under the exercise while members train.</p>
            <ExerciseForm
              mode={editing === 'new' ? 'create' : 'edit'}
              isDark={isDark}
              compact
              canEditShared
              creatorName={gym.name}
              excludeId={editing === 'new' ? undefined : editing.id}
              initial={editing === 'new' ? {} : {
                name: editing.name, muscleGroup: editing.muscleGroup, category: editing.category, equipment: editing.equipment,
                met: editing.met, sharedNotes: editing.notes ?? '', notes: '', videoUrl: editing.videoUrl ?? '',
              }}
              submitLabel={editing === 'new' ? 'Add to gym' : 'Save'}
              onCancel={() => setEditing(null)}
              onSubmit={async (values) => {
                try {
                  await saveGymExercise(gym.id, {
                    name: values.name, muscleGroup: values.muscleGroup, category: values.category, equipment: values.equipment,
                    videoUrl: values.videoUrl, notes: values.sharedNotes, met: values.met,
                  }, editing === 'new' ? undefined : editing);
                  showToast(editing === 'new' ? 'Added to the gym library.' : 'Saved.');
                  setEditing(null);
                } catch (err) {
                  showToast(err instanceof Error ? err.message : 'Could not save.', 'error');
                }
              }}
            />
          </>
        )}
      </Sheet>
    </div>
  );
}
