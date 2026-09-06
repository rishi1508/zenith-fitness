import type { ZenRequest } from './dataRequests';

/**
 * Zen client — talks to `api/zen.ts`. All the security- and quota-
 * relevant work happens server-side; this file only posts one turn and
 * transparently drives the one-round data-request protocol (spec §6).
 *
 * Mirrors the typed-error shape of `src/llm/types.ts`'s `LLMError` and
 * the endpoint-derivation pattern of `src/otpService.ts`.
 */

export type ZenErrorKind = 'auth' | 'rate-limit' | 'busy' | 'network' | 'unknown';

export class ZenError extends Error {
  kind: ZenErrorKind;
  retryAfterSec?: number;
  constructor(kind: ZenErrorKind, message: string, opts?: { retryAfterSec?: number }) {
    super(message);
    this.name = 'ZenError';
    this.kind = kind;
    this.retryAfterSec = opts?.retryAfterSec;
  }
}

export interface ZenChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskZenOptions {
  /** Firebase ID token for the signed-in user. */
  idToken: string;
  messages: ZenChatMessage[];
  context: string;
  /** IANA zone, e.g. "Asia/Kolkata". */
  tz?: string;
  /** Overrides the derived endpoint (mainly for tests). */
  endpoint?: string;
  /** Resolves a `zen_request` into the text Zen asked for. Called at
   *  most once per `askZen()` call — the server allows exactly one
   *  round of the data protocol. */
  resolveData: (request: ZenRequest) => string | Promise<string>;
}

export interface AskZenResult {
  text: string;
  model?: string;
}

interface ZenApiResponse {
  text?: string;
  model?: string;
  needData?: ZenRequest;
  error?: string;
  retryAfterSec?: number;
}

/** `VITE_ZEN_ENDPOINT` if set, else derived from `VITE_PUSH_ENDPOINT`
 *  (same Vercel project), else the same-origin default. */
function resolveEndpoint(): string {
  const explicit = import.meta.env.VITE_ZEN_ENDPOINT as string | undefined;
  if (explicit) return explicit;
  const push = import.meta.env.VITE_PUSH_ENDPOINT as string | undefined;
  if (push) return push.replace(/\/api\/push\/?$/, '/api/zen');
  return '/api/zen';
}

async function post(url: string, body: Record<string, unknown>): Promise<ZenApiResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ZenError('network', 'Could not reach Zen. Check your connection and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as ZenApiResponse;
  if (!res.ok) {
    const message = data.error || 'Zen ran into a problem. Please try again.';
    if (res.status === 401) throw new ZenError('auth', message);
    if (res.status === 429) throw new ZenError('rate-limit', message, { retryAfterSec: data.retryAfterSec });
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new ZenError('busy', message);
    throw new ZenError('unknown', message);
  }
  return data;
}

/**
 * One conversational turn with Zen. If Zen needs a lookup first
 * (`needData`), this resolves it via `resolveData` and re-posts once
 * with the answer — the caller never sees the intermediate round.
 */
export async function askZen(opts: AskZenOptions): Promise<AskZenResult> {
  const url = opts.endpoint || resolveEndpoint();
  const base = { idToken: opts.idToken, messages: opts.messages, context: opts.context, tz: opts.tz };

  const first = await post(url, base);
  if (first.needData) {
    const dataAnswer = await opts.resolveData(first.needData);
    const second = await post(url, { ...base, dataAnswer });
    if (!second.text) throw new ZenError('unknown', 'Zen did not answer. Please try again.');
    return { text: second.text, model: second.model };
  }
  if (!first.text) throw new ZenError('unknown', 'Zen did not answer. Please try again.');
  return { text: first.text, model: first.model };
}
