import type { LLMConfig, LLMMessage, LLMStreamChunk } from './types';
import { LLMError } from './types';
import { streamGemini } from './providers/gemini';
import { streamOpenAI } from './providers/openai';

/**
 * Provider-agnostic streaming entry point. Picks the right adapter
 * based on `config.provider`. Yields token chunks; the final chunk has
 * `done = true` and no text.
 *
 * Throws `LLMError` for auth / rate-limit / network / config issues.
 * Caller should map these to user-friendly UI messages.
 */
export async function* streamCompletion(
  config: LLMConfig,
  systemPrompt: string,
  messages: LLMMessage[],
  signal: AbortSignal,
): AsyncGenerator<LLMStreamChunk> {
  if (!config.apiKey) {
    throw new LLMError('invalid-config', 'No API key configured. Open BYOK setup.');
  }
  if (!config.model) {
    throw new LLMError('invalid-config', 'No model selected. Open BYOK setup.');
  }
  // Trim to last 14 user/assistant turns to keep request size sane.
  // Users with rambling chat histories shouldn't blow context windows.
  const trimmed = trimForRequest(messages, 14);

  switch (config.provider) {
    case 'gemini':
      yield* streamGemini(config, systemPrompt, trimmed, signal);
      return;
    case 'openai-compatible':
      yield* streamOpenAI(config, systemPrompt, trimmed, signal);
      return;
    default: {
      const exhaustive: never = config.provider;
      throw new LLMError('invalid-config', `Unknown provider: ${exhaustive}`);
    }
  }
}

/** Single-shot non-streaming wrapper. Useful for the BYOK "Test
 *  connection" button — we just want to confirm key + model + endpoint
 *  resolve without spending tokens on a long reply. */
export async function testConnection(config: LLMConfig): Promise<{ ok: true } | { ok: false; error: LLMError }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);
  try {
    let received = '';
    for await (const chunk of streamCompletion(
      config,
      'You are a connectivity-test endpoint. Reply with the exact word OK and nothing else.',
      [{ role: 'user', content: 'ping' }],
      ac.signal,
    )) {
      if (chunk.done) break;
      received += chunk.text;
      if (received.length >= 8) {
        ac.abort(); // got enough, save tokens
        break;
      }
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof LLMError) return { ok: false, error: err };
    return { ok: false, error: new LLMError('unknown', err instanceof Error ? err.message : 'Test failed') };
  } finally {
    clearTimeout(timer);
  }
}

function trimForRequest(messages: LLMMessage[], maxTurns: number): LLMMessage[] {
  if (messages.length <= maxTurns) return messages;
  // Keep the last `maxTurns` messages, but make sure we start on a
  // user turn so the LLM gets a coherent thread.
  let start = messages.length - maxTurns;
  while (start < messages.length && messages[start].role !== 'user') start++;
  return messages.slice(start);
}
