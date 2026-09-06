import type { ReactNode } from 'react';
import type { TabItem } from './TabBar';

interface SidebarProps<T extends string> {
  items: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  /** User block pinned to the bottom (avatar, name, secondary line). */
  user?: { name: string; sub?: string; avatar?: ReactNode; onClick?: () => void };
}

/**
 * Desktop (≥1024px) navigation rail: 240px, the same items as the phone
 * TabBar stacked vertically, brand on top and the user block at the
 * bottom. Hidden below lg.
 */
export function Sidebar<T extends string>({ items, active, onChange, user }: SidebarProps<T>) {
  return (
    <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-border bg-bg px-3 py-5 gap-1">
      <div className="flex items-center gap-2.5 px-3 pb-5">
        <img src="/icon.svg" alt="" className="w-8 h-8 rounded-lg" />
        <span className="font-display text-lg font-bold tracking-[-0.01em]">Zenith Fitness</span>
      </div>
      <nav className="flex flex-col gap-1" aria-label="Primary">
        {items.map(({ id, label, icon: Icon, center }) => {
          const on = id === active;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              aria-current={on ? 'page' : undefined}
              className={`flex items-center gap-3 h-11 px-3 rounded-control text-sm font-bold transition-colors ${
                on ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface hover:text-text'
              }`}
            >
              <span className={center ? 'w-7 h-7 rounded-lg bg-accent text-white flex items-center justify-center' : ''}>
                <Icon className={center ? 'w-4 h-4' : 'w-5 h-5'} strokeWidth={1.75} />
              </span>
              {label}
            </button>
          );
        })}
      </nav>
      {user && (
        <button
          onClick={user.onClick}
          className="mt-auto flex items-center gap-3 px-3 py-2 rounded-control text-left hover:bg-surface transition-colors"
        >
          {user.avatar}
          <span className="min-w-0">
            <span className="block text-sm font-bold truncate">{user.name}</span>
            {user.sub && <span className="block text-xs text-muted truncate">{user.sub}</span>}
          </span>
        </button>
      )}
    </aside>
  );
}
