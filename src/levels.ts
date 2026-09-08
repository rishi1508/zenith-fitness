/**
 * Experience levels — one number that says how much work someone has put in.
 *
 * The measure is lifetime training volume (kg lifted, the same figure
 * `storage.calculateStats().totalVolume` reports). Everyone starts at level 1
 * and each level costs more than the last, so early levels arrive within the
 * first week and later ones take months:
 *
 *   level 2 at 1.5 t, level 3 at 4 t, level 4 at 7.4 t, … level 10 at ~45 t,
 *   level 20 at ~950 t.
 *
 * The first two steps are the owner's own numbers (1.5 t then 2.5 t); after
 * that each step is 35 % harder than the one before. Pure module, no storage —
 * see `src/levelProgress.ts` for the "have we celebrated this yet" side.
 */

/** Cost of reaching level 2, in kg of lifetime volume. */
const FIRST_STEP_KG = 1_500;
/** Cost of reaching level 3. */
const SECOND_STEP_KG = 2_500;
/** Every later step is this much harder than the previous one. */
const GROWTH = 1.35;
/** Past this the curve is academic; it also bounds every loop below. */
export const MAX_LEVEL = 99;

/** Volume needed to go from `level` to `level + 1`, in kg. */
export function stepKgFor(level: number): number {
  if (level <= 1) return FIRST_STEP_KG;
  return Math.round(SECOND_STEP_KG * GROWTH ** (level - 2));
}

/** Cumulative volume needed to BE at `level`. Level 1 costs nothing. */
export function thresholdKgFor(level: number): number {
  let total = 0;
  for (let l = 1; l < Math.min(level, MAX_LEVEL); l++) total += stepKgFor(l);
  return total;
}

export interface LevelProgress {
  level: number;
  /** Lifetime volume this level started at. */
  startKg: number;
  /** Lifetime volume the next level needs; null at MAX_LEVEL. */
  nextKg: number | null;
  /** Volume still to go; null at MAX_LEVEL. */
  remainingKg: number | null;
  /** 0–1 through the current level; 1 at MAX_LEVEL. */
  fraction: number;
}

/** Where a lifetime volume lands on the curve. */
export function levelForVolume(totalKg: number): LevelProgress {
  const volume = Number.isFinite(totalKg) && totalKg > 0 ? totalKg : 0;
  let level = 1;
  let start = 0;
  while (level < MAX_LEVEL) {
    const next = start + stepKgFor(level);
    if (volume < next) {
      return {
        level,
        startKg: start,
        nextKg: next,
        remainingKg: Math.max(0, Math.round(next - volume)),
        fraction: Math.min(1, Math.max(0, (volume - start) / (next - start))),
      };
    }
    start = next;
    level += 1;
  }
  return { level: MAX_LEVEL, startKg: start, nextKg: null, remainingKg: null, fraction: 1 };
}

/** "1.2 t" / "940 kg" — volumes get big, so tonnes above a tonne. */
export function formatVolume(kg: number): string {
  if (!Number.isFinite(kg) || kg <= 0) return '0 kg';
  if (kg < 1000) return `${Math.round(kg)} kg`;
  const t = kg / 1000;
  return `${t >= 100 ? Math.round(t) : t.toFixed(1)} t`;
}

/** Flavour shown with the badge. Deliberately about effort, not physique. */
export function levelTitle(level: number): string {
  if (level >= 40) return 'Legend';
  if (level >= 30) return 'Elite';
  if (level >= 22) return 'Veteran';
  if (level >= 15) return 'Advanced';
  if (level >= 9) return 'Intermediate';
  if (level >= 4) return 'Committed';
  return 'Beginner';
}
