/**
 * Admin console client — talks to `api/admin.ts`. All admin-only work
 * (listing every auth user, disabling/deleting accounts, granting
 * premium) happens server-side via firebase-admin, which bypasses
 * Firestore rules; this file only posts the caller's ID token and lets
 * the server re-check `ADMIN_UIDS`. Endpoint derivation mirrors
 * `src/otpService.ts` / `src/zen/client.ts`.
 */
import { auth } from './firebase';

export interface AdminUserRow {
  uid: string;
  email: string | null;
  displayName: string | null;
  providers: string[];
  createdAt?: string;
  lastSignInAt?: string;
  disabled: boolean;
  gym: { gymId: string; gymRole: string } | null;
  subscriptionTier: string | null;
  premiumGrant: boolean;
}

/** `VITE_ADMIN_ENDPOINT` if set, else derived from `VITE_PUSH_ENDPOINT`
 *  (same Vercel project), else the same-origin default. */
function endpoint(): string {
  const explicit = import.meta.env.VITE_ADMIN_ENDPOINT as string | undefined;
  if (explicit) return explicit;
  const push = import.meta.env.VITE_PUSH_ENDPOINT as string | undefined;
  if (push) return push.replace(/\/api\/push\/?$/, '/api/admin');
  return '/api/admin';
}

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Not signed in.');
  let res: Response;
  try {
    res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, action, ...payload }),
    });
  } catch {
    throw new Error('Could not reach the admin server. Check your connection and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || 'Admin request failed. Please try again.');
  return data;
}

export async function listUsers(): Promise<AdminUserRow[]> {
  const { users } = await call<{ users: AdminUserRow[] }>('list-users');
  return users;
}

export async function setUserDisabled(uid: string, disabled: boolean): Promise<void> {
  await call('set-disabled', { uid, disabled });
}

export async function deleteUser(uid: string): Promise<void> {
  await call('delete-user', { uid });
}

export async function setPremiumGrant(uid: string, grant: boolean): Promise<void> {
  await call('set-premium-grant', { uid, grant });
}
