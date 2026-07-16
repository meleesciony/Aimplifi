/**
 * Demo fences on the LLM touchpoints (#242 critic cycle-1 P1-1). The shared demo
 * account must NEVER consult a provider — even on a keyed deployment — because
 * (a) a demo visitor's typed input must not egress under a shared account, and
 * (b) the Trust Center's demo copy states "it never consults a model" as an
 * enforced fact, not a deployment accident. These tests set a FAKE provider key
 * and prove the demo path makes ZERO network calls.
 *
 * Covered here (executed): Ask intent routing, coach review ordering, and
 * `categorizeSuggestFor` — the ONE constructor every categorize path (manual
 * create, CSV import, Plaid sync, SimpleFIN sync, backfill) obtains its suggest
 * function from (#242 cycle-2 F1/F5: per-call-site ternaries missed two sites;
 * centralizing makes one executed test cover all five). balance-move's fence is
 * pre-existing (#240).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';

vi.mock('@/server/authz', () => ({
  requireUserId: async () => DEMO_USER_ID,
  rateLimitDurable: async () => true,
}));

const { askAssistant } = await import('@/server/assistant');
const { getCoachData } = await import('@/server/coach');
const { categorizeSuggestFor } = await import('@/server/categorize-suggest');

const origXai = process.env.XAI_API_KEY;
const origAnthropic = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  // A KEYED deployment — the exact configuration cycle-1's P1-1 was about.
  process.env.XAI_API_KEY = 'xai-fake-key-for-fence-test';
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => {
  if (origXai === undefined) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = origXai;
  if (origAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = origAnthropic;
  vi.restoreAllMocks();
});

describe('test_regression__demo_never_consults_a_model (keyed deployment)', () => {
  it('Ask: an unroutable demo question stays an honest unknown with ZERO provider calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const answer = await askAssistant('what is the damage on my whole situation lately?');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(answer.kind).toBe('unknown');
  });

  it('coach: orderReview for the demo user compiles the deterministic floor with ZERO provider calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const data = await getCoachData(DEMO_USER_ID, { orderReview: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    // The recap still renders — the floor, never a model ordering.
    expect(data.reviewLines.length).toBeGreaterThan(0);
    expect(data.reviewPersonalized).toBe(false);
  });

  it('categorize (all five paths): the demo suggest is a null no-op with ZERO provider calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const suggest = categorizeSuggestFor(DEMO_USER_ID);
    expect(await suggest({ rawDescriptor: 'MYSTERY MERCHANT LLC', amountCents: -1234 })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('categorize: a real user DOES call through (the fence is demo-specific, not a global off-switch)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"categoryId":"coffee","confidence":0.8}' } }] }),
        { status: 200 },
      ),
    );
    const suggest = categorizeSuggestFor('user-fence-real');
    // The audit sink's write fails on the nonexistent user and is swallowed by
    // design — the VALUE path must still work (the fire-wall regression class).
    expect(await suggest({ rawDescriptor: 'LOCAL ROASTERS', amountCents: -650 })).toEqual({
      categoryId: 'coffee',
      confidenceBps: 8000,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
