import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Info } from 'lucide-react';
import { StatTile } from '../../../ui';

interface KpiTileProps {
  eyebrow: string;
  value: ReactNode;
  /** Period-over-period change in percent; null when there is nothing to compare with. */
  changePct?: number | null;
  /** What the change is measured against, e.g. "vs 30 days ago". */
  changeLabel?: string;
  /** Shown instead of a delta when a percentage would be dishonest. */
  sub?: ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'danger' | 'accent' | 'info';
  /** Makes the whole tile the tap target — a link inside one is too small. */
  onClick?: () => void;
}

/**
 * A dashboard KPI: the kit's StatTile plus the one thing it has no slot
 * for — a signed period-over-period delta. Tiles without a comparable
 * prior period say what they are instead of inventing a percentage.
 */
export function KpiTile({ eyebrow, value, changePct, changeLabel, sub, tone, onClick }: KpiTileProps) {
  const delta = changePct == null ? null : (
    <span className={`inline-flex items-center gap-0.5 font-semibold ${changePct >= 0 ? 'text-ok' : 'text-danger'}`}>
      {changePct >= 0 ? <ArrowUpRight className="w-3 h-3" strokeWidth={2.5} /> : <ArrowDownRight className="w-3 h-3" strokeWidth={2.5} />}
      {Math.abs(changePct) >= 100 ? Math.round(Math.abs(changePct)) : Math.abs(changePct).toFixed(1)}%
    </span>
  );

  return (
    <StatTile
      compact
      onClick={onClick}
      // The small "i" is the promise that tapping explains the number —
      // MRR and CLV mean nothing to most owners until they have read it once.
      eyebrow={onClick ? (
        <span className="inline-flex items-center gap-1 min-w-0">
          <span className="truncate">{eyebrow}</span>
          <Info className="w-3 h-3 shrink-0 text-subtle" strokeWidth={2.25} aria-hidden />
        </span>
      ) : eyebrow}
      value={value}
      tone={tone}
      sub={
        <span className="flex items-center gap-1 min-w-0">
          {delta}
          <span className="truncate">{delta ? changeLabel : sub}</span>
        </span>
      }
    />
  );
}
