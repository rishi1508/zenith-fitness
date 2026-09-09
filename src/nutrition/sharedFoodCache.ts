import { collection, getDocs, limit as fsLimit, query } from 'firebase/firestore';
import { db } from '../firebase';
import type { FoodItem } from '../types';

/**
 * The community food library, read back.
 *
 * Every food a member creates is published to `sharedFoods` — but until now
 * nothing ever read it, so a food existed only on the device that created it.
 * Rishi created "High Protein Roti" on his phone and could not find it
 * afterwards: the shared copy was there all along, his own copy was not
 * (a whole-array sync from another device had overwritten it).
 *
 * Cost shape: one `getDocs` per session at most, capped, cached in
 * localStorage with a timestamp. No listener (docs/COST_CONTROLS.md).
 */

const CACHE_KEY = 'zenith_shared_foods_cache';
const MAX_DOCS = 500;
/** Long enough that a day of use is one read; short enough to see a new food. */
const TTL_MS = 6 * 60 * 60 * 1000;

interface Cache {
  at: number;
  foods: FoodItem[];
}

function read(): Cache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cache) : null;
  } catch {
    return null;
  }
}

/** Whatever is cached right now — synchronous, for render paths. */
export function getSharedFoods(): FoodItem[] {
  return read()?.foods ?? [];
}

let inFlight: Promise<FoodItem[]> | null = null;

/** Fetches the library if the cache is stale. At most one request at a time. */
export async function loadSharedFoods(force = false): Promise<FoodItem[]> {
  const cached = read();
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.foods;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const snap = await getDocs(query(collection(db, 'sharedFoods'), fsLimit(MAX_DOCS)));
      const foods = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<FoodItem, 'id'>) }))
        .filter((f) => !!f.name && !!f.per100g);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), foods } satisfies Cache));
      } catch { /* private mode */ }
      return foods;
    } catch (err) {
      console.warn('[Nutrition] sharedFoods read failed:', err);
      return cached?.foods ?? [];
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
