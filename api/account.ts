// Vercel serverless function: self-service account deletion (Play Store
// requirement — docs/REVAMP_SPEC.md §5). The caller can only delete
// their OWN account: their identity comes from the verified ID token,
// never from a client-supplied uid.
//
// POST JSON { idToken, action: 'delete' } → { ok: true }
//   409 when the account owns a gym (transfer ownership first)
//   500 when the auth account is gone but some data is still there — the
//       message tells the user to tap Delete again (see api/_accountWipe.ts)
//
// Required Vercel env vars (shared with /api/push, /api/otp, /api/admin):
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type admin from 'firebase-admin';
import { GymOwnerError, wipeUserData } from './_accountWipe.js';
import { getAdmin, replyNotConfigured, setCors } from './_http.js';
import { HttpError } from './_limits.js';

// A full wipe walks a dozen collections; a member with a long history
// takes a few seconds, well inside this.
export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  let a: typeof admin;
  try { a = getAdmin(); }
  catch (e) { replyNotConfigured(res, e); return; }

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
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
    if (err instanceof GymOwnerError) { res.status(409).json({ error: err.message }); return; }
    console.error('[account] unhandled', err);
    const msg = err instanceof Error && /Tap Delete again/.test(err.message) ? err.message : 'Something went wrong. Please try again.';
    res.status(500).json({ error: msg });
  }
}
