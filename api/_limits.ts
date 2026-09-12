// Per-request guards shared by the Vercel routes: the `HttpError` every
// handler turns into a JSON body, the fixed-window quota counters kept in
// `zenLimits/*`, and the premium check. Extracted verbatim from
// api/zen.ts so api/foodscan.ts enforces the same limits the same way
// (docs/HEALTH_SPEC.md §6).

import type { Firestore } from 'firebase-admin/firestore';
import { adminUids } from './_http.js';

export const MINUTE_MS = 60 * 1000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export interface LimitWindow {
  field: string;
  windowMs: number;
  max: number;
  /** Friendly 429 text; `{min}` is replaced with minutes until the window resets. */
  message: string;
}

/**
 * Fixed-window counters in one Firestore doc, consumed in a transaction.
 * Returns how many requests are left in each window *after* this one, so
 * a caller can show "3 scans left today" without a second read.
 */
export async function consumeLimit(
  db: Firestore,
  key: string,
  windows: LimitWindow[],
): Promise<Record<string, number>> {
  const ref = db.collection('zenLimits').doc(key);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.exists ? snap.data() : {}) as Record<string, { win: number; count: number }>;
    const now = Date.now();
    const next: Record<string, { win: number; count: number }> = {};
    const remaining: Record<string, number> = {};
    for (const w of windows) {
      const win = Math.floor(now / w.windowMs);
      const cur = data[w.field];
      const count = cur && cur.win === win ? cur.count : 0;
      if (count >= w.max) {
        const retryAfterSec = Math.ceil(((win + 1) * w.windowMs - now) / 1000);
        const min = Math.max(1, Math.ceil(retryAfterSec / 60));
        throw new HttpError(429, w.message.replace('{min}', String(min)), { reason: 'quota', retryAfterSec });
      }
      next[w.field] = { win, count: count + 1 };
      remaining[w.field] = w.max - (count + 1);
    }
    tx.set(ref, { ...next, updatedAt: now }, { merge: true });
    return remaining;
  });
}

/**
 * Hand one consumed request back, when the work it paid for never happened.
 * Only ever decrements the *current* window, so a refund arriving after the
 * window rolled over cannot create credit out of thin air. Best-effort: a
 * failed refund must never turn into a second error for the caller.
 */
export async function refundLimit(db: Firestore, key: string, field: string, windowMs: number): Promise<void> {
  const ref = db.collection('zenLimits').doc(key);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() as Record<string, { win: number; count: number }>;
      const cur = data[field];
      const win = Math.floor(Date.now() / windowMs);
      if (!cur || cur.win !== win || cur.count <= 0) return;
      tx.set(ref, { [field]: { win, count: cur.count - 1 }, updatedAt: Date.now() }, { merge: true });
    });
  } catch (err) {
    console.warn('[limits] refund failed', key, field, (err as Error).message);
  }
}

/** Paid tier, an admin grant, or a gym membership (REVAMP_SPEC.md §5 precedence). */
export async function assertPremium(db: Firestore, uid: string, message: string): Promise<void> {
  if (adminUids().includes(uid)) return; // same precedence as src/premium (admin > paid > gym > free)
  const snap = await db.collection('userProfiles').doc(uid).get();
  const p = (snap.exists ? snap.data() : {}) as { premiumGrant?: boolean; subscriptionTier?: string; gym?: unknown };
  const ok = p.premiumGrant === true || p.subscriptionTier === 'premium' || !!p.gym;
  if (!ok) throw new HttpError(403, message, { reason: 'premium' });
}
