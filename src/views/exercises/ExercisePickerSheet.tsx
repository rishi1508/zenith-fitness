import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Plus, Search, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Exercise } from '../../types';
import * as storage from '../../storage';
import { ExerciseForm } from '../../components/ExerciseForm';
import { createExerciseFromForm } from './createExerciseFromForm';
import { labelize } from '../../exerciseUtils';
import { registerBackHandler } from '../../backHandlerRegistry';
import { formatSet, lastTopSetByExercise } from '../../progression';
import { H2, SUB, IconButton } from '../../ui';

/** Tallest the pinned head can get: handle + title row + search + padding. */
const HEAD_MAX_PX = 180;

interface Viewport {
  /** Height actually visible to the user — the soft keyboard takes its cut. */
  height: number;
  /** Gap between the bottom of that area and the bottom of the window. */
  bottomInset: number;
}

function readViewport(): Viewport {
  if (typeof window === 'undefined') return { height: 800, bottomInset: 0 };
  const vv = window.visualViewport;
  if (!vv) return { height: window.innerHeight, bottomInset: 0 };
  return {
    height: vv.height,
    bottomInset: Math.max(0, window.innerHeight - vv.height - vv.offsetTop),
  };
}

/**
 * Tracks the area the soft keyboard leaves behind. Android WebViews are
 * split on this: most resize the whole window (so the inset is 0 and
 * `innerHeight` already shrank), some pan it instead — and then
 * `visualViewport` is the only thing that knows the keyboard is up.
 */
function useVisibleViewport(active: boolean): Viewport {
  const [viewport, setViewport] = useState<Viewport>(readViewport);

  useEffect(() => {
    if (!active) return;
    const update = () => setViewport(readViewport());
    update();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [active]);

  return viewport;
}

interface ExercisePickerSheetProps {
  open: boolean;
  /** Sheet heading — "Add exercise" / "Swap exercise". */
  title: string;
  /** Candidates, already narrowed by the caller (current exercises removed). */
  exercises: Exercise[];
  /** Glyph on each row: a plus when picking adds, a chevron when it replaces. */
  action?: 'add' | 'swap';
  onPick: (exercise: Exercise) => void;
  onClose: () => void;
  /** Fired after a brand-new exercise is saved, before `onPick`. */
  onCreated?: () => void;
  /** Group session id, so a new exercise reaches the other participants. */
  sessionId?: string;
}

/**
 * The exercise picker, with geometry that does NOT follow the result count.
 *
 * The old inline block was as tall as its list: typing shrank 40 rows to
 * one, the sheet collapsed downwards and the single match you were aiming
 * for slid under the Android keyboard. Here the search field is pinned in a
 * head that never scrolls and the results live in a scroll area of fixed
 * height, so the first row sits in the same place whether the query matches
 * everything or one thing.
 */
export function ExercisePickerSheet({
  open, title, exercises, action = 'add', onPick, onClose, onCreated, sessionId,
}: ExercisePickerSheetProps) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const { height, bottomInset } = useVisibleViewport(open);

  useEffect(() => {
    if (!open) return;
    return registerBackHandler(() => { onClose(); return true; });
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // One pass over history per opening, instead of one scan per row per
  // keystroke — the "Last:" hint used to re-read every workout 40 times.
  const lastSets = useMemo(() => (open ? lastTopSetByExercise(storage.getWorkouts()) : null), [open]);

  const term = query.trim().toLowerCase();
  const matches = useMemo(
    () => (term ? exercises.filter((ex) => ex.name.toLowerCase().includes(term)) : exercises),
    [exercises, term],
  );

  if (!open) return null;

  const close = () => { setQuery(''); setCreating(false); onClose(); };
  const pick = (exercise: Exercise) => { setQuery(''); setCreating(false); onPick(exercise); };

  // Half the visible area, floored so the list is still usable on a short
  // viewport and capped so the pinned head always fits above it.
  const listHeight = Math.max(140, Math.min(Math.round(height * 0.5), height - HEAD_MAX_PX));
  const RowIcon: LucideIcon = action === 'add' ? Plus : ChevronRight;

  return createPortal(
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/55" onClick={close} />
      <div
        className="absolute inset-x-0 mx-auto w-full max-w-lg flex flex-col bg-surface border-t border-border rounded-t-[24px] overflow-hidden animate-fadeIn"
        style={{ bottom: bottomInset }}
      >
        {/* Pinned head — never scrolls, so the field you are typing in stays put. */}
        <div className="shrink-0 px-5 pt-3 pb-3 border-b border-border">
          <div className="w-10 h-1 rounded-sm bg-border mx-auto mb-2" aria-hidden="true" />
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className={H2}>{creating ? 'New exercise' : title}</h2>
            <IconButton icon={X} label="Close" size="sm" onClick={close} />
          </div>
          {!creating && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" strokeWidth={1.75} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search exercises…"
                aria-label="Search exercises"
                autoFocus
                className="w-full h-11 pl-9 pr-3 rounded-control border border-border bg-surface-2 text-text placeholder:text-subtle text-sm outline-none focus:border-accent/50"
              />
            </div>
          )}
        </div>

        {/* Fixed-height scroll area. Same height with one match or forty. */}
        <div
          className="overflow-y-auto overscroll-contain px-3 py-2"
          style={{ height: listHeight, paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}
        >
          {creating ? (
            <>
              <p className={`${SUB} mb-3`}>It goes into your library and the shared library.</p>
              <ExerciseForm
                mode="create"
                isDark
                compact
                canEditShared
                initial={{ name: query.trim() }}
                onCancel={() => setCreating(false)}
                onUseExisting={pick}
                onSubmit={(values) => {
                  const created = createExerciseFromForm(values, sessionId);
                  onCreated?.();
                  pick(created);
                }}
              />
            </>
          ) : (
            <>
              {matches.length === 0 && (
                <p className={`${SUB} px-1 py-6 text-center`}>
                  {term ? `Nothing matches "${query.trim()}".` : 'No exercises in your library yet.'}
                </p>
              )}
              {matches.map((ex) => {
                const last = lastSets?.get(ex.id) ?? lastSets?.get(ex.name.trim().toLowerCase()) ?? null;
                const meta = [labelize(ex.muscleGroup), ex.equipment ? labelize(ex.equipment) : null]
                  .filter(Boolean).join(' · ');
                return (
                  <button
                    key={ex.id}
                    onClick={() => pick(ex)}
                    className="w-full min-h-14 px-2 py-2 rounded-control text-left flex items-center gap-3 transition-colors hover:bg-surface-2"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-[15px] leading-[22px] font-semibold text-text truncate">{ex.name}</span>
                      <span className={`${SUB} block truncate`}>
                        {meta}
                        {last && <span className="text-accent"> · Last: {formatSet(last)}</span>}
                      </span>
                    </span>
                    <RowIcon className="w-[18px] h-[18px] text-subtle shrink-0" strokeWidth={1.75} />
                  </button>
                );
              })}
              {term.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border">
                  <button
                    onClick={() => setCreating(true)}
                    className="w-full min-h-11 px-2 rounded-control text-left flex items-center gap-2 text-accent text-sm font-semibold transition-colors hover:bg-accent-soft"
                  >
                    <Plus className="w-4 h-4 shrink-0" strokeWidth={2} />
                    <span className="truncate">Create "{query.trim()}"…</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
