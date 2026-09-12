// What every Vercel route shares: the firebase-admin app, the CORS
// allowlist, the admin uid list and the "server not configured" answer.
// Extracted from the five routes (push, otp, zen, foodscan, account,
// admin), which each carried their own copy.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';

/** Initialise once per cold start. Hot invocations reuse the same app. */
export function getAdmin(): typeof admin {
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

/**
 * Origins allowed to call the routes from a browser: the hosted app, the
 * Capacitor WebView (https://localhost on Android, capacitor://localhost on
 * iOS) and local dev servers. The routes authenticate with an ID token in
 * the body, so this is hygiene rather than the access control — an unknown
 * origin simply gets no CORS header and the browser drops the response.
 * `CORS_EXTRA_ORIGINS` (comma list) adds more without a deploy of this file.
 */
const ALLOWED_ORIGINS = new Set([
  'https://zenith-fitness-18e2a.web.app',
  'https://zenith-fitness-18e2a.firebaseapp.com',
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'ionic://localhost',
  ...(process.env.CORS_EXTRA_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
]);
const DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

export function setCors(req: VercelRequest, res: VercelResponse): void {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (origin && (ALLOWED_ORIGINS.has(origin) || DEV_ORIGIN.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
}

/** The reply when FIREBASE_* is missing: say so without echoing the env var names. */
export function replyNotConfigured(res: VercelResponse, err: unknown): void {
  console.error('[api] server not configured:', (err as Error).message);
  res.status(503).json({ error: 'The server is not configured yet. Please try again later.' });
}

const DEFAULT_ADMIN_UIDS = [
  'BXedteurc3bPydsehvPIdVWPTbM2', // Rishi
  'upLvcTSoE5SS7lOmhYBKHFWSV0r1', // QA admin (demo) — remove after launch; mirrored in src/admin.ts and firestore.rules
];

/** ADMIN_UIDS env (comma list, whitespace tolerated) overrides the default. */
export function adminUids(): string[] {
  const env = process.env.ADMIN_UIDS;
  if (env && env.trim()) return env.split(',').map((s) => s.trim()).filter(Boolean);
  return DEFAULT_ADMIN_UIDS;
}

/** Vercel sets x-real-ip from the connection; x-forwarded-for can carry a client-supplied prefix. */
export function clientIp(req: VercelRequest): string {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  const xff = req.headers['x-forwarded-for'];
  const first = Array.isArray(xff) ? xff[0] : (xff || '').split(',')[0];
  return (first || req.socket?.remoteAddress || 'unknown').trim();
}
