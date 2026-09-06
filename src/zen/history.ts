/**
 * Zen chat history — localStorage persistence, moved here from
 * `src/llm/storage.ts` (the old BYOK "AI Coach" chat this replaces).
 *
 * Deliberately KEEPS the old key `zenith_llm_chat` rather than the
 * `zenith_zen_chat` name floated in docs/REVAMP_SPEC.md §6, so existing
 * conversations survive the Zen rename instead of silently vanishing —
 * an explicit call for this package. LLM config (BYOK provider/key/
 * model) is dropped entirely: Zen is server-proxied, so there's no key
 * to store client-side.
 */

const CHAT_KEY = 'zenith_llm_chat';
const MAX_PERSISTED_MESSAGES = 50;

export interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** True if this assistant turn ended in an error, so the UI can
   *  render a subtle warning rather than a normal reply bubble. */
  errorKind?: string;
}

export function getChatHistory(): ChatEntry[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Trims to the last `MAX_PERSISTED_MESSAGES` before saving — the UI can
 *  scroll through the full persisted history; the server sees far fewer
 *  (see api/_zenProtocol.ts MAX_MESSAGES). */
export function setChatHistory(entries: ChatEntry[]): void {
  const trimmed = entries.slice(-MAX_PERSISTED_MESSAGES);
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(trimmed)); } catch { /* quota? ignore */ }
}

export function clearChatHistory(): void {
  try { localStorage.removeItem(CHAT_KEY); } catch { /* ignore */ }
}

/** Persisted ChatEntry[] → the plain {role,content}[] shape `askZen()`
 *  sends to the server. Drops error turns (those are UI-only). */
export function toZenMessages(entries: ChatEntry[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return entries.filter((e) => !e.errorKind).map((e) => ({ role: e.role, content: e.content }));
}
