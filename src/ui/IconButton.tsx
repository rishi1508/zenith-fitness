import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  /** Accessible name (also the tooltip). */
  label: string;
  /** Count bubble at the top-right corner; 0 hides it. */
  badge?: number;
  size?: 'md' | 'sm';
  /** Accent colouring for the icon. */
  active?: boolean;
}

/** 40px square bordered icon button with an optional count badge. */
export function IconButton({ icon: Icon, label, badge, size = 'md', active, className = '', type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`relative shrink-0 flex items-center justify-center rounded-control border border-border bg-surface transition-colors hover:text-text ${
        size === 'sm' ? 'w-9 h-9' : 'w-10 h-10'
      } ${active ? 'text-accent' : 'text-muted'} ${className}`}
      {...rest}
    >
      <Icon className={size === 'sm' ? 'w-[18px] h-[18px]' : 'w-5 h-5'} strokeWidth={1.75} />
      {badge && badge > 0 ? (
        <span
          className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-[5px] rounded-full bg-accent text-white text-[11px] leading-[18px] font-bold text-center"
          aria-label={`${badge} pending`}
        >
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  );
}
