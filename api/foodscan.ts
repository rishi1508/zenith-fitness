// Vercel serverless function: camera food scan (docs/HEALTH_SPEC.md §6).
// One photo in, an estimated food list out. Same auth/CORS/quota shape as
// api/zen.ts; the difference is the model, which comes from the free-tier
// cascade in api/_modelRouter.ts rather than Zen's Gemma pair.
//
// POST JSON { idToken, image, mime?, hint?, tz? }
//   image — base64 JPEG/PNG, no data: prefix needed (one is stripped),
//           ≤ 700 KB of base64 (the client downscales to 1024 px q0.8)
//   hint  — optional free text from the user ("2 rotis, home dal")
//   → 200 { items: [{ name, grams, kcal, protein, carbs, fat, confidence }],
//           note, model, remainingToday }
//     `remainingToday` is the user's own scans left today, for the UI.
//   → 4xx/5xx { error, reason }  reason ∈ auth | premium | quota | image | busy
//
// Limits: FOODSCAN_PER_USER_PER_DAY (default 10) per user in
// zenLimits/{uid}.scan, plus the shared daily model budgets in
// aiQuota/{YYYY-MM-DD}.
//
// Required Vercel env vars:
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY  (shared with /api/push)
//   GEMINI_API_KEY                                                    (shared with /api/zen)
// Optional:
//   FOODSCAN_PER_USER_PER_DAY   default 10
//   FOODSCAN_REQUIRE_PREMIUM    default false  ('true' → userProfiles/{uid} must be premium/gym)

import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
import { assertPremium, consumeLimit, DAY_MS, HttpError, refundLimit } from './_limits.js';
import { classifyFailure, markExhausted, MAX_MODEL_ATTEMPTS, pickModel } from './_modelRouter.js';
import { parseScanPayload, SCAN_PROMPT, type ScanPayload } from './_scanParse.js';

// A vision call on a flash model answers in 2–8 s; the ceiling is here for
// the retry path (up to MAX_MODEL_ATTEMPTS models on a bad day).
export const config = { maxDuration: 60 };

const DEFAULT_PER_USER_PER_DAY = 10;
const MAX_IMAGE_B64_BYTES = 700 * 1024;
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png']);
/**
 * A vision call on a thinking model regularly needs 15–20 s; 20 s was cutting
 * good answers off mid-flight (measured 2026-09-09: a clean scan took 17 s and
 * the next model timed out at 20 s).
 */
const GEMINI_TIMEOUT_MS = 26_000;
/** Stop starting new model attempts past this point so we answer before maxDuration. */
const RETRY_DEADLINE_MS = 30_000;

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

// ----- image ---------------------------------------------------------------

interface ScanImage { data: string; mimeType: string }

/** Validates the posted image and strips a `data:` prefix if the client sent one. */
function readImage(body: Record<string, unknown>): ScanImage {
  const raw = typeof body.image === 'string' ? body.image.trim() : '';
  if (!raw) throw new HttpError(400, 'No photo received. Take the picture again.', { reason: 'image' });

  let data = raw;
  let mimeType = typeof body.mime === 'string' ? body.mime.toLowerCase().trim() : '';
  const prefix = raw.match(/^data:([a-z/+.-]+);base64,/i);
  if (prefix) {
    mimeType = mimeType || prefix[1].toLowerCase();
    data = raw.slice(prefix[0].length);
  }
  mimeType = mimeType || 'image/jpeg';

  if (!ALLOWED_MIMES.has(mimeType)) {
    throw new HttpError(400, 'That image format is not supported — use a JPEG or PNG photo.', { reason: 'image' });
  }
  if (data.length > MAX_IMAGE_B64_BYTES) {
    throw new HttpError(400, 'That photo is too large. Try again — the app will shrink it.', { reason: 'image' });
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(data.slice(0, 256))) {
    throw new HttpError(400, "That photo couldn't be read. Take the picture again.", { reason: 'image' });
  }
  return { data: data.replace(/\s+/g, ''), mimeType };
}

// ----- Gemini --------------------------------------------------------------

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; status?: string };
}

async function callGemini(
  model: string,
  prompt: string,
  image: ScanImage,
  apiKey: string,
  jsonMime: boolean,
  thinking = true,
): Promise<{ status: number; body: GeminiResponse }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  // Room for the JSON *and* whatever the model thinks first. Gemini 3.x flash
  // models reason before answering and those tokens come out of the same
  // budget: at 1200 a long deliberation left a truncated object, which is
  // what "Couldn't read that plate" actually meant. `minimal` keeps the
  // thinking short (the same setting Zen uses) and 2400 leaves headroom.
  const generationConfig: Record<string, unknown> = { temperature: 0.2, maxOutputTokens: 2400 };
  if (thinking) generationConfig.thinkingLevel = 'minimal';
  if (jsonMime) generationConfig.responseMimeType = 'application/json';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.data } }] }],
        generationConfig,
      }),
      signal: ctrl.signal,
    });
    const body = (await r.json().catch(() => ({}))) as GeminiResponse;
    return { status: r.status, body };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    console.error('[foodscan] Gemini fetch failed', aborted ? 'timeout' : (err as Error).message);
    // Reported as a status rather than thrown, so the cascade can take the
    // next model instead of failing the whole scan on one slow model.
    return { status: aborted ? 504 : 502, body: {} };
  } finally {
    clearTimeout(timer);
  }
}

function extractText(body: GeminiResponse): string {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  // Thought parts are the model's private reasoning — never parsed, never shown.
  return parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim();
}

/** Raw-shape diagnostics, returned only to admins who pass `debug: true`.
 *  Never carries user data — status, finish reason, token counts and the
 *  first line of any error. The same shape Zen returns (api/zen.ts). */
export interface ScanDebug {
  model: string;
  status: number;
  finishReason?: string;
  blockReason?: string;
  parts?: Array<{ thought: boolean; chars: number }>;
  usage?: unknown;
  error?: string;
  parsed?: number | 'no';
  /** First 300 chars of the reply, so an unparseable answer can be read. */
  sample?: string;
}

function describe(model: string, r: { status: number; body: GeminiResponse }, text?: string, parsed?: number | 'no'): ScanDebug {
  const c = r.body.candidates?.[0];
  return {
    model,
    status: r.status,
    finishReason: c?.finishReason,
    blockReason: r.body.promptFeedback?.blockReason,
    parts: c?.content?.parts?.map((p) => ({ thought: !!p.thought, chars: (p.text ?? '').length })),
    usage: r.body.usageMetadata,
    error: r.body.error?.message?.slice(0, 300),
    ...(parsed !== undefined ? { parsed } : {}),
    ...(text !== undefined ? { sample: text.slice(0, 300) } : {}),
  };
}

/** True when the model rejected `responseMimeType` rather than the request itself. */
function isResponseMimeRejection(status: number, body: GeminiResponse): boolean {
  return status === 400 && /response.?mime/i.test(body.error?.message || '');
}

/** Same idea for `thinkingLevel` — older models in the cascade don't take it. */
function isThinkingRejection(status: number, body: GeminiResponse): boolean {
  return status === 400 && /thinking/i.test(body.error?.message || '');
}

/**
 * Walks the cascade: reserve a model, call it, and on a 429/404/503 write
 * that model off for the day and take the next one. At most
 * MAX_MODEL_ATTEMPTS models per request.
 */
async function scan(
  db: admin.firestore.Firestore,
  prompt: string,
  image: ScanImage,
  debug: ScanDebug[] | null = null,
): Promise<{ payload: ScanPayload; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new HttpError(503, 'Scanning is not configured on the server yet.');
  const startedAt = Date.now();

  // What went wrong last, so the user gets the real reason if every attempt
  // fails rather than a generic "busy".
  let lastFailure: HttpError | null = null;
  const canRetry = (attempt: number) =>
    attempt + 1 < MAX_MODEL_ATTEMPTS && Date.now() - startedAt < RETRY_DEADLINE_MS;

  // Models that already failed this request. A transient failure doesn't
  // touch the daily budget, so without this the picker would hand back the
  // same model on the next attempt.
  const tried = new Set<string>();

  for (let attempt = 0; attempt < MAX_MODEL_ATTEMPTS; attempt++) {
    const { model } = await pickModel(db, { purpose: 'foodscan', skip: tried });
    let r = await callGemini(model, prompt, image, apiKey, true);
    if (isThinkingRejection(r.status, r.body)) {
      r = await callGemini(model, prompt, image, apiKey, true, false);
    }
    if (isResponseMimeRejection(r.status, r.body)) {
      r = await callGemini(model, prompt, image, apiKey, false, !isThinkingRejection(r.status, r.body));
    }
    if (r.status < 200 || r.status >= 300) {
      debug?.push(describe(model, r));
      const why = r.body.error?.message || '';
      const kind = classifyFailure(r.status, why);
      console.warn(`[foodscan] ${model} → ${r.status} (${kind}) ${why.slice(0, 140)}`);
      if (kind === 'exhausted') {
        await markExhausted(db, model);
        tried.add(model);
        if (canRetry(attempt)) continue;
        break;
      }
      if (kind === 'transient') {
        // The model is fine, this call was not. Skip it for the rest of THIS
        // request only — its daily budget is untouched.
        tried.add(model);
        lastFailure = r.status === 504
          ? new HttpError(504, 'The scan took too long. Please try again in a moment.', { reason: 'busy' })
          : new HttpError(503, 'The scanner is busy right now. Try again in a moment.', { reason: 'busy' });
        if (canRetry(attempt)) continue;
        break;
      }
      throw new HttpError(502, "The scan didn't work. Please try again.", { reason: 'busy', ...(debug ? { debug } : {}) });
    }
    const text = extractText(r.body);
    const payload = parseScanPayload(text);
    debug?.push(describe(model, r, text, payload ? payload.items.length : 'no'));
    if (!payload) {
      // A garbled reply is the model's problem, not the photo's — give the
      // next one a go before telling the user to retake it.
      console.warn('[foodscan] unparseable reply', model, r.body.candidates?.[0]?.finishReason, text.slice(0, 200));
      tried.add(model);
      lastFailure = new HttpError(502, "Couldn't read that plate. Try a clearer, closer photo.", { reason: 'image' });
      if (canRetry(attempt)) continue;
      break;
    }
    const u = r.body.usageMetadata;
    console.log(`[foodscan] model=${model} items=${payload.items.length} prompt=${u?.promptTokenCount ?? '?'} out=${u?.candidatesTokenCount ?? '?'}`);
    return { payload, model };
  }
  const failure = lastFailure ?? new HttpError(429, 'Scanning is busy today. Try again tomorrow.', { reason: 'quota' });
  if (debug) failure.extra = { ...failure.extra, debug };
  throw failure;
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
    if (!idToken) throw new HttpError(401, 'Please sign in to scan food.', { reason: 'auth' });
    let uid: string;
    try { uid = (await a.auth().verifyIdToken(idToken)).uid; }
    catch { throw new HttpError(401, 'Your session has expired. Please sign in again.', { reason: 'auth' }); }

    if (process.env.FOODSCAN_REQUIRE_PREMIUM === 'true') {
      await assertPremium(db, uid, 'Food scan is part of Zenith Premium.');
    }

    const image = readImage(body);
    const hint = typeof body.hint === 'string' ? body.hint.trim().slice(0, 200) : '';
    const perDay = Number(process.env.FOODSCAN_PER_USER_PER_DAY) || DEFAULT_PER_USER_PER_DAY;

    const remaining = await consumeLimit(db, uid, [
      {
        field: 'scan',
        windowMs: DAY_MS,
        max: perDay,
        message: `You've used today's ${perDay} food scans. More tomorrow — you can still add food by hand.`,
      },
    ]);

    // Admins may ask for raw-shape diagnostics (never user data) with debug: true.
    const adminUids = (process.env.ADMIN_UIDS || 'BXedteurc3bPydsehvPIdVWPTbM2,upLvcTSoE5SS7lOmhYBKHFWSV0r1').split(',');
    const debug: ScanDebug[] | null = body.debug === true && adminUids.includes(uid) ? [] : null;

    const prompt = hint ? `${SCAN_PROMPT}\n\nThe user says: ${hint}` : SCAN_PROMPT;
    let payload: ScanPayload;
    let model: string;
    try {
      ({ payload, model } = await scan(db, prompt, image, debug));
    } catch (err) {
      // A scan that never produced anything shouldn't cost one of the day's
      // ten. The user retrying our own flakiness was burning their budget.
      await refundLimit(db, uid, 'scan', DAY_MS);
      throw err;
    }

    res.status(200).json({
      items: payload.items, note: payload.note, model, remainingToday: remaining.scan ?? 0,
      ...(debug ? { debug } : {}),
    });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, ...err.extra });
      return;
    }
    console.error('[foodscan] unhandled', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
