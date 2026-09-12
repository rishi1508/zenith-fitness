// One person, one Zenith account. The phone number is the key that ties
// the sign-in methods together: email code today, Google today, SMS later.
// Every path that completes a profile — a member registering, a gym adding
// a member at the desk — comes through here, so the rules are in one place:
//
//   - the number is normalised to E.164 (10-digit Indian numbers get +91);
//   - phoneIndex/{e164} → uid is claimed in a transaction, so two accounts
//     can never hold the same number;
//   - the Auth record carries the number too (best-effort: Auth rejects a
//     number another Auth user already has, which the index has just ruled
//     out anyway);
//   - the profile records what was collected and who collected it.

import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpError } from './_limits.js';

export type Sex = 'male' | 'female' | 'other';

export interface ProfileInput {
  displayName?: string;
  phone: string;
  dob?: string;      // YYYY-MM-DD
  sex?: Sex;
  email?: string;
}

/** +91XXXXXXXXXX for a 10-digit Indian mobile; any other country must be given with its + code. */
export function normalizePhone(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'Please enter a phone number.');
  let s = raw.replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (/^\+91\d{10}$/.test(s)) return s;
  if (/^91\d{10}$/.test(s)) return `+${s}`;
  if (/^0\d{10}$/.test(s)) return `+91${s.slice(1)}`;
  if (/^[6-9]\d{9}$/.test(s)) return `+91${s}`;
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  throw new HttpError(400, 'That phone number does not look right. Use 10 digits, or include the country code.');
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A date of birth that makes a person between 10 and 100 years old. */
export function normalizeDob(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || !ISO_DATE.test(raw)) throw new HttpError(400, 'Date of birth must be a date.');
  const t = Date.parse(`${raw}T00:00:00Z`);
  if (!Number.isFinite(t)) throw new HttpError(400, 'Date of birth must be a date.');
  const years = (Date.now() - t) / (365.25 * 86_400_000);
  if (years < 10 || years > 100) throw new HttpError(400, 'Please check the date of birth.');
  return raw;
}

export function normalizeSex(raw: unknown): Sex | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (raw === 'male' || raw === 'female' || raw === 'other') return raw;
  throw new HttpError(400, 'Invalid value for sex.');
}

export function normalizeName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
  if (!name) throw new HttpError(400, 'Please enter a name.');
  return name;
}

/** The uid that holds this number, or null. */
export async function uidForPhone(db: Firestore, e164: string): Promise<string | null> {
  const snap = await db.collection('phoneIndex').doc(e164).get();
  return snap.exists ? ((snap.data() as { uid?: string }).uid ?? null) : null;
}

/**
 * Claims the number for `uid` — a no-op when it already belongs to them,
 * a 409 when it belongs to somebody else. Transactional, so two sign-ups
 * racing for one number cannot both win.
 */
export async function claimPhone(db: Firestore, uid: string, e164: string): Promise<void> {
  const ref = db.collection('phoneIndex').doc(e164);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const owner = snap.exists ? (snap.data() as { uid?: string }).uid : undefined;
    if (owner && owner !== uid) {
      throw new HttpError(409, 'This phone number is already on another Zenith account. Sign in to that account, or ask your gym to check the number.');
    }
    if (!owner) tx.set(ref, { uid, at: new Date().toISOString() });
  });
}

/**
 * Writes the collected details onto the profile (and the Auth record) after
 * the number has been claimed. `by` says who filled it in — the person, or a
 * gym's front desk, in which case the profile is complete before they ever
 * open the app and they go straight to the tour.
 */
export async function completeProfile(
  authAdmin: Auth,
  db: Firestore,
  uid: string,
  input: ProfileInput,
  by: { kind: 'self' } | { kind: 'staff'; gymId: string; staffUid: string },
): Promise<{ phone: string }> {
  const phone = normalizePhone(input.phone);
  const dob = normalizeDob(input.dob);
  const sex = normalizeSex(input.sex);
  const displayName = input.displayName !== undefined ? normalizeName(input.displayName) : undefined;
  await claimPhone(db, uid, phone);

  const authPatch: Record<string, unknown> = { phoneNumber: phone };
  if (displayName) authPatch.displayName = displayName;
  try {
    await authAdmin.updateUser(uid, authPatch);
  } catch (err) {
    // Auth may refuse the number (another Auth user holds it from before the
    // index existed) — the index is the source of truth; keep going.
    console.warn('[profile] auth update skipped:', (err as Error).message);
    if (displayName) await authAdmin.updateUser(uid, { displayName }).catch(() => { /* fine */ });
  }

  const now = new Date().toISOString();
  const profile: Record<string, unknown> = {
    uid,
    phone,
    profileComplete: true,
    profileCompletedAt: now,
    createdBy: by.kind,
    ...(by.kind === 'staff' ? { createdByGym: by.gymId, createdByStaff: by.staffUid } : {}),
    ...(dob ? { dob } : {}),
    ...(sex ? { sex } : {}),
    ...(displayName ? { displayName, displayNameLower: displayName.toLowerCase() } : {}),
    ...(input.email ? { email: input.email.trim().toLowerCase() } : {}),
  };
  const ref = db.collection('userProfiles').doc(uid);
  const existing = await ref.get();
  if (!existing.exists) {
    Object.assign(profile, { joinedAt: now, totalWorkouts: 0, currentStreak: 0, streakLevel: 1, level: 1, totalVolume: 0, isWorkingOut: false });
  }
  await ref.set(profile, { merge: true });
  return { phone };
}
