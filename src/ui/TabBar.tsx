import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface TabItem<T extends string = string> {
  /** Replaces the icon entirely — used for the avatar-with-level tab. */
  render?: (active: boolean) => ReactNode;
  id: T;
  label: string;
  icon: LucideIcon;
  /** Rendered as the elevated 56px accent disc in the middle of the bar. */
  center?: boolean;
}

interface TabBarProps<T extends string> {
  items: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
}

/** Height of the bar's content box (excluding the safe-area inset). */
export const TAB_BAR_HEIGHT = 84;

/**
 * Phone bottom navigation. One equal-width column per item; an item
 * flagged `center` floats a 56px accent disc above the bar (My Gym).
 * Hidden on ≥1024px where `Sidebar` takes over.
 */
export function TabBar<T extends string>({ items, active, onChange }: TabBarProps<T>) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 grid items-start pt-[10px] border-t border-border bg-bg/92 backdrop-blur-md lg:hidden"
      style={{
        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        height: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px))`,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
      aria-label="Primary"
    >
      {items.map(({ id, label, icon: Icon, center, render }) => {
        const on = id === active;
        return (
          <button
            key={id}
            data-tour={`tab-${id}`}
            onClick={() => onChange(id)}
            aria-current={on ? 'page' : undefined}
            className={`flex flex-col items-center gap-1 text-[11px] font-bold transition-colors ${
              on ? 'text-accent' : 'text-subtle hover:text-muted'
            } ${center ? '-mt-[30px]' : ''}`}
          >
            {render ? render(on) : center ? (
              <span className="w-14 h-14 rounded-full bg-accent text-white flex items-center justify-center border-4 border-bg shadow-lg shadow-accent/35">
                <Icon className="w-[26px] h-[26px]" strokeWidth={2} />
              </span>
            ) : (
              <Icon className="w-6 h-6" strokeWidth={1.75} />
            )}
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
