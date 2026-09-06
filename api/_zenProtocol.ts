// Pure helpers for api/zen.ts: message trimming, the Gemini `contents`
// layout, and the one-round zen_request data protocol. No I/O, no env —
// so they can be bundled into a plain node test.

import { ZEN_PERSONA, ZEN_REQUEST_KINDS, ZEN_REQUEST_PROTOCOL, type ZenRequestKind } from './_zenPersona.js';

export const MAX_MESSAGES = 8;
export const MAX_CONTEXT_CHARS = 10_000;
export const MAX_DATA_CHARS = 6_000;
/** Per-message cap. Not in the spec, but a runaway paste should not blow the prompt. */
export const MAX_MESSAGE_CHARS = 4_000;

export interface ZenMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ZenRequest = { kind: ZenRequestKind } & Record<string, unknown>;

export interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/** Keeps the last MAX_MESSAGES well-formed messages, each capped in length. */
export function trimMessages(raw: unknown): ZenMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ZenMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue;
    const text = content.trim();
    if (!text) continue;
    out.push({ role, content: truncate(text, MAX_MESSAGE_CHARS) });
  }
  return out.slice(-MAX_MESSAGES);
}

/** "Sat, 6 Sep 2026" in the user's zone; falls back to UTC on a bad tz. */
export function todayLabel(tz: string | undefined, now: Date = new Date()): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
  try {
    return now.toLocaleDateString('en-IN', { ...opts, timeZone: tz || 'UTC' }) + (tz ? ` (${tz})` : ' (UTC)');
  } catch {
    return now.toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' }) + ' (UTC)';
  }
}

/**
 * The single prepended user turn: SYSTEM + USER CONTEXT (+ DATA). Gemma
 * models may reject `systemInstruction`, so everything rides in the first
 * user turn instead.
 */
export function buildSystemTurn(opts: { context: string; dataAnswer?: string; tz?: string; now?: Date }): string {
  const parts = [
    'SYSTEM\n' + ZEN_PERSONA + '\n\n' + ZEN_REQUEST_PROTOCOL + '\nToday: ' + todayLabel(opts.tz, opts.now),
    'USER CONTEXT\n' + (truncate(opts.context, MAX_CONTEXT_CHARS).trim() || '(no context available)'),
  ];
  if (opts.dataAnswer !== undefined) {
    parts.push(
      'DATA\n' +
        'The data you requested is below. Answer the user now from it; do not send another zen_request.\n' +
        (truncate(opts.dataAnswer, MAX_DATA_CHARS).trim() || '(no data returned)'),
    );
  }
  return parts.join('\n\n');
}

/**
 * Gemini `contents`: the system turn, then the chat. Consecutive turns of
 * the same role are merged so the transcript strictly alternates (the
 * chat-template models are strict about this).
 */
export function buildContents(systemTurn: string, messages: ZenMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [{ role: 'user', parts: [{ text: systemTurn }] }];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = out[out.length - 1];
    if (last.role === role) last.parts[0].text += '\n\n' + m.content;
    else out.push({ role, parts: [{ text: m.content }] });
  }
  return out;
}

// ----- zen_request detection ----------------------------------------------

const KIND_SET: ReadonlySet<string> = new Set(ZEN_REQUEST_KINDS);

/** A line that is a JSON object with a `zen_request` key, or null. Tolerates
 *  surrounding backticks and trailing punctuation the model may add. */
function parseRequestLine(line: string): Record<string, unknown> | null {
  let s = line.trim().replace(/^`+|`+$/g, '').trim();
  if (!s.startsWith('{')) return null;
  const end = s.lastIndexOf('}');
  if (end < 0) return null;
  s = s.slice(0, end + 1);
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const req = (parsed as Record<string, unknown>).zen_request;
    if (!req || typeof req !== 'object') return null;
    return req as Record<string, unknown>;
  } catch {
    return null;
  }
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates a raw request object into the shape the client resolves.
 *  Returns null for unknown kinds or missing required fields. */
export function normalizeZenRequest(raw: Record<string, unknown>): ZenRequest | null {
  const rawKind = typeof raw.kind === 'string' ? raw.kind : '';
  if (!KIND_SET.has(rawKind)) return null;
  const kind = rawKind as ZenRequestKind;
  switch (kind) {
    case 'exercise_history': {
      const exercise = typeof raw.exercise === 'string' ? raw.exercise.trim().slice(0, 80) : '';
      if (!exercise) return null;
      return { kind, exercise, sessions: clampInt(raw.sessions, 1, 20, 8) };
    }
    case 'workouts_range':
    case 'nutrition_range':
    case 'activity_range': {
      const from = typeof raw.from === 'string' ? raw.from.slice(0, 10) : '';
      const to = typeof raw.to === 'string' ? raw.to.slice(0, 10) : '';
      if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return null;
      return from <= to ? { kind, from, to } : { kind, from: to, to: from };
    }
    case 'body_weight':
      return { kind, days: clampInt(raw.days, 7, 365, 90) };
    case 'volume_by_muscle':
      return { kind, weeks: clampInt(raw.weeks, 1, 12, 4) };
    case 'streak_detail':
    case 'plan_detail':
    case 'gym_summary':
    case 'prs':
    case 'phase_detail':
      return { kind };
    default:
      return null;
  }
}

/** First valid zen_request in the reply, or null. */
export function parseZenRequest(text: string): ZenRequest | null {
  for (const line of text.split(/\r?\n/)) {
    const raw = parseRequestLine(line);
    if (!raw) continue;
    const req = normalizeZenRequest(raw);
    if (req) return req;
  }
  return null;
}

// ----- model switching (Rishi's rule, spec §6) -----------------------------
//
// GEMINI_MODEL and GEMINI_FALLBACK_MODEL are peers, not primary+backup.
// On 429/404/503 from whichever model is being tried, retry immediately
// with the other one. When a switch succeeds, the caller persists
// { preferredModel, until } to zenLimits/global so the next minute of
// requests starts on the model that just worked; once `until` passes,
// pickStartModel falls back to `primary`. Symmetric: whichever model is
// preferred, a failure on it tries the other. Only when both fail does
// the caller return 429 "Zen is busy, try again in a minute."

export const MODEL_PREFERENCE_TTL_MS = 60_000;

export interface ModelPreference {
  preferredModel?: string;
  until?: number;
}

/** Which model to try first this request. */
export function pickStartModel(pref: ModelPreference, primary: string, fallback: string, now: number): string {
  if (
    pref.preferredModel &&
    pref.until !== undefined &&
    pref.until > now &&
    (pref.preferredModel === primary || pref.preferredModel === fallback)
  ) {
    return pref.preferredModel;
  }
  return primary;
}

/** The two models are peers — a retry always means "the other one". */
export function otherModel(model: string, primary: string, fallback: string): string {
  return model === primary ? fallback : primary;
}

/** Statuses that mean "try the other model immediately". */
export function isSwitchableStatus(status: number): boolean {
  return status === 429 || status === 404 || status === 503;
}

/**
 * What to persist to zenLimits/global after this request, given the
 * model we started with and the one that actually answered (or null if
 * both failed). Only written when we actually switched AND it worked —
 * if the model we started with answered fine, there's nothing new to
 * remember, and a failed request has no success to prefer.
 */
export function preferenceToWrite(opts: {
  startedWith: string;
  succeededWith: string | null;
  now: number;
}): { preferredModel: string; until: number } | null {
  if (!opts.succeededWith || opts.succeededWith === opts.startedWith) return null;
  return { preferredModel: opts.succeededWith, until: opts.now + MODEL_PREFERENCE_TTL_MS };
}

/** Removes every zen_request line (valid or not) and any code fence left
 *  empty by that removal, then tidies blank lines. */
export function stripZenRequests(text: string): string {
  const kept = text.split(/\r?\n/).filter((line) => parseRequestLine(line) === null);
  const out: string[] = [];
  for (let i = 0; i < kept.length; i++) {
    const line = kept[i];
    // Opening fence directly followed by a closing fence → both go.
    if (/^\s*```/.test(line) && i + 1 < kept.length && /^\s*```\s*$/.test(kept[i + 1])) { i++; continue; }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
