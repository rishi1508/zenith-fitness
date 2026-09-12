/** ISO of the newest notice this device has already looked at, per gym.
 *  Read by GymContext (tab badge) and GymFeedView (the tab itself). */
export const announcementsSeenKey = (gymId: string) => `zenith_gym_ann_seen_${gymId}`;

export function readAnnouncementsSeen(gymId: string): string {
  try { return localStorage.getItem(announcementsSeenKey(gymId)) ?? ''; } catch { return ''; }
}
