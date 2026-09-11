import { useRef, useState } from 'react';
import { Card } from '../../../ui';
import { H2, SUB } from '../../../ui/styles';
import type { AcquisitionMonth } from '../../../gym/gymOps';

/** Both ends plus every fourth month — twelve labels would collide at 412px. */
function labelIndices(n: number): number[] {
  const out = new Set<number>([0]);
  for (let i = n - 1; i >= 2; i -= 4) out.add(i);
  return [...out].sort((a, b) => a - b);
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Member acquisition against churn, twelve months of opposed columns.
 * Joins grow up from the zero line and departures down from it on the
 * same scale, so the shape of the year is the answer and the exact net
 * comes from holding a month. Same scrub idiom as PeakHours: pointer
 * capture on the track, and every column is a real focusable button.
 */
export function AcquisitionChurnChart({ series }: { series: AcquisitionMonth[] }) {
  const [active, setActive] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const max = Math.max(1, ...series.map((m) => Math.max(m.new, m.churned)));
  const empty = series.every((m) => m.new === 0 && m.churned === 0);
  const shown = series[active ?? series.length - 1];
  const labels = labelIndices(series.length);

  /** Which column is under this x — so a slide reads continuously rather
   *  than only when a finger lands on a bar. */
  const columnAt = (clientX: number): number | null => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    const i = Math.floor(((clientX - box.left) / box.width) * series.length);
    return i >= 0 && i < series.length ? i : null;
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <h2 className={H2}>Acquisition vs churn</h2>
          <p className={SUB}>Members joined and lost · last 12 months</p>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-lg leading-6 font-bold tabular-nums ${shown.net > 0 ? 'text-ok' : shown.net < 0 ? 'text-danger' : 'text-muted'}`}>
            {signed(shown.net)}
          </div>
          <div className="text-[11px] text-subtle">net · {shown.month}</div>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span className="w-2.5 h-2.5 rounded-[2px] bg-accent" aria-hidden />New members
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span className="w-2.5 h-2.5 rounded-[2px] bg-danger/70" aria-hidden />Churned
        </span>
      </div>

      {empty ? (
        <p className="text-sm text-muted py-6 text-center">No joins or departures in the last 12 months.</p>
      ) : (
        <>
          <div className="flex gap-1.5">
            <div className="w-6 shrink-0 flex flex-col justify-between text-[10px] leading-none text-subtle tabular-nums text-right pt-0.5 pb-0.5">
              <span>{max}</span>
              <span>0</span>
              <span>{max}</span>
            </div>

            <div
              ref={trackRef}
              data-elastic-skip
              className="relative flex-1 h-[124px] flex touch-none select-none"
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setActive(columnAt(e.clientX)); }}
              onPointerMove={(e) => { if (e.buttons > 0 || e.pointerType === 'touch') setActive(columnAt(e.clientX)); }}
              onPointerUp={() => setActive(null)}
              onPointerCancel={() => setActive(null)}
              onPointerLeave={() => setActive(null)}
            >
              {/* Zero rule — the only gridline this chart needs; the two
                  halves share one scale so the y labels carry the rest. */}
              <div className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden />

              {series.map((m, i) => (
                <button
                  key={m.month}
                  type="button"
                  aria-label={`${m.month}: ${m.new} new, ${m.churned} churned, net ${signed(m.net)}`}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className={`relative flex-1 h-full min-w-0 outline-none rounded-[3px] ${i === active ? 'bg-surface-2' : ''}`}
                >
                  <span
                    className="absolute left-[22%] right-[22%] bottom-[calc(50%+1px)] rounded-t-[3px] bg-accent"
                    style={{ height: `calc(${(m.new / max) * 50}% - 1px)` }}
                    aria-hidden
                  />
                  <span
                    className="absolute left-[22%] right-[22%] top-[calc(50%+1px)] rounded-b-[3px] bg-danger/70"
                    style={{ height: `calc(${(m.churned / max) * 50}% - 1px)` }}
                    aria-hidden
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="relative h-4 mt-1 ml-[30px] text-[10px] leading-4 text-subtle">
            {labels.map((i) => (
              <span
                key={i}
                className="absolute whitespace-nowrap"
                style={
                  i === series.length - 1
                    ? { right: 0 }
                    : i === 0
                      ? { left: 0 }
                      : { left: `${((i + 0.5) / series.length) * 100}%`, transform: 'translateX(-50%)' }
                }
              >
                {series[i].month}
              </span>
            ))}
          </div>

          <p className="text-xs text-muted mt-2">
            {shown.new} joined and {shown.churned} left in {shown.month}.
            {active === null ? ' Hold and slide across for any month.' : ''}
          </p>
        </>
      )}
    </Card>
  );
}
