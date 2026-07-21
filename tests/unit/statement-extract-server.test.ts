/**
 * Doc Extractor v1 server layer (DECISIONS #247): the fencing constructor
 * (shared-demo lesson — a visitor's pasted statement must never egress), the
 * scrub-before-egress invariant (the provider request body must never contain
 * an account number), and the action's honest failure paths. Mirrors the
 * ai-demo-fence / llm-categorize test conventions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';

let mockUserId = 'extract-user-1';
let mockRateLimited = false;
vi.mock('@/server/authz', () => ({
  requireUserId: async () => mockUserId,
  auditLog: async () => undefined,
  rateLimitDurable: async () => !mockRateLimited,
}));

const { statementExtractFor } = await import('@/server/statement-extract');
const { extractStatementViaLLM } = await import('@/server/llm-statement-extract');
const { extractStatementDraft } = await import('@/server/card-actions');

const origXai = process.env.XAI_API_KEY;
const origAnthropic = process.env.ANTHROPIC_API_KEY;

/** One xAI-shaped 200 response whose message content is the given JSON string. */
function xaiReply(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

const VALID_REPLY = JSON.stringify({
  fields: [
    { field: 'statementBalance', sourceSpan: 'New balance $1,234.56', confidence: 0.98 },
    { field: 'dueDate', sourceSpan: 'Payment due date 08/10/2026', confidence: 0.96 },
  ],
});

beforeEach(() => {
  mockUserId = 'extract-user-1';
  mockRateLimited = false;
  process.env.XAI_API_KEY = 'xai-fake-key-for-extract-test';
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => {
  if (origXai === undefined) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = origXai;
  if (origAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = origAnthropic;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('test_regression__demo_paste_never_egresses (keyed deployment)', () => {
  it('the demo extract is a null no-op with ZERO provider calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const extract = statementExtractFor(DEMO_USER_ID);
    expect(await extract({ scrubbedText: 'New balance $1,234.56' })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the demo ACTION answers honestly-unavailable with ZERO provider calls', async () => {
    mockUserId = DEMO_USER_ID;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const out = await extractStatementDraft({ text: 'New balance $1,234.56' });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('enter the fields manually');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a real user DOES call through (fence is demo-specific)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(xaiReply(VALID_REPLY));
    const extract = statementExtractFor('extract-user-real');
    const out = await extract({ scrubbedText: 'irrelevant' });
    expect(out?.map((f) => f.field)).toEqual(['statementBalance', 'dueDate']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('extractStatementViaLLM — provider posture', () => {
  it('returns null and never fetches when NO provider key is set', async () => {
    delete process.env.XAI_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await extractStatementViaLLM({ scrubbedText: 'x' })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null (no throw) on a provider error, reporting unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const outcomes: string[] = [];
    const out = await extractStatementViaLLM({ scrubbedText: 'x' }, async (o) => {
      outcomes.push(o);
    });
    expect(out).toBeNull();
    expect(outcomes).toEqual(['unavailable']);
  });

  it('reports rejected when the guardrail discards the reply', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      xaiReply('{"fields":[{"field":"notAField","sourceSpan":"$1.00","confidence":0.9}]}'),
    );
    const outcomes: string[] = [];
    expect(
      await extractStatementViaLLM({ scrubbedText: 'x' }, async (o) => {
        outcomes.push(o);
      }),
    ).toBeNull();
    expect(outcomes).toEqual(['rejected']);
  });

  it('reports replied with a plain COUNT — never spans — in the meta', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(xaiReply(VALID_REPLY));
    const seen: { outcome: string; meta: Record<string, unknown> }[] = [];
    const out = await extractStatementViaLLM({ scrubbedText: 'x' }, async (outcome, meta) => {
      seen.push({ outcome, meta });
    });
    expect(out).toHaveLength(2);
    expect(seen).toEqual([{ outcome: 'replied', meta: { count: 2 } }]);
  });

  it('test_regression__extract_fetch_hang_bounded: a hung provider fetch aborts to null at 7s', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    const pending = extractStatementViaLLM({ scrubbedText: 'x' });
    await vi.advanceTimersByTimeAsync(7_000);
    await expect(pending).resolves.toBeNull();
  });
});

describe('extractStatementDraft — the action', () => {
  it('scrubs account numbers BEFORE egress: the request body never contains them', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(xaiReply('{"fields":[]}'));
    await extractStatementDraft({
      text: 'Account number: 4400 1234 5678 9010\nNew balance $1,234.56',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = String(fetchSpy.mock.calls[0]?.[1]?.body);
    expect(body).not.toContain('4400 1234 5678 9010');
    expect(body).toContain('[removed]');
    expect(body).toContain('New balance $1,234.56');
  });

  it('returns grounded prefill values derived by code from verified spans', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(xaiReply(VALID_REPLY));
    const out = await extractStatementDraft({
      text: 'New balance $1,234.56\nPayment due date 08/10/2026',
    });
    expect(out.ok).toBe(true);
    expect(out.abstained).toEqual([]);
    expect(out.fields?.map((f) => ({ field: f.field, value: f.value }))).toEqual([
      { field: 'statementBalance', value: '1234.56' },
      { field: 'dueDate', value: '2026-08-10' },
    ]);
  });

  it('a span the pasted text does not contain abstains (never a prefill)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(xaiReply(VALID_REPLY));
    const out = await extractStatementDraft({ text: 'Completely unrelated text 08/10/2026' });
    expect(out.ok).toBe(true);
    expect(out.fields).toEqual([]);
    expect(out.abstained).toEqual(['statementBalance', 'dueDate']);
  });

  it('empty and oversized pastes fail honestly without a provider call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect((await extractStatementDraft({ text: '   ' })).error).toContain('Paste your statement');
    expect((await extractStatementDraft({ text: 'x'.repeat(16_001) })).error).toContain(
      'statement summary section',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('an unavailable provider yields the honest manual-entry message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const out = await extractStatementDraft({ text: 'New balance $1,234.56' });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('enter the fields manually');
  });

  it('test_regression__extract_rate_limited: over the per-user limit → honest error, ZERO provider calls (critic cycle-1 P1-4)', async () => {
    mockRateLimited = true;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const out = await extractStatementDraft({ text: 'New balance $1,234.56' });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('enter the fields manually');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
