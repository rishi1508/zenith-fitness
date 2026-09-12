// Server-side entries in the activity log. Same shape the app writes
// (src/audit.ts) with source 'server'. Never throws: a logging failure must
// not fail the request that already did its work.

import { Timestamp, type Firestore } from 'firebase-admin/firestore';

const RETENTION_DAYS = 180;

export async function auditServer(db: Firestore, e: {
  gymId?: string | null;
  actorUid: string;
  actorName?: string;
  action: string;
  target?: { type: string; id?: string; name?: string };
  details?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  try {
    const now = new Date();
    const entry = {
      at: now.toISOString(),
      ts: now.getTime(),
      actorUid: e.actorUid,
      actorName: e.actorName ?? 'Server',
      action: e.action,
      ...(e.target ? { target: e.target } : {}),
      ...(e.details ? { details: e.details } : {}),
      source: 'server',
      expiresAt: Timestamp.fromMillis(now.getTime() + RETENTION_DAYS * 86_400_000),
    };
    const col = e.gymId ? db.collection('gyms').doc(e.gymId).collection('audit') : db.collection('auditLogs');
    await col.add(entry);
  } catch (err) {
    console.warn('[audit] not recorded:', e.action, (err as Error).message);
  }
}
