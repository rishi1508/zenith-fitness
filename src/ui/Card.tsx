import type { ReactNode } from 'react';

type CardTone = 'default' | 'accent' | 'danger' | 'info' | 'warn';

interface CardProps {
  /** Marks the card as a target for the welcome tour's spotlight. */
  'data-tour'?: string;
  /** `md` = 16px; `list` = the tight wrapper for `ListRow`s; `none` = bare. */
  padding?: 'md' | 'list' | 'none';
  /** Tints the 1px border (used for the dues tile, the admin block, …). */
  tone?: CardTone;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}

const PAD: Record<NonNullable<CardProps['padding']>, string> = {
  md: 'p-4',
  list: 'px-4 py-1',
  none: '',
};

const TONE: Record<CardTone, string> = {
  default: 'border-border',
  accent: 'border-accent/40',
  danger: 'border-danger/40',
  info: 'border-info/35',
  warn: 'border-warn/40',
};

/** Surface card — 16px radius, 1px border. Becomes a button when `onClick` is set. */
export function Card({ padding = 'md', tone = 'default', className = '', onClick, children }: CardProps) {
  const cls = `bg-surface border rounded-card ${TONE[tone]} ${PAD[padding]} ${className}`;
  if (onClick) {
    return (
      <button onClick={onClick} className={`${cls} w-full text-left transition-colors hover:border-accent/40`}>
        {children}
      </button>
    );
  }
  return <div className={cls}>{children}</div>;
}
