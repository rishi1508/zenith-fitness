// Shared account-deletion helper for api/admin.ts (admin-initiated) and
// api/account.ts (self-service, Play Store requirement). Both routes
// verify the caller's identity themselves; this only does the wipe:
// the users/{uid} subtree, the public profile, the gym membership doc
// (if any), and the auth account itself. See docs/REVAMP_SPEC.md §5.

import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

export async function wipeUserData(authAdmin: Auth, db: Firestore, uid: string): Promise<void> {
  const profileRef = db.collection('userProfiles').doc(uid);
  const profileSnap = await profileRef.get();
  const gymId = profileSnap.exists ? (profileSnap.data() as { gym?: { gymId?: string } }).gym?.gymId : undefined;

  await db.recursiveDelete(db.collection('users').doc(uid));
  await profileRef.delete().catch(() => { /* already gone */ });
  if (gymId) {
    await db.collection('gyms').doc(gymId).collection('members').doc(uid).delete().catch(() => { /* not a member */ });
  }
  try {
    await authAdmin.deleteUser(uid);
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/user-not-found') throw err;
  }
}
