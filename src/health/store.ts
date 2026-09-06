// Health data store — docs/HEALTH_SPEC.md §3.
//
// Small, whole-value keys (profile, phase, targets, favourites, recents,
// custom foods) go through storage.ts-style localStorage + the existing
// FirestoreSync (registered in firestoreSync.ts STORAGE_TO_FIRESTORE).
//
// Per-day documents (nutrition, activity) are different: they grow without
// bound, so they live as one Firestore doc per local day under
// users/{uid}/nutrition/{date} and users/{uid}/activity/{date}, with a
// 90-day localStorage cache. Reading a day costs one Firestore read; the
// cache answers instantly and is reconciled by `updatedAt` (last write wins).

import { doc, getDoc, setDoc, collection, query, where, getDocs, documentId, orderBy, limit as fsLimit } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { queueFirestoreSync } from '../firestoreSync';
import type {
  NutritionDay, NutritionTargets, ActivityDay, HealthProfile, PhaseSettings, FoodItem,
} from '../types';

export const HEALTH_KEYS = {
  PROFILE: 'zenith_health_profile',
  PHASE: 'zenith_phase_settings',
  TARGETS: 'zenith_nutrition_targets',
  FAVOURITES: 'zenith_food_favourites',
  RECENTS: 'zenith_food_recents',
  CUSTOM_FOODS: 'zenith_custom_foods',
  NUTRITION_DAYS: 'zenith_nutrition_days', // cache only — never synced as a whole
  ACTIVITY_DAYS: 'zenith_activity_days',   // cache only — never synced as a whole
} as const;

const CACHE_DAYS = 90;
const RECENTS_MAX = 30;

// ---------- change notifications ----------
type Listener = () => void;
const listeners = new Set<Listener>();
/** Subscribe to any health-store change (React views re-read on notify). */
export function subscribeHealth(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function notify(): void { for (const fn of listeners) fn(); }

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function writeSynced<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); queueFirestoreSync(key, value); } catch (e) { console.error('[Health] save failed', key, e); }
  notify();
}
function writeLocal<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.error('[Health] cache write failed', key, e); }
}

export function localDateISO(d: Date = new Date()): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function addDaysISO(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return localDateISO(new Date(y, m - 1, d + n));
}

// ---------- small synced values ----------
export function getHealthProfile(): HealthProfile { return read<HealthProfile>(HEALTH_KEYS.PROFILE, {}); }
export function setHealthProfile(p: HealthProfile): void { writeSynced(HEALTH_KEYS.PROFILE, p); }

export function getPhaseSettings(): PhaseSettings | null { return read<PhaseSettings | null>(HEALTH_KEYS.PHASE, null); }
export function setPhaseSettings(p: PhaseSettings | null): void { writeSynced(HEALTH_KEYS.PHASE, p); }

export function getTargets(): NutritionTargets | null { return read<NutritionTargets | null>(HEALTH_KEYS.TARGETS, null); }
export function setTargets(t: NutritionTargets | null): void { writeSynced(HEALTH_KEYS.TARGETS, t); }

export function getFavouriteFoodIds(): string[] { return read<string[]>(HEALTH_KEYS.FAVOURITES, []); }
export function toggleFavouriteFood(foodId: string): boolean {
  const ids = getFavouriteFoodIds();
  const next = ids.includes(foodId) ? ids.filter((id) => id !== foodId) : [foodId, ...ids];
  writeSynced(HEALTH_KEYS.FAVOURITES, next);
  return next.includes(foodId);
}

/** Recently logged foods (most recent first), capped. Stores the item so it renders offline. */
export function getRecentFoods(): FoodItem[] { return read<FoodItem[]>(HEALTH_KEYS.RECENTS, []); }
export function pushRecentFood(item: FoodItem): void {
  const next = [item, ...getRecentFoods().filter((f) => f.id !== item.id)].slice(0, RECENTS_MAX);
  writeSynced(HEALTH_KEYS.RECENTS, next);
}

/** Foods the user created (also published to sharedFoods by the caller). */
export function getCustomFoods(): FoodItem[] { return read<FoodItem[]>(HEALTH_KEYS.CUSTOM_FOODS, []); }
export function saveCustomFood(item: FoodItem): void {
  const next = [item, ...getCustomFoods().filter((f) => f.id !== item.id)];
  writeSynced(HEALTH_KEYS.CUSTOM_FOODS, next);
}
export function deleteCustomFood(id: string): void {
  writeSynced(HEALTH_KEYS.CUSTOM_FOODS, getCustomFoods().filter((f) => f.id !== id));
}

// ---------- per-day documents ----------
type DayMap<T> = Record<string, T>;

function pruneDays<T>(map: DayMap<T>): DayMap<T> {
  const cutoff = addDaysISO(localDateISO(), -CACHE_DAYS);
  for (const k of Object.keys(map)) if (k < cutoff) delete map[k];
  return map;
}

function emptyNutritionDay(date: string): NutritionDay {
  return { date, entries: [], waterMl: 0, updatedAt: new Date(0).toISOString() };
}
function emptyActivityDay(date: string): ActivityDay {
  return { date, source: 'manual', updatedAt: new Date(0).toISOString() };
}

function dayRef(kind: 'nutrition' | 'activity', date: string) {
  const uid = auth.currentUser?.uid;
  return uid ? doc(db, 'users', uid, kind, date) : null;
}

function cachedDays<T>(key: string): DayMap<T> { return read<DayMap<T>>(key, {}); }
function cacheDay<T extends { date: string }>(key: string, day: T): void {
  const map = pruneDays(cachedDays<T>(key));
  map[day.date] = day;
  writeLocal(key, map);
  notify();
}

/** Cached day (instant). Returns an empty day when nothing is cached. */
export function getNutritionDay(date: string): NutritionDay {
  return cachedDays<NutritionDay>(HEALTH_KEYS.NUTRITION_DAYS)[date] ?? emptyNutritionDay(date);
}
/** Cache + write-through to Firestore (fire-and-forget; offline writes are queued by the SDK). */
export function saveNutritionDay(day: NutritionDay): void {
  const stamped = { ...day, updatedAt: new Date().toISOString() };
  cacheDay(HEALTH_KEYS.NUTRITION_DAYS, stamped);
  const ref = dayRef('nutrition', day.date);
  if (ref) setDoc(ref, stamped).catch((e) => console.warn('[Health] nutrition write failed', e));
}
/** One Firestore read; reconciles with the cache by updatedAt and returns the winner. */
export async function fetchNutritionDay(date: string): Promise<NutritionDay> {
  const local = getNutritionDay(date);
  const ref = dayRef('nutrition', date);
  if (!ref) return local;
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return local;
    const remote = snap.data() as NutritionDay;
    if (remote.updatedAt > local.updatedAt) { cacheDay(HEALTH_KEYS.NUTRITION_DAYS, remote); return remote; }
    return local;
  } catch (e) { console.warn('[Health] nutrition fetch failed', e); return local; }
}
/** Cached days in [from, to] (inclusive), oldest first. Missing days are omitted. */
export function listNutritionDays(from: string, to: string): NutritionDay[] {
  return Object.values(cachedDays<NutritionDay>(HEALTH_KEYS.NUTRITION_DAYS)).filter((d) => d.date >= from && d.date <= to).sort((a, b) => a.date.localeCompare(b.date));
}
/** Range fetch (≤ 1 read per day present); fills the cache. Use for trends after a fresh install. */
export async function fetchNutritionRange(from: string, to: string): Promise<NutritionDay[]> {
  const uid = auth.currentUser?.uid;
  if (uid) {
    try {
      const snap = await getDocs(query(collection(db, 'users', uid, 'nutrition'), where(documentId(), '>=', from), where(documentId(), '<=', to), orderBy(documentId()), fsLimit(CACHE_DAYS)));
      for (const d of snap.docs) { const remote = d.data() as NutritionDay; if (remote.updatedAt > getNutritionDay(remote.date).updatedAt) cacheDay(HEALTH_KEYS.NUTRITION_DAYS, remote); }
    } catch (e) { console.warn('[Health] nutrition range fetch failed', e); }
  }
  return listNutritionDays(from, to);
}

export function getActivityDay(date: string): ActivityDay {
  return cachedDays<ActivityDay>(HEALTH_KEYS.ACTIVITY_DAYS)[date] ?? emptyActivityDay(date);
}
export function saveActivityDay(day: ActivityDay): void {
  const stamped = { ...day, updatedAt: new Date().toISOString() };
  cacheDay(HEALTH_KEYS.ACTIVITY_DAYS, stamped);
  const ref = dayRef('activity', day.date);
  if (ref) setDoc(ref, stamped).catch((e) => console.warn('[Health] activity write failed', e));
}
export async function fetchActivityDay(date: string): Promise<ActivityDay> {
  const local = getActivityDay(date);
  const ref = dayRef('activity', date);
  if (!ref) return local;
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return local;
    const remote = snap.data() as ActivityDay;
    if (remote.updatedAt > local.updatedAt) { cacheDay(HEALTH_KEYS.ACTIVITY_DAYS, remote); return remote; }
    return local;
  } catch (e) { console.warn('[Health] activity fetch failed', e); return local; }
}
export function listActivityDays(from: string, to: string): ActivityDay[] {
  return Object.values(cachedDays<ActivityDay>(HEALTH_KEYS.ACTIVITY_DAYS)).filter((d) => d.date >= from && d.date <= to).sort((a, b) => a.date.localeCompare(b.date));
}
export async function fetchActivityRange(from: string, to: string): Promise<ActivityDay[]> {
  const uid = auth.currentUser?.uid;
  if (uid) {
    try {
      const snap = await getDocs(query(collection(db, 'users', uid, 'activity'), where(documentId(), '>=', from), where(documentId(), '<=', to), orderBy(documentId()), fsLimit(CACHE_DAYS)));
      for (const d of snap.docs) { const remote = d.data() as ActivityDay; if (remote.updatedAt > getActivityDay(remote.date).updatedAt) cacheDay(HEALTH_KEYS.ACTIVITY_DAYS, remote); }
    } catch (e) { console.warn('[Health] activity range fetch failed', e); }
  }
  return listActivityDays(from, to);
}

// ---------- helpers shared by views ----------
export function sumMacros(day: NutritionDay): { kcal: number; protein: number; carbs: number; fat: number; fiber: number } {
  return day.entries.reduce((acc, e) => ({
    kcal: acc.kcal + e.macros.kcal, protein: acc.protein + e.macros.protein, carbs: acc.carbs + e.macros.carbs,
    fat: acc.fat + e.macros.fat, fiber: acc.fiber + (e.macros.fiber ?? 0),
  }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
}
