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

/** How many models a single request may burn through before giving up. */
export const MAX_MODEL_ATTEMPTS = 3;

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
export function selectModel(state: QuotaState, budgets: ModelBudget[] = MODEL_CASCADE): ModelPick | null {
  for (const b of budgets) {
    if (state.exhausted?.[b.model]) continue;
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
  opts: { purpose: string; now?: Date; budgets?: ModelBudget[] },
): Promise<ModelPick> {
  const budgets = opts.budgets ?? MODEL_CASCADE;
  const ref = quotaRef(db, opts.now);
  const pick = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const state = (snap.exists ? snap.data() : {}) as QuotaState;
    const chosen = selectModel(state, budgets);
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

/** Statuses that mean "this model is done for today, take the next one". */
export function isExhaustedStatus(status: number): boolean {
  return status === 429 || status === 404 || status === 503;
}

/**
 * A failure that says nothing about the model's daily quota — the API's own
 * "Internal error encountered", a bad gateway, or a request that timed out.
 * The next model in the cascade usually answers the same request fine, which
 * is what "it failed a few times, then it worked" looked like from the
 * outside (reported 2026-09-09). The model is NOT written off for the day.
 */
export function isTransientStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 504;
}
