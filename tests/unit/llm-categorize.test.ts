/**
 * Provider selection + the no-key fallback (DECISIONS #38, #64). With no provider
 * key the LLM client returns null WITHOUT a network call (demo-mode invariant);
 * xAI Grok is preferred when XAI_API_KEY is set (cheaper), Anthropic otherwise.
 * The risky parse/validation is covered in categorize-llm.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { suggestCategoryViaLLM } from '@/server/llm-categorize';

describe('suggestCategoryViaLLM — provider selection + graceful fallback', () => {
  const origAnthropic = process.env.ANTHROPIC_API_KEY;
  const origXai = process.env.XAI_API_KEY;
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.XAI_API_KEY;
  });
  afterEach(() => {
    if (origAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = origAnthropic;
    if (origXai === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = origXai;
    vi.restoreAllMocks();
  });

  it('returns null and never fetches when NO provider key is set', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const out = await suggestCategoryViaLLM({ rawDescriptor: 'UNKNOWN MERCHANT XYZ', amountCents: -1234 });
    expect(out).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses xAI Grok (OpenAI shape) when XAI_API_KEY is set, parsing choices[].message.content', async () => {
    process.env.XAI_API_KEY = 'xai-test-key';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"categoryId":"pets","confidence":0.91}' } }] }), {
        status: 200,
      }),
    );
    const out = await suggestCategoryViaLLM({ rawDescriptor: 'CHEWY.COM', amountCents: -4200 });
    expect(out).toEqual({ categoryId: 'pets', confidenceBps: 9100 });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('api.x.ai');
  });

  it('prefers xAI over Anthropic when BOTH keys are set', async () => {
    process.env.XAI_API_KEY = 'xai-test-key';
    process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"categoryId":"coffee","confidence":0.8}' } }] }), {
        status: 200,
      }),
    );
    const out = await suggestCategoryViaLLM({ rawDescriptor: 'LOCAL ROASTERS', amountCents: -650 });
    expect(out).toEqual({ categoryId: 'coffee', confidenceBps: 8000 });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('api.x.ai');
  });

  it('returns null (no throw) when the provider API errors', async () => {
    process.env.XAI_API_KEY = 'xai-test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    expect(await suggestCategoryViaLLM({ rawDescriptor: 'X', amountCents: -1 })).toBeNull();
  });

  it('still supports Anthropic (content[].text) when only ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ content: [{ text: '{"categoryId":"software","confidence":0.88}' }] }), {
        status: 200,
      }),
    );
    expect(await suggestCategoryViaLLM({ rawDescriptor: 'FIGMA MONTHLY', amountCents: -1500 })).toEqual({
      categoryId: 'software',
      confidenceBps: 8800,
    });
  });
});
