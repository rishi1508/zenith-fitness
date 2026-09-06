// Vercel serverless function: Zenith admin console (docs/REVAMP_SPEC.md
// §5). Verifies the caller's ID token with firebase-admin and requires
// their uid be in ADMIN_UIDS (mirrors src/admin.ts; env ADMIN_UIDS is a
// comma list that overrides the default below) before doing anything —
// firebase-admin bypasses Firestore rules, so this check IS the access
// control.
//
// POST JSON { idToken, action, ... }:
//   list-users        {}                    → { users: AdminUserRow[] }
//   set-disabled      { uid, disabled }      → { ok: true }
//   delete-user       { uid }                → { ok: true }
//   set-premium-grant { uid, grant }         → { ok: true }
//
// delete-user wipes users/{uid} (recursively), userProfiles/{uid}, the
// gym membership doc if they belong to one, and the auth account
// itself — same wipe api/account.ts uses for self-service deletion
// (shared in api/_accountWipe.ts).
//
// Required Vercel env vars (shared with /api/push, /api/otp, /api/zen):
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
// Optional:
//   ADMIN_UIDS   comma-separated uid list; overrides the default below.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
import { wipeUserData } from './_accountWipe.js';

const DEFAULT_ADMIN_UIDS = ['BXedteurc3bPydsehvPIdVWPTbM2', 'upLvcTSoE5SS7lOmhYBKHFWSV0r1'];

function adminUids(): string[] {
  const env = process.env.ADMIN_UIDS;
  if (env && env.trim()) return env.split(',').map((s) => s.trim()).filter(Boolean);
  return DEFAULT_ADMIN_UIDS;
}

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
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  let a: typeof admin;
  try { a = getAdmin(); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); return; }
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
    console.error('[admin] unhandled', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
