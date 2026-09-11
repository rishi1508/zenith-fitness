// OpenAI as the plate scanner's safety net.
//
// Gemini's free tier is the primary scanner and stays so: it is free and its
// 3.x flash models read Indian plates well. But on a bad minute every flash
// model answers 503 "high demand" and the flash-lites time out, and the user
// sees "Couldn't read that plate" for a photo that was fine. This module is
// what runs when the whole Gemini cascade has given up: one paid call, so the
// scan completes.
//
// Model: gpt-5.6-luna — OpenAI's nano tier for high-volume work, $0.20/M in,
// $0.02/M cached, $1.20/M out (verified 2026-09-12). Independent benchmarks
// put it ahead of gpt-5.4-nano on every shared test including MMMU-Pro
// (vision) at the same price, and ahead of gpt-5-nano on 14 of 15, which is
// why it beats the cheaper nano here despite costing 3× per token: a
// fallback that misreads the plate is not a fallback.
//
// Cost per scan ≈ $0.001 (922 image tokens for 1024×768, the ~2.5K-token
// prompt served from cache after the first call, ~600 tokens out with low
// reasoning). At the expected 20–60 scans/day with OpenAI taking the failed
// fraction, $8 of credit lasts well past its 12-month expiry.

import { SCAN_PROMPT } from './_scanParse.js';

export const OPENAI_SCAN_MODEL = process.env.OPENAI_SCAN_MODEL || 'gpt-5.6-luna';
/** Per-1M-token prices for the fallback model, for the spend counter. */
export const OPENAI_PRICES_USD = { input: 0.2, cachedInput: 0.02, output: 1.2 };

export interface OpenAiUsage {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
}

/** The JSON the client consumes — mirrored from _scanParse so the model is
 *  told the shape, not just asked for it. `strict` stays off: a confidence
 *  the model omits should not fail the whole scan, clampItem fills it. */
const PLATE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          grams: { type: 'number' },
          kcal: { type: 'number' },
          protein: { type: 'number' },
          carbs: { type: 'number' },
          fat: { type: 'number' },
          confidence: { type: 'number' },
        },
        required: ['name', 'grams', 'kcal', 'protein', 'carbs', 'fat'],
      },
    },
    note: { type: 'string' },
  },
  required: ['items'],
};

/**
 * The request body for POST /v1/responses. Pure, so the shape is testable.
 *
 * The constant prompt goes in `instructions` — the stable prefix OpenAI
 * caches automatically past 1,024 tokens — and the per-scan parts (the photo,
 * the user's hint) in `input`, so every call after the first pays the cached
 * rate on ~2.5K of the ~3.5K input tokens.
 */
export function buildOpenAiScanRequest(
  image: { mimeType: string; data: string },
  hint: string,
  opts: { withSchema?: boolean; model?: string } = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: opts.model ?? OPENAI_SCAN_MODEL,
    instructions: SCAN_PROMPT,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_image', image_url: `data:${image.mimeType};base64,${image.data}`, detail: 'auto' },
          { type: 'input_text', text: hint ? `The user says: ${hint}` : 'Estimate what is on this plate.' },
        ],
      },
    ],
    // `low`, not `none`: portion sizes need a moment's thought and the
    // difference is a few hundred output tokens.
    reasoning: { effort: 'low' },
    max_output_tokens: 2400,
    store: false,
  };
  if (opts.withSchema !== false) {
    body.text = { format: { type: 'json_schema', name: 'plate_scan', schema: PLATE_SCHEMA, strict: false } };
  }
  return body;
}

/** Dollars for one call, from the usage block. */
export function estimateOpenAiCostUsd(usage: OpenAiUsage | undefined, prices = OPENAI_PRICES_USD): number {
  if (!usage) return 0;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const input = Math.max(0, (usage.input_tokens ?? 0) - cached);
  const output = usage.output_tokens ?? 0;
  return (input * prices.input + cached * prices.cachedInput + output * prices.output) / 1_000_000;
}

interface OpenAiResponse {
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  usage?: OpenAiUsage;
  error?: { message?: string; type?: string; code?: string };
  status?: string;
  incomplete_details?: { reason?: string };
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

export interface OpenAiScanResult {
  status: number;
  text: string;
  usage?: OpenAiUsage;
  error?: string;
  costUsd: number;
  model: string;
}

/**
 * One scan through OpenAI. Reports failure as a status, like callGemini, so
 * the handler decides what the user hears. A 400 that objects to the JSON
 * schema is retried once without it — the prompt already demands JSON.
 */
export async function callOpenAiScan(
  image: { mimeType: string; data: string },
  hint: string,
  apiKey: string,
  timeoutMs: number,
): Promise<OpenAiScanResult> {
  const model = OPENAI_SCAN_MODEL;
  const attempt = async (withSchema: boolean): Promise<{ status: number; body: OpenAiResponse }> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(buildOpenAiScanRequest(image, hint, { withSchema, model })),
        signal: ctrl.signal,
      });
      const body = (await r.json().catch(() => ({}))) as OpenAiResponse;
      return { status: r.status, body };
    } catch (err) {
      const aborted = (err as Error).name === 'AbortError';
      console.error('[foodscan] OpenAI fetch failed', aborted ? 'timeout' : (err as Error).message);
      return { status: aborted ? 504 : 502, body: {} };
    } finally {
      clearTimeout(timer);
    }
  };

  let r = await attempt(true);
  if (r.status === 400 && /format|schema/i.test(r.body.error?.message ?? '')) r = await attempt(false);
  const costUsd = estimateOpenAiCostUsd(r.body.usage);
  if (r.status < 200 || r.status >= 300) {
    return { status: r.status, text: '', usage: r.body.usage, error: r.body.error?.message || `HTTP ${r.status}`, costUsd, model };
  }
  return { status: r.status, text: extractOpenAiText(r.body), usage: r.body.usage, costUsd, model };
}
