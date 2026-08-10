/**
 * C.25 (DECISIONS #403) — a linked loan payment is one payee classified two
 * ways month by month, because `countsInFlows` keys off the stored
 * `isTransfer` and the stored flag is a ±3-day same-amount coincidence at
 * sync time. Measured live on the owner's $6,217.07 Truist mortgage: paired
 * in May/Jun (flagged → out of the flows), unpaired in Apr (no counterpart)
 * and Jul (4-day settlement) → counted as ordinary spending in half his
 * months. The sync-time fix was built, gated green, and REVERTED (#400):
 * merchant identity is not specific enough to WRITE on, and nothing undoes
 * it. This slice moves the exclusion to READ time with four gates — the
 * money leaves a flow sum only where "it is carried elsewhere" is CHECKED
 * (a dateable obligation on the linked loan account at the row's own
 * amount). Hand-verified values in docs/EDGE_CASES.md §C.25.
 */
import { describe, expect, it } from 'vitest';
import {
  loanPaymentFlowExclusions,
  type LoanPaymentFlowExclusionInput,
} from '@/lib/engine/categorize/loan-payment-flows';
import { countsInFlows, monthlyFlows, type TxnLike } from '@/lib/engine/fi/insights';
import { answerMerchantSpend, merchantSpend, type AskTxnRow } from '@/lib/engine/assistant/answer';

/** Fixture rows are POSTED unless the fixture is ABOUT another status. */
function row(r: {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
  status?: string;
  isSplitParent?: boolean;
  excludeFromTotals?: boolean | null;
}) {
  return { status: 'POSTED', ...r };
}

// ── fixture A: the owner shape ─────────────────────────────────────────────
// chk outflows −621707 on 04-03 (unflagged, no counterpart), 05-04 (pairs at
// 1 day), 06-03 (pairs), 07-06 (counterpart 4 days out → NO pair). Loan
// inflows +621707 on 05-05, 06-04, 07-10. Obligation: 621707, due day 1.
const A_ROWS = [
  row({ id: 't-apr', accountId: 'chk', date: '2026-04-03', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT' }),
  row({ id: 't-may', accountId: 'chk', date: '2026-05-04', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT' }),
  row({ id: 't-jun', accountId: 'chk', date: '2026-06-03', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT' }),
  row({ id: 't-jul', accountId: 'chk', date: '2026-07-06', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT' }),
  // control rows: payroll + groceries, every month
  row({ id: 'pay-apr', accountId: 'chk', date: '2026-04-01', amountCents: 500_000, rawDescriptor: 'PAYROLL ACME' }),
  row({ id: 'pay-may', accountId: 'chk', date: '2026-05-01', amountCents: 500_000, rawDescriptor: 'PAYROLL ACME' }),
  row({ id: 'pay-jun', accountId: 'chk', date: '2026-06-01', amountCents: 500_000, rawDescriptor: 'PAYROLL ACME' }),
  row({ id: 'pay-jul', accountId: 'chk', date: '2026-07-01', amountCents: 500_000, rawDescriptor: 'PAYROLL ACME' }),
  row({ id: 'gro-apr', accountId: 'chk', date: '2026-04-15', amountCents: -10_000, rawDescriptor: 'GROCERY STORE 101' }),
  row({ id: 'gro-may', accountId: 'chk', date: '2026-05-15', amountCents: -10_000, rawDescriptor: 'GROCERY STORE 101' }),
  row({ id: 'gro-jun', accountId: 'chk', date: '2026-06-15', amountCents: -10_000, rawDescriptor: 'GROCERY STORE 101' }),
  row({ id: 'gro-jul', accountId: 'chk', date: '2026-07-15', amountCents: -10_000, rawDescriptor: 'GROCERY STORE 101' }),
];
const A_INFLOW_DATES = ['2026-05-05', '2026-06-04', '2026-07-10'];
const A_TYPES = new Map([['chk', 'CHECKING'], ['mtg', 'MORTGAGE']]);

function fixtureA(overrides: Partial<LoanPaymentFlowExclusionInput> = {}): LoanPaymentFlowExclusionInput {
  return {
    rows: A_ROWS,
    loanInflows: A_INFLOW_DATES.map((date, i) => ({ id: `in-${i}`, accountId: 'mtg', date, amountCents: 621_707 })),
    accountTypeById: A_TYPES,
    obligations: [{ accountId: 'mtg', paymentCents: 621_707 }],
    ...overrides,
  };
}

function toTxn(row: (typeof A_ROWS)[number], isTransfer = false): TxnLike {
  return { ...row, isTransfer, status: 'POSTED', categoryId: null };
}

describe('C.25 — loanPaymentFlowExclusions (the four gates)', () => {
  it('fixture A: every $6,217.07 month leaves the flows, including the unflagged ones', () => {
    const { excludeIds } = loanPaymentFlowExclusions(fixtureA());
    expect(excludeIds.has('t-apr')).toBe(true);
    expect(excludeIds.has('t-may')).toBe(true);
    expect(excludeIds.has('t-jun')).toBe(true);
    expect(excludeIds.has('t-jul')).toBe(true);
    // control rows never leave
    for (const id of ['pay-apr', 'gro-apr', 'gro-may', 'gro-jun', 'gro-jul']) {
      expect(excludeIds.has(id)).toBe(false);
    }
  });

  it('fixture A: month totals stop depending on settlement timing', () => {
    const { excludeIds } = loanPaymentFlowExclusions(fixtureA());
    const txns = [
      toTxn(A_ROWS[0]),
      toTxn(A_ROWS[1], true), // stored flag, as May/Jun carry it today
      toTxn(A_ROWS[2], true),
      toTxn(A_ROWS[3]),
      ...A_ROWS.slice(4).map((r) => toTxn(r)),
    ];
    const flows = monthlyFlows(txns, excludeIds);
    expect(flows).toHaveLength(4);
    for (const f of flows) {
      expect(f.expensesCents).toBe(10_000); // groceries only, all four months
      expect(f.incomeCents).toBe(500_000);
      expect(f.savingsRateBps).toBe(9_800);
    }
    // and without the exclusion the defect reproduces: Apr/Jul carry the mortgage
    const broken = monthlyFlows(txns);
    expect(broken.find((f) => f.month === '2026-04')?.expensesCents).toBe(631_707);
    expect(broken.find((f) => f.month === '2026-05')?.expensesCents).toBe(10_000);
    expect(broken.find((f) => f.month === '2026-07')?.expensesCents).toBe(631_707);
  });

  it('fixture A: the disclosure facts name the obligation, one entry per merchant', () => {
    const { excluded } = loanPaymentFlowExclusions(fixtureA());
    expect(excluded).toHaveLength(1);
    expect(excluded[0]).toMatchObject({ accountId: 'mtg', paymentCents: 621_707 });
    expect(typeof excluded[0].canonical).toBe('string');
    expect(excluded[0].canonical.length).toBeGreaterThan(0);
  });

  it('fixture B: a generic descriptor excludes ONLY the obligation amount (P0-1 of #400)', () => {
    const rows = [
      row({ id: 'loanpay-may', accountId: 'chk', date: '2026-05-15', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'loanpay-jun', accountId: 'chk', date: '2026-06-15', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'rent', accountId: 'chk', date: '2026-06-01', amountCents: -190_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'electric', accountId: 'chk', date: '2026-06-12', amountCents: -22_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'internet', accountId: 'chk', date: '2026-06-14', amountCents: -9_500, rawDescriptor: 'ONLINE PAYMENT' }),
    ];
    const { excludeIds } = loanPaymentFlowExclusions({
      rows,
      loanInflows: [
        { id: 'in-1', accountId: 'auto', date: '2026-05-16', amountCents: 45_000 },
        { id: 'in-2', accountId: 'auto', date: '2026-06-16', amountCents: 45_000 },
      ],
      accountTypeById: new Map([['chk', 'CHECKING'], ['auto', 'LOAN']]),
      obligations: [{ accountId: 'auto', paymentCents: 45_000 }],
    });
    expect(excludeIds.has('loanpay-may')).toBe(true);
    expect(excludeIds.has('loanpay-jun')).toBe(true);
    expect(excludeIds.has('rent')).toBe(false);
    expect(excludeIds.has('electric')).toBe(false);
    expect(excludeIds.has('internet')).toBe(false);
  });

  it('fixture C: one coincidence never classifies a payee (P0-2 of #400)', () => {
    const rows = [
      row({ id: 'roof', accountId: 'chk', date: '2026-06-17', amountCents: -621_707, rawDescriptor: 'ABC ROOFING & SIDING' }),
      row({ id: 'mtg-jul', accountId: 'chk', date: '2026-07-17', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT' }),
    ];
    const { excludeIds } = loanPaymentFlowExclusions({
      rows,
      loanInflows: [
        { id: 'in-1', accountId: 'mtg', date: '2026-06-18', amountCents: 621_707 },
        { id: 'in-2', accountId: 'mtg', date: '2026-07-18', amountCents: 621_707 },
      ],
      accountTypeById: A_TYPES,
      obligations: [{ accountId: 'mtg', paymentCents: 621_707 }],
    });
    // roofing paired ONCE → not a loan-payment merchant → the invoice stays
    expect(excludeIds.has('roof')).toBe(false);
    // a first-payment mortgage has one paired month → visible until the second lands
    expect(excludeIds.has('mtg-jul')).toBe(false);
  });

  it('fixture D: a SimpleFIN loan (no obligation fields) excludes nothing', () => {
    const { excludeIds } = loanPaymentFlowExclusions(fixtureA({ obligations: [] }));
    expect(excludeIds.size).toBe(0);
  });

  it('fixture E: an undatable loan is a refusal, handled by the caller (no obligation in, no exclusion out)', () => {
    // selectLoanObligations refuses dueDayOfMonth=null upstream; the engine
    // contract is: no obligation for the account → no exclusion, ever.
    const { excludeIds, excluded } = loanPaymentFlowExclusions(
      fixtureA({ obligations: [{ accountId: 'other-loan', paymentCents: 621_707 }] }),
    );
    expect(excludeIds.size).toBe(0);
    expect(excluded).toHaveLength(0);
  });

  it('fixture F: an escrow-adjusted amount stays visible; the plain months stay excluded', () => {
    const rows = [
      ...A_ROWS.slice(0, 4),
      row({ id: 't-aug', accountId: 'chk', date: '2026-08-04', amountCents: -650_000, rawDescriptor: 'TRUIST MORTG OL B MTGPMT' }),
    ];
    const { excludeIds } = loanPaymentFlowExclusions(
      fixtureA({
        rows,
        loanInflows: [
          ...fixtureA().loanInflows,
          { id: 'in-aug', accountId: 'mtg', date: '2026-08-05', amountCents: 650_000 },
        ],
      }),
    );
    expect(excludeIds.has('t-aug')).toBe(false); // 650000 ≠ obligation 621707
    expect(excludeIds.has('t-apr')).toBe(true);
    expect(excludeIds.has('t-jul')).toBe(true);
  });

  it('fixture G: an aggregate canonical is never a loan-payment merchant', () => {
    const rows = [
      row({ id: 'chk-may', accountId: 'chk', date: '2026-05-10', amountCents: -621_707, rawDescriptor: 'CHECK 1041' }),
      row({ id: 'chk-jun', accountId: 'chk', date: '2026-06-10', amountCents: -621_707, rawDescriptor: 'CHECK 1042' }),
    ];
    const { excludeIds } = loanPaymentFlowExclusions({
      rows,
      loanInflows: [
        { id: 'in-1', accountId: 'mtg', date: '2026-05-11', amountCents: 621_707 },
        { id: 'in-2', accountId: 'mtg', date: '2026-06-11', amountCents: 621_707 },
      ],
      accountTypeById: A_TYPES,
      obligations: [{ accountId: 'mtg', paymentCents: 621_707 }],
    });
    expect(excludeIds.size).toBe(0);
  });

  it('boundary: two pairs inside ONE calendar month count as one distinct month', () => {
    const rows = [
      row({ id: 'm-1', accountId: 'chk', date: '2026-05-02', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT' }),
      row({ id: 'm-2', accountId: 'chk', date: '2026-05-20', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT' }),
    ];
    const { excludeIds } = loanPaymentFlowExclusions({
      rows,
      loanInflows: [
        { id: 'in-1', accountId: 'mtg', date: '2026-05-03', amountCents: 621_707 },
        { id: 'in-2', accountId: 'mtg', date: '2026-05-21', amountCents: 621_707 },
      ],
      accountTypeById: A_TYPES,
      obligations: [{ accountId: 'mtg', paymentCents: 621_707 }],
    });
    expect(excludeIds.size).toBe(0);
  });

  it('gate 1: split-parent, reader-excluded and non-cash rows never enter the set; PENDING rows DO (critic P2-1)', () => {
    const { excludeIds } = loanPaymentFlowExclusions(
      fixtureA({
        rows: [
          // PENDING is ADMITTED: isSpendRow-basis surfaces count pending, so a
          // payment that left only at post would move the total mid-month —
          // the instability class this module exists to kill. countsInFlows
          // surfaces never count pending anyway, so nothing changes there.
          row({ id: 'pending', accountId: 'chk', date: '2026-04-03', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT', status: 'PENDING' }),
          row({ id: 'split', accountId: 'chk', date: '2026-04-03', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT', isSplitParent: true }),
          row({ id: 'excl', accountId: 'chk', date: '2026-04-03', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT', excludeFromTotals: true }),
          row({ id: 'card', accountId: 'cc', date: '2026-04-03', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT' }),
          ...A_ROWS.slice(1, 3), // keep eligibility alive via May/Jun pairs
        ],
        accountTypeById: new Map([['chk', 'CHECKING'], ['mtg', 'MORTGAGE'], ['cc', 'CREDIT']]),
      }),
    );
    expect(excludeIds.has('pending')).toBe(true);
    for (const id of ['split', 'excl', 'card']) expect(excludeIds.has(id)).toBe(false);
  });

  it('critic P1-3: one canonical paying TWO loans — the undatable loan keeps its money visible', () => {
    // Bank stamps every ACH alike (the gate-4 world): one canonical pays a
    // dateable auto loan AND an undatable SimpleFIN loan, both $450.
    const rows = [
      row({ id: 'may-l1', accountId: 'chk', date: '2026-05-15', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'jun-l1', accountId: 'chk', date: '2026-06-15', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'may-l2', accountId: 'chk', date: '2026-05-20', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'jun-l2', accountId: 'chk', date: '2026-06-20', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'apr-ambiguous', accountId: 'chk', date: '2026-04-15', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
    ];
    const { excludeIds } = loanPaymentFlowExclusions({
      rows,
      loanInflows: [
        { id: 'in-l1-may', accountId: 'auto', date: '2026-05-16', amountCents: 45_000 },
        { id: 'in-l1-jun', accountId: 'auto', date: '2026-06-16', amountCents: 45_000 },
        { id: 'in-l2-may', accountId: 'student', date: '2026-05-21', amountCents: 45_000 },
        { id: 'in-l2-jun', accountId: 'student', date: '2026-06-21', amountCents: 45_000 },
      ],
      accountTypeById: new Map([['chk', 'CHECKING'], ['auto', 'LOAN'], ['student', 'LOAN']]),
      // auto loan is dateable; the SimpleFIN student loan has no obligation
      obligations: [{ accountId: 'auto', paymentCents: 45_000 }],
    });
    expect(excludeIds.has('may-l1')).toBe(true); // attributed to the dateable loan
    expect(excludeIds.has('jun-l1')).toBe(true);
    expect(excludeIds.has('may-l2')).toBe(false); // attributed to the undatable loan → visible
    expect(excludeIds.has('jun-l2')).toBe(false);
    expect(excludeIds.has('apr-ambiguous')).toBe(false); // could be either loan → visible
  });

  it('critic P1-3 control: when BOTH loans are dateable, the ambiguous month may leave', () => {
    const rows = [
      row({ id: 'may-l1', accountId: 'chk', date: '2026-05-15', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'jun-l1', accountId: 'chk', date: '2026-06-15', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'may-l2', accountId: 'chk', date: '2026-05-20', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'jun-l2', accountId: 'chk', date: '2026-06-20', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'apr-ambiguous', accountId: 'chk', date: '2026-04-15', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
    ];
    const { excludeIds } = loanPaymentFlowExclusions({
      rows,
      loanInflows: [
        { id: 'in-l1-may', accountId: 'auto', date: '2026-05-16', amountCents: 45_000 },
        { id: 'in-l1-jun', accountId: 'auto', date: '2026-06-16', amountCents: 45_000 },
        { id: 'in-l2-may', accountId: 'student', date: '2026-05-21', amountCents: 45_000 },
        { id: 'in-l2-jun', accountId: 'student', date: '2026-06-21', amountCents: 45_000 },
      ],
      accountTypeById: new Map([['chk', 'CHECKING'], ['auto', 'LOAN'], ['student', 'LOAN']]),
      obligations: [
        { accountId: 'auto', paymentCents: 45_000 },
        { accountId: 'student', paymentCents: 45_000 },
      ],
    });
    expect(excludeIds.has('may-l1')).toBe(true);
    expect(excludeIds.has('jun-l2')).toBe(true);
    expect(excludeIds.has('apr-ambiguous')).toBe(true); // every linked account can project
  });

  it('critic P2-1: PENDING rows never serve as pairing evidence', () => {
    // Two "pair months", but one is pending-only evidence: a pending row can
    // settle as a different row, so it must not classify the merchant.
    const rows = [
      row({ id: 'may-posted', accountId: 'chk', date: '2026-05-04', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT' }),
      row({ id: 'jun-pending', accountId: 'chk', date: '2026-06-03', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT', status: 'PENDING' }),
    ];
    const { excludeIds } = loanPaymentFlowExclusions({
      rows,
      loanInflows: [
        { id: 'in-may', accountId: 'mtg', date: '2026-05-05', amountCents: 621_707 },
        { id: 'in-jun', accountId: 'mtg', date: '2026-06-04', amountCents: 621_707 },
      ],
      accountTypeById: A_TYPES,
      obligations: [{ accountId: 'mtg', paymentCents: 621_707 }],
    });
    // one POSTED pair month only → not eligible → nothing excluded
    expect(excludeIds.size).toBe(0);
  });

  it('critic cycle-2 P1-A: a row paired with BOTH an eligible and an ineligible loan stays visible', () => {
    // Adjacent-day inflows mean EVERY outflow pairs with BOTH loans. The
    // student loan cannot project, so no row'\''s money is checked anywhere
    // — the ambiguity doctrine keeps them all visible, even at the cost of
    // double-showing the auto payment (visible beats vanished, #400).
    const rows = [
      row({ id: 'may-a', accountId: 'chk', date: '2026-05-15', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'may-b', accountId: 'chk', date: '2026-05-17', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'jun-a', accountId: 'chk', date: '2026-06-15', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'jun-b', accountId: 'chk', date: '2026-06-17', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
    ];
    const { excludeIds } = loanPaymentFlowExclusions({
      rows,
      loanInflows: [
        { id: 'in-auto-may', accountId: 'auto', date: '2026-05-16', amountCents: 45_000 },
        { id: 'in-stu-may', accountId: 'student', date: '2026-05-18', amountCents: 45_000 },
        { id: 'in-auto-jun', accountId: 'auto', date: '2026-06-16', amountCents: 45_000 },
        { id: 'in-stu-jun', accountId: 'student', date: '2026-06-18', amountCents: 45_000 },
      ],
      accountTypeById: new Map([['chk', 'CHECKING'], ['auto', 'LOAN'], ['student', 'LOAN']]),
      obligations: [{ accountId: 'auto', paymentCents: 45_000 }],
    });
    expect(excludeIds.size).toBe(0);
  });

  it('critic cycle-2 P1-B: same-amount RENT under a generic canonical — only the carried count leaves', () => {
    // The bank stamps every ACH alike, and the rent equals the auto payment.
    // The loan payment pairs; the rent (on the 1st) does not. Exactly the
    // carried count — ONE $450 — may leave; the rent stays visible.
    const rows = [
      row({ id: 'loanpay-may', accountId: 'chk', date: '2026-05-15', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'rent-may', accountId: 'chk', date: '2026-05-01', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'loanpay-jun', accountId: 'chk', date: '2026-06-15', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
    ];
    const { excludeIds } = loanPaymentFlowExclusions({
      rows,
      loanInflows: [
        { id: 'in-may', accountId: 'auto', date: '2026-05-16', amountCents: 45_000 },
        { id: 'in-jun', accountId: 'auto', date: '2026-06-16', amountCents: 45_000 },
      ],
      accountTypeById: new Map([['chk', 'CHECKING'], ['auto', 'LOAN']]),
      obligations: [{ accountId: 'auto', paymentCents: 45_000 }],
    });
    expect(excludeIds.has('loanpay-may')).toBe(true); // attributed, within capacity
    expect(excludeIds.has('rent-may')).toBe(false); // capacity 1 already spent
    expect(excludeIds.has('loanpay-jun')).toBe(true);
  });

  it('critic cycle-2 P1-B variant: even when the rent COINCIDENTALLY pairs, exactly one unit leaves', () => {
    const rows = [
      row({ id: 'rent-may', accountId: 'chk', date: '2026-05-14', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'loanpay-may', accountId: 'chk', date: '2026-05-15', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
      row({ id: 'loanpay-jun', accountId: 'chk', date: '2026-06-15', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT' }),
    ];
    const { excludeIds } = loanPaymentFlowExclusions({
      rows,
      loanInflows: [
        { id: 'in-may', accountId: 'auto', date: '2026-05-16', amountCents: 45_000 },
        { id: 'in-jun', accountId: 'auto', date: '2026-06-16', amountCents: 45_000 },
      ],
      accountTypeById: new Map([['chk', 'CHECKING'], ['auto', 'LOAN']]),
      obligations: [{ accountId: 'auto', paymentCents: 45_000 }],
    });
    // One inflow ⇒ one carried unit ⇒ exactly one of the two May rows
    // leaves, whichever the deterministic order picks. The invariant is on
    // the SUM: no month loses more than the loan side provably carries.
    const mayExcluded = ['rent-may', 'loanpay-may'].filter((id) => excludeIds.has(id));
    expect(mayExcluded).toHaveLength(1);
    expect(excludeIds.has('loanpay-jun')).toBe(true);
  });

  it('capacity cap: two unattributed rows against ONE inflow — exactly one leaves (the owner-July shape)', () => {
    const rows = [
      row({ id: 't-may', accountId: 'chk', date: '2026-05-04', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT' }),
      row({ id: 't-jun', accountId: 'chk', date: '2026-06-03', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT' }),
      row({ id: 'jul-1', accountId: 'chk', date: '2026-07-04', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT' }),
      row({ id: 'jul-2', accountId: 'chk', date: '2026-07-05', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT' }),
    ];
    const { excludeIds } = loanPaymentFlowExclusions({
      rows,
      loanInflows: [
        { id: 'in-may', accountId: 'mtg', date: '2026-05-05', amountCents: 621_707 },
        { id: 'in-jun', accountId: 'mtg', date: '2026-06-04', amountCents: 621_707 },
        { id: 'in-jul', accountId: 'mtg', date: '2026-07-10', amountCents: 621_707 },
      ],
      accountTypeById: A_TYPES,
      obligations: [{ accountId: 'mtg', paymentCents: 621_707 }],
    });
    expect(excludeIds.has('t-may')).toBe(true);
    expect(excludeIds.has('t-jun')).toBe(true);
    const julExcluded = ['jul-1', 'jul-2'].filter((id) => excludeIds.has(id));
    expect(julExcluded).toHaveLength(1); // one inflow ⇒ one carried unit
  });

  it('the stored isTransfer flag is never consulted: identical set whatever it says', () => {
    // The exclusion re-derives pairing from raw rows; a flag that lies in
    // either direction cannot move the boundary.
    const withFlags = loanPaymentFlowExclusions(fixtureA());
    expect(withFlags.excludeIds.has('t-apr')).toBe(true); // unflagged month still out
  });
});

describe('C.25 — the flow predicates accept the exclusion set', () => {
  it('countsInFlows: an excluded id stops counting; an omitted set changes nothing', () => {
    const set = new Set(['t-apr']);
    expect(countsInFlows(toTxn(A_ROWS[0]), set)).toBe(false);
    expect(countsInFlows(toTxn(A_ROWS[0]))).toBe(true); // today's behaviour intact
    expect(countsInFlows(toTxn(A_ROWS[9]), set)).toBe(true); // groceries untouched
  });

  it('a flagged row stays out of the flows whether or not it is in the set', () => {
    const set = new Set(['t-may']);
    expect(countsInFlows(toTxn(A_ROWS[1], true), set)).toBe(false);
    expect(countsInFlows(toTxn(A_ROWS[1], true))).toBe(false);
  });
});


describe("C.25 critic P1-2 — Ask merchant_spend is one basis with the category intents", () => {
  const askRow = (r: { id: string; date: string; amountCents: number; merchant: string }): AskTxnRow => ({
    ...r,
    status: "POSTED",
    categoryId: null,
    merchantCategoryId: null,
    aggregateMerchant: false,
    isTransfer: false,
    isSplitParent: false,
    excludeFromTotals: false,
  });
  const tf = { fromYm: "2026-07", toYm: "2026-07", label: "July 2026" };
  const rows = [
    askRow({ id: "mtg-jul", date: "2026-07-06", amountCents: -621_707, merchant: "Truist Mortg Olb Mtgpmt" }),
    askRow({ id: "gro-jul", date: "2026-07-15", amountCents: -10_000, merchant: "Grocery Store 101" }),
  ];

  it("a carried-elsewhere payment answers as not spent, same as the totals", () => {
    const excluded = merchantSpend(rows, tf, "truist", "2026-07-31", undefined, new Set(["mtg-jul"]));
    expect(excluded.totalCents).toBe(0);
    expect(excluded.purchaseCount).toBe(0);
    const control = merchantSpend(rows, tf, "truist", "2026-07-31");
    expect(control.totalCents).toBe(621_707); // pre-C.25 behaviour, intact without the set
    // unrelated merchants untouched by the set
    const groceries = merchantSpend(rows, tf, "grocery", "2026-07-31", undefined, new Set(["mtg-jul"]));
    expect(groceries.totalCents).toBe(10_000);
  });
});


describe("C.25 critic P1-C — Ask names the loan payment instead of denying it", () => {
  it("merchant_spend with only excluded rows answers loan-payment, not no-spending", async () => {
    const { answerMerchantSpend } = await import("@/lib/engine/assistant/answer");
    const tf = { fromYm: "2026-07", toYm: "2026-07", label: "July 2026" };
    const rows = [
      {
        id: "mtg-jul",
        date: "2026-07-06",
        amountCents: -621_707,
        merchant: "Truist Mortg Olb Mtgpmt",
        status: "POSTED",
        categoryId: null,
        merchantCategoryId: null,
        aggregateMerchant: false,
        isTransfer: false,
        isSplitParent: false,
        excludeFromTotals: false,
      },
    ];
    const res = merchantSpend(rows, tf, "truist", "2026-07-31", undefined, new Set(["mtg-jul"]));
    expect(res.count).toBe(0);
    expect(res.excludedLoanPaymentCount).toBe(1);
    expect(res.excludedLoanPaymentCents).toBe(621_707);
    const answer = answerMerchantSpend(res, tf);
    expect(answer.headline).toContain("aren't counted as spending");
    expect(answer.headline).not.toContain("No spending");
    // O.18e-FU3: the detail tail is scoped to the answer, never the universal
    // "not as spending" — the headline carries the month-scoped claim, and the
    // count-0 branches have no figure a "not in these figures" clause could name.
    expect(answer.detail).toBe("$6,217.07 went there — counted on the loan instead.");
    expect(answer.detail).not.toContain("not as spending");
    expect(answer.detail).not.toMatch(/loan payments are not/i);
    // and the control still says no spending when nothing matched at all
    const empty = merchantSpend(rows, tf, "costco", "2026-07-31", undefined, new Set(["mtg-jul"]));
    expect(answerMerchantSpend(empty, tf).headline).toContain("No spending");
  });
});

describe("O.18e-FU3 — the appended excluded-loan clause names the answer's figures", () => {
  const tf = { fromYm: "2026-07", toYm: "2026-07", label: "July 2026" };
  const row = (r: { id: string; date: string; amountCents: number }): AskTxnRow => ({
    ...r,
    status: "POSTED",
    categoryId: null,
    merchantCategoryId: null,
    aggregateMerchant: false,
    isTransfer: false,
    isSplitParent: false,
    excludeFromTotals: false,
    merchant: "Truist Mortg Olb Mtgpmt",
  });

  it("refunds-only branch: the clause says 'not in these figures', never 'not as spending'", () => {
    const rows = [
      row({ id: "mtg-jul", date: "2026-07-06", amountCents: -621_707 }),
      row({ id: "ref-jul", date: "2026-07-20", amountCents: 15_000 }),
    ];
    const res = merchantSpend(rows, tf, "truist", "2026-07-31", undefined, new Set(["mtg-jul"]));
    expect(res.count).toBe(1); // the refund stays in the answer
    expect(res.excludedLoanPaymentCount).toBe(1);
    const answer = answerMerchantSpend(res, tf);
    expect(answer.headline).toBe("No purchases at Truist Mortg Olb Mtgpmt July 2026.");
    expect(answer.detail).toContain(
      "$6,217.07 in a payment to this lender is counted on the loan, not in these figures.",
    );
    expect(answer.detail).not.toContain("not as spending");
  });

  it("plural form ('N payments are counted … not in these figures') and the purchases branch", () => {
    const rows = [
      row({ id: "mtg-jun", date: "2026-07-03", amountCents: -621_707 }),
      row({ id: "mtg-jul", date: "2026-07-06", amountCents: -621_707 }),
      row({ id: "pur-jul", date: "2026-07-15", amountCents: -10_000 }),
    ];
    const res = merchantSpend(rows, tf, "truist", "2026-07-31", undefined, new Set(["mtg-jun", "mtg-jul"]));
    const answer = answerMerchantSpend(res, tf);
    expect(answer.headline).toBe("You spent $100.00 at Truist Mortg Olb Mtgpmt July 2026.");
    expect(answer.detail).toContain(
      "$12,434.14 in 2 payments to this lender are counted on the loan, not in these figures.",
    );
    expect(answer.detail).not.toContain("not as spending");
  });
});



describe('C.25 critic cycle 3 P1-1 — facts derive from ACTUAL exclusions', () => {
  it('D1/D3: split-parent evidence never mints a merchant or a fact', () => {
    const rows = [
      row({ id: 'sp-may', accountId: 'chk', date: '2026-05-04', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT', isSplitParent: true }),
      row({ id: 'sp-jun', accountId: 'chk', date: '2026-06-03', amountCents: -621_707, rawDescriptor: 'TRUIST MORTG OL B MTGPMT', isSplitParent: true }),
    ];
    const { excludeIds, excluded } = loanPaymentFlowExclusions(fixtureA({ rows }));
    expect(excludeIds.size).toBe(0);
    expect(excluded).toHaveLength(0); // no phantom disclosure fact
  });

  it('D4: a covered-amount gap excludes nothing and publishes nothing', () => {
    const rows = [
      row({ id: 'may', accountId: 'chk', date: '2026-05-04', amountCents: -650_000, rawDescriptor: 'TRUIST MORTG OL B MTGPMT' }),
      row({ id: 'jun', accountId: 'chk', date: '2026-06-03', amountCents: -650_000, rawDescriptor: 'TRUIST MORTG OL B MTGPMT' }),
    ];
    const { excludeIds, excluded } = loanPaymentFlowExclusions(
      fixtureA({
        rows,
        loanInflows: [
          { id: 'in-1', accountId: 'mtg', date: '2026-05-05', amountCents: 650_000 },
          { id: 'in-2', accountId: 'mtg', date: '2026-06-04', amountCents: 650_000 },
        ],
      }),
    );
    // obligation is 621707; rows pair at 650000 → gate 4 never covers them
    expect(excludeIds.size).toBe(0);
    expect(excluded).toHaveLength(0);
  });
});
