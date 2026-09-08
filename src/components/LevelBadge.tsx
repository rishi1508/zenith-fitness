import { Sparkles } from 'lucide-react';
import { formatVolume, levelForVolume, levelTitle } from '../levels';
import { CAPTION, SUB } from '../ui';

/** Compact "Lv 12 · Advanced" pill for a profile header. */
export function LevelPill({ level, className = '' }: { level: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 h-6 px-2 rounded-full bg-accent-soft text-accent text-[11px] font-bold ${className}`}
      title={`${levelTitle(level)} — level ${level}`}
    >
      <Sparkles className="w-3 h-3" strokeWidth={2.5} />
      Lv {level} · {levelTitle(level)}
    </span>
  );
}

/**
 * Level with a progress bar towards the next one. Used on the You tab; a
 * buddy's profile shows the pill alone (their remaining volume is not ours
 * to display precisely).
 */
export function LevelProgressCard({ totalVolumeKg }: { totalVolumeKg: number }) {
  const p = levelForVolume(totalVolumeKg);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className={CAPTION}>Level {p.level} · {levelTitle(p.level)}</span>
        <span className="text-[11px] font-semibold text-subtle tabular-nums">
          {formatVolume(totalVolumeKg)} lifted
        </span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-surface-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${Math.round(p.fraction * 100)}%` }}
        />
      </div>
      <p className={`${SUB} mt-1.5`}>
        {p.remainingKg == null
          ? 'Top level reached — everything from here is bonus.'
          : `${formatVolume(p.remainingKg)} more to level ${p.level + 1}.`}
      </p>
    </div>
  );
}
