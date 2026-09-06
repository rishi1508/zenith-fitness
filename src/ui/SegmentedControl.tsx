import type { ReactNode } from 'react';

interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Accessible name for the group. */
  label?: string;
}

/** Two-to-four-way switch (Member | Manage). The selected segment lifts onto a surface. */
export function SegmentedControl<T extends string>({ options, value, onChange, className = '', label }: SegmentedControlProps<T>) {
  return (
    <div role="tablist" aria-label={label} className={`flex bg-surface-2 rounded-control p-1 gap-1 ${className}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={`flex-1 h-9 rounded-[9px] text-sm font-bold transition-colors ${
              on ? 'bg-surface text-text shadow-[0_1px_2px_rgba(0,0,0,.25)]' : 'text-muted hover:text-text'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
