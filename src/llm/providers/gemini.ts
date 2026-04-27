import type { LLMConfig, LLMMessage, LLMStreamChunk } from '../types';
import { LLMError } from '../types';

/**
 * Google AI Studio (Gemini) streaming provider.
 *
 * Uses the v1beta `:streamGenerateContent` SSE endpoint. Free-tier
 * limits as of early 2026: ~15 RPM / 1500 RPD on Flash, ~5 RPM /
 * ~25 RPD on Pro. We map 401/403 → auth, 429 → rate-limit (with
 * retry-after when present), 5xx → network.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export async function* streamGemini(
  config: LLMConfig,
  systemPrompt: string,
  messages: LLMMessage[],
  signal: AbortSignal,
): AsyncGenerator<LLMStreamChunk> {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(config.apiKey)}`;

  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      maxOutputTokens: 1024,
    },
    // Loose safety settings — coaching content occasionally trips
    // medical/violence filters with default thresholds.
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) return;
    throw new LLMError('network', err instanceof Error ? err.message : 'Network error');
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw mapGeminiError(response.status, text, response.headers.get('retry-after'));
  }
  if (!response.body) throw new LLMError('network', 'No response body from Gemini');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE-style: events separated by blank lines, each event = a
      // single "data: <json>" line.
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = event.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const json = line.slice(6).trim();
        if (!json) continue;
        try {
          const parsed = JSON.parse(json);
          // Gemini occasionally emits prompt-feedback events with no
          // candidates — skip those instead of throwing.
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (typeof text === 'string' && text.length > 0) {
            yield { text, done: false };
          }
          // Surface a finish reason like SAFETY / MAX_TOKENS as a
          // small post-script so the user understands a truncated reply.
          const finish = parsed?.candidates?.[0]?.finishReason;
          if (finish && finish !== 'STOP' && finish !== 'FINISH_REASON_UNSPECIFIED') {
            yield { text: `\n\n_(stopped: ${finish.toLowerCase()})_`, done: false };
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

function mapGeminiError(status: number, body: string, retryAfter: string | null): LLMError {
  // Gemini error body: { error: { code, message, status } }
  let message = body;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error?.message) message = parsed.error.message;
  } catch { /* leave as raw */ }

  if (status === 401 || status === 403) {
    return new LLMError('auth', 'API key was rejected. Re-check it in BYOK settings.', { raw: body });
  }
  if (status === 404) {
    return new LLMError('not-found', `Model not found. Check the model id is valid for your plan.`, { raw: body });
  }
  if (status === 429) {
    const retryAfterMs = parseRetryAfter(retryAfter);
    return new LLMError('rate-limit', 'Free-tier quota hit. Try again in a few minutes.', { retryAfterMs, raw: body });
  }
  if (status >= 500) {
    return new LLMError('network', 'Gemini service error. Try again shortly.', { raw: body });
  }
  return new LLMError('unknown', `Gemini error ${status}: ${message.slice(0, 200)}`, { raw: body });
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const n = Number(header);
  if (Number.isFinite(n)) return n * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}
