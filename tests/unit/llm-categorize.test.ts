/**
 * The no-key fallback is the demo-mode invariant: with no ANTHROPIC_API_KEY the
 * LLM client must return null WITHOUT making a network call, so categorization
 * stays fully deterministic. (The live API path can't be exercised without a
 * key; the risky parse/validation is covered in categorize-llm.test.ts.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { suggestCategoryViaLLM } from '@/server/llm-categorize';

describe('suggestCategoryViaLLM — no-key fallback (DECISIONS #38)', () => {
  const original = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
    vi.restoreAllMocks();
  });

  it('returns null and never fetches when no API key is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const out = await suggestCategoryViaLLM({ rawDescriptor: 'UNKNOWN MERCHANT XYZ', amountCents: -1234 });
    expect(out).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null (no throw) when the API errors', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const out = await suggestCategoryViaLLM({ rawDescriptor: 'UNKNOWN MERCHANT XYZ', amountCents: -1234 });
    expect(out).toBeNull();
  });

  it('parses + validates a well-formed API response', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ content: [{ text: '{"categoryId":"software","confidence":0.88}' }] }), {
        status: 200,
      }),
    );
    const out = await suggestCategoryViaLLM({ rawDescriptor: 'FIGMA MONTHLY', amountCents: -1500 });
    expect(out).toEqual({ categoryId: 'software', confidenceBps: 8800 });
  });
});
