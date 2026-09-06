import type { Workout, WorkoutSet } from '../types';
import { localIso } from '../streakService';

/**
 * Small, deterministic formatters shared by the context pack and the
 * data-request resolvers. Everything here is plain string work — no
 * locale calls, so the output is identical on every device.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "72.5" / "70" — up to `digits` decimals, trailing zeros dropped. */
export function num(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '0';
  const s = n.toFixed(digits);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Signed change: "+0.3", "−1.2", "±0". */
export function signed(n: number, digits = 1): string {
  const r = Number(n.toFixed(digits));
  if (r > 0) return '+' + num(r, digits);
  if (r < 0) return '−' + num(-r, digits);
  return '±0';
}

/** Volume in kg: 820 → "820", 8420 → "8.4k", 1_236_000 → "1236k". */
export function fmtVolume(kg: number): string {
  if (!Number.isFinite(kg) || kg <= 0) return '0';
  if (kg >= 100_000) return Math.round(kg / 1000) + 'k';
  if (kg >= 1000) return num(kg / 1000, 1) + 'k';
  return String(Math.round(kg));
}

/** "Fri 5 Sep" (local time). */
export function fmtDay(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '?';
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "5 Sep 2026" — for dates that may be far back. */
export function fmtDate(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '?';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "5 Sep" — short form for compact lists. */
export function fmtShort(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '?';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Local YYYY-MM-DD of a workout/entry timestamp. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : localIso(d);
}

export function isTraining(w: Workout): boolean {
  return w.completed && w.type !== 'rest';
}

export function byDateDesc(a: { date: string }, b: { date: string }): number {
  return new Date(b.date).getTime() - new Date(a.date).getTime();
}

export function byDateAsc(a: { date: string }, b: { date: string }): number {
  return new Date(a.date).getTime() - new Date(b.date).getTime();
}

export function completedSets(sets: WorkoutSet[]): WorkoutSet[] {
  return sets.filter((s) => s.completed && s.reps > 0);
}

export function setsVolume(sets: WorkoutSet[]): number {
  let v = 0;
  for (const s of sets) if (s.completed && s.weight > 0 && s.reps > 0) v += s.weight * s.reps;
  return v;
}

export function workoutVolume(w: Workout): number {
  if (w.type === 'rest') return 0;
  let v = 0;
  for (const ex of w.exercises) v += setsVolume(ex.sets);
  return v;
}

/** Heaviest completed set; ties broken by reps. */
export function bestSet(sets: WorkoutSet[]): { weight: number; reps: number } | null {
  let best: { weight: number; reps: number } | null = null;
  for (const s of sets) {
    if (!s.completed || s.reps <= 0) continue;
    if (!best || s.weight > best.weight || (s.weight === best.weight && s.reps > best.reps)) {
      best = { weight: s.weight, reps: s.reps };
    }
  }
  return best;
}

/** "70×6" (bodyweight sets show as "BW×12"). */
export function fmtSet(s: { weight: number; reps: number }): string {
  return `${s.weight > 0 ? num(s.weight, 2) : 'BW'}×${s.reps}`;
}

/** "70×6, 70×6, 75×5" — every completed set in order. */
export function fmtSets(sets: WorkoutSet[]): string {
  return completedSets(sets).map(fmtSet).join(', ') || 'no sets';
}

/** "Bench Press 75×6 (4 sets)". */
export function fmtExerciseBest(name: string, sets: WorkoutSet[]): string {
  const done = completedSets(sets);
  const best = bestSet(sets);
  if (!best) return `${name} (no sets)`;
  return `${name} ${fmtSet(best)} (${done.length} set${done.length === 1 ? '' : 's'})`;
}

/** Cuts at the last line break before `max` and marks the cut. */
export function capChars(text: string, max: number): string {
  if (text.length <= max) return text;
  const marker = '\n…(truncated)';
  const room = max - marker.length;
  const cut = text.lastIndexOf('\n', room);
  return text.slice(0, cut > room * 0.6 ? cut : room).trimEnd() + marker;
}

/** Whole days from a to b (YYYY-MM-DD strings, local). */
export function daysBetween(aISO: string, bISO: string): number {
  const a = new Date(aISO + 'T00:00:00');
  const b = new Date(bISO + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
