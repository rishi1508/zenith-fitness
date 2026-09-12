// Vercel serverless function: anonymous class-session ratings.
//
// POST JSON { idToken, gymId, classId, date, stars (1–5), comment? } → { ok }
//
// Why a server route and not a client write: the gym owner asked for ratings
// members can give honestly, so the trainer relationship never comes into
// it. The document id is a keyed hash of (gym, class, date, uid) — one vote
// per person per session, re-rating overwrites — and the document itself
// carries no uid, name or device. Nobody with Firestore access, including
// us, can turn a rating back into a person. The key is derived from the
// Firebase private key so nothing new has to be provisioned.
//
// Who may rate: a member of the gym who was enrolled in (or marked attended
// at) that session, for a session dated within the last 14 days. Staff do
// not rate their own gym's sessions.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type admin from 'firebase-admin';
import crypto from 'node:crypto';
import { getAdmin, replyNotConfigured, setCors } from './_http.js';
import { consumeLimit, DAY_MS, HttpError, MINUTE_MS } from './_limits.js';

export const config = { maxDuration: 30 };

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_COMMENT = 300;
const WINDOW_DAYS = 14;

function voterId(secret: string, gymId: string, classId: string, date: string, uid: string): string {
  const key = crypto.createHash('sha256').update(`session-rating:${secret}`).digest();
  return crypto.createHmac('sha256', key).update(`${gymId}:${classId}:${date}:${uid}`).digest('hex').slice(0, 40);
}

function dayOffset(date: string, now = new Date()): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.parse(`${date}T00:00:00Z`) - today) / DAY_MS);
}

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
    if (!idToken) throw new HttpError(401, 'Please sign in to rate a session.');
    let uid: string;
    try { uid = (await a.auth().verifyIdToken(idToken)).uid; }
    catch { throw new HttpError(401, 'Your session has expired. Please sign in again.'); }

    const gymId = typeof body.gymId === 'string' ? body.gymId : '';
    const classId = typeof body.classId === 'string' ? body.classId : '';
    const date = typeof body.date === 'string' ? body.date : '';
    const stars = Number(body.stars);
    const comment = typeof body.comment === 'string' ? body.comment.trim().replace(/\s+/g, ' ').slice(0, MAX_COMMENT) : '';
    if (!ID.test(gymId) || !ID.test(classId) || !ISO_DATE.test(date)) throw new HttpError(400, 'Invalid request.');
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpError(400, 'Pick 1 to 5 stars.');
    const offset = dayOffset(date);
    if (offset > 1) throw new HttpError(400, 'You can rate a session once it has happened.');
    if (offset < -WINDOW_DAYS) throw new HttpError(400, `Sessions can be rated for ${WINDOW_DAYS} days.`);

    await consumeLimit(db, `rate:${uid}`, [
      { field: 'm', windowMs: MINUTE_MS, max: 10, message: 'Too many ratings — try again in {min} min.' },
      { field: 'd', windowMs: DAY_MS, max: 60, message: 'Daily rating limit reached.' },
    ]);

    const gymRef = db.collection('gyms').doc(gymId);
    const [gymSnap, memberSnap, sessionSnap, classSnap] = await Promise.all([
      gymRef.get(),
      gymRef.collection('members').doc(uid).get(),
      gymRef.collection('classes').doc(classId).collection('sessions').doc(date).get(),
      gymRef.collection('classes').doc(classId).get(),
    ]);
    if (!gymSnap.exists || !memberSnap.exists) throw new HttpError(403, 'Only members of this gym can rate its sessions.');
    const staff = (gymSnap.data() as { staff?: Record<string, string> }).staff ?? {};
    if (staff[uid]) throw new HttpError(403, 'Staff do not rate their own sessions.');
    const session = sessionSnap.exists ? (sessionSnap.data() as { enrolled?: string[]; attended?: string[] }) : null;
    const wasThere = !!session && ((session.enrolled ?? []).includes(uid) || (session.attended ?? []).includes(uid));
    if (!wasThere) throw new HttpError(403, 'Only members who were in the session can rate it.');
    const trainerUid = classSnap.exists ? (classSnap.data() as { trainerUid?: string }).trainerUid : undefined;

    const voter = voterId(process.env.FIREBASE_PRIVATE_KEY || '', gymId, classId, date, uid);
    const at = new Date(); at.setUTCMinutes(0, 0, 0);
    await gymRef.collection('ratings').doc(voter).set({
      classId, date, stars,
      ...(trainerUid ? { trainerUid } : {}),
      ...(comment ? { comment } : {}),
      at: at.toISOString(),
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message, ...err.extra }); return; }
    console.error('[rate] unhandled', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
