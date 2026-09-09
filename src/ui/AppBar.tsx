import type { ReactNode } from 'react';
import { CAPTION, H1 } from './styles';

interface AppBarProps {
  /** Page title (Sora 26). Ignored when `left` is given. */
  title?: ReactNode;
  /** Small caption above the title, e.g. the date or "My gym". */
  eyebrow?: ReactNode;
  /** Custom left slot — replaces eyebrow + title. */
  left?: ReactNode;
  /** Right slot: streak pill, icon buttons, … */
  right?: ReactNode;
}

/**
 * Top bar. Three shapes: `title`, `eyebrow` + `title`, or a custom
 * `left` node; the right slot is always free-form. Respects the status
 * bar inset the same way the old header did.
 */
export function AppBar({ title, eyebrow, left, right }: AppBarProps) {
  return (
    <header
      className="flex-none flex items-center justify-between gap-3 px-5 pb-2 bg-bg"
      // Breathing room ON TOP of the status bar, not the larger of the two:
      // with `max()` a device reporting a 24px inset got no gap at all and
      // the title sat against the clock.
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 18px)' }}
    >
      <div className="min-w-0 flex-1">
        {left ?? (
          <div className="flex flex-col min-w-0">
            {eyebrow && <div className={`${CAPTION} truncate`}>{eyebrow}</div>}
            {title && <h1 className={`${H1} truncate`}>{title}</h1>}
          </div>
        )}
      </div>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </header>
  );
}
