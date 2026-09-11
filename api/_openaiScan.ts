// The plate scan's OpenAI fallback — request shape only; the client and the
// pricing live in _openai.ts. Runs when the whole Gemini cascade has given up.
//
// Cost per scan ≈ $0.001: a 1024×768 photo is 768 patches × 1.2 = 922 tokens
// on gpt-5.6-luna, the ~2.5K-token prompt is served from cache after the
// first call, and low reasoning keeps output near 600 tokens.

import { SCAN_PROMPT } from './_scanParse.js';
import { OPENAI_MODEL, postOpenAiResponse } from './_openai.js';
import type { OpenAiCallResult } from './_openai.js';

export { estimateOpenAiCostUsd, extractOpenAiText, OPENAI_PRICES_USD } from './_openai.js';
export const OPENAI_SCAN_MODEL = OPENAI_MODEL;

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
    model: opts.model ?? OPENAI_MODEL,
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

/** One scan through OpenAI. */
export function callOpenAiScan(
  image: { mimeType: string; data: string },
  hint: string,
  apiKey: string,
  timeoutMs: number,
): Promise<OpenAiCallResult> {
  return postOpenAiResponse((withSchema) => buildOpenAiScanRequest(image, hint, { withSchema }), apiKey, timeoutMs);
}
