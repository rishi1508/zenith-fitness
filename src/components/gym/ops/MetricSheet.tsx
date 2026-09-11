import { useState } from 'react';
import type { ReactNode } from 'react';
import { Sheet } from '../../../ui';
import { CAPTION } from '../../../ui/styles';

/**
 * The words behind a number. Every metric on the analytics screen opens one
 * of these: what it means in plain language, how it was counted, what a good
 * figure looks like, and — where the data allows — the last twelve months
 * drawn out, so an owner who has never heard "MRR" can still read the tile.
 */
export interface MetricExplainer {
  title: string;
  /** The headline figure, as shown on the tile. */
  value?: ReactNode;
  /** One or two plain sentences. No jargon that is not defined here. */
  meaning: string;
  /** Where the number comes from — the rule, in words. */
  method: string;
  /** The band to aim for, when there is an honest one. */
  good?: string;
}

export interface HistoryPoint {
  label: string;
  value: number;
}

interface HistoryBarsProps {
  points: HistoryPoint[];
  format: (v: number) => string;
  tone?: 'accent' | 'info' | 'ok';
  /** Caption above the bars, e.g. "Last 12 months". */
  caption: string;
}

const TONE = {
  accent: { full: 'bg-accent', muted: 'bg-accent/40' },
  info: { full: 'bg-info', muted: 'bg-info/40' },
  ok: { full: 'bg-ok', muted: 'bg-ok/40' },
} as const;

/** Twelve quiet bars. Tap one to read it; the newest is drawn full-tone. */
export function HistoryBars({ points, format, tone = 'accent', caption }: HistoryBarsProps) {
  const [active, setActive] = useState<number | null>(null);
  const last = points.length - 1;
  const shown = active ?? last;
  const max = Math.max(1, ...points.map((p) => p.value));
  const empty = points.every((p) => p.value === 0);
  const colors = TONE[tone];

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className={CAPTION}>{caption}</span>
        {!empty && points[shown] && (
          <span className="text-[13px] font-bold tabular-nums text-text">
            {format(points[shown].value)} <span className="font-medium text-muted">{points[shown].label}</span>
          </span>
        )}
      </div>
      <div className="flex items-end gap-1 h-16" data-elastic-skip>
        {points.map((p, i) => (
          <button
            key={p.label + i}
            type="button"
            aria-label={`${p.label}: ${format(p.value)}`}
            onClick={() => setActive(i === active ? null : i)}
            className="flex-1 h-full flex items-end min-w-0 outline-none"
          >
            <span
              className={`w-full rounded-t-[3px] transition-colors ${i === shown ? colors.full : colors.muted}`}
              style={{ height: `${p.value > 0 ? Math.max((p.value / max) * 100, 4) : 2}%` }}
            />
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-subtle mt-1">
        <span>{points[0]?.label}</span>
        <span>{points[Math.floor(last / 2)]?.label}</span>
        <span>{points[last]?.label}</span>
      </div>
      {empty && <p className="text-xs text-subtle mt-2">Nothing recorded in these months yet.</p>}
    </div>
  );
}

export function MetricSheet({ open, onClose, explainer, children }: {
  open: boolean;
  onClose: () => void;
  explainer: MetricExplainer;
  /** The visual: a HistoryBars, a list of people, a formula — whatever shows the number. */
  children?: ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={explainer.title}>
      <div className="space-y-5 pb-2">
        {explainer.value !== undefined && (
          <div className="font-display text-[32px] leading-9 font-bold tabular-nums text-text">{explainer.value}</div>
        )}

        <section>
          <div className={`${CAPTION} mb-1`}>What it means</div>
          <p className="text-[15px] leading-[22px] text-text">{explainer.meaning}</p>
        </section>

        {children}

        <section>
          <div className={`${CAPTION} mb-1`}>How it is counted</div>
          <p className="text-sm leading-5 text-muted">{explainer.method}</p>
        </section>

        {explainer.good && (
          <section>
            <div className={`${CAPTION} mb-1`}>What good looks like</div>
            <p className="text-sm leading-5 text-muted">{explainer.good}</p>
          </section>
        )}
      </div>
    </Sheet>
  );
}
