import { useEffect, useMemo, useState } from 'react';
import type { NutritionDay, NutritionTargets } from '../../types';
import { getNutritionDay, getTargets, localDateISO, subscribeHealth, sumMacros } from '../../health/store';
import { CAPTION } from '../../ui';

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
  /** Protein / carbs / fat rings under the calorie ring (default true). */
  showMacros?: boolean;
  /** Diameter of those macro rings (default 56). */
  macroSize?: number;
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
  date, day, targets, size = 128, showMacros = true, macroSize = 56, onClick, className = '',
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

  const stroke = Math.max(6, Math.round(size * 0.085));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  // The three stacked lines only fit inside a big ring. Small ones (the Home
  // row) show the number and a compact "/target" and drop the rest, instead
  // of overlapping three lines of text inside a 64px circle.
  const compact = size < 104;
  const numberSize = Math.max(15, Math.round(size * 0.22));
  const captionSize = Math.max(9, Math.round(size * 0.085));

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
        <div className="absolute inset-0 flex flex-col items-center justify-center px-2 text-center leading-none">
          <span
            className={`font-display font-bold tabular-nums tracking-[-0.02em] ${over ? 'text-danger' : 'text-text'}`}
            style={{ fontSize: numberSize, lineHeight: 1.05 }}
          >
            {kcal}
          </span>
          <span className="text-muted mt-0.5" style={{ fontSize: captionSize, lineHeight: 1.2 }}>
            {targetKcal ? (compact ? `/ ${targetKcal}` : `of ${targetKcal} kcal`) : 'kcal'}
          </span>
          {!compact && left != null && (
            <span className="font-semibold text-subtle mt-0.5" style={{ fontSize: captionSize, lineHeight: 1.2 }}>
              {left >= 0 ? `${left} left` : `${-left} over`}
            </span>
          )}
        </div>
      </div>

      {showMacros && <NutritionMacroRings date={iso} day={resolvedDay} targets={resolvedTargets} size={macroSize} />}
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

/**
 * Protein, carbs and fat as rings of their own — the same language the
 * calorie ring speaks, so the day reads at a glance instead of as three
 * numbers. Self-sufficient like `NutritionRing`: hand it a day or let it
 * read one.
 */
export function NutritionMacroRings({
  date, day, targets, size = 56, className = '',
}: Pick<NutritionRingProps, 'date' | 'day' | 'targets' | 'className'> & { size?: number }) {
  const [tick, setTick] = useState(0);
  const self = day === undefined;
  const iso = date ?? localDateISO();
  useEffect(() => {
    if (!self) return;
    return subscribeHealth(() => setTick((t) => t + 1));
  }, [self]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const resolvedDay = useMemo(() => day ?? getNutritionDay(iso), [day, iso, tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useMemo(() => (targets !== undefined ? targets : getTargets()), [targets, tick]);
  const totals = useMemo(() => sumMacros(resolvedDay), [resolvedDay]);

  return (
    <div className={`flex items-start justify-center gap-3 ${className}`}>
      <MacroRing label="Protein" value={totals.protein} target={t?.protein} size={size} tone="stroke-info" />
      <MacroRing label="Carbs" value={totals.carbs} target={t?.carbs} size={size} tone="stroke-ok" />
      <MacroRing label="Fat" value={totals.fat} target={t?.fat} size={size} tone="stroke-warn" />
    </div>
  );
}

/**
 * One macro as its own small ring, so protein reads the same way calories
 * do — a circle you can see the state of without reading the numbers.
 */
function MacroRing({ label, value, target, size, tone }: {
  label: string;
  value: number;
  target?: number;
  size: number;
  tone: string;
}) {
  const stroke = Math.max(4, Math.round(size * 0.11));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = target ? Math.min(1, value / target) : 0;
  const over = target != null && value > target * 1.05;

  return (
    <div className="flex flex-col items-center gap-1 min-w-0">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-2" />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
            className={over ? 'stroke-danger' : tone}
            strokeDasharray={`${circumference * pct} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dasharray .3s ease' }}
          />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center font-bold tabular-nums text-text"
          style={{ fontSize: Math.max(10, Math.round(size * 0.26)) }}
        >
          {Math.round(value)}
        </span>
      </div>
      <span className={`${CAPTION} truncate`}>{label}</span>
      {target ? (
        <span className="text-[10px] text-subtle tabular-nums leading-none">of {target} g</span>
      ) : (
        <span className="text-[10px] text-subtle leading-none">g</span>
      )}
    </div>
  );
}
