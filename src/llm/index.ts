// Public LLM API. Components import from here, not from the internal
// providers/ subdir or storage.ts directly.
export type { LLMConfig, LLMMessage, LLMStreamChunk, LLMProviderType, LLMRole } from './types';
export { LLMError, PROVIDER_PRESETS } from './types';
export { streamCompletion, testConnection } from './service';
export {
  getLLMConfig, setLLMConfig, clearLLMConfig, hasLLMConfig,
  getChatHistory, setChatHistory, clearChatHistory, toLLMMessages,
  type ChatEntry,
} from './storage';
export { buildSystemPrompt, quickPrompts } from './prompts';
