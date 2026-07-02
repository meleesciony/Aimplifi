/**
 * getCashFlowForecast server read-path (#134). The pure forecast.test.ts fixtures can't
 * witness that the demo /forecast actually FOLDS the auto-loan obligation into the balance
 * projection (a loan payment is a loan-due obligation, never a checking scheduled row — so the
 * forecast under-projected checking by $385/mo until this fix). This drives the real read-path
 * against the seeded demo user so a regression that corrupts the loan amount/count/account —
 * which the e2e's text-presence check would miss — fails here (checker P2-C).
 */
import { describe, expect, it } from 'vitest';
import { getCashFlowForecast } from '@/server/forecast';

describe('getCashFlowForecast — auto-loan folded into the demo projection (#134)', () => {
  it('surfaces the Auto Loan payment exactly 3× at −$385 over the 90-day horizon, on the checking projection', async () => {
    const { forecast, accountName } = await getCashFlowForecast('user-demo');

    // Anchored on the seed's designated payment/checking account (business-today pins the demo
    // to 2026-06-10, so the day-5 loan lands 2026-07-05 / 08-05 / 09-05 within 90d).
    expect(accountName).toBe('Everyday Checking');

    const loanEvents = forecast.days
      .flatMap((d) => d.events)
      .filter((e) => e.label === 'Auto Loan');
    expect(loanEvents).toHaveLength(3);
    expect(loanEvents.every((e) => e.amountCents === -38500)).toBe(true);
    expect(loanEvents.map((e) => forecast.days.find((d) => d.events.includes(e))?.date).sort()).toEqual([
      '2026-07-05',
      '2026-08-05',
      '2026-09-05',
    ]);

    // The /forecast view renders `upcoming`; the loan must be there too (the e2e's anchor).
    expect(
      forecast.upcoming.some((e) => e.label === 'Auto Loan' && e.amountCents === -38500),
    ).toBe(true);
  });
});
