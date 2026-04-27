import type { LLMConfig, LLMMessage, LLMStreamChunk } from '../types';
import { LLMError } from '../types';

/**
 * OpenAI-compatible streaming provider. Works with:
 *   - OpenAI (https://api.openai.com/v1)
 *   - Groq (https://api.groq.com/openai/v1)
 *   - OpenRouter (https://openrouter.ai/api/v1)
 *   - LM Studio / vLLM / llama.cpp (http://localhost:.../v1)
 *
 * The user supplies the base URL via `config.endpoint`. We append
 * `/chat/completions`.
 */

const DEFAULT_BASE = 'https://api.openai.com/v1';

export async function* streamOpenAI(
  config: LLMConfig,
  systemPrompt: string,
  messages: LLMMessage[],
  signal: AbortSignal,
): AsyncGenerator<LLMStreamChunk> {
  const base = (config.endpoint || DEFAULT_BASE).replace(/\/+$/, '');
  const url = `${base}/chat/completions`;

  const body = {
    model: config.model,
    stream: true,
    temperature: 0.7,
    top_p: 0.95,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        // OpenRouter expects an HTTP-Referer header for free routes,
        // and recommends an X-Title; harmless for other providers.
        'HTTP-Referer': 'https://zenith.fitness',
        'X-Title': 'Zenith Fitness',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) return;
    throw new LLMError('network', err instanceof Error ? err.message : 'Network error');
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw mapOpenAIError(response.status, text, response.headers.get('retry-after'));
  }
  if (!response.body) throw new LLMError('network', 'No response body from provider');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // OpenAI streams as SSE: "data: <json>\n\n" with sentinel "[DONE]"
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        if (line === 'data: [DONE]') {
          yield { text: '', done: true };
          return;
        }
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6).trim();
        if (!json) continue;
        try {
          const parsed = JSON.parse(json);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            yield { text: delta, done: false };
          }
          const finish = parsed?.choices?.[0]?.finish_reason;
          if (finish && finish !== 'stop' && finish !== null) {
            yield { text: `\n\n_(stopped: ${finish})_`, done: false };
          }
        } catch {
          // ignore partial / non-JSON heartbeats
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }

  yield { text: '', done: true };
}

function mapOpenAIError(status: number, body: string, retryAfter: string | null): LLMError {
  let message = body;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error?.message) message = parsed.error.message;
    else if (typeof parsed?.error === 'string') message = parsed.error;
  } catch { /* leave as raw */ }

  if (status === 401 || status === 403) {
    return new LLMError('auth', 'API key was rejected. Re-check it in BYOK settings.', { raw: body });
  }
  if (status === 404) {
    return new LLMError('not-found', `Endpoint or model not found. Check your endpoint URL and model id.`, { raw: body });
  }
  if (status === 429) {
    const retryAfterMs = parseRetryAfter(retryAfter);
    return new LLMError('rate-limit', 'Provider rate limit hit. Try again in a moment.', { retryAfterMs, raw: body });
  }
  if (status >= 500) {
    return new LLMError('network', 'Provider service error. Try again shortly.', { raw: body });
  }
  return new LLMError('unknown', `${status}: ${message.slice(0, 200)}`, { raw: body });
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const n = Number(header);
  if (Number.isFinite(n)) return n * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}
