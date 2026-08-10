/**
 * getCashFlowForecast server read-path (#134). The pure forecast.test.ts fixtures can't
 * witness that the demo /forecast actually FOLDS the auto-loan obligation into the balance
 * projection (a loan payment is a loan-due obligation, never a checking scheduled row — so the
 * forecast under-projected checking by $385/mo until this fix). This drives the real read-path
 * against the seeded demo user so a regression that corrupts the loan amount/count/account —
 * which the e2e's text-presence check would miss — fails here (checker P2-C).
 */
import { describe, expect, it, vi } from 'vitest';
import { getCashFlowForecast } from '@/server/forecast';
import { resolvePaymentAccount } from '@/server/finance';
import { getProvider } from '@/lib/providers/demo';
import { prisma } from '@/lib/db';

/**
 * Audit P2 — the frozen disclosure must name the account the way the headline
 * does (`accountLabel`: the reader's rename wins over the stored name). The old
 * wiring passed `payment.name`, so a renamed account showed two different names
 * on one card. Armed only for the parity test below; the demo test above stays
 * byte-identical.
 */
const frozenArmed = vi.hoisted(() => ({ armed: false }));
// K.7 (DECISIONS #437): arms the snapshot with BOTH sources of one loan payment — the
// obligation the seed already derives from acct-autoloan, PLUS the detected scheduled row
// `server/recurring.ts` would persist for the ACH that pays it, PLUS the C.25 fact proving
// the row is that payment. The forecast must project the payment ONCE.
const k7Armed = vi.hoisted(() => ({ armed: false }));
vi.mock('@/lib/providers/demo', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/providers/demo')>();
  return {
    ...mod,
    getProvider: () => {
      const p = mod.getProvider();
      return new Proxy(p, {
        get(target, prop, recv) {
          if (prop === 'getFinanceSnapshot') {
            return async (userId: string) => {
              const snap = await target.getFinanceSnapshot(userId);
              if (k7Armed.armed) {
                // The real demo snapshot already carries the obligation (acct-autoloan,
                // minimumPaymentCents 38500, dueDayOfMonth 5). Overlay the detector's side.
                return {
                  ...snap,
                  scheduled: [
                    ...snap.scheduled,
                    {
                      id: 'sched-loan-detected',
                      accountId: snap.paymentAccountId,
                      description: 'CARMAX AUTO FINANCE', // the merchant canonical, as recurring.ts writes it
                      amountCents: -38500,
                      nextDate: '2026-07-05',
                      cadence: 'MONTHLY',
                    },
                  ],
                  loanPaymentFlowExclusions: {
                    excludeIds: new Set<string>(),
                    excluded: [
                      {
                        canonical: 'Carmax Auto Finance',
                        accountId: 'acct-autoloan',
                        paymentCents: 38500,
                      },
                    ],
                  },
                };
              }
              if (!frozenArmed.armed) return snap;
              const paymentId = snap.paymentAccountId;
              return {
                ...snap,
                accounts: snap.accounts.map((a) =>
                  a.id === paymentId
                    ? { ...a, displayName: 'My Renamed Checking', feedDroppedAt: '2026-06-01' }
                    : a,
                ),
              };
            };
          }
          return Reflect.get(target, prop, recv);
        },
      });
    },
  };
});

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

describe('getCashFlowForecast — a detected loan series yields to the obligation (K.7)', () => {
  // The #134 residual, executed for the first time in k7-double-count-probe.mts: with BOTH
  // sources present the projection debited the payment twice a month ($1,155.00 of phantom
  // outflow over 90 days). The obligation owns the payment; the C.25-proven row is dropped.
  // FAIL-OLD: deleting the `splitLoanCarriedScheduled` call in server/forecast.ts turns the
  // count below into 6 — the wiring line is locked, not just the pure engine.
  it('projects the proven payment exactly 3× at −$385.00, under the obligation’s label', async () => {
    k7Armed.armed = true;
    try {
      const { forecast } = await getCashFlowForecast('user-demo');
      const loanAmount = forecast.days
        .flatMap((d) => d.events)
        .filter((e) => e.amountCents === -38500);
      // 3 = the obligation's own cycles; 6 would be the detected row expanding on top.
      expect(loanAmount).toHaveLength(3);
      // Every event is the OBLIGATION's — the detected row's description must not survive.
      expect(loanAmount.map((e) => e.label)).toEqual(['Auto Loan', 'Auto Loan', 'Auto Loan']);
    } finally {
      k7Armed.armed = false;
    }
  });
});

describe('getCashFlowForecast — frozen note names the account the headline names (audit P2)', () => {
  it('uses accountLabel (the reader’s rename), never the stored name', async () => {
    frozenArmed.armed = true;
    try {
      const { accountName, frozenNote } = await getCashFlowForecast('user-demo');
      expect(accountName).toBe('My Renamed Checking');
      expect(frozenNote).not.toBeNull();
      expect(frozenNote).toContain('My Renamed Checking');
      expect(frozenNote).not.toContain('Everyday Checking');
    } finally {
      frozenArmed.armed = false;
    }
  });
});

describe('forecast and cash-needed anchor the SAME account on a savings-only user (audit D1)', () => {
  // The D1 drift: finance.ts's resolver fell back CHECKING → ANY while
  // forecast.ts's inline chain fell back CHECKING → SAVINGS → ANY, so a user
  // with savings + a brokerage (no checking, no designated account) got its
  // cash-needed anchored on the brokerage and its forecast on the savings
  // account — two answers to one question. The forecast now uses the shared
  // resolver; this locks that a savings-only fallback actually lands.
  it('resolvePaymentAccount picks the SAVINGS tier, and the forecast anchors on the same row', async () => {
    const stamp = `${Date.now()}-${process.pid}`;
    const USER = `forecast-d1-${stamp}`;
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const insert = await prisma.account.createMany({
      data: [
        { userId: USER, provider: 'demo', name: 'Rainy-Day Savings', type: 'SAVINGS', currentBalanceCents: 600000 },
        { userId: USER, provider: 'demo', name: 'Vanguard Brokerage', type: 'INVESTMENT', currentBalanceCents: 900000 },
      ],
    });
    expect(insert.count).toBe(2);
    try {
      const snap = await getProvider().getFinanceSnapshot(USER);
      expect(snap.paymentAccountId).toBeNull(); // no designated account — the fallback is under test
      expect(resolvePaymentAccount(snap).id).toBe(
        snap.accounts.find((a) => a.type === 'SAVINGS')!.id,
      );

      const { accountName, forecast } = await getCashFlowForecast(USER);
      expect(accountName).toBe('Rainy-Day Savings');
      expect(forecast.startingBalanceCents).toBe(600000);
    } finally {
      await prisma.user.deleteMany({ where: { id: USER } }); // cascades the two accounts
    }
  });
});
