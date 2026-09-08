/**
 * Who does this user actually train and talk with?
 *
 * There is no server-side interaction counter, and adding one would mean a
 * write per message and a read per buddy on every Home render — for a feature
 * that only needs an ordering. So the tally is local: each interaction adds a
 * weight, the score decays with age, and the whole map rides the existing
 * per-key Firestore sync (`zenith_buddy_affinity`) so it follows the account
 * to a new device.
 */

const KEY = 'zenith_buddy_affinity';
/** Score halves after this long without contact. */
const HALF_LIFE_DAYS = 30;
/** Beyond this the map is trimmed — nobody has 200 buddies. */
const MAX_ENTRIES = 60;

export type InteractionKind = 'message' | 'session' | 'profile' | 'reaction';

/** How much each kind of contact says about closeness. */
const WEIGHT: Record<InteractionKind, number> = {
  session: 6,   // training together is the strongest signal
  message: 3,
  reaction: 2,
  profile: 1,   // a glance at their profile barely counts
};

interface Entry { score: number; at: string }
type Map_ = Record<string, Entry>;

function read(): Map_ {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Map_) : {};
  } catch { return {}; }
}

function write(map: Map_): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
    // Same debounced sync every other storage key uses.
    void import('./firestoreSync').then((m) => m.queueFirestoreSync(KEY, map)).catch(() => {});
  } catch { /* storage unavailable */ }
}

function decayFactor(fromISO: string, now: number): number {
  const then = Date.parse(fromISO);
  if (!Number.isFinite(then)) return 1;
  const days = Math.max(0, (now - then) / 86_400_000);
  return 0.5 ** (days / HALF_LIFE_DAYS);
}

/** Current, decayed score for one buddy. Exported for tests and ranking. */
export function affinityScore(uid: string, now = Date.now(), map = read()): number {
  const e = map[uid];
  if (!e) return 0;
  return e.score * decayFactor(e.at, now);
}

/** Note an interaction. Cheap and safe to call from any handler. */
export function recordBuddyInteraction(uid: string | undefined | null, kind: InteractionKind, now = Date.now()): void {
  if (!uid) return;
  const map = read();
  const decayed = affinityScore(uid, now, map);
  map[uid] = { score: Math.round((decayed + WEIGHT[kind]) * 100) / 100, at: new Date(now).toISOString() };

  const uids = Object.keys(map);
  if (uids.length > MAX_ENTRIES) {
    const keep = uids
      .map((u) => ({ u, s: affinityScore(u, now, map) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_ENTRIES)
      .map((x) => x.u);
    const trimmed: Map_ = {};
    for (const u of keep) trimmed[u] = map[u];
    write(trimmed);
    return;
  }
  write(map);
}

/**
 * Orders buddy uids by how much this user interacts with them, most first.
 * Ties (including "no history at all") keep the caller's original order, so a
 * brand-new user still sees a sensible list rather than a shuffled one.
 */
export function rankByAffinity(uids: string[], now = Date.now()): string[] {
  const map = read();
  return uids
    .map((uid, i) => ({ uid, i, score: affinityScore(uid, now, map) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.uid);
}
