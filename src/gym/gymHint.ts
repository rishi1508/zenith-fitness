/**
 * What this device last knew about the signed-in user's gym. Read
 * synchronously on the very first render (before auth resolves) so the My
 * Gym tab, the accent colour and the splash's "by <gym>" line are in the
 * first paint. A hint for a different account is discarded the moment auth
 * says so (GymContext).
 */
export interface GymHint { uid: string; gymId: string; gymName?: string; accentColor?: string }

export const HINT_KEY = 'zenith_gym_hint';

export function readHint(): GymHint | null {
  try {
    const raw = localStorage.getItem(HINT_KEY);
    const parsed = raw ? (JSON.parse(raw) as GymHint) : null;
    return parsed?.uid && parsed.gymId ? parsed : null;
  } catch {
    return null;
  }
}

export function writeHint(hint: GymHint | null): void {
  try {
    if (hint) localStorage.setItem(HINT_KEY, JSON.stringify(hint));
    else localStorage.removeItem(HINT_KEY);
  } catch { /* private mode */ }
}
