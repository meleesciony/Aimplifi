/**
 * Ask Aimplifi — LLM classifier provider selection + no-key fallback (DECISIONS
 * #75, mirrors llm-categorize.test.ts). With no provider key it returns null
 * WITHOUT a network call (the zero-credential demo invariant); the model is only
 * ever asked to pick a KIND, validated before use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyIntentViaLLM } from '@/server/assistant-llm';

describe('classifyIntentViaLLM — provider selection + graceful fallback', () => {
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
    expect(await classifyIntentViaLLM('what should I do with my money')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses xAI Grok and extracts a valid routable kind', async () => {
    process.env.XAI_API_KEY = 'xai-test-key';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"intent":"net_worth"}' } }] }), { status: 200 }));
    expect(await classifyIntentViaLLM('how am I doing overall')).toBe('net_worth');
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('api.x.ai');
  });

  it('rejects a hallucinated / non-routable kind', async () => {
    process.env.XAI_API_KEY = 'xai-test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"intent":"transfer_money"}' } }] }), { status: 200 }));
    expect(await classifyIntentViaLLM('send money to bob')).toBeNull();
  });

  it('returns null (no throw) when the provider API errors', async () => {
    process.env.XAI_API_KEY = 'xai-test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    expect(await classifyIntentViaLLM('x')).toBeNull();
  });
});
