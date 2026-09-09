const SEEN_KEY = 'zenith_tour_seen_v1';

/** Has this person already been shown around? Treated as "yes" when
 *  localStorage is unavailable — better a missing tour than a stuck one. */
export function tourSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; }
}

export function markTourSeen(): void {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ }
}
