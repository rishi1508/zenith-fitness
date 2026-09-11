// Zen's OpenAI fallback — request shape only; the client lives in _openai.ts.
//
// Runs only after BOTH Gemma models have failed (or one has timed out, which
// on Gemma is final). Gemma stays primary because it is free and because Zen
// is tuned for it; this is the answer the user gets instead of "Zen is busy".
// The same prompt goes across: the system turn Zen builds (persona, the data
// protocol, the context pack) becomes `instructions`, the conversation is
// the input. A Zen turn is ~5K tokens in and ~400 out ≈ $0.0015 on Luna, so
// this must stay rare — the per-purpose tally on aiQuota is how that is
// checked, not assumed.

import { OPENAI_MODEL, postOpenAiResponse } from './_openai.js';
import type { OpenAiCallResult } from './_openai.js';
import type { ZenMessage } from './_zenProtocol.js';

export function buildOpenAiChatRequest(
  systemTurn: string,
  messages: ZenMessage[],
  opts: { maxOutputTokens?: number; model?: string } = {},
): Record<string, unknown> {
  return {
    model: opts.model ?? OPENAI_MODEL,
    instructions: systemTurn,
    input: messages.map((m) => ({ role: m.role, content: m.content })),
    reasoning: { effort: 'low' },
    max_output_tokens: opts.maxOutputTokens ?? 1500,
    store: false,
  };
}

export function callOpenAiChat(
  systemTurn: string,
  messages: ZenMessage[],
  apiKey: string,
  timeoutMs: number,
  maxOutputTokens?: number,
): Promise<OpenAiCallResult> {
  return postOpenAiResponse(() => buildOpenAiChatRequest(systemTurn, messages, { maxOutputTokens }), apiKey, timeoutMs);
}
