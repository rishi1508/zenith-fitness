import type { ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'lg' | 'md' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** lg = 52px primary action, md = 44px secondary, sm = 36px inline. */
  size?: Size;
  loading?: boolean;
  icon?: LucideIcon;
  /** Stretch to the container's width. */
  full?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface-2 text-text border border-border hover:bg-surface',
  ghost: 'bg-transparent text-accent hover:bg-accent-soft',
  danger: 'bg-danger text-white hover:brightness-110',
};

const SIZE: Record<Size, string> = {
  lg: 'h-[52px] px-5 rounded-[14px] text-base font-bold gap-2',
  md: 'h-11 px-4 rounded-control text-sm font-semibold gap-2',
  sm: 'h-9 px-3 rounded-[10px] text-[13px] font-semibold gap-1.5',
};

const ICON_SIZE: Record<Size, string> = { lg: 'w-5 h-5', md: 'w-[18px] h-[18px]', sm: 'w-4 h-4' };

/** Flat accent button (no gradients). `loading` swaps the icon for a spinner and disables. */
export function Button({
  variant = 'primary', size = 'md', loading, icon: Icon, full, className = '', children, disabled, type = 'button', ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center select-none transition-[filter,background-color,color] disabled:opacity-50 disabled:pointer-events-none ${
        VARIANT[variant]} ${SIZE[size]} ${full ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? (
        <Loader2 className={`${ICON_SIZE[size]} animate-spin`} />
      ) : (
        Icon && <Icon className={ICON_SIZE[size]} strokeWidth={2} />
      )}
      {children}
    </button>
  );
}
