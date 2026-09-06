// Vercel serverless function: email-OTP sign-in, server-side.
//
// Replaces the client-only flow, which had two holes:
//   1. The EmailJS public key + template shipped in the bundle, so anyone
//      could send unlimited "your login code" emails to any address and
//      burn the monthly quota.
//   2. Users were signed in with a Firebase password derived from
//      sha256(email + constant-in-the-bundle) — anyone could compute any
//      OTP user's password and log in as them without a code.
//
// Now the code is generated, hashed, stored and checked here; the email is
// sent with EmailJS's PRIVATE key; sign-in uses a Firebase custom token
// minted with firebase-admin. Nothing in the bundle can mint or send.
//
// Actions (POST JSON { action, ... }):
//   send     { email }                       → { ok, expiresInSec }
//   verify   { email, code }                 → { token, isNewUser:false }  existing account
//                                            → { isNewUser:true, ticket }   new email, collect name next
//   complete { email, ticket, displayName }  → { token, isNewUser:true }
//
// Limits (fixed windows, Firestore-backed so they hold across instances):
//   per email: 3 codes / hour, 6 / day      per IP: 15 codes / day
//   per code : 5 verify attempts, 10-minute expiry
//
// Required Vercel env vars:
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY   (shared with /api/push)
//   EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY
//
// Firestore: otpCodes/{emailHash}, otpLimits/{key}. No client rules → admin-only.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
import crypto from 'node:crypto';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const LIMITS = {
  emailPerHour: 3,
  emailPerDay: 6,
  ipPerDay: 15,
};
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function getAdmin() {
  if (admin.apps.length) return admin;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!privateKey || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PROJECT_ID) {
    throw new Error('Missing FIREBASE_* env vars');
  }
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
  return admin;
}

function setCors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const normalizeEmail = (e: unknown) => (typeof e === 'string' ? e.trim().toLowerCase() : '');
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;

function clientIp(req: VercelRequest): string {
  const xff = req.headers['x-forwarded-for'];
  const first = Array.isArray(xff) ? xff[0] : (xff || '').split(',')[0];
  return (first || (req.headers['x-real-ip'] as string) || req.socket?.remoteAddress || 'unknown').trim();
}

class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

/**
 * Fixed-window counter in Firestore. `windows` = [{ field, windowMs, max }].
 * Runs in a transaction so concurrent requests can't both slip under a limit.
 */
async function consumeLimit(
  db: admin.firestore.Firestore,
  key: string,
  windows: Array<{ field: string; windowMs: number; max: number }>,
  label: string,
): Promise<void> {
  const ref = db.collection('otpLimits').doc(key);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.exists ? snap.data() : {}) as Record<string, { win: number; count: number }>;
    const now = Date.now();
    const next: Record<string, { win: number; count: number }> = {};
    for (const w of windows) {
      const win = Math.floor(now / w.windowMs);
      const cur = data[w.field];
      const count = cur && cur.win === win ? cur.count : 0;
      if (count >= w.max) {
        const retryAfterSec = Math.ceil(((win + 1) * w.windowMs - now) / 1000);
        throw new HttpError(429, `Too many codes requested for this ${label}. Try again in ${Math.ceil(retryAfterSec / 60)} min.`, { retryAfterSec });
      }
      next[w.field] = { win, count: count + 1 };
    }
    tx.set(ref, { ...next, updatedAt: now }, { merge: true });
  });
}

async function sendCodeEmail(to: string, code: string): Promise<void> {
  const { EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY } = process.env;
  if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY || !EMAILJS_PRIVATE_KEY) {
    throw new HttpError(503, 'Email sign-in is not configured on the server yet. Please use Google sign-in.');
  }
  const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      accessToken: EMAILJS_PRIVATE_KEY,
      template_params: { to_email: to, otp_code: code },
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    console.error('[otp] EmailJS error', r.status, text.slice(0, 200));
    throw new HttpError(502, 'Could not send the code right now. Please try again in a minute.');
  }
}

type CodeDoc = {
  email: string;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  ip: string;
  verifiedAt?: number;
  ticketHash?: string;
};

async function handleSend(db: admin.firestore.Firestore, req: VercelRequest, email: string) {
  const ip = clientIp(req);
  await consumeLimit(db, `ip:${sha256(ip)}`, [{ field: 'd', windowMs: DAY_MS, max: LIMITS.ipPerDay }], 'device');
  await consumeLimit(db, `email:${sha256(email)}`, [
    { field: 'h', windowMs: HOUR_MS, max: LIMITS.emailPerHour },
    { field: 'd', windowMs: DAY_MS, max: LIMITS.emailPerDay },
  ], 'email');

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const now = Date.now();
  const doc: CodeDoc = {
    email,
    codeHash: sha256(`${code}:${email}`),
    createdAt: now,
    expiresAt: now + CODE_TTL_MS,
    attempts: 0,
    ip: sha256(ip),
  };
  await db.collection('otpCodes').doc(sha256(email)).set(doc);
  await sendCodeEmail(email, code);
  return { ok: true, expiresInSec: CODE_TTL_MS / 1000 };
}

async function loadCode(db: admin.firestore.Firestore, email: string) {
  const ref = db.collection('otpCodes').doc(sha256(email));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'No verification code found. Please request a new one.');
  const data = snap.data() as CodeDoc;
  if (Date.now() > data.expiresAt) {
    await ref.delete();
    throw new HttpError(410, 'Code has expired. Please request a new one.');
  }
  return { ref, data };
}

async function mintToken(a: typeof admin, uid: string): Promise<string> {
  return a.auth().createCustomToken(uid);
}

async function handleVerify(a: typeof admin, db: admin.firestore.Firestore, email: string, codeRaw: unknown) {
  const code = typeof codeRaw === 'string' ? codeRaw.trim() : '';
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Please enter the 6-digit code.');
  const { ref, data } = await loadCode(db, email);
  // Already verified (ticket issued, waiting for the name step). A retry or
  // double-tap must NOT burn the ticket — tell the client to move on.
  if (data.verifiedAt) {
    throw new HttpError(409, 'Code already verified. Please enter your name to finish signing up.');
  }
  if (data.attempts >= MAX_VERIFY_ATTEMPTS) {
    await ref.delete();
    throw new HttpError(429, 'Too many attempts. Please request a new code.');
  }
  if (sha256(`${code}:${email}`) !== data.codeHash) {
    await ref.update({ attempts: admin.firestore.FieldValue.increment(1) });
    const remaining = MAX_VERIFY_ATTEMPTS - (data.attempts + 1);
    throw new HttpError(401, `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
  }

  // Code is right. Existing account (any provider — the email is proven)
  // → sign them straight in. New email → hand back a ticket so the app
  // can collect a display name before the account is created.
  try {
    const user = await a.auth().getUserByEmail(email);
    await ref.delete();
    return { token: await mintToken(a, user.uid), isNewUser: false };
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/user-not-found') throw err;
  }
  const ticket = crypto.randomBytes(24).toString('hex');
  await ref.update({ verifiedAt: Date.now(), ticketHash: sha256(ticket), attempts: MAX_VERIFY_ATTEMPTS });
  return { isNewUser: true, ticket };
}

async function handleComplete(a: typeof admin, db: admin.firestore.Firestore, email: string, ticketRaw: unknown, nameRaw: unknown) {
  const ticket = typeof ticketRaw === 'string' ? ticketRaw : '';
  const displayName = typeof nameRaw === 'string' ? nameRaw.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
  if (!displayName) throw new HttpError(400, 'Please enter your name.');
  const { ref, data } = await loadCode(db, email);
  if (!data.verifiedAt || !data.ticketHash || sha256(ticket) !== data.ticketHash) {
    throw new HttpError(401, 'Verification expired. Please request a new code.');
  }
  let uid: string;
  try {
    uid = (await a.auth().getUserByEmail(email)).uid; // raced with another sign-up — fine
  } catch {
    uid = (await a.auth().createUser({ email, displayName, emailVerified: true })).uid;
  }
  await ref.delete();
  return { token: await mintToken(a, uid), isNewUser: true };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  let a: typeof admin;
  try { a = getAdmin(); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); return; }
  const db = a.firestore();

  const body = (req.body || {}) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  try {
    if (!isEmail(email)) throw new HttpError(400, 'Please enter a valid email address.');
    switch (body.action) {
      case 'send':
        res.status(200).json(await handleSend(db, req, email)); return;
      case 'verify':
        res.status(200).json(await handleVerify(a, db, email, body.code)); return;
      case 'complete':
        res.status(200).json(await handleComplete(a, db, email, body.ticket, body.displayName)); return;
      default:
        throw new HttpError(400, 'Unknown action');
    }
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, ...err.extra });
      return;
    }
    console.error('[otp] unhandled', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
