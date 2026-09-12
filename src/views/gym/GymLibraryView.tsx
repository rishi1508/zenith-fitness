import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Dumbbell, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import type { GymViewProps } from './types';
import type { Gym, GymExercise } from '../../types';
import { MUSCLE_GROUPS } from '../../types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { deleteGymExercise, listenToGymExercises, saveGymExercise } from '../../gymLibrary';
import { labelize } from '../../exerciseUtils';
import { ExerciseForm } from '../../components/ExerciseForm';
import { VideoModal } from '../../components';
import { Card, EmptyState, IconButton, SectionHeader, Sheet, useConfirm, useToast, H1, SUB, CAPTION } from '../../ui';

/**
 * The gym's own exercise library — the trainer's movements with the
 * trainer's videos. Members get a consumption-first `MemberLibrary`:
 * browse, search, watch, read the cues. Staff get a management
 * `StaffLibrary`: add, edit, remove. During a workout the same videos
 * open from the exercise card (src/gymLibrary.ts feeds the pickers).
 */
export function GymLibraryView({ isDark, onBack }: GymViewProps) {
  const { gym, role } = useGym();
  const { user } = useAuth();
  const isStaff = role === 'trainer' || role === 'manager' || role === 'owner' || isAdmin(user?.uid);

  const [items, setItems] = useState<GymExercise[] | null>(null);

  useEffect(() => {
    if (!gym?.id) return;
    return listenToGymExercises(gym.id, setItems);
  }, [gym?.id]);

  if (!gym) return null;

  return isStaff
    ? <StaffLibrary gym={gym} isDark={isDark} items={items} onBack={onBack} />
    : <MemberLibrary gymName={gym.name} items={items} onBack={onBack} />;
}

// ----- member: browse, search, watch -----------------------------------------

function MemberLibrary({ gymName, items, onBack }: { gymName: string; items: GymExercise[] | null; onBack: () => void }) {
  const [query, setQuery] = useState('');
  const [playing, setPlaying] = useState<GymExercise | null>(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = (items ?? []).filter((e) => !q || e.name.toLowerCase().includes(q) || labelize(e.muscleGroup).toLowerCase().includes(q));
    return MUSCLE_GROUPS
      .map((group) => ({ group, rows: shown.filter((e) => e.muscleGroup === group) }))
      .filter((g) => g.rows.length > 0);
  }, [items, query]);
  const matches = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-2">
        <button aria-label="Back" onClick={onBack} className="w-10 h-10 -ml-2 shrink-0 flex items-center justify-center rounded-control text-muted hover:text-text transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className={H1}>Exercise videos</h1>
          <p className={`${CAPTION} mt-0.5`}>{gymName}</p>
        </div>
      </div>

      {items === null ? (
        <Card><p className={SUB}>Loading…</p></Card>
      ) : items.length === 0 ? (
        <EmptyState icon={Dumbbell} title="Nothing here yet" body={`${gymName} has not added exercise videos yet.`} />
      ) : (
        <>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search gym exercises"
            className="w-full h-11 px-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
          />
          {matches === 0 ? (
            <p className={`${SUB} text-center py-6`}>Nothing matches.</p>
          ) : (
            <div className="space-y-4">
              {groups.map(({ group, rows }) => (
                <div key={group}>
                  <SectionHeader caption={labelize(group)} />
                  <Card padding="list" className="mt-2">
                    {rows.map((e) => (
                      <div key={e.id} className="flex items-start gap-3 px-4 py-3 border-b border-border last:border-b-0">
                        <button
                          type="button"
                          onClick={() => (e.videoUrl ? setPlaying(e) : undefined)}
                          disabled={!e.videoUrl}
                          aria-label={e.videoUrl ? `Watch ${e.name}` : `${e.name} has no video`}
                          className={`w-10 h-10 shrink-0 rounded-control flex items-center justify-center ${e.videoUrl ? 'bg-accent text-white' : 'bg-surface-2 text-subtle'}`}
                        >
                          {e.videoUrl ? <Play className="w-4 h-4" /> : <Dumbbell className="w-4 h-4" strokeWidth={1.75} />}
                        </button>
                        <div className="min-w-0 flex-1 pt-1.5">
                          <div className="text-sm font-semibold text-text truncate">{e.name}</div>
                          {e.equipment && <div className={`${SUB} truncate`}>{labelize(e.equipment)}</div>}
                          {e.notes && <p className="text-xs text-muted mt-1 whitespace-pre-wrap">{e.notes}</p>}
                        </div>
                      </div>
                    ))}
                  </Card>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {playing?.videoUrl && <VideoModal url={playing.videoUrl} title={playing.name} onClose={() => setPlaying(null)} />}
    </div>
  );
}

// ----- staff: add, edit, remove ------------------------------------------------

function StaffLibrary({ gym, isDark, items, onBack }: { gym: Gym; isDark: boolean; items: GymExercise[] | null; onBack: () => void }) {
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const [editing, setEditing] = useState<GymExercise | 'new' | null>(null);
  const [playing, setPlaying] = useState<GymExercise | null>(null);
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((e) => !q || e.name.toLowerCase().includes(q) || labelize(e.muscleGroup).toLowerCase().includes(q));
  }, [items, query]);

  const remove = async (e: GymExercise) => {
    const ok = await confirm({ title: `Remove ${e.name}?`, message: 'Members keep the sets they logged; the video and cues stop showing.', confirmLabel: 'Remove', tone: 'danger' });
    if (!ok) return;
    try { await deleteGymExercise(gym.id, e.id); showToast('Removed.'); }
    catch (err) { showToast(err instanceof Error ? err.message : 'Could not remove.', 'error'); }
  };

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
        <IconButton icon={Plus} label="Add exercise" onClick={() => setEditing('new')} />
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
          title="No exercises yet"
          body="Add the movements you coach, with your own video for each. Members see them in the exercise picker and can watch the video mid-set."
          action={{ label: 'Add the first exercise', onClick: () => setEditing('new') }}
        />
      ) : (
        <Card padding="list">
          {shown.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => (e.videoUrl ? setPlaying(e) : undefined)}
                disabled={!e.videoUrl}
                aria-label={e.videoUrl ? `Preview ${e.name}` : `${e.name} has no video`}
                className={`w-9 h-9 shrink-0 rounded-control flex items-center justify-center ${e.videoUrl ? 'bg-accent text-white' : 'bg-surface-2 text-subtle'}`}
              >
                {e.videoUrl ? <Play className="w-3.5 h-3.5" /> : <Dumbbell className="w-3.5 h-3.5" strokeWidth={1.75} />}
              </button>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(e)}>
                <div className="text-sm font-semibold text-text truncate">{e.name}</div>
                <div className={`${SUB} truncate flex items-center gap-1.5`}>
                  <span className="truncate">{[labelize(e.muscleGroup), e.equipment ? labelize(e.equipment) : null].filter(Boolean).join(' · ')}</span>
                  {!e.videoUrl && (
                    <span className="inline-flex items-center gap-1 text-warn font-semibold shrink-0">
                      <AlertTriangle className="w-3 h-3" /> No video
                    </span>
                  )}
                </div>
              </button>
              <IconButton icon={Pencil} label={`Edit ${e.name}`} size="sm" onClick={() => setEditing(e)} />
              <IconButton icon={Trash2} label={`Remove ${e.name}`} size="sm" onClick={() => { void remove(e); }} />
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
