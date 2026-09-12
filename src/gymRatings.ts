/**
 * Anonymous class-session ratings. The member's rating goes through
 * api/rate.ts, which checks they were in the session and writes a document
 * that carries no name — see the note at the top of that file. Managers read
 * the collection back for Analytics; the only per-device state here is a
 * marker so the card says "thanks" instead of asking twice.
 */
import { collection, getDocs, limit as fsLimit, orderBy, query, where } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { GymClass, GymSessionRating } from './types';

function endpoint(): string {
  const explicit = import.meta.env.VITE_RATE_ENDPOINT as string | undefined;
  if (explicit) return explicit;
  const push = import.meta.env.VITE_PUSH_ENDPOINT as string | undefined;
  if (push) return push.replace(/\/api\/push\/?$/, '/api/rate');
  return '/api/rate';
}

const markerKey = (gymId: string, classId: string, date: string) => `zenith_rated_${gymId}_${classId}_${date}`;

export function hasRated(gymId: string, classId: string, date: string): boolean {
  try { return localStorage.getItem(markerKey(gymId, classId, date)) === '1'; } catch { return false; }
}

export async function submitSessionRating(input: { gymId: string; classId: string; date: string; stars: number; comment?: string }): Promise<void> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Please sign in to rate a session.');
  let res: Response;
  try {
    res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, ...input, comment: input.comment?.trim() || undefined }),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || 'Could not save your rating. Please try again.');
  try { localStorage.setItem(markerKey(input.gymId, input.classId, input.date), '1'); } catch { /* fine */ }
}

/** Manager/owner: ratings for sessions on or after `sinceDate` (YYYY-MM-DD). */
export async function listRatings(gymId: string, sinceDate: string, max = 1000): Promise<GymSessionRating[]> {
  const snap = await getDocs(query(
    collection(db, 'gyms', gymId, 'ratings'),
    where('date', '>=', sinceDate),
    orderBy('date', 'desc'),
    fsLimit(max),
  ));
  return snap.docs.map((d) => d.data() as GymSessionRating);
}

export interface RatingsSummary {
  count: number;
  /** Mean stars, or null with no ratings. */
  avg: number | null;
  /** 1..5 → how many gave that many stars. */
  histogram: Record<1 | 2 | 3 | 4 | 5, number>;
  byTrainer: Array<{ trainerUid: string | null; count: number; avg: number }>;
  byClass: Array<{ classId: string; name: string; count: number; avg: number }>;
  /** Newest comments first, with the class name for context. */
  comments: Array<{ stars: number; comment: string; date: string; className: string }>;
}

/** Pure: the numbers the Analytics card and sheet show. */
export function summarizeRatings(ratings: GymSessionRating[], classes: GymClass[]): RatingsSummary {
  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? 'Class';
  const histogram: RatingsSummary['histogram'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const trainers = new Map<string | null, { sum: number; count: number }>();
  const byClassMap = new Map<string, { sum: number; count: number }>();
  let sum = 0;
  for (const r of ratings) {
    const s = Math.min(5, Math.max(1, Math.round(r.stars))) as 1 | 2 | 3 | 4 | 5;
    histogram[s]++;
    sum += s;
    const t = trainers.get(r.trainerUid ?? null) ?? { sum: 0, count: 0 };
    trainers.set(r.trainerUid ?? null, { sum: t.sum + s, count: t.count + 1 });
    const c = byClassMap.get(r.classId) ?? { sum: 0, count: 0 };
    byClassMap.set(r.classId, { sum: c.sum + s, count: c.count + 1 });
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    count: ratings.length,
    avg: ratings.length ? round1(sum / ratings.length) : null,
    histogram,
    byTrainer: [...trainers.entries()].map(([trainerUid, v]) => ({ trainerUid, count: v.count, avg: round1(v.sum / v.count) })).sort((a, b) => b.count - a.count),
    byClass: [...byClassMap.entries()].map(([classId, v]) => ({ classId, name: className(classId), count: v.count, avg: round1(v.sum / v.count) })).sort((a, b) => b.count - a.count),
    comments: ratings
      .filter((r) => r.comment)
      .sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at))
      .map((r) => ({ stars: r.stars, comment: r.comment as string, date: r.date, className: className(r.classId) })),
  };
}
