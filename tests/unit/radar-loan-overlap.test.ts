/**
 * K.7 (DECISIONS #437) — the radar's half of the ownership rule.
 *
 * A loan payment reaches the committed projection from two sources on the ordinary
 * shape: the LOAN OBLIGATION (`selectLoanObligations`, issuer terms) and the DETECTED
 * SCHEDULED ROW (`server/recurring.ts` learns the ACH that pays it). Where C.25
 * (`loanPaymentFlowExclusions`) has PROVEN the row is that same payment, the split
 * drops the row and the obligation carries the money once; where no fact exists, both
 * are expanded and the radar SAYS SO (the #134 residual, narrowed).
 *
 * FAIL-OLD: deleting the `splitLoanCarriedScheduled` call in `server/radar.ts` turns
 * the count test below red (6 events instead of 3) — the WIRING line is locked, not
 * just the pure engine (the H.6 F4 lesson: the three lines that carry a decision had
 * zero coverage and reverted silently).
 */
import { describe, expect, it } from 'vitest';
import { NO_RECURRING_OVERRIDES } from '@/lib/engine/recurring/override';
import { isoDate } from '@/lib/dates';
import { radarFromSnapshot } from '@/server/radar';
import type { CarriedLoanPayment } from '@/lib/engine/loans/duplicate-projection';
import type { FinanceSnapshot } from '@/lib/providers/types';

const TODAY = isoDate('2026-07-25');

/** The checking account the loan payment leaves. */
const CHECKING = {
  id: 'chk',
  name: 'Everyday Checking',
  type: 'CHECKING',
  currentBalanceCents: 1_249_500,
  currency: 'USD',
  provider: 'plaid',
};

/** The demo's auto loan, as the seed (and a Plaid `/liabilities/get` mapper) writes it. */
const AUTO_LOAN = {
  id: 'acct-autoloan',
  name: 'Auto Loan',
  type: 'LOAN',
  currentBalanceCents: -1_430_000,
  currency: 'USD',
  provider: 'plaid',
  minimumPaymentCents: 38500,
  dueDayOfMonth: 5,
};

/** A second loan whose payment no fact covers — the unproven overlap that must still be disclosed. */
const MORTGAGE = {
  id: 'acct-mortgage',
  name: 'Mortgage',
  type: 'LOAN',
  currentBalanceCents: -21_000_000,
  currency: 'USD',
  provider: 'plaid',
  minimumPaymentCents: 41200,
  dueDayOfMonth: 12,
};

/** Exactly what `server/recurring.ts` persists for a detected series on the payment account. */
const DETECTED_AUTO = {
  id: 'sched-loan',
  accountId: 'chk',
  description: 'CARMAX AUTO FINANCE',
  amountCents: -38500,
  nextDate: isoDate('2026-08-05'),
  cadence: 'MONTHLY',
};
const DETECTED_MORTGAGE = {
  id: 'sched-mortgage',
  accountId: 'chk',
  description: 'WELLS FARGO MORTGAGE',
  amountCents: -41200,
  nextDate: isoDate('2026-08-12'),
  cadence: 'MONTHLY',
};

/** The C.25 disclosure fact for the auto loan (canonical pinned in the engine's own test). */
const CARRIED_AUTO: CarriedLoanPayment = {
  canonical: 'Carmax Auto Finance',
  accountId: 'acct-autoloan',
  paymentCents: 38500,
};

function snapWith(opts: {
  loans?: typeof AUTO_LOAN[];
  scheduled?: (typeof DETECTED_AUTO)[];
  carried?: CarriedLoanPayment[];
}): FinanceSnapshot {
  return {
    accounts: [CHECKING, ...(opts.loans ?? [])],
    paymentAccountId: 'chk',
    autopays: [],
    statements: [],
    cardPayments: [],
    transactions: [],
    scheduled: opts.scheduled ?? [],
    balanceSnapshots: [],
    loanPaymentFlowExclusions:
      opts.carried && opts.carried.length > 0
        ? { excludeIds: new Set(), excluded: opts.carried }
        : undefined,
  } as unknown as FinanceSnapshot;
}

const run = (snap: FinanceSnapshot) =>
  radarFromSnapshot(snap, TODAY, NO_RECURRING_OVERRIDES, 90);

/** The loan-amount committed events and the #134 overlap disclosure, pulled out. */
function loanEvents(snap: FinanceSnapshot) {
  const { input, radar } = run(snap);
  return {
    events: input.committedEvents.filter((e) => e.amountCents === -38500),
    mortgageEvents: input.committedEvents.filter((e) => e.amountCents === -41200),
    overlapNote: radar.assumptions.find((a) => a.includes('counted twice')) ?? null,
  };
}

describe('the radar projects a proven loan payment ONCE (K.7 ownership rule)', () => {
  it('suppresses the detected row a C.25 fact proves the obligation carries — 3 events, not 6', () => {
    const { events } = loanEvents(
      snapWith({ loans: [AUTO_LOAN], scheduled: [DETECTED_AUTO], carried: [CARRIED_AUTO] }),
    );
    expect(events).toHaveLength(3);
    // The label is the OBLIGATION's — the detected row's description must not survive a
    // second time under any spelling.
    expect(events.map((e) => e.label)).toEqual(['Auto Loan', 'Auto Loan', 'Auto Loan']);
  });

  it('discloses nothing while the overlap is proven — a stale warning is its own defect', () => {
    const { overlapNote } = loanEvents(
      snapWith({ loans: [AUTO_LOAN], scheduled: [DETECTED_AUTO], carried: [CARRIED_AUTO] }),
    );
    expect(overlapNote).toBeNull();
  });

  it('counts it TWICE, disclosed, while C.25 has no fact (a first month, a one-sided bank)', () => {
    const { events, overlapNote } = loanEvents(
      snapWith({ loans: [AUTO_LOAN], scheduled: [DETECTED_AUTO] }),
    );
    expect(events).toHaveLength(6);
    expect(overlapNote).toContain('counted twice');
  });

  it('keeps disclosing an UNPROVEN overlap after a proven one is suppressed (two loans)', () => {
    // Closing one overlap must never silence the disclosure for another — the check is
    // per surviving row, deliberately not gated on "anything was suppressed".
    const { events, mortgageEvents, overlapNote } = loanEvents(
      snapWith({
        loans: [AUTO_LOAN, MORTGAGE],
        scheduled: [DETECTED_AUTO, DETECTED_MORTGAGE],
        carried: [CARRIED_AUTO],
      }),
    );
    expect(events).toHaveLength(3); // auto loan: proven, once
    expect(mortgageEvents).toHaveLength(6); // mortgage: unproven, twice
    expect(overlapNote).toContain('counted twice');
  });

  it('ABSTAINS on the demo’s own shape — an obligation with no detected row', () => {
    // The seeded demo: obligation yes, detected series no. Nothing is counted twice and
    // the radar must not claim otherwise (this is also the fail-old-stable case — the old
    // categoryId check abstained here too, on a fresh seed).
    const { events, overlapNote } = loanEvents(snapWith({ loans: [AUTO_LOAN] }));
    expect(events).toHaveLength(3);
    expect(overlapNote).toBeNull();
  });
});
