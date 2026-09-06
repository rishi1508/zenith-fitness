import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export type PillTone = 'ok' | 'warn' | 'danger' | 'accent' | 'info' | 'neutral';

interface PillProps {
  tone?: PillTone;
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
}

const TONE: Record<PillTone, string> = {
  ok: 'bg-ok/14 text-ok',
  warn: 'bg-warn/16 text-warn',
  danger: 'bg-danger/14 text-danger',
  accent: 'bg-accent-soft text-accent',
  info: 'bg-info/14 text-info',
  neutral: 'bg-surface-2 text-muted',
};

/** 24px status pill — "Active", "Live", "Day 2 · Legs", "Premium". */
export function Pill({ tone = 'neutral', icon: Icon, className = '', children }: PillProps) {
  return (
    <span className={`inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-xs font-bold whitespace-nowrap ${TONE[tone]} ${className}`}>
      {Icon && <Icon className="w-3 h-3" strokeWidth={1.75} />}
      {children}
    </span>
  );
}
