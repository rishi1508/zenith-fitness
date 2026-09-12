// Vercel serverless function: Zenith admin console (docs/REVAMP_SPEC.md
// §5). Verifies the caller's ID token with firebase-admin and requires
// their uid be in ADMIN_UIDS (api/_http.ts; mirrors src/admin.ts; env
// ADMIN_UIDS is a comma list that overrides the default) before doing
// anything — firebase-admin bypasses Firestore rules, so this check IS
// the access control.
//
// POST JSON { idToken, action, ... }:
//   list-users        {}                    → { users: AdminUserRow[] }
//   set-disabled      { uid, disabled }      → { ok: true }
//   delete-user       { uid }                → { ok: true }   (409 for a gym owner)
//   set-premium-grant { uid, grant }         → { ok: true }
//
// delete-user runs the same wipe api/account.ts uses for self-service
// deletion (api/_accountWipe.ts lists exactly what goes and what stays).
//
// Required Vercel env vars (shared with /api/push, /api/otp, /api/zen):
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
// Optional:
//   ADMIN_UIDS   comma-separated uid list; overrides the default.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
import { GymOwnerError, wipeUserData } from './_accountWipe.js';
import { adminUids, getAdmin, replyNotConfigured, setCors } from './_http.js';

export const config = { maxDuration: 60 };

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function requireAdmin(a: typeof admin, idToken: unknown): Promise<string> {
  if (typeof idToken !== 'string' || !idToken) throw new HttpError(401, 'Missing ID token.');
  let decoded;
  try {
    decoded = await a.auth().verifyIdToken(idToken);
  } catch {
    throw new HttpError(401, 'Invalid or expired session. Please sign in again.');
  }
  if (!adminUids().includes(decoded.uid)) throw new HttpError(403, 'Admins only.');
  return decoded.uid;
}

interface AdminUserRow {
  uid: string;
  email: string | null;
  displayName: string | null;
  providers: string[];
  createdAt?: string;
  lastSignInAt?: string;
  disabled: boolean;
  gym: { gymId: string; gymRole: string } | null;
  subscriptionTier: string | null;
  premiumGrant: boolean;
}

async function handleListUsers(a: typeof admin, db: admin.firestore.Firestore): Promise<AdminUserRow[]> {
  const authUsers: admin.auth.UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await a.auth().listUsers(1000, pageToken);
    authUsers.push(...page.users);
    pageToken = page.pageToken || undefined;
  } while (pageToken);

  const profileSnap = await db.collection('userProfiles').get();
  const profiles = new Map(profileSnap.docs.map((d) => [d.id, d.data()]));

  return authUsers.map((u) => {
    const profile = profiles.get(u.uid) as Record<string, unknown> | undefined;
    return {
      uid: u.uid,
      email: u.email ?? null,
      displayName: u.displayName ?? null,
      providers: u.providerData.map((p) => p.providerId),
      createdAt: u.metadata.creationTime,
      lastSignInAt: u.metadata.lastSignInTime,
      disabled: u.disabled,
      gym: (profile?.gym as { gymId: string; gymRole: string } | null | undefined) ?? null,
      subscriptionTier: (profile?.subscriptionTier as string | undefined) ?? null,
      premiumGrant: !!profile?.premiumGrant,
    };
  });
}

async function handleSetDisabled(a: typeof admin, uid: unknown, disabled: unknown): Promise<{ ok: true }> {
  if (typeof uid !== 'string' || !uid) throw new HttpError(400, 'uid is required.');
  if (typeof disabled !== 'boolean') throw new HttpError(400, 'disabled must be a boolean.');
  await a.auth().updateUser(uid, { disabled });
  return { ok: true };
}

async function handleDeleteUser(a: typeof admin, db: admin.firestore.Firestore, uid: unknown): Promise<{ ok: true }> {
  if (typeof uid !== 'string' || !uid) throw new HttpError(400, 'uid is required.');
  // Admin accounts (including the caller) cannot be wiped from the console —
  // a slip here would lock everyone out of the admin tools.
  if (adminUids().includes(uid)) throw new HttpError(403, 'Admin accounts cannot be deleted from the console.');
  await wipeUserData(a.auth(), db, uid);
  return { ok: true };
}

async function handleSetPremiumGrant(db: admin.firestore.Firestore, uid: unknown, grant: unknown): Promise<{ ok: true }> {
  if (typeof uid !== 'string' || !uid) throw new HttpError(400, 'uid is required.');
  if (typeof grant !== 'boolean') throw new HttpError(400, 'grant must be a boolean.');
  const patch = grant
    ? { premiumGrant: true, subscriptionTier: 'premium', subscriptionSource: 'admin-grant' }
    : {
        premiumGrant: admin.firestore.FieldValue.delete(),
        subscriptionTier: admin.firestore.FieldValue.delete(),
        subscriptionSource: admin.firestore.FieldValue.delete(),
      };
  await db.collection('userProfiles').doc(uid).set(patch, { merge: true });
  return { ok: true };
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
    await requireAdmin(a, body.idToken);
    switch (body.action) {
      case 'list-users':
        res.status(200).json({ users: await handleListUsers(a, db) }); return;
      case 'set-disabled':
        res.status(200).json(await handleSetDisabled(a, body.uid, body.disabled)); return;
      case 'delete-user':
        res.status(200).json(await handleDeleteUser(a, db, body.uid)); return;
      case 'set-premium-grant':
        res.status(200).json(await handleSetPremiumGrant(db, body.uid, body.grant)); return;
      default:
        throw new HttpError(400, 'Unknown action');
    }
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof GymOwnerError) { res.status(409).json({ error: err.message }); return; }
    console.error('[admin] unhandled', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
