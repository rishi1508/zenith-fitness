// Vercel serverless function that fans out FCM push notifications.
//
// Two actions (POST JSON, `idToken` verified with firebase-admin):
//   { recipientUid, title, body?, data? }            one recipient
//   { action: 'announce', gymId, title, body?, data? } every member of a gym
//
// A push may only go to someone the sender has a relationship with — a
// buddy, a pending buddy request either way, or (staff only) a member of
// their gym. firebase-admin bypasses Firestore rules, so that check is
// the access control here. Tokens come from userProfiles/{uid}/fcmTokens;
// ones FCM reports as stale are removed so the list self-heals.
//
// Required Vercel env vars (Project → Settings → Environment Variables):
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type admin from 'firebase-admin';
import { consumeLimit, DAY_MS, HttpError, MINUTE_MS } from './_limits.js';
import { getAdmin, replyNotConfigured, setCors } from './_http.js';

// An announcement to a 300-member gym reads 300 token subcollections and
// sends in 500-token batches; comfortably inside this.
export const config = { maxDuration: 60 };

const UID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_DATA_ENTRIES = 12;
const MAX_DATA_VALUE_CHARS = 512;
/** How many member token lookups run at once during an announcement. */
const TOKEN_LOOKUP_CONCURRENCY = 25;
const FCM_BATCH = 500;

type Db = admin.firestore.Firestore;
type Payload = { title: string; body: string; data: Record<string, string> };

function readPayload(body: Record<string, unknown>): Payload {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 120) throw new HttpError(400, 'Invalid payload');
  const text = body.body === undefined ? '' : body.body;
  if (typeof text !== 'string' || text.length > 500) throw new HttpError(400, 'Invalid payload');
  const data: Record<string, string> = {};
  if (body.data !== undefined) {
    if (typeof body.data !== 'object' || body.data === null || Array.isArray(body.data)) throw new HttpError(400, 'Invalid payload');
    const entries = Object.entries(body.data as Record<string, unknown>);
    if (entries.length > MAX_DATA_ENTRIES) throw new HttpError(400, 'Invalid payload');
    for (const [k, v] of entries) {
      if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) throw new HttpError(400, 'Invalid payload');
      const str = typeof v === 'string' ? v : String(v ?? '');
      if (str.length > MAX_DATA_VALUE_CHARS) throw new HttpError(400, 'Invalid payload');
      data[k] = str;
    }
  }
  return { title, body: text, data };
}

const pairId = (a: string, b: string) => (a < b ? `${a}_${b}` : `${b}_${a}`);

/** Buddies, a pending request in either direction, or the sender is staff at the recipient's gym. */
async function canNotify(db: Db, sender: string, recipient: string, gymId: string | undefined): Promise<boolean> {
  const [buddy, req1, req2] = await Promise.all([
    db.collection('buddies').doc(pairId(sender, recipient)).get(),
    db.collection('buddyRequests').doc(`${sender}__${recipient}`).get(),
    db.collection('buddyRequests').doc(`${recipient}__${sender}`).get(),
  ]);
  if (buddy.exists || req1.exists || req2.exists) return true;
  if (gymId && UID.test(gymId)) {
    const staff = await isStaff(db, gymId, sender);
    if (!staff) return false;
    const member = await db.collection('gyms').doc(gymId).collection('members').doc(recipient).get();
    return member.exists;
  }
  return false;
}

async function isStaff(db: Db, gymId: string, uid: string): Promise<boolean> {
  const gym = await db.collection('gyms').doc(gymId).get();
  const staff = (gym.exists ? (gym.data() as { staff?: Record<string, string> }).staff : undefined) ?? {};
  return typeof staff[uid] === 'string';
}

async function tokensFor(db: Db, uid: string): Promise<Array<{ uid: string; token: string }>> {
  const snap = await db.collection('userProfiles').doc(uid).collection('fcmTokens').get();
  return snap.docs.map((d) => ({ uid, token: d.id }));
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function send(a: typeof admin, db: Db, targets: Array<{ uid: string; token: string }>, payload: Payload) {
  let sent = 0;
  let failed = 0;
  const removals: Promise<unknown>[] = [];
  for (let i = 0; i < targets.length; i += FCM_BATCH) {
    const batch = targets.slice(i, i + FCM_BATCH);
    const result = await a.messaging().sendEachForMulticast({
      tokens: batch.map((t) => t.token),
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
      android: { priority: 'high', notification: { channelId: 'default' } },
      apns: { payload: { aps: { sound: 'default' } } },
    });
    sent += result.successCount;
    failed += result.failureCount;
    result.responses.forEach((r, j) => {
      const code = (r.error as { code?: string } | undefined)?.code || '';
      if (r.error && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(code)) {
        const t = batch[j];
        removals.push(db.collection('userProfiles').doc(t.uid).collection('fcmTokens').doc(t.token).delete());
      }
    });
  }
  if (removals.length) await Promise.allSettled(removals);
  return { sent, failed, pruned: removals.length };
}

async function handleOne(a: typeof admin, db: Db, senderUid: string, body: Record<string, unknown>) {
  const recipientUid = typeof body.recipientUid === 'string' ? body.recipientUid : '';
  if (!UID.test(recipientUid)) throw new HttpError(400, 'recipientUid, title, idToken required');
  if (recipientUid === senderUid) return { ok: true, sent: 0, reason: 'self' };
  const payload = readPayload(body);

  // Per-sender budget so a scripted account cannot blast other users.
  await consumeLimit(db, `push:${senderUid}`, [
    { field: 'm', windowMs: MINUTE_MS, max: 30, message: 'Too many notifications — try again in {min} min.' },
    { field: 'd', windowMs: DAY_MS, max: 600, message: 'Daily notification limit reached.' },
  ]);

  if (!(await canNotify(db, senderUid, recipientUid, payload.data.gymId))) {
    // Same answer as "no tokens": nothing for a stranger to learn from it.
    return { ok: true, sent: 0, reason: 'no tokens' };
  }
  const targets = await tokensFor(db, recipientUid);
  if (targets.length === 0) return { ok: true, sent: 0, reason: 'no tokens' };
  return { ok: true, ...(await send(a, db, targets, payload)) };
}

async function handleAnnounce(a: typeof admin, db: Db, senderUid: string, body: Record<string, unknown>) {
  const gymId = typeof body.gymId === 'string' ? body.gymId : '';
  if (!UID.test(gymId)) throw new HttpError(400, 'gymId required');
  const payload = readPayload(body);
  payload.data.gymId = gymId;
  payload.data.type = payload.data.type || 'gym_announcement';

  await consumeLimit(db, `push-announce:${senderUid}`, [
    { field: 'm', windowMs: MINUTE_MS, max: 5, message: 'Too many announcements — try again in {min} min.' },
    { field: 'd', windowMs: DAY_MS, max: 40, message: 'Daily announcement limit reached.' },
  ]);
  if (!(await isStaff(db, gymId, senderUid))) throw new HttpError(403, 'Only gym staff can send announcements.');

  const members = await db.collection('gyms').doc(gymId).collection('members').select().limit(1000).get();
  const uids = members.docs.map((d) => d.id).filter((uid) => uid !== senderUid && !uid.startsWith('demo_') && UID.test(uid));
  const targets = (await mapLimit(uids, TOKEN_LOOKUP_CONCURRENCY, (uid) => tokensFor(db, uid))).flat();
  if (targets.length === 0) return { ok: true, sent: 0, recipients: uids.length, reason: 'no tokens' };
  return { ok: true, recipients: uids.length, ...(await send(a, db, targets, payload)) };
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
    if (!idToken) throw new HttpError(400, 'recipientUid, title, idToken required');
    let senderUid: string;
    try { senderUid = (await a.auth().verifyIdToken(idToken)).uid; }
    catch { throw new HttpError(401, 'Invalid token'); }

    const result = body.action === 'announce'
      ? await handleAnnounce(a, db, senderUid, body)
      : await handleOne(a, db, senderUid, body);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message, ...err.extra }); return; }
    console.error('[push] unhandled', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
