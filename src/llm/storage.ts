import type { LLMConfig, LLMMessage } from './types';

/**
 * Local persistence for BYOK config and chat history.
 *
 * Security note: we store the user's API key with a light XOR + base64
 * obfuscation. This is NOT encryption — it just keeps the key out of
 * casual `localStorage` inspection by other JS / extensions. BYOK is a
 * trust-the-device model: anyone with physical access to the unlocked
 * device can recover the key.
 */

const CONFIG_KEY = 'zenith_llm_config';
const CHAT_KEY = 'zenith_llm_chat';
const MAX_PERSISTED_MESSAGES = 50;

const OBFUSCATION_PATTERN = 'zenith-fitness-byok';

function obfuscate(s: string): string {
  let xored = '';
  for (let i = 0; i < s.length; i++) {
    xored += String.fromCharCode(s.charCodeAt(i) ^ OBFUSCATION_PATTERN.charCodeAt(i % OBFUSCATION_PATTERN.length));
  }
  // btoa supports only Latin-1, but XOR may produce arbitrary bytes;
  // wrap in encodeURIComponent so multi-byte characters survive.
  return btoa(unescape(encodeURIComponent(xored)));
}

function deobfuscate(s: string): string {
  try {
    const xored = decodeURIComponent(escape(atob(s)));
    let out = '';
    for (let i = 0; i < xored.length; i++) {
      out += String.fromCharCode(xored.charCodeAt(i) ^ OBFUSCATION_PATTERN.charCodeAt(i % OBFUSCATION_PATTERN.length));
    }
    return out;
  } catch {
    return '';
  }
}

export function getLLMConfig(): LLMConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.apiKey || !parsed?.provider || !parsed?.model) return null;
    const apiKey = deobfuscate(parsed.apiKey);
    if (!apiKey) return null;
    return {
      provider: parsed.provider,
      apiKey,
      model: parsed.model,
      endpoint: parsed.endpoint,
    };
  } catch {
    return null;
  }
}

export function setLLMConfig(config: LLMConfig): void {
  const stored = {
    provider: config.provider,
    apiKey: obfuscate(config.apiKey),
    model: config.model,
    endpoint: config.endpoint,
  };
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(stored)); } catch { /* quota? ignore */ }
}

export function clearLLMConfig(): void {
  try { localStorage.removeItem(CONFIG_KEY); } catch { /* ignore */ }
}

export function hasLLMConfig(): boolean {
  return !!getLLMConfig();
}

// ----- Chat history ------------------------------------------------------

export interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** True if this assistant turn ended in an error (so the UI can
   *  render a subtle warning rather than treating it as a normal reply). */
  errorKind?: string;
}

export function getChatHistory(): ChatEntry[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function setChatHistory(entries: ChatEntry[]): void {
  // Trim to last N to keep localStorage tidy. We send fewer than this
  // to the LLM (see service.ts trimForRequest) but the UI can scroll
  // through the full persisted history.
  const trimmed = entries.slice(-MAX_PERSISTED_MESSAGES);
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(trimmed)); } catch { /* ignore */ }
}

export function clearChatHistory(): void {
  try { localStorage.removeItem(CHAT_KEY); } catch { /* ignore */ }
}

/** Convert persisted ChatEntry[] → LLMMessage[] for sending to the
 *  provider. Drops error turns (those are UI-only). */
export function toLLMMessages(entries: ChatEntry[]): LLMMessage[] {
  return entries
    .filter((e) => !e.errorKind)
    .map((e) => ({ role: e.role, content: e.content }));
}
