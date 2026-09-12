// Vercel serverless function: self-service account deletion (Play Store
// requirement — docs/REVAMP_SPEC.md §5). The caller can only delete
// their OWN account: their identity comes from the verified ID token,
// never from a client-supplied uid.
//
// POST JSON { idToken, action: 'delete' } → { ok: true }
//   409 when the account owns a gym (transfer ownership first)
// POST JSON { idToken, action: 'complete-profile', displayName?, phone, dob?, sex? } → { ok: true, phone }
//   Claims the phone number for this account (409 if another account holds it)
//   and marks the profile complete — see api/_profile.ts.
//   500 when the auth account is gone but some data is still there — the
//       message tells the user to tap Delete again (see api/_accountWipe.ts)
//
// Required Vercel env vars (shared with /api/push, /api/otp, /api/admin):
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type admin from 'firebase-admin';
import { GymOwnerError, wipeUserData } from './_accountWipe.js';
import { getAdmin, replyNotConfigured, setCors } from './_http.js';
import { consumeLimit, HttpError, MINUTE_MS } from './_limits.js';
import { auditServer } from './_audit.js';
import { completeProfile } from './_profile.js';

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
    const idToken = body.idToken;
    if (typeof idToken !== 'string' || !idToken) throw new HttpError(401, 'Missing ID token.');
    let decoded;
    try {
      decoded = await a.auth().verifyIdToken(idToken);
    } catch {
      throw new HttpError(401, 'Invalid or expired session. Please sign in again.');
    }
    if (body.action === 'complete-profile') {
      await consumeLimit(a.firestore(), `profile:${decoded.uid}`, [
        { field: 'm', windowMs: MINUTE_MS, max: 10, message: 'Too many attempts — try again in {min} min.' },
      ]);
      const { phone } = await completeProfile(a.auth(), a.firestore(), decoded.uid, {
        displayName: body.displayName as string | undefined,
        phone: body.phone as string,
        dob: body.dob as string | undefined,
        sex: body.sex as never,
        email: decoded.email,
      }, { kind: 'self' });
      res.status(200).json({ ok: true, phone });
      return;
    }
    if (body.action !== 'delete') throw new HttpError(400, 'Unknown action');
    const db = a.firestore();
    const profile = await db.collection('userProfiles').doc(decoded.uid).get();
    const gymId = profile.exists ? (profile.data() as { gym?: { gymId?: string } | null }).gym?.gymId ?? null : null;
    const name = profile.exists ? (profile.data() as { displayName?: string }).displayName : undefined;
    await wipeUserData(a.auth(), db, decoded.uid);
    // After the wipe, so a refused deletion (gym owner) leaves no trail of a deletion that did not happen.
    await auditServer(db, { actorUid: decoded.uid, actorName: name, action: 'account.delete', target: { type: 'user', id: decoded.uid }, details: { gymId } });
    if (gymId) await auditServer(db, { gymId, actorUid: decoded.uid, actorName: name, action: 'member.account-deleted', target: { type: 'member', id: decoded.uid, name } });
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message, ...err.extra }); return; }
    if (err instanceof GymOwnerError) { res.status(409).json({ error: err.message }); return; }
    console.error('[account] unhandled', err);
    const msg = err instanceof Error && /Tap Delete again/.test(err.message) ? err.message : 'Something went wrong. Please try again.';
    res.status(500).json({ error: msg });
  }
}
