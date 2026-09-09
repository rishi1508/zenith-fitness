import type { GymFeedPost, UserProfile, Workout } from '../../types';
import * as storage from '../../storage';
import { levelForVolume } from '../../levels';

/**
 * What a profile can show about someone.
 *
 * Your own numbers come from the device, where the full history lives.
 * Somebody else's come from their `userProfiles` document — the same
 * snapshot buddy comparison already reads — plus whatever they chose to
 * share to the gym feed. We never try to read another user's private data,
 * because we cannot and should not.
 */
export interface ProfileStats {
  level: number;
  totalVolumeKg: number;
  workouts: number;
  streak: number;
  streakLevel: number;
}

export function ownStats(): ProfileStats {
  const workouts = storage.getWorkouts().filter((w) => w.completed && w.type !== 'rest');
  const stats = storage.calculateStats();
  const volume = stats.totalVolume ?? 0;
  return {
    level: levelForVolume(volume).level,
    totalVolumeKg: volume,
    workouts: workouts.length,
    streak: stats.currentStreak ?? 0,
    streakLevel: stats.streakLevel ?? 1,
  };
}

export function statsFromProfile(profile: UserProfile | null): ProfileStats {
  const volume = profile?.totalVolume ?? 0;
  return {
    level: profile?.level ?? levelForVolume(volume).level,
    totalVolumeKg: volume,
    workouts: profile?.totalWorkouts ?? 0,
    streak: profile?.currentStreak ?? 0,
    streakLevel: profile?.streakLevel ?? 1,
  };
}

/** Sessions to list on a profile: your own history, newest first. */
export function ownWorkouts(limit = 30): Workout[] {
  return storage.getWorkouts()
    .filter((w) => w.completed && w.type !== 'rest')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);
}

/** One person's posts out of a feed page — no composite index needed. */
export function postsBy(posts: GymFeedPost[], uid: string): GymFeedPost[] {
  return posts.filter((p) => p.uid === uid);
}

export function photosBy(posts: GymFeedPost[], uid: string): GymFeedPost[] {
  return posts.filter((p) => p.uid === uid && p.hasImage);
}

/** "7.2 t · 24 sets · 62 min" for a session card. */
export function workoutSummaryLine(w: Workout): string {
  let sets = 0;
  let volume = 0;
  for (const ex of w.exercises) {
    for (const s of ex.sets) {
      if (!s.completed) continue;
      sets++;
      volume += s.weight * s.reps;
    }
  }
  const parts = [
    volume > 0 ? `${(volume / 1000).toFixed(1)} t` : null,
    sets > 0 ? `${sets} sets` : null,
    w.duration ? `${w.duration} min` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}
