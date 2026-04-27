/**
 * Provider-agnostic LLM types. The two adapter implementations
 * (Gemini, OpenAI-compatible) live under ./providers/ and conform to
 * `streamCompletion` exposed from ../service.ts.
 *
 * BYOK contract: the user provides their own API key, stored locally
 * with light obfuscation (NOT encryption — see ./storage.ts). We never
 * proxy through a server, so traffic goes from the user's device
 * directly to their chosen provider.
 */

export type LLMProviderType = 'gemini' | 'openai-compatible';

export interface LLMConfig {
  provider: LLMProviderType;
  /** User's BYOK key. Stored obfuscated in localStorage. */
  apiKey: string;
  /** Provider-specific model id (e.g. 'gemini-2.5-flash', 'gpt-4o-mini'). */
  model: string;
  /** Custom base URL for OpenAI-compatible providers (Groq, OpenRouter,
   *  LM Studio, vLLM, etc). Ignored for Gemini.
   *  Example: 'https://api.groq.com/openai/v1' */
  endpoint?: string;
}

export type LLMRole = 'user' | 'assistant';

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

/** Streaming-only token chunk. `done = true` is the final sentinel and
 *  carries no text. */
export interface LLMStreamChunk {
  text: string;
  done: boolean;
}

export type LLMErrorKind = 'auth' | 'rate-limit' | 'network' | 'invalid-config' | 'not-found' | 'unknown';

export class LLMError extends Error {
  kind: LLMErrorKind;
  retryAfterMs?: number;
  /** Best-effort raw provider response for debugging. */
  raw?: string;
  constructor(kind: LLMErrorKind, message: string, opts?: { retryAfterMs?: number; raw?: string }) {
    super(message);
    this.name = 'LLMError';
    this.kind = kind;
    this.retryAfterMs = opts?.retryAfterMs;
    this.raw = opts?.raw;
  }
}

/** Suggested model options surfaced in the BYOK setup UI per provider.
 *  Users can override with a custom string — these are just sensible
 *  defaults so most users don't have to look up model IDs. */
export const PROVIDER_PRESETS: Record<LLMProviderType, {
  label: string;
  defaultModel: string;
  models: Array<{ id: string; label: string; hint?: string }>;
  /** Where to get an API key. */
  keyUrl: string;
  /** Optional default endpoint (only meaningful for openai-compatible). */
  defaultEndpoint?: string;
  /** Endpoint suggestions (only for openai-compatible). */
  endpointSuggestions?: Array<{ url: string; label: string; defaultModel: string }>;
}> = {
  gemini: {
    label: 'Google AI Studio (Gemini)',
    defaultModel: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'Recommended — best free-tier quality' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', hint: 'Faster + larger free quota' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', hint: 'Stable older model' },
    ],
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  'openai-compatible': {
    label: 'OpenAI-compatible (OpenAI / Groq / OpenRouter / Local)',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini (OpenAI)' },
      { id: 'gpt-4o', label: 'GPT-4o (OpenAI)' },
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Groq)' },
      { id: 'mistralai/mistral-large-latest', label: 'Mistral Large (Mistral)' },
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat (OpenRouter)' },
    ],
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultEndpoint: 'https://api.openai.com/v1',
    endpointSuggestions: [
      { url: 'https://api.openai.com/v1', label: 'OpenAI', defaultModel: 'gpt-4o-mini' },
      { url: 'https://api.groq.com/openai/v1', label: 'Groq', defaultModel: 'llama-3.3-70b-versatile' },
      { url: 'https://openrouter.ai/api/v1', label: 'OpenRouter', defaultModel: 'deepseek/deepseek-chat' },
      { url: 'http://localhost:1234/v1', label: 'LM Studio (local)', defaultModel: 'llama-3.2-3b-instruct' },
    ],
  },
};
