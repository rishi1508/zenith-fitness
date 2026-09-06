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
