// The one paid model behind both AI surfaces, and the plumbing they share.
//
// Gemini's free tier is primary for Zen (Gemma 4, which has no paid tier) and
// for plate scans (the 3.x cascade). OpenAI runs only when Gemini has given
// up — so that a scan always completes and Zen always answers — and it must
// stay rare: every call is tallied on the day's aiQuota doc, by purpose, so
// "rare" is a number rather than a hope.
//
// Model: gpt-5.6-luna, $0.20/M in, $0.02/M cached, $1.20/M out (verified
// 2026-09-12). Ahead of gpt-5.4-nano on every shared benchmark incl. MMMU-Pro
// at the same price, and of gpt-5-nano on 14/15 — see docs/AI_INFERENCE.md.

export const OPENAI_MODEL = process.env.OPENAI_SCAN_MODEL || 'gpt-5.6-luna';
/** Per-1M-token prices for the fallback model, for the spend counter. */
export const OPENAI_PRICES_USD = { input: 0.2, cachedInput: 0.02, output: 1.2 };
/**
 * Runaway guards, not budgets. At ~$0.001 a scan and ~$0.0015 a Zen turn the
 * daily cap is ~200 paid calls — twice what 100 members scanning once a day
 * would need even with Gemini down all day — and the monthly cap keeps half
 * of the prepaid $8 in hand whatever happens. Below both, the fallback
 * always runs. Env overrides: OPENAI_DAILY_USD_CAP, OPENAI_MONTHLY_USD_CAP.
 */
export const OPENAI_DAILY_USD_CAP = Number(process.env.OPENAI_DAILY_USD_CAP) || 0.25;
export const OPENAI_MONTHLY_USD_CAP = Number(process.env.OPENAI_MONTHLY_USD_CAP) || 4;

export type OpenAiPurpose = 'scan' | 'zen';

export interface OpenAiUsage {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
}

export interface OpenAiResponse {
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  usage?: OpenAiUsage;
  error?: { message?: string; type?: string; code?: string };
  status?: string;
  incomplete_details?: { reason?: string };
}

/** Dollars for one call, from the usage block. */
export function estimateOpenAiCostUsd(usage: OpenAiUsage | undefined, prices = OPENAI_PRICES_USD): number {
  if (!usage) return 0;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const input = Math.max(0, (usage.input_tokens ?? 0) - cached);
  const output = usage.output_tokens ?? 0;
  return (input * prices.input + cached * prices.cachedInput + output * prices.output) / 1_000_000;
}

/** The reply text, whichever field the API used. */
export function extractOpenAiText(body: OpenAiResponse): string {
  if (typeof body.output_text === 'string' && body.output_text) return body.output_text;
  const parts: string[] = [];
  for (const item of body.output ?? []) {
    if (item.type && item.type !== 'message') continue;
    for (const c of item.content ?? []) if (c.type === 'output_text' && c.text) parts.push(c.text);
  }
  return parts.join('\n');
}

export interface OpenAiCallResult {
  status: number;
  text: string;
  usage?: OpenAiUsage;
  error?: string;
  costUsd: number;
  model: string;
}

/**
 * POST /v1/responses. Failure is reported as a status, like the Gemini
 * callers, so the route decides what the user hears. A 400 that objects to a
 * `text.format` schema is retried once without it — the prompts already
 * demand the shape they need.
 */
export async function postOpenAiResponse(
  build: (withSchema: boolean) => Record<string, unknown>,
  apiKey: string,
  timeoutMs: number,
): Promise<OpenAiCallResult> {
  const attempt = async (withSchema: boolean): Promise<{ status: number; body: OpenAiResponse }> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(build(withSchema)),
        signal: ctrl.signal,
      });
      const body = (await r.json().catch(() => ({}))) as OpenAiResponse;
      return { status: r.status, body };
    } catch (err) {
      const aborted = (err as Error).name === 'AbortError';
      console.error('[openai] fetch failed', aborted ? 'timeout' : (err as Error).message);
      return { status: aborted ? 504 : 502, body: {} };
    } finally {
      clearTimeout(timer);
    }
  };

  let r = await attempt(true);
  if (r.status === 400 && /format|schema/i.test(r.body.error?.message ?? '')) r = await attempt(false);
  const costUsd = estimateOpenAiCostUsd(r.body.usage);
  if (r.status < 200 || r.status >= 300) {
    return { status: r.status, text: '', usage: r.body.usage, error: r.body.error?.message || `HTTP ${r.status}`, costUsd, model: OPENAI_MODEL };
  }
  return { status: r.status, text: extractOpenAiText(r.body), usage: r.body.usage, costUsd, model: OPENAI_MODEL };
}
