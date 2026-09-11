// Vercel serverless function: Zen, the coach. Proxies one chat turn to
// Gemini (Gemma models) with the user's training context prepended, so
// the API key never ships in the bundle and the free-tier quota is
// shared fairly. See docs/REVAMP_SPEC.md §6.
//
// POST JSON { idToken, messages: [{ role: 'user'|'assistant', content }],
//             context: string, dataAnswer?: string, tz?: string }
//   → { text, model, usage? }            normal answer
//   → { needData: { kind, ... }, model }  Zen wants one lookup first; the
//                                         client resolves it locally and
//                                         re-POSTs the same turn with
//                                         `dataAnswer`. One round only.
//
// Limits (fixed windows in Firestore zenLimits/*, same pattern as api/otp.ts):
//   per user: 6 / minute, 60 / day       global: 24 / minute
//
// Required Vercel env vars:
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY   (shared with /api/push)
//   GEMINI_API_KEY
// Optional:
//   GEMINI_MODEL           default gemma-4-31b-it
//   GEMINI_FALLBACK_MODEL  default gemma-4-27b-it   (peer, not a backup — see
//                          the model-switching rule below)
//   ZEN_REQUIRE_PREMIUM    default false            ('true' → userProfiles/{uid} must be premium/gym)
//
// Model switching (Rishi's rule): GEMINI_MODEL and GEMINI_FALLBACK_MODEL
// are peers. On 429/404/503 from whichever is tried, retry immediately
// with the other. A successful switch is remembered on zenLimits/global
// for 60s so the next request starts on the model that worked; after
// that it reverts to GEMINI_MODEL. Only when both fail do we 429. See
// api/_zenProtocol.ts for the pure decision logic.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
import { assertPremium, consumeLimit, DAY_MS, HttpError, MINUTE_MS } from './_limits.js';
import {
  type ZenMessage,
  buildContents,
  buildSystemTurn,
  isSwitchableStatus,
  otherModel,
  parseZenRequest,
  pickStartModel,
  preferenceToWrite,
  stripZenRequests,
  trimMessages,
  type GeminiContent,
} from './_zenProtocol.js';
import { openAiSpentToday, recordOpenAiSpend } from './_modelRouter.js';
import { OPENAI_DAILY_USD_CAP } from './_openai.js';
import { callOpenAiChat } from './_openaiChat.js';

// Gemma at 700 output tokens can take 15–25 s. A model switch means up to
// two sequential calls, so this is kept well under half of maxDuration.
export const config = { maxDuration: 120 };

const DEFAULT_MODEL = 'gemma-4-31b-it';
const DEFAULT_FALLBACK_MODEL = 'gemma-4-26b-a4b-it'; // the only other Gemma 4 model on the key (verified via the models listing)
const GEMINI_TIMEOUT_MS = 100_000; // Gemma 4 thinks for 20–60 s; a timeout is final (no second model attempt)
/** What is left of maxDuration after a full Gemma timeout, less a margin. */
const OPENAI_TIMEOUT_MS = 15_000;
const LIMITS = {
  userPerMinute: 6,
  userPerDay: 60,
  globalPerMinute: 24, // AI Studio free tier is 30 RPM for the whole key
};

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

/** Bound an awaited stage so a stalled dependency surfaces as a named 504
 *  instead of the platform killing the function silently at maxDuration. */
function withTimeout<T>(p: Promise<T>, ms: number, stage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new HttpError(504, 'Zen is slow right now. Please try again in a moment.', { reason: 'busy', stage })), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function consumeQuotas(db: admin.firestore.Firestore, uid: string): Promise<void> {
  await consumeLimit(db, uid, [
    { field: 'm', windowMs: MINUTE_MS, max: LIMITS.userPerMinute, message: 'Zen needs a breather — try again in a minute.' },
    { field: 'd', windowMs: DAY_MS, max: LIMITS.userPerDay, message: `You've used today's ${LIMITS.userPerDay} Zen messages. More tomorrow.` },
  ]);
  await consumeLimit(db, 'global', [
    { field: 'm', windowMs: MINUTE_MS, max: LIMITS.globalPerMinute, message: 'Zen is busy right now. Try again in a minute.' },
  ]);
}

// ----- Gemini ---------------------------------------------------------------

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  error?: { message?: string; status?: string };
}

interface Tuning { maxOutputTokens?: number; thinkingBudget?: number; thinkingLevel?: string; model?: string; forceFallback?: boolean }
// Gemma 4 accepts thinkingLevel ("minimal" verified live; "low" and thinkingBudget are
// rejected). Unconstrained it thinks for 20–60 s and can spend the whole output cap
// on private reasoning, so minimal is the default; ZEN_THINKING_LEVEL overrides.
const DEFAULT_THINKING_LEVEL = process.env.ZEN_THINKING_LEVEL || 'minimal';
const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env.ZEN_MAX_OUTPUT_TOKENS) || 1500;
const DEFAULT_THINKING_BUDGET = process.env.ZEN_THINKING_BUDGET ? Number(process.env.ZEN_THINKING_BUDGET) : undefined;

async function callGemini(model: string, contents: GeminiContent[], apiKey: string, tuning: Tuning = {}): Promise<{ status: number; body: GeminiResponse }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
  // Gemma 4 is a thinking model and we let it think (Rishi's call): the
  // client shows placeholders meanwhile. Thought parts are filtered out in
  // extractText, and thinking tokens count against maxOutputTokens, so the
  // cap leaves room for both.
  const generationConfig: Record<string, unknown> = { temperature: 0.6, maxOutputTokens: tuning.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS };
  const budget = tuning.thinkingBudget ?? DEFAULT_THINKING_BUDGET;
  const level = tuning.thinkingLevel ?? DEFAULT_THINKING_LEVEL;
  if (budget !== undefined || level) {
    generationConfig.thinkingConfig = { ...(budget !== undefined ? { thinkingBudget: budget } : {}), ...(level ? { thinkingLevel: level } : {}) };
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig }),
      signal: ctrl.signal,
    });
    const body = (await r.json().catch(() => ({}))) as GeminiResponse;
    return { status: r.status, body };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    console.error('[zen] Gemini fetch failed', aborted ? 'timeout' : (err as Error).message);
    throw new HttpError(504, 'Zen took too long to answer. Please try again.', { reason: 'busy' });
  } finally {
    clearTimeout(timer);
  }
}

function extractText(body: GeminiResponse): string {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  // Thought parts are the model's private reasoning — never show them.
  return parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim();
}

async function readModelPreference(db: admin.firestore.Firestore): Promise<{ preferredModel?: string; until?: number }> {
  const snap = await db.collection('zenLimits').doc('global').get();
  const data = (snap.exists ? snap.data() : {}) as { preferredModel?: string; until?: number };
  return { preferredModel: data.preferredModel, until: data.until };
}

async function writeModelPreference(db: admin.firestore.Firestore, pref: { preferredModel: string; until: number }): Promise<void> {
  await db.collection('zenLimits').doc('global').set(pref, { merge: true });
}

/** Raw-shape diagnostics, returned only to admins who pass `debug: true`. */
interface ZenDebug { model: string; status: number; finishReason?: string; blockReason?: string; parts?: Array<{ thought: boolean; chars: number }>; error?: string; usage?: unknown }
function describe(model: string, r: { status: number; body: GeminiResponse }): ZenDebug {
  const c = r.body.candidates?.[0];
  return {
    model, status: r.status, finishReason: c?.finishReason, blockReason: r.body.promptFeedback?.blockReason,
    parts: c?.content?.parts?.map((p) => ({ thought: !!p.thought, chars: (p.text ?? '').length })),
    error: r.body.error?.message?.slice(0, 300), usage: r.body.usageMetadata,
  };
}

type Generated = { text: string; model: string; usage?: { promptTokens: number; outputTokens: number } };

/**
 * Gemma first, always; OpenAI only when Gemma has given up — both models
 * failed, or one timed out (final on Gemma), or the reply came back empty.
 * That is the rare path and it is counted (aiQuota.openai.byPurpose.zen),
 * so "rare" can be checked rather than assumed.
 */
async function generate(
  contents: GeminiContent[],
  systemTurn: string,
  messages: ZenMessage[],
  db: admin.firestore.Firestore,
  debug: ZenDebug[] | null = null,
  tuning: Tuning = {},
): Promise<Generated> {
  const openAiKey = process.env.OPENAI_API_KEY;
  let gemmaFailure: HttpError;
  if (tuning.forceFallback && openAiKey) {
    gemmaFailure = new HttpError(503, 'Gemma skipped (forceFallback).', { reason: 'busy' });
  } else {
    try {
      return await generateWithGemma(contents, db, debug, tuning);
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      gemmaFailure = err;
    }
  }
  if (!openAiKey) throw gemmaFailure;

  const spent = await withTimeout(openAiSpentToday(db), 8_000, 'openai-spend');
  if (spent.usd >= OPENAI_DAILY_USD_CAP) {
    console.error(`[zen] OpenAI daily cap reached ($${spent.usd.toFixed(2)}) — not falling back`);
    throw gemmaFailure;
  }
  console.warn(`[zen] Gemma gave up (${gemmaFailure.status} ${gemmaFailure.message.slice(0, 80)}) — falling back to OpenAI`);
  const r = await callOpenAiChat(systemTurn, messages, openAiKey, OPENAI_TIMEOUT_MS, tuning.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS);
  if (r.usage) {
    await recordOpenAiSpend(db, {
      usd: r.costUsd,
      inputTokens: r.usage.input_tokens ?? 0,
      outputTokens: r.usage.output_tokens ?? 0,
      purpose: 'zen',
    });
  }
  debug?.push({ model: r.model, status: r.status, error: r.error, usage: r.usage });
  if (r.status < 200 || r.status >= 300) {
    console.error(`[zen] OpenAI fallback failed ${r.status}: ${r.error}`);
    throw gemmaFailure;
  }
  if (!r.text.trim()) throw gemmaFailure;
  console.log(`[zen] model=${r.model} (fallback) in=${r.usage?.input_tokens ?? '?'} out=${r.usage?.output_tokens ?? '?'} usd=${r.costUsd.toFixed(5)}`);
  return { text: r.text, model: r.model, usage: r.usage ? { promptTokens: r.usage.input_tokens ?? 0, outputTokens: r.usage.output_tokens ?? 0 } : undefined };
}

async function generateWithGemma(
  contents: GeminiContent[],
  db: admin.firestore.Firestore,
  debug: ZenDebug[] | null = null,
  tuning: Tuning = {},
): Promise<Generated> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new HttpError(503, 'Zen is not configured on the server yet.');
  const primary = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const fallback = process.env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;

  const now = Date.now();
  const pref = await withTimeout(readModelPreference(db), 8_000, 'preference');
  const start = tuning.model || pickStartModel(pref, primary, fallback, now);

  let model = start;
  let switchedOn: number | undefined;
  let r = await callGemini(model, contents, apiKey, tuning);
  debug?.push(describe(model, r));
  if (isSwitchableStatus(r.status)) {
    const next = otherModel(model, primary, fallback);
    if (next !== model) {
      console.warn(`[zen] model ${model} returned ${r.status} — switching to ${next}`);
      switchedOn = r.status;
      model = next;
      r = await callGemini(model, contents, apiKey, tuning);
      debug?.push(describe(model, r));
    }
  }
  const dbgExtra = debug ? { debug } : {};
  if (isSwitchableStatus(r.status)) {
    throw new HttpError(429, 'Zen is busy, try again in a minute.', { reason: 'busy', retryAfterSec: 60, ...dbgExtra });
  }
  if (r.status < 200 || r.status >= 300) {
    console.error('[zen] Gemini error', model, r.status, (r.body.error?.message || '').slice(0, 200));
    throw new HttpError(502, "Zen couldn't answer right now. Please try again.", { reason: 'busy', ...dbgExtra });
  }
  const text = extractText(r.body);
  if (!text) {
    console.warn('[zen] empty reply', model, r.body.candidates?.[0]?.finishReason, r.body.promptFeedback?.blockReason);
    throw new HttpError(502, "Zen couldn't answer that one. Try rephrasing.", { reason: 'empty', ...dbgExtra });
  }

  const toWrite = preferenceToWrite({ startedWith: start, succeededWith: model, now, switchedOn });
  if (toWrite) await withTimeout(writeModelPreference(db, toWrite), 8_000, 'preference-write');

  const u = r.body.usageMetadata;
  const usage = u ? { promptTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0 } : undefined;
  console.log(`[zen] model=${model} prompt=${usage?.promptTokens ?? '?'} out=${usage?.outputTokens ?? '?'}`);
  return { text, model, usage };
}

// ----- Handler -------------------------------------------------------------

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
    const idToken = typeof body.idToken === 'string' ? body.idToken : '';
    if (!idToken) throw new HttpError(401, 'Please sign in to talk to Zen.', { reason: 'auth' });
    let uid: string;
    try { uid = (await withTimeout(a.auth().verifyIdToken(idToken), 10_000, 'auth')).uid; }
    catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(401, 'Your session has expired. Please sign in again.', { reason: 'auth' });
    }

    if (process.env.ZEN_REQUIRE_PREMIUM === 'true') await assertPremium(db, uid, 'Zen is part of Zenith Premium.');

    const messages = trimMessages(body.messages);
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      throw new HttpError(400, 'Send Zen a message first.');
    }
    const context = typeof body.context === 'string' ? body.context : '';
    const dataAnswer = typeof body.dataAnswer === 'string' ? body.dataAnswer : undefined;
    const tz = typeof body.tz === 'string' && body.tz.length <= 64 ? body.tz : undefined;

    await withTimeout(consumeQuotas(db, uid), 12_000, 'quota');

    // Admins may ask for raw-shape diagnostics (never user data) with debug: true.
    const adminUids = (process.env.ADMIN_UIDS || 'BXedteurc3bPydsehvPIdVWPTbM2,upLvcTSoE5SS7lOmhYBKHFWSV0r1').split(',');
    const debug: ZenDebug[] | null = body.debug === true && adminUids.includes(uid) ? [] : null;

    // Admin-only: list the models this key can use (to pick fallbacks).
    if (debug && body.action === 'models') {
      const key = process.env.GEMINI_API_KEY || '';
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`);
      const j = (await r.json().catch(() => ({}))) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
      const models = (j.models ?? []).filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent')).map((m) => m.name.replace('models/', ''));
      res.status(200).json({ models });
      return;
    }

    // Admin-only generation overrides for tuning experiments.
    const t = (debug && typeof body.tuning === 'object' && body.tuning ? body.tuning : {}) as Record<string, unknown>;
    const tuning: Tuning = {
      maxOutputTokens: typeof t.maxOutputTokens === 'number' ? Math.min(8192, Math.max(200, t.maxOutputTokens)) : undefined,
      thinkingBudget: typeof t.thinkingBudget === 'number' ? Math.max(0, t.thinkingBudget) : undefined,
      thinkingLevel: typeof t.thinkingLevel === 'string' && /^[a-z]{2,12}$/.test(t.thinkingLevel) ? t.thinkingLevel : undefined,
      model: typeof t.model === 'string' && /^[a-z0-9.-]{3,40}$/.test(t.model) ? t.model : undefined,
      forceFallback: !!debug && t.forceFallback === true,
    };

    const systemTurn = buildSystemTurn({ context, dataAnswer, tz });
    const contents = buildContents(systemTurn, messages);
    const { text, model, usage } = await generate(contents, systemTurn, messages, db, debug, tuning);

    // One-round data protocol. With dataAnswer already supplied we never
    // ask again — any stray request block is stripped and the text returned.
    if (dataAnswer === undefined) {
      const request = parseZenRequest(text);
      if (request) { res.status(200).json({ needData: request, model }); return; }
    }
    const clean = stripZenRequests(text) || "I don't have enough data to answer that yet. Tell me a bit more, or log a few more sessions.";
    res.status(200).json({ text: clean, model, usage, ...(debug ? { debug } : {}) });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, ...err.extra });
      return;
    }
    console.error('[zen] unhandled', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
