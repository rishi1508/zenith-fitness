/**
 * Front-desk member creation — talks to api/members.ts, which finds or
 * makes the person's Zenith account (by phone, then e-mail), completes
 * their profile, and writes the gym membership under the real uid. Every
 * gym member is a Zenith account from the moment the desk adds them.
 */
import { auth } from './firebase';

function endpoint(): string {
  const explicit = import.meta.env.VITE_MEMBERS_ENDPOINT as string | undefined;
  if (explicit) return explicit;
  const push = import.meta.env.VITE_PUSH_ENDPOINT as string | undefined;
  if (push) return push.replace(/\/api\/push\/?$/, '/api/members');
  return '/api/members';
}

export interface NewMemberInput {
  name: string;
  phone: string;
  email?: string;
  dob?: string;
  sex?: 'male' | 'female' | 'other';
  planId?: string;
  planStart?: string;
  trainerUid?: string;
  /** A Zenith account the desk picked from search, to link instead of creating. */
  uid?: string;
}

export async function createMemberAccount(gymId: string, input: NewMemberInput): Promise<{ uid: string; existed: boolean }> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Not signed in.');
  let res: Response;
  try {
    res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, action: 'create', gymId, ...input }),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; uid?: string; existed?: boolean };
  if (!res.ok || !data.uid) throw new Error(data.error || 'Could not add the member. Please try again.');
  return { uid: data.uid, existed: !!data.existed };
}
