/**
 * The one LLM provider selection + round-trip (src/server/llm-provider.ts),
 * extracted from five modules that each carried a copy (2026-07-21 agent review,
 * finding B2).
 *
 * These lock the contract every caller depends on, in one place instead of five:
 *   - no key → `llmProviderConfigured()` is false and NOTHING is fetched (the
 *     zero-credential demo invariant, CLAUDE.md rule 4);
 *   - xAI wins when both keys are present;
 *   - `null` means UNAVAILABLE and an empty string means "the provider replied
 *     with nothing usable" — the callers map those to different audit outcomes
 *     ('unavailable' vs 'rejected'), so collapsing them would silently mislabel
 *     the AI trust ledger.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { llmCompleteText, llmProviderConfigured } from '@/server/llm-provider';

const ORIG_XAI = process.env.XAI_API_KEY;
const ORIG_ANTHROPIC = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  delete process.env.XAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  if (ORIG_XAI === undefined) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = ORIG_XAI;
  if (ORIG_ANTHROPIC === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIG_ANTHROPIC;
  vi.restoreAllMocks();
});

function okJson(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('llmProviderConfigured', () => {
  it('is false with no keys at all', () => {
    expect(llmProviderConfigured()).toBe(false);
  });

  it('is true with either key alone, or both', () => {
    process.env.XAI_API_KEY = 'xai-test';
    expect(llmProviderConfigured()).toBe(true);
    delete process.env.XAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'anthropic-test';
    expect(llmProviderConfigured()).toBe(true);
    process.env.XAI_API_KEY = 'xai-test';
    expect(llmProviderConfigured()).toBe(true);
  });

  it('an EMPTY xAI key does not mask a real Anthropic key', () => {
    // The trap this extraction had to avoid: `XAI ?? ANTHROPIC` keeps the empty
    // string and reports "not configured", stranding a perfectly good key.
    process.env.XAI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = 'anthropic-test';
    expect(llmProviderConfigured()).toBe(true);
  });
});

describe('llmCompleteText — provider selection', () => {
  it('prefers xAI when both keys are set, and passes the prompt + token cap', async () => {
    process.env.XAI_API_KEY = 'xai-test';
    process.env.ANTHROPIC_API_KEY = 'anthropic-test';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(okJson({ choices: [{ message: { content: 'grok says hi' } }] }));

    expect(await llmCompleteText('classify this', 42)).toBe('grok says hi');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('api.x.ai');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer xai-test');
    const body = JSON.parse(String(init.body)) as { max_tokens: number; messages: { content: string }[] };
    expect(body.max_tokens).toBe(42);
    expect(body.messages[0]?.content).toBe('classify this');
  });

  it('falls back to Anthropic when only that key is set (Messages API shape)', async () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-test';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(okJson({ content: [{ text: 'claude ' }, { text: 'says hi' }] }));

    // Multi-block replies are joined, not truncated to the first block.
    expect(await llmCompleteText('classify this', 20)).toBe('claude says hi');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('api.anthropic.com');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('anthropic-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('returns null WITHOUT fetching when no key is set', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await llmCompleteText('classify this', 20)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('llmCompleteText — unavailable vs replied-with-nothing', () => {
  it('a non-OK status is unavailable (null)', async () => {
    process.env.XAI_API_KEY = 'xai-test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    expect(await llmCompleteText('q', 20)).toBeNull();
  });

  it('a network error / abort is unavailable (null), never a throw', async () => {
    process.env.XAI_API_KEY = 'xai-test';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    await expect(llmCompleteText('q', 20)).resolves.toBeNull();
  });

  it('an unparseable body is unavailable (null)', async () => {
    process.env.XAI_API_KEY = 'xai-test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>not json</html>', { status: 200 }));
    expect(await llmCompleteText('q', 20)).toBeNull();
  });

  it('an OK response with no usable text is EMPTY STRING, not null', async () => {
    // The distinction the audit ledger reads: the provider answered (so the call
    // is 'replied'/'rejected' after validation), it just said nothing we can use.
    process.env.XAI_API_KEY = 'xai-test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({ choices: [] }));
    expect(await llmCompleteText('q', 20)).toBe('');

    vi.restoreAllMocks();
    delete process.env.XAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'anthropic-test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({ content: 'not-an-array' }));
    expect(await llmCompleteText('q', 20)).toBe('');
  });
});
