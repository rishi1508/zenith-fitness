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
//   per email: 3 codes / hour, 6 / day      per IP: 15 codes / day, 60 verify attempts / hour
//   per code : 5 verify attempts, 10-minute expiry
// A code whose e-mail could not be sent is refunded, so a mail outage does
// not lock the address out for the hour. The code doc holds hashes only —
// the address itself never sits in Firestore.
//
// Required Vercel env vars:
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY   (shared with /api/push)
//   EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY
//
// Firestore: otpCodes/{emailHash}, otpLimits/{key}. No client rules → admin-only.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type admin from 'firebase-admin';
import crypto from 'node:crypto';
import { clientIp, getAdmin, replyNotConfigured, setCors } from './_http.js';

export const config = { maxDuration: 30 };

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const EMAILJS_TIMEOUT_MS = 12_000;
const LIMITS = {
  emailPerHour: 3,
  emailPerDay: 6,
  ipPerDay: 15,
  ipVerifyPerHour: 60,
};
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const normalizeEmail = (e: unknown) => (typeof e === 'string' ? e.trim().toLowerCase() : '');
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;

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
        throw new HttpError(429, `Too many ${label}. Try again in ${Math.max(1, Math.ceil(retryAfterSec / 60))} min.`, { retryAfterSec });
      }
      next[w.field] = { win, count: count + 1 };
    }
    tx.set(ref, { ...next, updatedAt: now }, { merge: true });
  });
}

/** Hands one consumed request back in the current window only (see api/_limits.ts refundLimit). */
async function refundLimit(db: admin.firestore.Firestore, key: string, windows: Array<{ field: string; windowMs: number }>): Promise<void> {
  const ref = db.collection('otpLimits').doc(key);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() as Record<string, { win: number; count: number }>;
      const patch: Record<string, unknown> = {};
      for (const w of windows) {
        const cur = data[w.field];
        const win = Math.floor(Date.now() / w.windowMs);
        if (cur && cur.win === win && cur.count > 0) patch[w.field] = { win, count: cur.count - 1 };
      }
      if (Object.keys(patch).length) tx.set(ref, { ...patch, updatedAt: Date.now() }, { merge: true });
    });
  } catch (err) {
    console.warn('[otp] refund failed', key, (err as Error).message);
  }
}

async function sendCodeEmail(to: string, code: string): Promise<void> {
  const { EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY } = process.env;
  if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY || !EMAILJS_PRIVATE_KEY) {
    console.error('[otp] EMAILJS_* env vars missing');
    throw new HttpError(503, 'Email sign-in is unavailable right now. Please use Google sign-in.');
  }
  // Genuine non-browser API call authenticated by the PRIVATE key. Requires
  // the EmailJS account settings "Allow EmailJS API for non-browser
  // applications" and "Use Private Key" (both enabled 2026-09-06). The
  // rate limits above are what protect the monthly quota.
  let r: Response;
  try {
    r = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        accessToken: EMAILJS_PRIVATE_KEY,
        template_params: { to_email: to, otp_code: code },
      }),
      signal: AbortSignal.timeout(EMAILJS_TIMEOUT_MS),
    });
  } catch (err) {
    console.error('[otp] EmailJS unreachable', (err as Error).name, (err as Error).message);
    throw new HttpError(502, 'Could not send the code right now. Please try again in a minute.');
  }
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    console.error('[otp] EmailJS error', r.status, text.slice(0, 200));
    throw new HttpError(502, 'Could not send the code right now. Please try again in a minute.');
  }
}

/** otpCodes/{sha256(email)} — hashes only; the address is never stored. */
type CodeDoc = {
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  ip: string;
  verifiedAt?: number;
  ticketHash?: string;
};

const EMAIL_WINDOWS = [
  { field: 'h', windowMs: HOUR_MS, max: LIMITS.emailPerHour },
  { field: 'd', windowMs: DAY_MS, max: LIMITS.emailPerDay },
];
const IP_WINDOWS = [{ field: 'd', windowMs: DAY_MS, max: LIMITS.ipPerDay }];

async function handleSend(db: admin.firestore.Firestore, req: VercelRequest, email: string) {
  const ip = clientIp(req);
  const ipKey = `ip:${sha256(ip)}`;
  const emailKey = `email:${sha256(email)}`;
  await consumeLimit(db, ipKey, IP_WINDOWS, 'codes requested from this device');
  try {
    await consumeLimit(db, emailKey, EMAIL_WINDOWS, 'codes requested for this email');
  } catch (err) {
    await refundLimit(db, ipKey, IP_WINDOWS);
    throw err;
  }

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const now = Date.now();
  const doc: CodeDoc = {
    codeHash: sha256(`${code}:${email}`),
    createdAt: now,
    expiresAt: now + CODE_TTL_MS,
    attempts: 0,
    ip: sha256(ip),
  };
  await db.collection('otpCodes').doc(sha256(email)).set(doc);
  try {
    await sendCodeEmail(email, code);
  } catch (err) {
    // The mail never left: the user's hour and the device's day get the
    // request back, and the unsent code cannot be guessed at.
    await Promise.all([refundLimit(db, emailKey, EMAIL_WINDOWS), refundLimit(db, ipKey, IP_WINDOWS)]);
    await db.collection('otpCodes').doc(sha256(email)).delete().catch(() => { /* best-effort */ });
    throw err;
  }
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

async function handleVerify(a: typeof admin, db: admin.firestore.Firestore, req: VercelRequest, email: string, codeRaw: unknown) {
  const code = typeof codeRaw === 'string' ? codeRaw.trim() : '';
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Please enter the 6-digit code.');
  // Per-device ceiling on guesses across all addresses; the per-code cap
  // below is what actually stops brute force on one address.
  await consumeLimit(db, `verify-ip:${sha256(clientIp(req))}`, [{ field: 'h', windowMs: HOUR_MS, max: LIMITS.ipVerifyPerHour }], 'attempts from this device');

  // Who this is, before the code is consumed: existing account (any
  // provider — the email is proven) or a brand-new email.
  let existingUid: string | null = null;
  try {
    existingUid = (await a.auth().getUserByEmail(email)).uid;
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/user-not-found') throw err;
  }
  const ticket = crypto.randomBytes(24).toString('hex');

  // Check and consume in one transaction, so two guesses in flight cannot
  // both read attempts=4 and both get a try.
  const ref = db.collection('otpCodes').doc(sha256(email));
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, 'No verification code found. Please request a new one.');
    const data = snap.data() as CodeDoc;
    if (Date.now() > data.expiresAt) {
      tx.delete(ref);
      throw new HttpError(410, 'Code has expired. Please request a new one.');
    }
    // Already verified (ticket issued, waiting for the name step). A retry
    // or double-tap must NOT burn the ticket — tell the client to move on.
    if (data.verifiedAt) throw new HttpError(409, 'Code already verified. Please enter your name to finish signing up.');
    if (data.attempts >= MAX_VERIFY_ATTEMPTS) {
      tx.delete(ref);
      throw new HttpError(429, 'Too many attempts. Please request a new code.');
    }
    if (sha256(`${code}:${email}`) !== data.codeHash) {
      tx.update(ref, { attempts: data.attempts + 1 });
      const remaining = MAX_VERIFY_ATTEMPTS - (data.attempts + 1);
      throw new HttpError(401, `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
    }
    if (existingUid) {
      tx.delete(ref);
      return 'sign-in' as const;
    }
    tx.update(ref, { verifiedAt: Date.now(), ticketHash: sha256(ticket), attempts: MAX_VERIFY_ATTEMPTS });
    return 'new' as const;
  });

  if (outcome === 'sign-in' && existingUid) return { token: await mintToken(a, existingUid), isNewUser: false };
  // New email → the app collects a display name before the account is created.
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
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  let a: typeof admin;
  try { a = getAdmin(); }
  catch (e) { replyNotConfigured(res, e); return; }
  const db = a.firestore();

  const body = (req.body || {}) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  try {
    if (!isEmail(email)) throw new HttpError(400, 'Please enter a valid email address.');
    switch (body.action) {
      case 'send':
        res.status(200).json(await handleSend(db, req, email)); return;
      case 'verify':
        res.status(200).json(await handleVerify(a, db, req, email, body.code)); return;
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
