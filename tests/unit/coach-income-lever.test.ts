/**
 * P1.4 /coach wiring — the income lever is computed from the same FI card
 * basis `getCoachData` already carries. COACH_COPY is the one author.
 */
import { describe, expect, it } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import {
  INCOME_LEVER_DEFAULT_RAISE_CENTS,
  incomeLever,
} from '@/lib/engine/fi/income-lever';
import { cents } from '@/lib/money';
import { getCoachData } from '@/server/coach';

describe('P1.4 /coach income-lever payload', () => {
  it('demo $10k raise at the card basis moves the date and is one-authored', async () => {
    const d = await getCoachData(DEMO_USER_ID);
    const measured = incomeLever({
      portfolioCents: d.fi.portfolioCents,
      monthlySavingsCents: d.fi.monthlySavingsCents,
      monthlyIncomeCents: d.fi.monthlyIncomeCents,
      realReturnBps: d.fi.projectionReturnBps,
      fiTargetCents: d.fi.fiNumberCents,
      raiseAnnualCents: INCOME_LEVER_DEFAULT_RAISE_CENTS,
    });
    expect(measured.baselineMonths).toBe(d.fi.monthsToFI);
    expect(measured.noIncome).toBe(false);
    expect(measured.rateNonPositive).toBe(false);
    expect(measured.monthsSooner).toBeGreaterThan(0);
    const sentence = COACH_COPY.incomeLever(measured, d.fi.monthlySavingsMonths);
    expect(sentence).not.toBeNull();
    expect(sentence).toContain('$10,000.00/yr raise');
    expect(sentence).toContain('sooner');
    expect(sentence).toContain('Same return and inflation assumptions as Coach');
    expect(sentence).toContain('Illustration, not advice');
    expect(sentence).toContain('Only that share of the raise is treated as extra savings');
    expect(sentence).toContain('average');
    expect(sentence).not.toMatch(/your current /i);
    expect(sentence).not.toMatch(/this card/i);
    expect(sentence).not.toMatch(/\bbelow\b/i);
  });

  it('honest null when the raise does not move the date', () => {
    expect(
      COACH_COPY.incomeLever({
        raiseAnnualCents: cents(1_200_000),
        monthlyRaiseCents: cents(100_000),
        rateBps: 2000,
        extraMonthlySavingsCents: cents(20_000),
        raisedMonthlySavingsCents: cents(120_000),
        baselineMonths: 120,
        raisedMonths: 120,
        monthsSooner: 0,
        newlyReachable: false,
        noIncome: false,
        rateNonPositive: false,
        alreadyThere: false,
      }, 6),
    ).toBeNull();
  });
});
