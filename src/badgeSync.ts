import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import * as storage from './storage';
import { earnedBadgeIds, mergeBadges } from './badges';
import type { EarnedBadge } from './badges';
import { listNutritionDays, localDateISO, addDaysISO } from './health/store';

/**
 * Works out which badges are earned and publishes them on the user's profile
 * document, so anybody viewing that profile can see them without reading a
 * scrap of private history.
 *
 * Local first: the list is cached so the profile paints instantly and so a
 * re-run can tell what is genuinely new. One profile write, and only when
 * something changed.
 */

const KEY = 'zenith_badges';

export function getLocalBadges(): EarnedBadge[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as EarnedBadge[]) : [];
  } catch {
    return [];
  }
}

/** How many of the last 400 days have any food logged. */
function loggedNutritionDays(): number {
  const today = localDateISO();
  return listNutritionDays(addDaysISO(today, -400), today).filter((d) => d.entries.length > 0).length;
}

/**
 * Returns the badges earned since the last run, so the caller can celebrate
 * them. Safe to call often; it writes only on a change.
 */
export async function refreshBadges(): Promise<string[]> {
  const workouts = storage.getWorkouts();
  const stats = storage.calculateStats();
  const earned = earnedBadgeIds({
    workouts,
    records: storage.getPersonalRecords(),
    totalVolumeKg: stats.totalVolume ?? 0,
    streakWeeks: stats.currentStreak ?? 0,
    loggedNutritionDays: loggedNutritionDays(),
  });

  const { badges, added } = mergeBadges(getLocalBadges(), earned);
  if (added.length === 0) return [];

  try { localStorage.setItem(KEY, JSON.stringify(badges)); } catch { /* private mode */ }
  const uid = auth.currentUser?.uid;
  if (uid) {
    await setDoc(doc(db, 'userProfiles', uid), { badges }, { merge: true })
      .catch((err) => console.warn('[Badges] publish failed:', err));
  }
  return added;
}
