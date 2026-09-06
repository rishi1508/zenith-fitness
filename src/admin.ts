/**
 * Accounts allowed to edit ANY shared exercise (name, muscle group,
 * category, creator notes, video) and remove entries from the shared
 * library. Mirrored in firestore.rules — keep both lists in sync.
 */
export const ADMIN_UIDS: readonly string[] = [
  'BXedteurc3bPydsehvPIdVWPTbM2', // Rishi
];

export function isAdmin(uid: string | null | undefined): boolean {
  return !!uid && ADMIN_UIDS.includes(uid);
}
