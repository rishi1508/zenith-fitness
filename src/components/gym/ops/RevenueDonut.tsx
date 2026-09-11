import { useState } from 'react';
import { Card } from '../../../ui';
import { H2, SUB } from '../../../ui/styles';
import { formatInr, type RevenueSplitResult } from '../../../gym/gymOps';

const RADIUS = 44;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Arc length of the surface-coloured gap between slices (~2px on screen). */
const GAP = 2;

/** Categorical order is fixed: memberships own the accent, PT the info
 *  blue, and everything else the de-emphasis grey. */
const SLICE_COLOR = ['var(--color-accent)', 'var(--color-info)', 'var(--color-muted)'];

/**
 * Where the money comes from. A donut earns its place here because the
 * question is part-to-whole across three buckets, and the centre keeps
 * the total — the number the owner actually quotes — at full size.
 * Pressing a slice or its legend row focuses it; the legend carries both
 * the percentage and the rupees, so nothing is gated behind the press.
 */
export function RevenueDonut({ split }: { split: RevenueSplitResult }) {
  const [focused, setFocused] = useState<number | null>(null);
  const focusedSlice = focused == null ? null : split.slices[focused];

  const arcs = split.slices.map((slice, i) => ({
    i,
    start: split.slices.slice(0, i).reduce((sum, s) => sum + s.share, 0) * CIRCUMFERENCE,
    length: slice.share * CIRCUMFERENCE,
    color: SLICE_COLOR[i],
  }));

  return (
    <Card>
      <div className="mb-3">
        <h2 className={H2}>Revenue split</h2>
        <p className={SUB}>What was paid in · last {split.days} days</p>
      </div>

      {split.total === 0 ? (
        <p className="text-sm text-muted py-6 text-center">No payments recorded in this window.</p>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-[168px] h-[168px] shrink-0">
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90" role="presentation">
              {arcs.map((arc) =>
                arc.length <= GAP ? null : (
                  <circle
                    key={arc.i}
                    cx="60"
                    cy="60"
                    r={RADIUS}
                    fill="none"
                    stroke={arc.color}
                    strokeWidth={focused === arc.i ? 18 : 14}
                    strokeDasharray={`${Math.max(0, arc.length - GAP)} ${CIRCUMFERENCE - Math.max(0, arc.length - GAP)}`}
                    strokeDashoffset={-arc.start}
                    opacity={focused == null || focused === arc.i ? 1 : 0.35}
                    className="cursor-pointer"
                    onPointerDown={() => setFocused(focused === arc.i ? null : arc.i)}
                  />
                ),
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pointer-events-none">
              <span className="font-display text-xl leading-6 font-bold tracking-[-0.02em] tabular-nums text-text">
                {formatInr(focusedSlice ? focusedSlice.amount : split.total)}
              </span>
              <span className="text-[11px] leading-4 text-subtle mt-0.5">
                {focusedSlice ? focusedSlice.label : 'Total'}
              </span>
            </div>
          </div>

          <div className="w-full flex flex-col gap-1">
            {split.slices.map((slice, i) => (
              <button
                key={slice.key}
                type="button"
                aria-pressed={focused === i}
                onClick={() => setFocused(focused === i ? null : i)}
                className={`flex items-center gap-2.5 min-h-10 px-2 rounded-control text-left transition-colors ${
                  focused === i ? 'bg-surface-2' : ''
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-[2px] shrink-0" style={{ background: SLICE_COLOR[i] }} aria-hidden />
                <span className="flex-1 min-w-0 truncate text-sm text-text">{slice.label}</span>
                <span className="text-sm font-bold tabular-nums text-text">{slice.pct}%</span>
                <span className="text-sm tabular-nums text-muted w-[76px] text-right">{formatInr(slice.amount)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
