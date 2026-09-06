import { useMemo, useState } from 'react';
import { Lock, Plus, Check } from 'lucide-react';
import type { Exercise, ExerciseCategory, ExerciseEquipment, MuscleGroup } from '../types';
import { EXERCISE_CATEGORIES, EXERCISE_EQUIPMENT, MUSCLE_GROUPS } from '../types';
import * as storage from '../storage';
import { labelize, guessCategory } from '../exerciseUtils';

export interface ExerciseFormValues {
  name: string;
  muscleGroup: MuscleGroup;
  category: ExerciseCategory;
  equipment?: ExerciseEquipment;
  /** Creator notes — shared with everyone who has the exercise. */
  sharedNotes: string;
  /** Personal notes — private. */
  notes: string;
  videoUrl: string;
}

interface Props {
  mode: 'create' | 'edit';
  initial?: Partial<ExerciseFormValues>;
  isDark: boolean;
  /** May the shared definition (name, group, category, equipment, creator
   *  notes, video) be edited? False for exercises someone else created. */
  canEditShared: boolean;
  creatorName?: string;
  /** Edit mode: the exercise being edited, so the duplicate check skips it. */
  excludeId?: string;
  onSubmit: (values: ExerciseFormValues) => void;
  onCancel?: () => void;
  /** Create mode: the typed name already exists in the library. */
  onUseExisting?: (existing: Exercise) => void;
  submitLabel?: string;
  /** Tighter spacing for bottom sheets. */
  compact?: boolean;
}

export function ExerciseForm({
  mode, initial, isDark, canEditShared, creatorName, excludeId,
  onSubmit, onCancel, onUseExisting, submitLabel, compact,
}: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup>(initial?.muscleGroup ?? 'chest');
  const [category, setCategory] = useState<ExerciseCategory>(
    initial?.category ?? (initial?.name ? guessCategory(initial.name) : 'isolation'),
  );
  const [categoryTouched, setCategoryTouched] = useState(!!initial?.category);
  const [equipment, setEquipment] = useState<ExerciseEquipment | undefined>(initial?.equipment);
  const [sharedNotes, setSharedNotes] = useState(initial?.sharedNotes ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [videoUrl, setVideoUrl] = useState(initial?.videoUrl ?? '');

  // Duplicate check — the same name (case/space-insensitive) already in the library.
  const duplicate = useMemo(() => {
    const match = storage.findExerciseByName(name);
    return match && match.id !== excludeId ? match : undefined;
  }, [name, excludeId]);

  const handleNameChange = (v: string) => {
    setName(v);
    if (!categoryTouched && mode === 'create') setCategory(guessCategory(v));
  };

  const canSubmit = name.trim().length > 0 && !duplicate;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      name: name.trim().replace(/\s+/g, ' '),
      muscleGroup,
      category,
      equipment,
      sharedNotes: sharedNotes.trim(),
      notes: notes.trim(),
      videoUrl: videoUrl.trim(),
    });
  };

  const input = `w-full rounded-lg border px-3 ${compact ? 'py-2 text-sm' : 'py-3'} focus:outline-none focus:border-orange-500 ${
    isDark ? 'bg-[#252525] border-[#3e3e3e] text-white placeholder-zinc-500' : 'bg-white border-gray-200 placeholder-gray-400'
  } disabled:opacity-60`;
  const label = `text-xs font-medium ${isDark ? 'text-zinc-400' : 'text-gray-600'}`;
  const chip = (active: boolean, disabled = false) =>
    `px-3 py-1 rounded-full text-xs font-medium transition-colors ${
      active
        ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white'
        : isDark ? 'bg-[#252525] text-zinc-400 hover:bg-[#303030]' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
    } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`;
  const gap = compact ? 'space-y-2.5' : 'space-y-3';
  const locked = !canEditShared;

  return (
    <div className={gap}>
      {locked && (
        <div className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 ${isDark ? 'bg-[#252525] text-zinc-400' : 'bg-gray-100 text-gray-600'}`}>
          <Lock className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Created by {creatorName || 'another user'}. Only they can change the shared details — you can still add personal notes.</span>
        </div>
      )}

      {/* Name */}
      <div className="space-y-1">
        <label className={label}>Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="e.g. Incline Dumbbell Press"
          className={input}
          disabled={locked}
          autoFocus={mode === 'create' && !initial?.name}
        />
        {duplicate && (
          <div className={`flex items-center justify-between gap-2 text-xs rounded-lg px-3 py-2 ${isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700'}`}>
            <span>"{duplicate.name}" is already in your library.</span>
            {mode === 'create' && onUseExisting && (
              <button onClick={() => onUseExisting(duplicate)} className="font-semibold underline whitespace-nowrap">
                Use it
              </button>
            )}
          </div>
        )}
      </div>

      {/* Muscle group */}
      <div className="space-y-1">
        <label className={label}>Muscle group</label>
        <div className="flex flex-wrap gap-1.5">
          {MUSCLE_GROUPS.map((g) => (
            <button key={g} type="button" disabled={locked} onClick={() => setMuscleGroup(g)} className={chip(muscleGroup === g, locked)}>
              {labelize(g)}
            </button>
          ))}
        </div>
      </div>

      {/* Category */}
      <div className="space-y-1">
        <label className={label}>Category <span className="font-normal opacity-70">· sets the default rest timer</span></label>
        <div className="flex flex-wrap gap-1.5">
          {EXERCISE_CATEGORIES.map((c) => (
            <button
              key={c} type="button" disabled={locked}
              onClick={() => { setCategory(c); setCategoryTouched(true); }}
              className={chip(category === c, locked)}
            >
              {labelize(c)}
            </button>
          ))}
        </div>
      </div>

      {/* Equipment */}
      <div className="space-y-1">
        <label className={label}>Equipment <span className="font-normal opacity-70">· optional</span></label>
        <div className="flex flex-wrap gap-1.5">
          {EXERCISE_EQUIPMENT.map((eq) => (
            <button
              key={eq} type="button" disabled={locked}
              onClick={() => setEquipment(equipment === eq ? undefined : eq)}
              className={chip(equipment === eq, locked)}
            >
              {labelize(eq)}
            </button>
          ))}
        </div>
      </div>

      {/* Creator notes */}
      <div className="space-y-1">
        <label className={label}>
          {locked ? `Notes from ${creatorName || 'the creator'}` : 'Creator notes'}
          {!locked && <span className="font-normal opacity-70"> · everyone who has this exercise sees these</span>}
        </label>
        {locked ? (
          <div className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${isDark ? 'bg-blue-500/10 text-zinc-300' : 'bg-blue-50 text-gray-700'}`}>
            {sharedNotes || <span className="italic opacity-60">No creator notes yet.</span>}
          </div>
        ) : (
          <textarea
            value={sharedNotes}
            onChange={(e) => setSharedNotes(e.target.value)}
            placeholder="Form cues, setup, common mistakes…"
            rows={compact ? 2 : 3}
            className={`${input} resize-none`}
          />
        )}
      </div>

      {/* Personal notes */}
      <div className="space-y-1">
        <label className={label}>My notes <span className="font-normal opacity-70">· only you see these</span></label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Your own cues, pain points, RPE targets…"
          rows={compact ? 2 : 3}
          className={`${input} resize-none`}
        />
      </div>

      {/* Video */}
      <div className="space-y-1">
        <label className={label}>Video URL <span className="font-normal opacity-70">· optional</span></label>
        <input
          type="url"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="https://youtube.com/…"
          className={input}
          disabled={locked}
        />
      </div>

      <div className="flex gap-2 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className={`flex-1 ${compact ? 'py-2 text-sm' : 'py-3'} rounded-lg font-medium transition-colors ${
              isDark ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
            }`}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={`flex-1 ${compact ? 'py-2 text-sm' : 'py-3'} rounded-lg font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-1.5`}
        >
          {mode === 'create' ? <Plus className="w-4 h-4" /> : <Check className="w-4 h-4" />}
          {submitLabel ?? (mode === 'create' ? 'Create exercise' : 'Save')}
        </button>
      </div>
    </div>
  );
}
