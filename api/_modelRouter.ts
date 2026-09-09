// Free-tier model cascade (docs/HEALTH_SPEC.md §6).
//
// Rishi's rule: always use the strongest model that still has free-tier
// quota left today, step down to the next one *before* the current one
// runs out, and start again at the top tomorrow. The AI Studio free tier
// resets at midnight Pacific, so the counters live in one Firestore
// document per Pacific day:
//
//   aiQuota/{YYYY-MM-DD} = { used: { [model]: n }, exhausted: { [model]: true } }
//
// `pickModel` reserves a slot in a transaction (so two concurrent scans
// can't both spend the last request). A 429/404/503 from the model that
// was picked means the published budget was wrong or the model is gone:
// `markExhausted` writes it off for the rest of the day and the caller
// picks again (see MAX_MODEL_ATTEMPTS).
//
// Zen is untouched: it keeps its own Gemma peer-switching in
// api/_zenProtocol.ts. Today only api/foodscan.ts uses this router.

import type { Firestore } from 'firebase-admin/firestore';
import { HttpError } from './_limits.js';

export interface ModelBudget {
  model: string;
  /** Free-tier requests per day for this model, on this key. */
  perDay: number;
}

/** Strongest first. All ids verified on the key on 2026-09-07. */
export const MODEL_CASCADE: ModelBudget[] = [
  { model: 'gemini-3.8-flash', perDay: 20 },
  { model: 'gemini-3.7-flash', perDay: 20 },
  { model: 'gemini-3.6-flash', perDay: 20 },
  { model: 'gemini-3.5-flash', perDay: 20 },
  { model: 'gemini-3.5-flash-lite', perDay: 500 },
  { model: 'gemini-3.1-flash-lite', perDay: 500 },
];

/**
 * Requests held back per model. Google's own counter and ours drift (a
 * request that times out on our side may still have been billed), so we
 * move on one request early rather than eat a hard 429.
 */
export const HEADROOM = 1;

/** How many models a single request may burn through before giving up.
 *  Four, not three: a 503 demand spike comes back in about a second, and on
 *  2026-09-09 the two strongest models both spiked on the same call. */
export const MAX_MODEL_ATTEMPTS = 4;

export interface QuotaState {
  used?: Record<string, number>;
  exhausted?: Record<string, boolean>;
}

export interface ModelPick {
  model: string;
  /** Requests still available on this model today, after the one just taken. */
  remainingToday: number;
}

/**
 * The pure decision: the strongest model that is neither exhausted nor
 * within HEADROOM of its daily budget, or null when the whole cascade is
 * spent for the day. No I/O — see the tests.
 */
export function selectModel(
  state: QuotaState,
  budgets: ModelBudget[] = MODEL_CASCADE,
  skip: ReadonlySet<string> = new Set(),
): ModelPick | null {
  for (const b of budgets) {
    if (state.exhausted?.[b.model] || skip.has(b.model)) continue;
    const used = state.used?.[b.model] ?? 0;
    if (used < b.perDay - HEADROOM) {
      return { model: b.model, remainingToday: b.perDay - HEADROOM - used - 1 };
    }
  }
  return null;
}

/** The quota day (YYYY-MM-DD) this instant belongs to — Pacific, like the API's reset. */
export function quotaDayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function quotaRef(db: Firestore, now?: Date) {
  return db.collection('aiQuota').doc(quotaDayISO(now));
}

/**
 * Reserves one request on the strongest model with quota left today.
 * Throws 429 when the cascade is spent — the daily counters reset on
 * their own, so there is nothing for the caller to retry before then.
 */
export async function pickModel(
  db: Firestore,
  opts: { purpose: string; now?: Date; budgets?: ModelBudget[]; skip?: ReadonlySet<string> },
): Promise<ModelPick> {
  const budgets = opts.budgets ?? MODEL_CASCADE;
  const ref = quotaRef(db, opts.now);
  const pick = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const state = (snap.exists ? snap.data() : {}) as QuotaState;
    const chosen = selectModel(state, budgets, opts.skip);
    if (!chosen) return null;
    tx.set(
      ref,
      { used: { [chosen.model]: (state.used?.[chosen.model] ?? 0) + 1 }, updatedAt: Date.now() },
      { merge: true },
    );
    return chosen;
  });
  if (!pick) throw new HttpError(429, 'Scanning is busy today. Try again tomorrow.', { reason: 'quota' });
  console.log(`[modelRouter] ${opts.purpose} → ${pick.model} (${pick.remainingToday} left today)`);
  return pick;
}

/** Writes a model off for the rest of the day after it answered 429/404/503. */
export async function markExhausted(db: Firestore, model: string, now?: Date): Promise<void> {
  console.warn(`[modelRouter] ${model} exhausted for ${quotaDayISO(now)}`);
  await quotaRef(db, now).set({ exhausted: { [model]: true }, updatedAt: Date.now() }, { merge: true });
}

/**
 * What a failed call means for the model that produced it.
 *
 *   'exhausted' — it is out of free-tier requests for the day (or does not
 *                 exist on this key). Write it off; the next scan skips it.
 *   'transient' — the model is fine, this call was not: a demand spike, an
 *                 internal error, a timeout. Take the next model for THIS
 *                 request but leave the daily budget alone.
 *   'fatal'     — our request was wrong; no other model will do better.
 *
 * Getting this wrong is expensive in exactly one direction, and we got it
 * wrong: 503 "This model is currently experiencing high demand" was treated
 * as exhaustion, so on 2026-09-09 the three strongest models were written
 * off for the whole day after 1, 2 and 2 calls out of 20 each. Every scan
 * after that fell to the weakest models or failed outright. A demand spike
 * lasts seconds; a daily quota lasts until midnight Pacific. Only 429 with
 * a quota message, and 404, may write a model off.
 */
export type FailureKind = 'exhausted' | 'transient' | 'fatal';

/** Per-minute limits recover on their own; per-day ones do not. */
function isPerDayQuota(message: string): boolean {
  const m = message.toLowerCase();
  if (/per\s*minute|perminute|per-minute|\brpm\b|requests per minute/.test(m)) return false;
  return /per\s*day|perday|per-day|\brpd\b|daily|quota/.test(m);
}

export function classifyFailure(status: number, message = ''): FailureKind {
  if (status === 404) return 'exhausted';
  if (status === 429) return isPerDayQuota(message) ? 'exhausted' : 'transient';
  if (status === 408 || status === 409 || status === 500 || status === 502 || status === 503 || status === 504) return 'transient';
  return 'fatal';
}
