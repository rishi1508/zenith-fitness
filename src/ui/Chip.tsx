import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface ChipProps {
  /** Selected state — accent-soft fill, accent text. */
  on?: boolean;
  icon?: LucideIcon;
  /** 32px (default) or 36px tall. */
  size?: 'md' | 'lg';
  onClick?: () => void;
  className?: string;
  title?: string;
  children: ReactNode;
}

/** Rounded selector chip (day picker, filters). A button when `onClick` is set. */
export function Chip({ on, icon: Icon, size = 'md', onClick, className = '', title, children }: ChipProps) {
  const cls = `inline-flex items-center gap-1.5 px-3 rounded-full text-[13px] font-semibold whitespace-nowrap transition-colors border ${
    size === 'lg' ? 'h-9' : 'h-8'
  } ${on ? 'bg-accent-soft border-transparent text-accent' : 'bg-surface-2 border-border text-text'} ${className}`;
  const body = (
    <>
      {Icon && <Icon className="w-4 h-4" strokeWidth={1.75} />}
      {children}
    </>
  );
  if (onClick) {
    return (
      <button onClick={onClick} title={title} aria-pressed={on} className={`${cls} hover:border-accent/40`}>
        {body}
      </button>
    );
  }
  return <span className={cls} title={title}>{body}</span>;
}
