import { describe, it, expect } from 'vitest';
import { buildOpenAiChatRequest } from '../api/_openaiChat';

describe('OpenAI chat fallback request', () => {
  it('carries Zen\'s system turn as instructions and the conversation as input', () => {
    const body = buildOpenAiChatRequest('You are Zen. Today is Fri.', [
      { role: 'user', content: 'How was my week?' },
      { role: 'assistant', content: 'Strong.' },
      { role: 'user', content: 'And volume?' },
    ], { model: 'gpt-5.6-luna', maxOutputTokens: 1500 }) as Record<string, unknown>;
    expect(body.model).toBe('gpt-5.6-luna');
    expect(body.instructions).toBe('You are Zen. Today is Fri.');
    expect(body.input).toEqual([
      { role: 'user', content: 'How was my week?' },
      { role: 'assistant', content: 'Strong.' },
      { role: 'user', content: 'And volume?' },
    ]);
    expect(body.reasoning).toEqual({ effort: 'low' });
    expect(body.max_output_tokens).toBe(1500);
    expect(body.store).toBe(false);
    expect(body.text).toBeUndefined();
  });
});
