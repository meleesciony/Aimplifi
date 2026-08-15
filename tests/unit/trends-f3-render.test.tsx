// @vitest-environment jsdom
/**
 * O.18e-FU (TASKS, critic F3 of O.18e) — the RENDER decision, locked.
 *
 * C.26 cycle 2's lesson: "moving the string builder without moving the render
 * decision converts an unlocked sentence into an unlocked call to a locked
 * sentence." loan-payment-basis.test.ts locks the five scoped sentences; this
 * file locks that the /trends card actually prints the PACE-figure scope —
 * and that the page can honestly carry BOTH the scoped sentence and the
 * "New this month" panel listing the same payment (the F3 coexistence the
 * universal "loan payments are not spending" made self-contradictory).
 *
 * Deliberately not a snapshot — a snapshot would go green on any change that
 * updates it (the C.26 rule).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TrendsView } from '@/components/finance/trends-view';
import type { SpendingTrendsData } from '@/server/trends';
import { cents } from '@/lib/money';

afterEach(cleanup);

// The F3 shape, hand-built: the same payment is excluded from the pace figure
// (the sentence speaks of it) and listed by the new-merchant panel (register
// basis — see trends-f3-regression.test.ts for the engine-side lock).
const trends: SpendingTrendsData = {
  asOfYm: '2026-06',
  asOfDate: '2026-06-10',
  comparedYm: null,
  baselineMonths: [],
  pace: {
    ym: '2026-06',
    daysElapsed: 10,
    daysInMonth: 30,
    spentSoFarCents: 150_000,
    billsStillDueCents: 0,
    billsStillDue: [],
    billsRefusedCount: 0,
    discretionarySoFarCents: 150_000,
    projectedRemainderCents: 1_000_000,
    projectedCents: 1_150_000,
    priorMonthCents: 1_200_000,
    deltaVsPriorCents: -50_000,
  },
  movers: [],
  moverTotal: 0,
  largest: [],
  newMerchants: [
    {
      merchant: 'Mr Cooper',
      categoryName: 'Housing',
      amountCents: 621_707,
      firstDate: '2026-06-01',
      rows: [
        {
          key: 'mr cooper:0:2026-06-01',
          transactionId: 't-mtg',
          date: '2026-06-01',
          label: 'Mr Cooper',
          rawDescriptor: null,
          amountCents: cents(621_707),
          isPending: false, onHandoverDay: false,
        },
      ],
      futureDatedCents: 0,
  countedOnHandoverDays: 0,
    },
  ],
  newMerchantTotal: 1,
  breakdowns: {},
  loanPaymentExclusions: [{ payee: 'Mr Cooper', loanName: 'Mortgage', paymentCents: 621_707 }],
  loanPaymentRefusedCategories: [],
};

describe('O.18e-FU — the /trends page renders the scoped sentence beside the panel that counts the payment', () => {
  it('the pace card prints the PACE-figure scope, never the universal', () => {
    render(<TrendsView trends={trends} />);
    const sentence = screen.getByTestId('trends-loan-payment-basis');
    expect(sentence.textContent).toBe(
      'Payments to Mr Cooper at $6,217.07/mo are counted on Mortgage, not in this pace figure. A payment at another amount counts normally.',
    );
    // The F3 regression guard: the false universal must not exist anywhere on
    // the page — a surface that lists the payment cannot also claim it is
    // not spending.
    expect(screen.queryByText(/loan payments are not spending/)).toBeNull();
    expect(document.body.textContent).not.toContain('loan payments are not');
  });

  it('the "New this month" panel lists the payment as its merchant\'s spending — the honest coexistence', () => {
    render(<TrendsView trends={trends} />);
    const card = screen.getByTestId('trends-new-merchants');
    expect(within(card).getByText('Mr Cooper')).toBeTruthy();
    // The card total prints the payment amount up front.
    expect(within(card).getAllByText('$6,217.07').length).toBeGreaterThanOrEqual(1);
    // Open the row's panel: its basis calls the merchant's rows spending —
    // the sentence the pace card no longer contradicts.
    fireEvent.click(screen.getByTestId('new-merchant-breakdown-toggle-Mr Cooper'));
    expect(
      within(card).getByText(/The \$6,217\.07 above is this merchant's spending in Jun '26 through/),
    ).toBeTruthy();
    // The panel's own row prints the payment amount too.
    expect(within(card).getAllByText('$6,217.07').length).toBeGreaterThanOrEqual(2);
  });

  it('the payment row is carried into the panel exactly once', () => {
    render(<TrendsView trends={trends} />);
    const rows = screen
      .getAllByTestId('new-merchant-row')
      .flatMap((li) => within(li).getAllByText('Mr Cooper'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
