/**
 * DECISIONS #796 — the period savings answer through the REAL server path, on the
 * seeded demo (today 2026-06-10; 18 months of records). The pure tests prove the rule;
 * these prove the wiring, against a figure computed by a DIFFERENT surface:
 *
 *   - "last month" through the period path is byte-identical to the standing answer,
 *     which is the /coach card's stored rate;
 *   - "the last 12 months" is the /coach chart's twelve bars added up (dollars over
 *     dollars), and its derivation panel reconciles.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { askAssistant } from '@/server/assistant';
import { getCoachData } from '@/server/coach';
import { savingsRateBps } from '@/lib/engine/fi/fi';
import { cents } from '@/lib/money';

const DEMO = 'user-demo';
let priorDemoToday: string | undefined;

beforeAll(() => {
  priorDemoToday = process.env.DEMO_TODAY;
  process.env.DEMO_TODAY = '2026-06-10';
  vi.mocked(auth).mockResolvedValue({ user: { id: DEMO } } as never);
});

afterAll(() => {
  if (priorDemoToday === undefined) delete process.env.DEMO_TODAY;
  else process.env.DEMO_TODAY = priorDemoToday;
});

describe('#796 period savings on the demo, through askAssistant', () => {
  it('"last month" through the period path = the standing answer = the /coach card', async () => {
    const standing = await askAssistant("what's my savings rate?");
    const lastMonth = await askAssistant('what was my savings rate last month?');
    const coach = await getCoachData(DEMO);
    expect(coach.flows[coach.flows.length - 1]?.month).toBe('2026-05');
    expect(standing.headlineBps).toBe(coach.currentRateBps);
    expect(lastMonth.headlineBps).toBe(coach.currentRateBps);
    expect(lastMonth.headline.startsWith('Your savings rate in May 2026 was ')).toBe(true);
  });

  it('"the last 12 months" is the /coach chart\'s twelve bars added up, and the panel reconciles', async () => {
    const coach = await getCoachData(DEMO);
    expect(coach.flows.map((f) => f.month)).toEqual([
      '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11',
      '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
    ]);
    const income = coach.flows.reduce((s, f) => s + f.incomeCents, 0);
    const expenses = coach.flows.reduce((s, f) => s + f.expensesCents, 0);
    const answer = await askAssistant('What was my savings rate over the last 12 months?');
    expect(answer.kind).toBe('savings_rate');
    expect(answer.headlineBps).toBe(savingsRateBps(cents(income), cents(expenses)));
    expect(answer.headline.startsWith('Your savings rate from June 2025 to May 2026 was ')).toBe(true);
    expect(answer.trace?.kind).toBe('derivation');
    expect(answer.trace && 'reconciled' in answer.trace && answer.trace.reconciled).toBe(true);
  });

  it('the owner\'s question: "last year" is all of 2025, every month of it on record', async () => {
    const answer = await askAssistant('What was my effective savings rate over last year?');
    expect(answer.kind).toBe('savings_rate');
    expect(answer.headline).toMatch(/^Your savings rate in 2025 was -?\d+\.\d% — you (kept|spent) /);
    expect(answer.facts.slice(3).map((f) => f.label)).toEqual([
      'Jan 2025', 'Feb 2025', 'Mar 2025', 'Apr 2025', 'May 2025', 'Jun 2025',
      'Jul 2025', 'Aug 2025', 'Sep 2025', 'Oct 2025', 'Nov 2025', 'Dec 2025',
    ]);
    expect(answer.intent).toEqual({ kind: 'savings_rate', timeframe: { fromYm: '2025-01', toYm: '2025-12', label: '2025' } });
  });

  it('critic cycle 1 F6: the records cut on the real path — December 2024 is only partly on record, so "since 2024" starts in January 2025', async () => {
    const answer = await askAssistant('what has my savings rate been since 2024?');
    expect(answer.headline).toMatch(
      /^Your records start Dec 12, 2024, so this covers January 2025 to May 2026: your savings rate was -?\d+\.\d% — you (kept|spent) /,
    );
    expect(answer.detail).toContain("June 2026 isn't over yet, so it's left out.");
    expect(answer.facts.slice(3).map((f) => f.label)).toEqual(['2025', '2026 (Jan–May)']);
  });

  it('critic cycle 1 F6: the month in progress on the real path — answered with the last full month, May 2026', async () => {
    const coach = await getCoachData(DEMO);
    const answer = await askAssistant("what's my savings rate this month?");
    expect(answer.headline).toMatch(/^June 2026 isn't over yet, so here is the last full month\. Your savings rate in May 2026 was /);
    expect(answer.headlineBps).toBe(coach.currentRateBps);
  });

  it('a year before the records says so and answers the months that are on record', async () => {
    const answer = await askAssistant('how much did I save in 2023?');
    expect(answer.kind).toBe('savings_rate');
    expect(answer.headline).toMatch(
      /^Your records start [A-Z][a-z]{2} \d{1,2}, 2024, so no full month in 2023 is on record\. Your savings rate from June 2025 to May 2026 was /,
    );
    expect(answer.detail?.startsWith('That is the latest 12 full months on record.')).toBe(true);
  });
});
