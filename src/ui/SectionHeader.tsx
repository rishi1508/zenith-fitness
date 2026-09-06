import type { ReactNode } from 'react';
import { CAPTION } from './styles';

interface SectionHeaderProps {
  caption: ReactNode;
  /** A link-style action (`{ label, onClick }`) or any node. */
  trailing?: { label: string; onClick: () => void } | ReactNode;
}

function isLink(v: unknown): v is { label: string; onClick: () => void } {
  return typeof v === 'object' && v !== null && 'label' in v && 'onClick' in v;
}

/** Caption row above a card group: "BUDDIES … See all". */
export function SectionHeader({ caption, trailing }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <span className={CAPTION}>{caption}</span>
      {isLink(trailing) ? (
        <button onClick={trailing.onClick} className="text-[13px] font-bold text-accent hover:brightness-110">
          {trailing.label}
        </button>
      ) : (
        trailing
      )}
    </div>
  );
}
