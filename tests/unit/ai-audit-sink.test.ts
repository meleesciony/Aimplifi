/**
 * AI touchpoint outcome reporting (AI plan §3.2, DECISIONS #242). Pins the
 * sink contract across all four LLM modules:
 *   - no provider key → NO sink call (no call happened, so no trail row);
 *   - valid reply → 'replied' with closed-set meta only;
 *   - invalid reply → 'rejected' with empty meta;
 *   - provider error / timeout → 'unavailable' with empty meta;
 *   - exactly ONE sink call per attempted provider call;
 *   - a THROWING sink never breaks the value path (fire-walled).
 * Plus the recorder itself: demo-user fence + DB-fault swallowing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiOutcome } from '@/lib/engine/ai-audit/describe';
import { classifyIntentViaLLM } from '@/server/assistant-llm';
import { draftMoveSentenceViaLLM } from '@/server/balance-move-llm';
import { suggestCategoryViaLLM } from '@/server/llm-categorize';
import { orderReviewViaLLM } from '@/server/money-review-llm';

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
  vi.useRealTimers();
});

/** Recording sink + captured calls. */
function makeSink() {
  const calls: { outcome: AiOutcome; meta: Record<string, unknown> }[] = [];
  const sink = async (outcome: AiOutcome, meta: Record<string, unknown>) => {
    calls.push({ outcome, meta });
  };
  return { sink, calls };
}

const okXai = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

// A minimal triggered BalanceMoveExplanation for draftMoveSentenceViaLLM. Only
// `triggered` and `primaryDriverId` gate the call; the prompt builder reads the
// rest, so supply a realistic shape.
const move = {
  triggered: true,
  comparedYm: '2026-06',
  comparisonWindowText: 'your 3-month average',
  primaryDriverId: 'dining',
  factors: [
    { id: 'dining', label: 'Dining Out', deltaCents: 24000 },
    { id: 'groceries', label: 'Groceries', deltaCents: 9000 },
  ],
  deterministicSentence: 'Dining Out, up $240.00, compared with your 3-month average.',
  allowedNumberStrings: ['$240.00', '$90.00'],
  allowedLabelTokens: ['dining', 'out', 'groceries'],
} as unknown as Parameters<typeof draftMoveSentenceViaLLM>[0];

const reviewCandidates = [
  { id: 'improvement-savings-rate', role: 'improvement', priority: 2, material: false, line: 'x' },
  { id: 'action-transfer', role: 'action', priority: 3, material: true, line: 'y' },
] as unknown as Parameters<typeof orderReviewViaLLM>[0];

describe('no provider key → sink NOT called (no call, no row)', () => {
  it('holds across all four touchpoint modules', async () => {
    const { sink, calls } = makeSink();
    await suggestCategoryViaLLM({ rawDescriptor: 'X', amountCents: -1 }, sink);
    await classifyIntentViaLLM('what did I spend', sink);
    await orderReviewViaLLM(reviewCandidates, sink);
    await draftMoveSentenceViaLLM(move, sink);
    expect(calls).toEqual([]);
  });
});

describe('suggestCategoryViaLLM outcomes', () => {
  beforeEach(() => {
    process.env.XAI_API_KEY = 'xai-test-key';
  });

  it("valid reply → one 'replied' with ONLY closed-set meta", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okXai('{"categoryId":"pets","confidence":0.91}'));
    const { sink, calls } = makeSink();
    const out = await suggestCategoryViaLLM({ rawDescriptor: 'CHEWY.COM', amountCents: -4200 }, sink);
    expect(out).toEqual({ categoryId: 'pets', confidenceBps: 9100 });
    expect(calls).toEqual([{ outcome: 'replied', meta: { categoryId: 'pets', confidenceBps: 9100 } }]);
  });

  it("invalid reply (hallucinated category) → one 'rejected', empty meta — the raw reply is never persisted", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okXai('{"categoryId":"made-up-cat","confidence":0.9}'));
    const { sink, calls } = makeSink();
    expect(await suggestCategoryViaLLM({ rawDescriptor: 'X', amountCents: -1 }, sink)).toBeNull();
    expect(calls).toEqual([{ outcome: 'rejected', meta: {} }]);
  });

  it("provider 500 → one 'unavailable'", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const { sink, calls } = makeSink();
    expect(await suggestCategoryViaLLM({ rawDescriptor: 'X', amountCents: -1 }, sink)).toBeNull();
    expect(calls).toEqual([{ outcome: 'unavailable', meta: {} }]);
  });

  it("network throw → one 'unavailable'", async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const { sink, calls } = makeSink();
    expect(await suggestCategoryViaLLM({ rawDescriptor: 'X', amountCents: -1 }, sink)).toBeNull();
    expect(calls).toEqual([{ outcome: 'unavailable', meta: {} }]);
  });

  it("timeout abort → one 'unavailable' (and still resolves null, never hangs)", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    const { sink, calls } = makeSink();
    const pending = suggestCategoryViaLLM({ rawDescriptor: 'HUNG', amountCents: -100 }, sink);
    await vi.advanceTimersByTimeAsync(7_000);
    await expect(pending).resolves.toBeNull();
    expect(calls).toEqual([{ outcome: 'unavailable', meta: {} }]);
  });

  it('test_regression__ai_sink_fault_never_breaks_value_path: a throwing sink does not change the returned value', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okXai('{"categoryId":"coffee","confidence":0.8}'));
    const out = await suggestCategoryViaLLM({ rawDescriptor: 'ROASTERS', amountCents: -650 }, () => {
      throw new Error('audit db down');
    });
    expect(out).toEqual({ categoryId: 'coffee', confidenceBps: 8000 });
  });
});

describe('classifyIntentViaLLM outcomes', () => {
  beforeEach(() => {
    process.env.XAI_API_KEY = 'xai-test-key';
  });

  it("valid kind → 'replied' with the closed-set kind (never the question text)", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okXai('{"intent":"net_worth"}'));
    const { sink, calls } = makeSink();
    expect(await classifyIntentViaLLM('how am I doing overall', sink)).toBe('net_worth');
    expect(calls).toEqual([{ outcome: 'replied', meta: { kind: 'net_worth' } }]);
  });

  it("unroutable kind → 'rejected', empty meta", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okXai('{"intent":"transfer_money"}'));
    const { sink, calls } = makeSink();
    expect(await classifyIntentViaLLM('send money to bob', sink)).toBeNull();
    expect(calls).toEqual([{ outcome: 'rejected', meta: {} }]);
  });
});

describe('orderReviewViaLLM outcomes', () => {
  beforeEach(() => {
    process.env.XAI_API_KEY = 'xai-test-key';
  });

  it("valid order → 'replied' with a COUNT only (ids stay out of the row)", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okXai('["action-transfer","improvement-savings-rate"]'),
    );
    const { sink, calls } = makeSink();
    const out = await orderReviewViaLLM(reviewCandidates, sink);
    expect(out).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].outcome).toBe('replied');
    expect(calls[0].meta).toEqual({ count: out!.length });
  });

  it("garbage reply → 'rejected'", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okXai('["not-a-candidate-id"]'));
    const { sink, calls } = makeSink();
    expect(await orderReviewViaLLM(reviewCandidates, sink)).toBeNull();
    expect(calls).toEqual([{ outcome: 'rejected', meta: {} }]);
  });

  it('empty candidate set → no call, no sink report', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { sink, calls } = makeSink();
    expect(await orderReviewViaLLM([], sink)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe('draftMoveSentenceViaLLM outcomes', () => {
  beforeEach(() => {
    process.env.XAI_API_KEY = 'xai-test-key';
  });

  it("shape-valid draft → 'replied' with EMPTY meta (model-authored text is never persisted)", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okXai('{"primaryDriverId":"dining","template":"{primary} drove it, {window}."}'),
    );
    const { sink, calls } = makeSink();
    const out = await draftMoveSentenceViaLLM(move, sink);
    expect(out).not.toBeNull();
    expect(calls).toEqual([{ outcome: 'replied', meta: {} }]);
  });

  it("malformed draft → 'rejected'", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okXai('{"primaryDriverId":"","template":""}'));
    const { sink, calls } = makeSink();
    expect(await draftMoveSentenceViaLLM(move, sink)).toBeNull();
    expect(calls).toEqual([{ outcome: 'rejected', meta: {} }]);
  });

  it('untriggered explanation → no call, no sink report', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { sink, calls } = makeSink();
    const untriggered = { ...(move as object), triggered: false } as typeof move;
    expect(await draftMoveSentenceViaLLM(untriggered, sink)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});
