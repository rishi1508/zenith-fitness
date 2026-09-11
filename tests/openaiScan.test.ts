import { describe, it, expect } from 'vitest';
import { buildOpenAiScanRequest } from '../api/_openaiScan';
import { estimateOpenAiCostUsd, extractOpenAiText, OPENAI_PRICES_USD } from '../api/_openai';
import { SCAN_PROMPT } from '../api/_scanParse';

describe('OpenAI scan request', () => {
  const image = { mimeType: 'image/jpeg', data: 'AAAA' };

  it('keeps the constant prompt in the cacheable prefix and the photo in the input', () => {
    const body = buildOpenAiScanRequest(image, 'dal and rice', { model: 'gpt-5.6-luna' }) as Record<string, unknown>;
    expect(body.model).toBe('gpt-5.6-luna');
    expect(body.instructions).toBe(SCAN_PROMPT);
    const input = body.input as Array<{ content: Array<Record<string, string>> }>;
    expect(input[0].content[0]).toMatchObject({ type: 'input_image', image_url: 'data:image/jpeg;base64,AAAA' });
    expect(input[0].content[1].text).toContain('dal and rice');
    expect(body.reasoning).toEqual({ effort: 'low' });
    expect(body.store).toBe(false);
    expect((body.text as { format: { type: string } }).format.type).toBe('json_schema');
  });

  it('can drop the schema for the retry', () => {
    expect(buildOpenAiScanRequest(image, '', { withSchema: false }).text).toBeUndefined();
  });

  it('prices a typical scan at about a tenth of a cent', () => {
    // 922 image tokens + 2,500 prompt tokens (cached), ~600 out.
    const usd = estimateOpenAiCostUsd({ input_tokens: 3422, input_tokens_details: { cached_tokens: 2500 }, output_tokens: 600 });
    expect(usd).toBeCloseTo((922 * 0.2 + 2500 * 0.02 + 600 * 1.2) / 1e6, 8);
    expect(usd).toBeLessThan(0.0011);
    expect(OPENAI_PRICES_USD.output / OPENAI_PRICES_USD.input).toBeCloseTo(6);
  });

  it('reads the text from either response shape', () => {
    expect(extractOpenAiText({ output_text: '{"items":[]}' })).toBe('{"items":[]}');
    expect(extractOpenAiText({ output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'x' }] }] })).toBe('x');
  });
});
