import { useEffect, useMemo, useState } from 'react';
import type { NutritionDay, NutritionTargets } from '../../types';
import { getNutritionDay, getTargets, localDateISO, subscribeHealth, sumMacros } from '../../health/store';
import { CAPTION, STAT } from '../../ui';

export interface NutritionRingProps {
  /** Local date (YYYY-MM-DD). Defaults to today. Ignored when `day` is given. */
  date?: string;
  /** Pre-read day — pass it when the parent already holds one, otherwise the
   *  ring reads `getNutritionDay(date)` itself and follows `subscribeHealth`. */
  day?: NutritionDay;
  /** Pre-read targets; omitted → `getTargets()`. */
  targets?: NutritionTargets | null;
  /** Ring diameter in px (default 128). */
  size?: number;
  /** Protein / carbs / fat pills under the ring (default true). */
  showMacros?: boolean;
  onClick?: () => void;
  className?: string;
}

/**
 * Calories consumed vs target as a ring, with optional macro pills
 * (docs/HEALTH_SPEC.md §3). Self-sufficient by default so Home and the
 * Health tab can drop it in with no props; the diary passes the day it
 * already has to avoid a second read.
 */
export function NutritionRing({
  date, day, targets, size = 128, showMacros = true, onClick, className = '',
}: NutritionRingProps) {
  const [tick, setTick] = useState(0);
  const self = day === undefined;
  const iso = date ?? localDateISO();

  useEffect(() => {
    if (!self) return;
    return subscribeHealth(() => setTick((t) => t + 1));
  }, [self]);

  const resolvedDay = useMemo(
    () => day ?? getNutritionDay(iso),
    // `tick` re-reads the store after a health-store change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [day, iso, tick],
  );
  const resolvedTargets = useMemo(
    () => (targets !== undefined ? targets : getTargets()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targets, tick],
  );

  const totals = useMemo(() => sumMacros(resolvedDay), [resolvedDay]);
  const targetKcal = resolvedTargets?.kcal ?? null;
  const kcal = Math.round(totals.kcal);
  const pct = targetKcal ? Math.min(1, kcal / targetKcal) : 0;
  const over = targetKcal != null && kcal > targetKcal;
  const left = targetKcal != null ? targetKcal - kcal : null;

  const stroke = Math.max(8, Math.round(size * 0.085));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  const body = (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
            className="stroke-surface-2"
          />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
            className={over ? 'stroke-danger' : 'stroke-accent'}
            strokeDasharray={`${circumference * pct} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dasharray .3s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`${STAT} ${over ? 'text-danger' : 'text-text'}`}>{kcal}</span>
          <span className="text-[11px] leading-4 text-muted">
            {targetKcal ? `of ${targetKcal} kcal` : 'kcal'}
          </span>
          {left != null && (
            <span className="text-[11px] leading-4 font-semibold text-subtle">
              {left >= 0 ? `${left} left` : `${-left} over`}
            </span>
          )}
        </div>
      </div>

      {showMacros && (
        <div className="flex items-stretch gap-2 w-full">
          <MacroPill label="Protein" value={totals.protein} target={resolvedTargets?.protein} />
          <MacroPill label="Carbs" value={totals.carbs} target={resolvedTargets?.carbs} />
          <MacroPill label="Fat" value={totals.fat} target={resolvedTargets?.fat} />
        </div>
      )}
    </div>
  );

  if (onClick) {
    return (
      <button onClick={onClick} className="w-full" aria-label="Open the nutrition diary">
        {body}
      </button>
    );
  }
  return body;
}

function MacroPill({ label, value, target }: { label: string; value: number; target?: number }) {
  return (
    <div className="flex-1 min-w-0 rounded-control bg-surface-2 px-2 py-1.5 text-center">
      <div className={`${CAPTION} truncate`}>{label}</div>
      <div className="text-[13px] font-bold tabular-nums text-text truncate">
        {Math.round(value)}{target ? <span className="text-subtle font-semibold">/{target}</span> : null} g
      </div>
    </div>
  );
}
