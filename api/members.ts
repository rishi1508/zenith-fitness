// Vercel serverless function: the gym's front desk adds a member — and that
// member is a real Zenith account from that moment, never just a row in the
// gym's list.
//
// POST JSON { idToken, action: 'create', gymId, name, phone, email?, dob?,
//             sex?, planId?, planStart?, trainerUid?, uid? }
//   → { uid, existed, linked }
//
// How the account is found or made, in order:
//   1. `uid` given (the desk picked somebody from the Zenith search) → that
//      account, provided the phone matches or the account has no phone yet.
//   2. phoneIndex/{e164} → the account that already holds this number.
//   3. Auth user with this email → that account.
//   4. Otherwise a new Auth user (email and phone on the record) is created.
// Then the profile is completed (phone claimed, details written, gym
// pointer set), the member doc is written under the real uid, memberCount
// goes up if the member doc is new, and any plan/payment work stays with
// the client (recordPayment) exactly as before.
//
// Someone who already belongs to ANOTHER gym is refused (409) — the desk
// cannot pull a person out of their gym.
//
// Caller must be staff of the gym (any role) or a Zenith admin.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { adminUids, getAdmin, replyNotConfigured, setCors } from './_http.js';
import { consumeLimit, HttpError, MINUTE_MS } from './_limits.js';
import { completeProfile, normalizeDob, normalizeName, normalizePhone, normalizeSex, uidForPhone } from './_profile.js';

export const config = { maxDuration: 30 };

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  let a: typeof admin;
  try { a = getAdmin(); }
  catch (e) { replyNotConfigured(res, e); return; }
  const db = a.firestore();

  const body = (req.body || {}) as Record<string, unknown>;
  try {
    const idToken = typeof body.idToken === 'string' ? body.idToken : '';
    if (!idToken) throw new HttpError(401, 'Please sign in.');
    let staffUid: string;
    try { staffUid = (await a.auth().verifyIdToken(idToken)).uid; }
    catch { throw new HttpError(401, 'Your session has expired. Please sign in again.'); }
    if (body.action !== 'create') throw new HttpError(400, 'Unknown action');

    const gymId = typeof body.gymId === 'string' ? body.gymId : '';
    if (!ID.test(gymId)) throw new HttpError(400, 'Invalid gym.');
    const gymRef = db.collection('gyms').doc(gymId);
    const gymSnap = await gymRef.get();
    if (!gymSnap.exists) throw new HttpError(404, 'Gym not found.');
    const staff = (gymSnap.data() as { staff?: Record<string, string> }).staff ?? {};
    if (!staff[staffUid] && !adminUids().includes(staffUid)) throw new HttpError(403, 'Only gym staff can add members.');

    await consumeLimit(db, `members:${staffUid}`, [
      { field: 'm', windowMs: MINUTE_MS, max: 20, message: 'Slow down — try again in {min} min.' },
    ]);

    const name = normalizeName(body.name);
    const phone = normalizePhone(body.phone);
    const dob = normalizeDob(body.dob);
    const sex = normalizeSex(body.sex);
    const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : undefined;
    if (email && (!EMAIL.test(email) || email.length > 254)) throw new HttpError(400, 'That email address does not look right.');
    const pickedUid = typeof body.uid === 'string' && ID.test(body.uid) ? body.uid : undefined;
    const planId = typeof body.planId === 'string' && body.planId ? body.planId : undefined;
    const planStart = typeof body.planStart === 'string' && ISO_DATE.test(body.planStart) ? body.planStart : undefined;
    const trainerUid = typeof body.trainerUid === 'string' && ID.test(body.trainerUid) ? body.trainerUid : undefined;

    // 1–4: find or make the account.
    let uid: string | null = null;
    let existed = true;
    const byPhone = await uidForPhone(db, phone);
    if (pickedUid) {
      if (byPhone && byPhone !== pickedUid) throw new HttpError(409, 'That phone number belongs to a different Zenith account than the person you picked.');
      const picked = await db.collection('userProfiles').doc(pickedUid).get();
      if (!picked.exists) throw new HttpError(404, 'That Zenith account no longer exists.');
      uid = pickedUid;
    } else if (byPhone) {
      uid = byPhone;
    } else if (email) {
      try { uid = (await a.auth().getUserByEmail(email)).uid; }
      catch (err) { if ((err as { code?: string }).code !== 'auth/user-not-found') throw err; }
    }
    if (!uid) {
      existed = false;
      try {
        uid = (await a.auth().createUser({ displayName: name, ...(email ? { email, emailVerified: false } : {}), phoneNumber: phone })).uid;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'auth/phone-number-already-exists' || code === 'auth/email-already-exists') {
          throw new HttpError(409, 'An account with this phone number or email already exists. Search for them on Zenith instead.');
        }
        // Phone auth not enabled for the project: create without the number; the index still holds it.
        uid = (await a.auth().createUser({ displayName: name, ...(email ? { email, emailVerified: false } : {}) })).uid;
      }
    }

    // The gym pointer: refuse to move somebody out of another gym.
    const profileRef = db.collection('userProfiles').doc(uid);
    const profileSnap = await profileRef.get();
    const theirGym = profileSnap.exists ? (profileSnap.data() as { gym?: { gymId?: string } | null }).gym : null;
    if (theirGym?.gymId && theirGym.gymId !== gymId) throw new HttpError(409, 'This person already belongs to another gym. They need to leave it first.');

    // Details on the account. For an existing account the desk does not
    // overwrite the name the person chose; the phone is still claimed.
    await completeProfile(a.auth(), db, uid, {
      phone, dob, sex, email,
      ...(existed ? {} : { displayName: name }),
    }, { kind: 'staff', gymId, staffUid });

    const now = new Date().toISOString();
    const memberRef = gymRef.collection('members').doc(uid);
    const memberSnap = await memberRef.get();
    const profileName = profileSnap.exists ? (profileSnap.data() as { displayName?: string }).displayName : undefined;
    const member: Record<string, unknown> = {
      uid,
      name: existed && profileName ? profileName : name,
      phone,
      ...(email ? { email } : {}),
      role: memberSnap.exists ? (memberSnap.data() as { role?: string }).role ?? 'member' : 'member',
      joinedAt: memberSnap.exists ? (memberSnap.data() as { joinedAt?: string }).joinedAt ?? now : now,
      ...(planId ? { planId } : {}),
      ...(planStart ? { planStart } : {}),
      ...(trainerUid ? { trainerUid } : {}),
    };
    if (planId && planStart) {
      const plans = (gymSnap.data() as { plans?: Array<{ id: string; months: number }> }).plans ?? [];
      const plan = plans.find((p) => p.id === planId);
      if (plan) member.planEnd = addMonths(planStart, plan.months);
    }
    const batch = db.batch();
    batch.set(memberRef, member, { merge: true });
    if (!memberSnap.exists) batch.update(gymRef, { memberCount: FieldValue.increment(1) });
    batch.set(profileRef, { gym: { gymId, gymRole: member.role, joinedAt: member.joinedAt } }, { merge: true });
    await batch.commit();

    res.status(200).json({ uid, existed, linked: true });
  } catch (err) {
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message, ...err.extra }); return; }
    console.error('[members] unhandled', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

/** YYYY-MM-DD plus whole months, clamped to the target month's last day (mirrors src/gymStats.addMonthsISO). */
function addMonths(yyyymmdd: string, months: number): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}
