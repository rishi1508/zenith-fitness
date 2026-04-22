// Vercel serverless function that fans out FCM push notifications.
//
// Flow:
//   1. Client POSTs { recipientUid, title, body, data, idToken }.
//   2. We verify `idToken` with firebase-admin. This ensures only a
//      signed-in user can trigger pushes, and blocks spam.
//   3. We load the recipient's fcmTokens subcollection (Firestore).
//   4. Fan out via FCM HTTP v1. Remove any tokens FCM reports as stale
//      so the list self-heals.
//
// Required Vercel env vars (Project → Settings → Environment Variables):
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY   (paste value; multi-line newlines are handled below)
//
// All three come from Firebase console → Project settings → Service accounts
// → Generate new private key → open JSON → copy the three fields.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';

// Initialise once per cold start. Hot invocations reuse the same app.
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

// Relaxed CORS so the Firebase-hosted app can call this Vercel endpoint.
function setCors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  let a: typeof admin;
  try { a = getAdmin(); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); return; }

  const { recipientUid, title, body, data, idToken } = (req.body || {}) as {
    recipientUid?: string; title?: string; body?: string;
    data?: Record<string, string>; idToken?: string;
  };
  if (!recipientUid || !title || !idToken) {
    res.status(400).json({ error: 'recipientUid, title, idToken required' });
    return;
  }

  // Auth check — only logged-in users can trigger pushes.
  try { await a.auth().verifyIdToken(idToken); }
  catch (e) { res.status(401).json({ error: 'Invalid token', detail: (e as Error).message }); return; }

  // Pull the recipient's device tokens.
  const db = a.firestore();
  const tokensSnap = await db
    .collection('userProfiles').doc(recipientUid)
    .collection('fcmTokens').get();
  const tokens = tokensSnap.docs.map((d) => d.id);
  if (tokens.length === 0) {
    res.status(200).json({ ok: true, sent: 0, reason: 'no tokens' });
    return;
  }

  // FCM HTTP v1 via sendEachForMulticast — returns per-token status so
  // we can prune ones that came back as unregistered/invalid.
  const result = await a.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body: body || '' },
    data: Object.fromEntries(
      Object.entries(data || {}).map(([k, v]) => [k, String(v)]),
    ),
    android: { priority: 'high', notification: { channelId: 'default' } },
    apns: { payload: { aps: { sound: 'default' } } },
  });

  // Remove tokens FCM said are invalid so the list doesn't keep growing.
  const removals: Promise<unknown>[] = [];
  result.responses.forEach((r, i) => {
    if (r.error && [
      'messaging/registration-token-not-registered',
      'messaging/invalid-registration-token',
    ].includes((r.error as { code?: string }).code || '')) {
      removals.push(db.collection('userProfiles').doc(recipientUid).collection('fcmTokens').doc(tokens[i]).delete());
    }
  });
  if (removals.length) await Promise.allSettled(removals);

  res.status(200).json({
    ok: true,
    sent: result.successCount,
    failed: result.failureCount,
    pruned: removals.length,
  });
}
