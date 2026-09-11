// Free-tier model cascade (docs/HEALTH_SPEC.md §6).
//
// Rishi's rule: always use the strongest model that still has free-tier
// quota left today, step down to the next one *before* the current one
// runs out, and start again at the top tomorrow. The AI Studio free tier
// resets at midnight Pacific, so the counters live in one Firestore
// document per Pacific day:
//
//   aiQuota/{YYYY-MM-DD} = {
//     used:          { [model]: n },       // RPD, spent today
//     exhausted:     { [model]: true },    // RPD gone: nothing until tomorrow
//     cooldownUntil: { [model]: epochMs }, // RPM / TPM / a demand spike
//   }
//
// The three limits Google enforces expire on completely different clocks,
// and treating them alike is what broke the scanner on 2026-09-09:
//
//   RPD  requests per day    → resets at midnight Pacific, i.e. a new doc
//   RPM  requests per minute → resets within the minute
//   TPM  tokens per minute   → resets within the minute
//
// So a model is skipped either because its DAY is spent (`exhausted`, which
// only a per-day 429 or a 404 may set) or because it is still inside a short
// cooling window (`cooldownUntil`, set by a per-minute 429 or a 503 spike and
// honoured only until that instant passes). A model rate-limited five minutes
// ago is a first-class candidate again now.
//
// `pickModel` reserves a slot in a transaction (so two concurrent scans can't
// both spend the last request); `releaseReservation` hands it back when the
// call never reached the model, so a spike cannot quietly eat the day's
// twenty requests.
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

/**
 * Most AVAILABLE first, not strongest first. Measured 2026-09-12: 3.8 and 3.7
 * answered 503 "high demand" on every probe and had landed 0–3 scans a day
 * for a fortnight, each miss costing 1–2 s (or 26 s on a timeout) before
 * 3.6 answered. 3.6 and 3.5 answer; the lites are 500 a day and rarely
 * spike. 3.8 is dropped outright (Rishi's call); 3.7 stays as a last resort
 * because when it does answer it is the best reader of the lot. All ids
 * verified on the key on 2026-09-07. When every one of these has given up,
 * api/_openaiScan.ts takes the request.
 */
export const MODEL_CASCADE: ModelBudget[] = [
  { model: 'gemini-3.6-flash', perDay: 20 },
  { model: 'gemini-3.5-flash', perDay: 20 },
  { model: 'gemini-3.5-flash-lite', perDay: 500 },
  { model: 'gemini-3.1-flash-lite', perDay: 500 },
  { model: 'gemini-3.7-flash', perDay: 20 },
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
  /** model → epoch ms before which it must not be picked again. */
  cooldownUntil?: Record<string, number>;
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
  nowMs: number = Date.now(),
): ModelPick | null {
  for (const b of budgets) {
    if (state.exhausted?.[b.model] || skip.has(b.model)) continue;
    // A cooling window that has already passed is not a reason to skip.
    if ((state.cooldownUntil?.[b.model] ?? 0) > nowMs) continue;
    const used = state.used?.[b.model] ?? 0;
    if (used < b.perDay - HEADROOM) {
      return { model: b.model, remainingToday: b.perDay - HEADROOM - used - 1 };
    }
  }
  return null;
}

/** Seconds until every cooling model is available again, or null if none are. */
export function nextAvailableInSec(state: QuotaState, nowMs: number = Date.now()): number | null {
  const waits = Object.values(state.cooldownUntil ?? {})
    .map((until) => until - nowMs)
    .filter((ms) => ms > 0);
  return waits.length ? Math.ceil(Math.min(...waits) / 1000) : null;
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
    const chosen = selectModel(state, budgets, opts.skip, opts.now?.getTime() ?? Date.now());
    if (!chosen) return null;
    tx.set(
      ref,
      { used: { [chosen.model]: (state.used?.[chosen.model] ?? 0) + 1 }, updatedAt: Date.now() },
      { merge: true },
    );
    return chosen;
  });
  if (!pick) {
    // Distinguish "come back tomorrow" from "come back in a minute" — with
    // per-minute limits the second is much the more common of the two.
    const state = (await ref.get()).data() as QuotaState | undefined;
    const wait = nextAvailableInSec(state ?? {}, opts.now?.getTime() ?? Date.now());
    if (wait !== null) {
      throw new HttpError(429, `Every model is rate-limited right now. Try again in ${wait < 60 ? `${wait}s` : 'a minute'}.`, {
        reason: 'busy', retryAfterSec: wait,
      });
    }
    throw new HttpError(429, 'Scanning is busy today. Try again tomorrow.', { reason: 'quota' });
  }
  console.log(`[modelRouter] ${opts.purpose} → ${pick.model} (${pick.remainingToday} left today)`);
  return pick;
}

/** Writes a model off for the rest of the day. Only a per-day 429 or a 404. */
export async function markExhausted(db: Firestore, model: string, now?: Date): Promise<void> {
  console.warn(`[modelRouter] ${model} exhausted for ${quotaDayISO(now)}`);
  await quotaRef(db, now).set({ exhausted: { [model]: true }, updatedAt: Date.now() }, { merge: true });
}

/**
 * Parks a model for `ms` — a per-minute limit or a demand spike. Nothing has
 * to clear it: `selectModel` compares the stored instant against the clock,
 * so the model returns of its own accord.
 */
export async function markCooldown(db: Firestore, model: string, ms: number, now?: Date): Promise<void> {
  const until = Date.now() + Math.max(1_000, ms);
  console.warn(`[modelRouter] ${model} cooling for ${Math.round(ms / 1000)}s`);
  await quotaRef(db, now).set({ cooldownUntil: { [model]: until }, updatedAt: Date.now() }, { merge: true });
}

/**
 * Hands back the request `pickModel` reserved, for a call that never reached
 * the model. Google does not charge a 503 against the daily quota, and nor
 * should we: on 2026-09-09 spikes alone walked `used` up 1 → 4 without a
 * single answer coming back.
 */
export async function releaseReservation(db: Firestore, model: string, now?: Date): Promise<void> {
  const ref = quotaRef(db, now);
  try {
    await ref.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const state = (snap.exists ? snap.data() : {}) as QuotaState;
      const used = state.used?.[model] ?? 0;
      if (used <= 0) return;
      tx.set(ref, { used: { [model]: used - 1 }, updatedAt: Date.now() }, { merge: true });
    });
  } catch (err) {
    console.warn(`[modelRouter] could not release ${model}:`, (err as Error).message);
  }
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
export type FailureKind = 'exhausted' | 'cooldown' | 'fatal';

export interface Failure {
  kind: FailureKind;
  /** kind 'cooldown': how long to park the model for, in ms. */
  cooldownMs?: number;
  /** True when the request never reached the model, so its slot is owed back. */
  refund?: boolean;
}

/** Default cooling windows, by what went wrong. */
const COOLDOWN_MS = {
  /** RPM / TPM. The window is a minute; a little past it is safer. */
  perMinute: 65_000,
  /** "This model is currently experiencing high demand" — seconds, usually. */
  spike: 45_000,
  /** An internal error or a timeout: give it a moment, don't write it off. */
  glitch: 20_000,
} as const;

/**
 * Google sometimes says exactly how long to wait, in
 * `error.details[].retryDelay: "23s"`. Believe it when it does.
 */
export function retryDelayMs(body: unknown): number | null {
  const details = (body as { error?: { details?: Array<Record<string, unknown>> } })?.error?.details;
  if (!Array.isArray(details)) return null;
  for (const d of details) {
    const raw = d?.retryDelay;
    if (typeof raw !== 'string') continue;
    const m = /^(\d+(?:\.\d+)?)s$/.exec(raw.trim());
    if (m) return Math.round(Number(m[1]) * 1000);
  }
  return null;
}

/** Per-minute limits recover on their own; per-day ones do not. */
function isPerDayQuota(message: string): boolean {
  const m = message.toLowerCase();
  if (/per\s*minute|perminute|per-minute|\brpm\b|requests per minute/.test(m)) return false;
  return /per\s*day|perday|per-day|\brpd\b|daily|quota/.test(m);
}

export function classifyFailure(status: number, message = '', body?: unknown): Failure {
  if (status === 404) return { kind: 'exhausted' };
  if (status === 429) {
    if (isPerDayQuota(message)) return { kind: 'exhausted' };
    return { kind: 'cooldown', cooldownMs: retryDelayMs(body) ?? COOLDOWN_MS.perMinute, refund: true };
  }
  if (status === 503) return { kind: 'cooldown', cooldownMs: retryDelayMs(body) ?? COOLDOWN_MS.spike, refund: true };
  if (status === 408 || status === 409 || status === 500 || status === 502 || status === 504) {
    return { kind: 'cooldown', cooldownMs: COOLDOWN_MS.glitch, refund: true };
  }
  return { kind: 'fatal' };
}

// ---------------------------------------------------------------- OpenAI spend

export interface OpenAiSpend {
  calls: number;
  usd: number;
  inputTokens: number;
  outputTokens: number;
  /** Which surface spent it — Zen's share is the number that must stay small. */
  byPurpose?: Record<string, { calls: number; usd: number }>;
}

/** What the paid fallback has cost today, on the same day-doc as the Gemini counters. */
export async function openAiSpentToday(db: Firestore, now?: Date): Promise<OpenAiSpend> {
  const snap = await quotaRef(db, now).get();
  const o = (snap.exists ? (snap.data() as { openai?: Partial<OpenAiSpend> }).openai : undefined) ?? {};
  return { calls: o.calls ?? 0, usd: o.usd ?? 0, inputTokens: o.inputTokens ?? 0, outputTokens: o.outputTokens ?? 0, byPurpose: o.byPurpose ?? {} };
}

/** Adds one paid call to today's tally. Best-effort — a lost increment is a
 *  slightly low number, not a broken scan. */
export async function recordOpenAiSpend(
  db: Firestore,
  call: { usd: number; inputTokens: number; outputTokens: number; purpose: string },
  now?: Date,
): Promise<void> {
  const ref = quotaRef(db, now);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = ((snap.exists ? (snap.data() as { openai?: Partial<OpenAiSpend> }).openai : undefined) ?? {}) as Partial<OpenAiSpend>;
      const mine = cur.byPurpose?.[call.purpose] ?? { calls: 0, usd: 0 };
      tx.set(ref, {
        openai: {
          calls: (cur.calls ?? 0) + 1,
          usd: Math.round(((cur.usd ?? 0) + call.usd) * 1e6) / 1e6,
          inputTokens: (cur.inputTokens ?? 0) + call.inputTokens,
          outputTokens: (cur.outputTokens ?? 0) + call.outputTokens,
          byPurpose: { [call.purpose]: { calls: mine.calls + 1, usd: Math.round((mine.usd + call.usd) * 1e6) / 1e6 } },
        },
        updatedAt: Date.now(),
      }, { merge: true });
    });
  } catch (err) {
    console.warn('[modelRouter] openai spend not recorded:', (err as Error).message);
  }
}
