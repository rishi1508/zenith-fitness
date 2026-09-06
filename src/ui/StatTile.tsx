import type { ReactNode } from 'react';
import { CAPTION, STAT } from './styles';

type StatTone = 'default' | 'ok' | 'warn' | 'danger' | 'accent' | 'info';

interface StatTileProps {
  eyebrow: ReactNode;
  /** The Sora numeral. */
  value: ReactNode;
  /** Inline unit after the numeral, e.g. "kg × 6". */
  unit?: ReactNode;
  /** Small muted line under the numeral. */
  sub?: ReactNode;
  tone?: StatTone;
  /** 12px padding (3-up grids) instead of 14px. */
  compact?: boolean;
  onClick?: () => void;
  className?: string;
}

const VALUE_TONE: Record<StatTone, string> = {
  default: 'text-text',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  accent: 'text-accent',
  info: 'text-info',
};

const BORDER_TONE: Record<StatTone, string> = {
  default: 'border-border',
  ok: 'border-border',
  warn: 'border-warn/40',
  danger: 'border-danger/40',
  accent: 'border-border',
  info: 'border-border',
};

/** Eyebrow · big Sora numeral (+unit) · sub line. `tone` colours the numeral. */
export function StatTile({ eyebrow, value, unit, sub, tone = 'default', compact, onClick, className = '' }: StatTileProps) {
  const cls = `bg-surface border rounded-card flex flex-col gap-1.5 min-w-0 ${BORDER_TONE[tone]} ${compact ? 'p-3' : 'p-[14px]'} ${className}`;
  const body = (
    <>
      <span className={`${CAPTION} truncate`}>{eyebrow}</span>
      <span className={`${STAT} ${VALUE_TONE[tone]} truncate`}>
        {value}
        {unit !== undefined && <span className="font-sans text-sm font-medium text-muted tracking-normal"> {unit}</span>}
      </span>
      {sub !== undefined && <span className="text-xs text-muted truncate">{sub}</span>}
    </>
  );
  if (onClick) {
    return <button onClick={onClick} className={`${cls} text-left transition-colors hover:border-accent/40`}>{body}</button>;
  }
  return <div className={cls}>{body}</div>;
}
