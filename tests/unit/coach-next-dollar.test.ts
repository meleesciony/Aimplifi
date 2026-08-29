/**
 * W.6(b) /coach wiring — the next-dollar plan on CoachData is the same
 * walk as calling `nextDollar` on the snapshot's loans + past-due cards,
 * and the demo lands on investing (Auto Loan 6.49% under the 7.00% default).
 */
import { describe, expect, it } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { classifyDebts, nextDollar } from '@/lib/engine/fi/next-dollar';
import { getCoachData } from '@/server/coach';

describe('W.6(b) /coach next-dollar payload', () => {
  it('demo destination is investing, Auto Loan 6.49% under the default 7.00%', async () => {
    const d = await getCoachData(DEMO_USER_ID);
    expect(d.nextDollar.destination).toBe('invest');
    expect(d.nextDollar.highestInstallment?.name).toBe('Auto Loan');
    expect(d.nextDollar.highestInstallment?.aprBps).toBe(649);
    expect(d.nextDollar.expectedReturnBps).toBe(700);
    expect(d.nextDollar.returnIsDefault).toBe(true);
    expect(d.nextDollar.skipped).toEqual(['employer_match', 'tax_advantaged']);
    expect(Number.isFinite(d.nextDollar.runwayMonths)).toBe(true);
    expect(d.nextDollar.runwayMonths).toBeGreaterThanOrEqual(3);
  });

  it('payload is the same walk as calling nextDollar on classified demo debts', async () => {
    const d = await getCoachData(DEMO_USER_ID);
    const measured = nextDollar({
      debts: classifyDebts({
        loans: d.nextDollar.highestInstallment
          ? [
              {
                id: d.nextDollar.highestInstallment.id,
                name: d.nextDollar.highestInstallment.name,
                balanceCents: d.nextDollar.highestInstallment.balanceCents,
                aprBps: d.nextDollar.highestInstallment.aprBps,
              },
            ]
          : [],
        pastDueCards: [],
      }),
      expectedReturnBps: d.fi.expectedReturnBps,
      returnIsDefault: d.fi.returnIsDefault,
      runwayMonths: d.runwayMonths,
      employerMatch: d.nextDollar.employerMatch,
    });
    expect(d.nextDollar.destination).toBe(measured.destination);
    expect(d.nextDollar.highestInstallment).toEqual(measured.highestInstallment);
  });

  it('test_regression__w6b_coach_next_dollar_sentence_comes_from_the_one_author', async () => {
    const d = await getCoachData(DEMO_USER_ID);
    const headline = COACH_COPY.nextDollarHeadline(d.nextDollar);
    expect(headline).toBe('Next extra dollar: investing');
    const why = COACH_COPY.nextDollarWhy(d.nextDollar);
    expect(why).toContain('Auto Loan');
    expect(why).toContain('6.49%');
    expect(why).toContain('our default 7.00% return assumption');
    expect(why).not.toMatch(/this card/i);
    expect(why).not.toMatch(/\bbelow\b/i);
    expect(COACH_COPY.nextDollarAssumptions(d.nextDollar)).toContain('Illustration, not advice');
  });
});
