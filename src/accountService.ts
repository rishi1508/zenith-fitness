/**
 * Account-deletion client — talks to `api/account.ts` (Play Store
 * requirement). Endpoint derivation mirrors `src/otpService.ts` /
 * `src/zen/client.ts`.
 */
import { auth } from './firebase';

function endpoint(): string {
  const explicit = import.meta.env.VITE_ACCOUNT_ENDPOINT as string | undefined;
  if (explicit) return explicit;
  const push = import.meta.env.VITE_PUSH_ENDPOINT as string | undefined;
  if (push) return push.replace(/\/api\/push\/?$/, '/api/account');
  return '/api/account';
}

export interface ProfileDetails {
  displayName?: string;
  phone: string;
  dob?: string;
  sex?: 'male' | 'female' | 'other';
}

/**
 * Completes the signed-in user's profile: claims the phone number for this
 * account (one number, one account — api/_profile.ts) and records the
 * details. Shown once to anyone whose profile lacks a phone.
 */
export async function completeMyProfile(details: ProfileDetails): Promise<{ phone: string }> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Not signed in.');
  let res: Response;
  try {
    res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, action: 'complete-profile', ...details }),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; phone?: string };
  if (!res.ok) throw new Error(data.error || 'Could not save your details. Please try again.');
  return { phone: data.phone ?? details.phone };
}

/**
 * Deletes the signed-in user's account and all their data (users/{uid}
 * subtree, public profile, gym membership). Does not sign them out —
 * the caller does that once this resolves.
 */
export async function deleteMyAccount(): Promise<void> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Not signed in.');
  let res: Response;
  try {
    res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, action: 'delete' }),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || 'Account deletion failed. Please try again.');
}
