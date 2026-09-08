import type { ReactNode } from 'react';
import { ChevronRight, FileText, Star, Trash2 } from 'lucide-react';
import type { Exercise } from '../../types';
import { labelize } from '../../exerciseUtils';
import { SUB } from '../../ui';
import { MUSCLE_ICON, MUSCLE_TILE } from './muscleGroups';

interface ExerciseRowProps {
  exercise: Exercise;
  /** Completed sessions this exercise appears in; 0 hides the line. */
  sessions: number;
  /** Show the muscle group in the meta line (flat list only — the grouped
   *  list already says it in the section header). */
  showGroup?: boolean;
  /** Name of the other user who created this exercise, when it is not the
   *  viewer's own. */
  creator?: string;
  expanded: boolean;
  /** Seeded exercises cannot be removed from the library. */
  deletable: boolean;
  onToggle: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
  /** The inline editor, rendered under the row while expanded. */
  children: ReactNode;
}

/**
 * One library entry in the `ListRow` shape: muscle tile · name · meta ·
 * favourite · delete. The row itself is not a single button because the
 * favourite and delete controls sit inside it, so it follows the same
 * split-button pattern as the nutrition search rows.
 */
export function ExerciseRow({
  exercise, sessions, showGroup, creator, expanded, deletable, onToggle, onToggleFavorite, onDelete, children,
}: ExerciseRowProps) {
  const Icon = MUSCLE_ICON[exercise.muscleGroup];
  const category = exercise.category ?? (exercise.isCompound ? 'compound' : 'isolation');
  const meta = [
    showGroup ? labelize(exercise.muscleGroup) : null,
    exercise.equipment ? labelize(exercise.equipment) : null,
    labelize(category),
    sessions > 0 ? `${sessions} session${sessions === 1 ? '' : 's'}` : null,
    creator ? `by ${creator}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-1 min-h-14">
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex-1 min-w-0 flex items-center gap-3 py-2 px-1 text-left"
        >
          <span className={`w-9 h-9 rounded-control flex items-center justify-center shrink-0 ${MUSCLE_TILE[exercise.muscleGroup]}`}>
            <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
          </span>
          <span className="flex-1 min-w-0 flex flex-col">
            <span className="text-[15px] leading-[22px] font-semibold text-text truncate">{exercise.name}</span>
            <span className={`${SUB} flex items-center gap-1.5 min-w-0`}>
              <span className="truncate">{meta}</span>
              {exercise.sharedNotes && <FileText className="w-3.5 h-3.5 text-info shrink-0" aria-label="Has creator notes" />}
              {exercise.notes && <FileText className="w-3.5 h-3.5 text-ok shrink-0" aria-label="Has your notes" />}
            </span>
          </span>
          <ChevronRight
            className={`w-[18px] h-[18px] text-subtle shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
            strokeWidth={1.75}
          />
        </button>
        <button
          onClick={onToggleFavorite}
          aria-pressed={!!exercise.isFavorite}
          aria-label={exercise.isFavorite ? `Unfavourite ${exercise.name}` : `Favourite ${exercise.name}`}
          className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-control ${exercise.isFavorite ? 'text-warn' : 'text-subtle'}`}
        >
          <Star className="w-[18px] h-[18px]" strokeWidth={1.75} fill={exercise.isFavorite ? 'currentColor' : 'none'} />
        </button>
        {deletable && (
          <button
            onClick={onDelete}
            aria-label={`Remove ${exercise.name}`}
            title="Remove from your library"
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-control text-subtle hover:text-danger"
          >
            <Trash2 className="w-[18px] h-[18px]" strokeWidth={1.75} />
          </button>
        )}
      </div>
      {expanded && <div className="pb-3 pt-3 px-1 border-t border-border">{children}</div>}
    </div>
  );
}
