import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type IconTone = 'default' | 'accent' | 'info' | 'danger';

interface ListRowProps {
  /** Leading 36px icon tile. Pass a lucide icon, or any node for the tile's content. */
  icon?: LucideIcon | ReactNode;
  iconTone?: IconTone;
  /** Replaces the icon tile entirely (avatars, time columns, …). */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** `'chevron'` (default when `onClick` is set), any node, or `null` for nothing. */
  trailing?: 'chevron' | ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}

const TILE_TONE: Record<IconTone, string> = {
  default: 'bg-surface-2 text-muted',
  accent: 'bg-accent-soft text-accent',
  info: 'bg-info/14 text-info',
  danger: 'bg-danger/14 text-danger',
};

function isLucide(v: unknown): v is LucideIcon {
  return typeof v === 'function' || (typeof v === 'object' && v !== null && 'render' in (v as object));
}

/**
 * 56px row for grouped lists: icon tile · title/subtitle · trailing.
 * Wrap a stack of rows in `<Card padding="list">`; rows draw their own
 * dividers and drop the last one.
 */
export function ListRow({ icon, iconTone = 'default', leading, title, subtitle, trailing, onClick, disabled }: ListRowProps) {
  const trail = trailing === undefined && onClick ? 'chevron' : trailing;
  const content = (
    <>
      {leading ?? (icon !== undefined && (
        <span className={`w-9 h-9 rounded-control flex items-center justify-center shrink-0 ${TILE_TONE[iconTone]}`}>
          {isLucide(icon) ? (() => { const Icon = icon; return <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />; })() : icon}
        </span>
      ))}
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-[15px] leading-[22px] font-semibold text-text truncate">{title}</span>
        {subtitle && <span className="text-[13px] leading-[18px] text-muted truncate">{subtitle}</span>}
      </span>
      {trail === 'chevron' ? <ChevronRight className="w-[18px] h-[18px] text-subtle shrink-0" strokeWidth={1.75} /> : trail}
    </>
  );
  const cls = 'flex items-center gap-3 min-h-14 px-1 w-full text-left border-b border-border last:border-b-0';
  if (onClick) {
    return (
      <button onClick={onClick} disabled={disabled} className={`${cls} transition-colors disabled:opacity-50 hover:bg-surface-2/40`}>
        {content}
      </button>
    );
  }
  return <div className={cls}>{content}</div>;
}
