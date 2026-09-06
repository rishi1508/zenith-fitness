// Vercel serverless function: self-service account deletion (Play Store
// requirement — docs/REVAMP_SPEC.md §5). The caller can only delete
// their OWN account: their identity comes from the verified ID token,
// never from a client-supplied uid.
//
// POST JSON { idToken, action: 'delete' } → { ok: true }
//
// Wipes users/{uid} (recursively), userProfiles/{uid}, the gym
// membership doc if they belong to one, and the auth account itself —
// same wipe api/admin.ts's delete-user action uses (shared in
// api/_accountWipe.ts).
//
// Required Vercel env vars (shared with /api/push, /api/otp, /api/admin):
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
import { wipeUserData } from './_accountWipe.js';

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

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  let a: typeof admin;
  try { a = getAdmin(); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); return; }

  const body = (req.body || {}) as Record<string, unknown>;
  try {
    if (body.action !== 'delete') throw new HttpError(400, 'Unknown action');
    const idToken = body.idToken;
    if (typeof idToken !== 'string' || !idToken) throw new HttpError(401, 'Missing ID token.');
    let decoded;
    try {
      decoded = await a.auth().verifyIdToken(idToken);
    } catch {
      throw new HttpError(401, 'Invalid or expired session. Please sign in again.');
    }
    await wipeUserData(a.auth(), a.firestore(), decoded.uid);
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('[account] unhandled', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
