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
import {
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

// Gemma at 700 output tokens can take 15–25 s. A model switch means up to
// two sequential calls, so this is kept well under half of maxDuration.
export const config = { maxDuration: 60 };

const DEFAULT_MODEL = 'gemma-4-31b-it';
const DEFAULT_FALLBACK_MODEL = 'gemma-4-27b-it';
const GEMINI_TIMEOUT_MS = 50_000; // a full think on Gemma 4 takes ~20–30 s; a timeout is final (no second model attempt would fit in the 60 s function limit)
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
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

class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

interface LimitWindow {
  field: string;
  windowMs: number;
  max: number;
  /** Friendly 429 text; `{min}` is replaced with minutes until the window resets. */
  message: string;
}

/** Fixed-window counters in one Firestore doc, consumed in a transaction. */
async function consumeLimit(db: admin.firestore.Firestore, key: string, windows: LimitWindow[]): Promise<void> {
  const ref = db.collection('zenLimits').doc(key);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.exists ? snap.data() : {}) as Record<string, { win: number; count: number }>;
    const now = Date.now();
    const next: Record<string, { win: number; count: number }> = {};
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
    }
    tx.set(ref, { ...next, updatedAt: now }, { merge: true });
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

/** When ZEN_REQUIRE_PREMIUM=true: paid tier, an admin grant, or a gym membership (spec §5 precedence). */
async function assertPremium(db: admin.firestore.Firestore, uid: string): Promise<void> {
  const snap = await db.collection('userProfiles').doc(uid).get();
  const p = (snap.exists ? snap.data() : {}) as { premiumGrant?: boolean; subscriptionTier?: string; gym?: unknown };
  const ok = p.premiumGrant === true || p.subscriptionTier === 'premium' || !!p.gym;
  if (!ok) throw new HttpError(403, 'Zen is part of Zenith Premium.', { reason: 'premium' });
}

// ----- Gemini ---------------------------------------------------------------

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  error?: { message?: string; status?: string };
}

async function callGemini(model: string, contents: GeminiContent[], apiKey: string): Promise<{ status: number; body: GeminiResponse }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
  // Gemma 4 is a thinking model and we let it think (Rishi's call): the
  // client shows placeholders meanwhile. Thought parts are filtered out in
  // extractText, and thinking tokens count against maxOutputTokens, so the
  // cap leaves room for both.
  const generationConfig: Record<string, unknown> = { temperature: 0.6, maxOutputTokens: 1500 };
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

async function generate(
  contents: GeminiContent[],
  db: admin.firestore.Firestore,
  debug: ZenDebug[] | null = null,
): Promise<{ text: string; model: string; usage?: { promptTokens: number; outputTokens: number } }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new HttpError(503, 'Zen is not configured on the server yet.');
  const primary = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const fallback = process.env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;

  const now = Date.now();
  const pref = await readModelPreference(db);
  const start = pickStartModel(pref, primary, fallback, now);

  let model = start;
  let r = await callGemini(model, contents, apiKey);
  debug?.push(describe(model, r));
  if (isSwitchableStatus(r.status)) {
    const next = otherModel(model, primary, fallback);
    if (next !== model) {
      console.warn(`[zen] model ${model} returned ${r.status} — switching to ${next}`);
      model = next;
      r = await callGemini(model, contents, apiKey);
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

  const toWrite = preferenceToWrite({ startedWith: start, succeededWith: model, now });
  if (toWrite) await writeModelPreference(db, toWrite);

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
    try { uid = (await a.auth().verifyIdToken(idToken)).uid; }
    catch { throw new HttpError(401, 'Your session has expired. Please sign in again.', { reason: 'auth' }); }

    if (process.env.ZEN_REQUIRE_PREMIUM === 'true') await assertPremium(db, uid);

    const messages = trimMessages(body.messages);
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      throw new HttpError(400, 'Send Zen a message first.');
    }
    const context = typeof body.context === 'string' ? body.context : '';
    const dataAnswer = typeof body.dataAnswer === 'string' ? body.dataAnswer : undefined;
    const tz = typeof body.tz === 'string' && body.tz.length <= 64 ? body.tz : undefined;

    await consumeQuotas(db, uid);

    // Admins may ask for raw-shape diagnostics (never user data) with debug: true.
    const adminUids = (process.env.ADMIN_UIDS || 'BXedteurc3bPydsehvPIdVWPTbM2,upLvcTSoE5SS7lOmhYBKHFWSV0r1').split(',');
    const debug: ZenDebug[] | null = body.debug === true && adminUids.includes(uid) ? [] : null;

    const contents = buildContents(buildSystemTurn({ context, dataAnswer, tz }), messages);
    const { text, model, usage } = await generate(contents, db, debug);

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
