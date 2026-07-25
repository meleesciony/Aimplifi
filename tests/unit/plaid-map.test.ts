import { describe, expect, it } from 'vitest';
import {
  type PlaidAccount,
  type PlaidCreditLiability,
  type PlaidTransaction,
  PFC_DETAILED_TO_CATEGORY,
  PFC_PRIMARY_TO_CATEGORY,
  mapPlaidAccount,
  mapPlaidAccountType,
  mapPlaidLiabilityToStatement,
  mapPlaidPersonalFinanceCategory,
  mapPlaidProviderCategoryGuess,
  resolvePfcCategoryId,
  pickPlaidAprBps,
  plaidAmountToCents,
  plaidDollarsToPositiveCents,
  plaidSignedDollarsToCents,
  prepareIngestedTransaction,
} from '@/lib/providers/plaid-map';
import { AUTO_FLAGGED_BPS } from '@/lib/engine/categorize/pipeline';
import { TUNE_SPAN_BPS } from '@/lib/engine/categorize/tuning';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import type { CardSnapshot, CashNeededInput } from '@/lib/engine/cash-needed/types';
import { cents } from '@/lib/money';
import { holidayTable, isoDate } from '@/lib/dates';

describe('plaidAmountToCents — sign flip + float-safe cents', () => {
  it('flips Plaid outflow-positive to Pulse outflow-negative', () => {
    expect(plaidAmountToCents(12.34)).toBe(-1234); // a $12.34 purchase
  });

  it('flips Plaid inflow-negative to Pulse inflow-positive', () => {
    expect(plaidAmountToCents(-100)).toBe(10000); // a $100 deposit
  });

  it('rounds float dollars half-away-from-zero (no float drift)', () => {
    // 12.99 * 100 = 1298.9999999… in float; must land on 1299.
    expect(plaidAmountToCents(12.99)).toBe(-1299);
    expect(plaidAmountToCents(0.1 + 0.2)).toBe(-30); // 0.30
  });

  it('handles zero', () => {
    expect(plaidAmountToCents(0)).toBe(0);
  });

  it('rejects non-finite input', () => {
    expect(() => plaidAmountToCents(NaN)).toThrow();
    expect(() => plaidAmountToCents(Infinity)).toThrow();
  });

  it('plaidDollarsToPositiveCents never flips sign', () => {
    expect(plaidDollarsToPositiveCents(250)).toBe(25000);
    expect(plaidDollarsToPositiveCents(-250)).toBe(25000);
  });
});

describe('plaidSignedDollarsToCents — sign-preserving balance conversion', () => {
  it('keeps a positive balance positive', () => {
    expect(plaidSignedDollarsToCents(250)).toBe(25000);
  });

  it('keeps a negative balance negative (overpaid card / overdrawn account)', () => {
    // Plaid reports balances.current = -75.00 for a card the holder overpaid.
    expect(plaidSignedDollarsToCents(-75)).toBe(-7500);
  });

  it('collapses -0 from a zero balance to 0', () => {
    expect(Object.is(plaidSignedDollarsToCents(0), -0)).toBe(false);
    expect(plaidSignedDollarsToCents(0)).toBe(0);
  });

  it('rounds half-away-from-zero on both signs', () => {
    expect(plaidSignedDollarsToCents(12.995)).toBe(1300);
    expect(plaidSignedDollarsToCents(-12.995)).toBe(-1300);
  });

  it('rejects non-finite input', () => {
    expect(() => plaidSignedDollarsToCents(NaN)).toThrow();
  });
});

describe('mapPlaidAccountType', () => {
  it('maps depository subtypes', () => {
    expect(mapPlaidAccountType('depository', 'checking')).toBe('CHECKING');
    expect(mapPlaidAccountType('depository', 'savings')).toBe('SAVINGS');
    expect(mapPlaidAccountType('depository', null)).toBe('CHECKING');
  });

  it('maps credit / loan / investment', () => {
    expect(mapPlaidAccountType('credit', 'credit card')).toBe('CREDIT');
    expect(mapPlaidAccountType('loan', 'student')).toBe('LOAN');
    expect(mapPlaidAccountType('investment', 'brokerage')).toBe('INVESTMENT');
  });

  it('throws on an unrecognized type rather than guessing (net-worth-sign safety)', () => {
    expect(() => mapPlaidAccountType('other', null)).toThrow(/unrecognized/i);
  });
});

describe('mapPlaidAccount', () => {
  const card: PlaidAccount = {
    account_id: 'plaid-acc-1',
    name: 'Platinum Card',
    mask: '4321',
    type: 'credit',
    subtype: 'credit card',
    balances: { current: 250.0, available: null, limit: 5000.0 },
  };

  it('keeps current signed (positive here), maps fields, available/limit positive', () => {
    const m = mapPlaidAccount(card);
    expect(m).toMatchObject({
      providerRef: 'plaid-acc-1',
      name: 'Platinum Card',
      type: 'CREDIT',
      mask: '4321',
      currentBalanceCents: 25000,
      availableBalanceCents: null,
      creditLimitCents: 500000,
    });
  });

  it('resolves the account currency (DECISIONS #135): ISO preferred, unofficial/crypto kept, neither → null', () => {
    expect(mapPlaidAccount(card).currency).toBeNull(); // fixture reports no code → assumed USD
    expect(mapPlaidAccount({ ...card, balances: { ...card.balances, iso_currency_code: 'USD' } }).currency).toBe('USD');
    expect(mapPlaidAccount({ ...card, balances: { ...card.balances, iso_currency_code: 'EUR' } }).currency).toBe('EUR');
    // iso null + unofficial (crypto) present → the unofficial code is used → withheld at the read boundary
    expect(
      mapPlaidAccount({
        ...card,
        balances: { ...card.balances, iso_currency_code: null, unofficial_currency_code: 'BTC' },
      }).currency,
    ).toBe('BTC');
  });

  it('preserves a NEGATIVE current balance (overpaid card) so net-worth sign lands right', () => {
    // An overpaid card: Plaid reports current = -120.50 (lender owes the holder).
    // It must NOT be abs()'d to +120.50, or the type-based liability sign would
    // wrongly subtract a credit the holder actually has.
    const overpaid: PlaidAccount = {
      ...card,
      balances: { current: -120.5, available: 5120.5, limit: 5000.0 },
    };
    const m = mapPlaidAccount(overpaid);
    expect(m.currentBalanceCents).toBe(-12050);
    expect(m.availableBalanceCents).toBe(512050); // available stays non-negative
    expect(m.creditLimitCents).toBe(500000);
  });

  it('maps a NULL current to null (unknown), NOT 0 — so the caller can preserve last-known-good (DECISIONS #130)', () => {
    // Plaid documents balances.current as nullable. Mapping null→0 would let a sync
    // silently overwrite a real balance with $0 and crater net worth; null signals
    // "unknown this fetch" so upsertPlaidAccounts omits the field on update.
    const noBalance: PlaidAccount = {
      account_id: 'inv-1',
      name: 'Brokerage',
      mask: null,
      type: 'investment',
      subtype: 'brokerage',
      balances: { current: null, available: null, limit: null },
    };
    const m = mapPlaidAccount(noBalance);
    expect(m.currentBalanceCents).toBeNull();
    expect(m.type).toBe('INVESTMENT');
  });
});

describe('mapPlaidLiabilityToStatement', () => {
  it('maps a generated statement', () => {
    const credit: PlaidCreditLiability = {
      account_id: 'plaid-acc-1',
      last_statement_balance: 1234.56,
      last_statement_issue_date: '2026-05-28',
      minimum_payment_amount: 35,
      next_payment_due_date: '2026-06-22',
    };
    expect(mapPlaidLiabilityToStatement(credit, 'acct-1')).toEqual({
      accountId: 'acct-1',
      cycleEnd: '2026-05-28',
      dueDate: '2026-06-22',
      statementBalanceCents: 123456,
      minimumPaymentCents: 3500,
      isEstimated: false,
    });
  });

  it('returns null when Plaid has no generated statement yet (estimate path)', () => {
    const credit: PlaidCreditLiability = {
      account_id: 'plaid-acc-1',
      last_statement_balance: null,
      last_statement_issue_date: null,
      minimum_payment_amount: null,
      next_payment_due_date: null,
    };
    expect(mapPlaidLiabilityToStatement(credit, 'acct-1')).toBeNull();
  });

  // DECISIONS #132 — audit #127 P2: a statement CREDIT must NOT be abs()'d into an owed balance.
  it('preserves a NEGATIVE last_statement_balance (statement credit) instead of flipping it to owed', () => {
    const credit: PlaidCreditLiability = {
      account_id: 'plaid-acc-1',
      last_statement_balance: -50.0, // the holder overpaid → a $50 statement CREDIT
      last_statement_issue_date: '2026-05-28',
      minimum_payment_amount: null, // a credit balance owes no minimum
      next_payment_due_date: '2026-06-22',
    };
    const m = mapPlaidLiabilityToStatement(credit, 'acct-1')!;
    expect(m.statementBalanceCents).toBe(-5000); // signed, NOT +5000
    expect(m.minimumPaymentCents).toBe(0); // no minimum owed on a credit
  });

  // DECISIONS #132 — audit #127 P2: a null minimum must mirror the engine's estimate, not collapse to $0.
  it('estimates a missing minimum (1% of balance) when it exceeds the $35 floor', () => {
    const credit: PlaidCreditLiability = {
      account_id: 'plaid-acc-1',
      last_statement_balance: 8000.0, // 1% = $80 > the $35 floor
      last_statement_issue_date: '2026-05-28',
      minimum_payment_amount: null,
      next_payment_due_date: '2026-06-22',
    };
    const m = mapPlaidLiabilityToStatement(credit, 'acct-1')!;
    expect(m.statementBalanceCents).toBe(800000);
    expect(m.minimumPaymentCents).toBe(8000); // max($35, 1% of $8,000) = $80, NOT $0
  });

  it('estimates a missing minimum at the $35 floor for a small balance', () => {
    const credit: PlaidCreditLiability = {
      account_id: 'plaid-acc-1',
      last_statement_balance: 500.0, // 1% = $5 < the $35 floor
      last_statement_issue_date: '2026-05-28',
      minimum_payment_amount: null,
      next_payment_due_date: '2026-06-22',
    };
    expect(mapPlaidLiabilityToStatement(credit, 'acct-1')!.minimumPaymentCents).toBe(3500);
  });

  it('passes a provided minimum through unchanged (no estimate)', () => {
    const credit: PlaidCreditLiability = {
      account_id: 'plaid-acc-1',
      last_statement_balance: 8000.0,
      last_statement_issue_date: '2026-05-28',
      minimum_payment_amount: 250, // provided → used verbatim, not the $80 estimate
      next_payment_due_date: '2026-06-22',
    };
    expect(mapPlaidLiabilityToStatement(credit, 'acct-1')!.minimumPaymentCents).toBe(25000);
  });

  // DECISIONS #132 — critic P2: a reported ZERO minimum on a positive balance is the same
  // understatement as a null one, so it must also fall through to the estimate.
  it('treats a reported ZERO minimum on a positive balance like a missing one (estimates)', () => {
    const credit: PlaidCreditLiability = {
      account_id: 'plaid-acc-1',
      last_statement_balance: 8000.0,
      last_statement_issue_date: '2026-05-28',
      minimum_payment_amount: 0, // reported 0 on a positive balance → not usable → estimate
      next_payment_due_date: '2026-06-22',
    };
    expect(mapPlaidLiabilityToStatement(credit, 'acct-1')!.minimumPaymentCents).toBe(8000);
  });
});

// End-to-end: the mapped statement must produce the right CASH-NEEDED money (the real-impact
// proof, not just a mapper field). DECISIONS #132 / audit #127 P2.
describe('mapPlaidLiabilityToStatement → cash-needed engine (real money impact)', () => {
  const HOLIDAYS = holidayTable(2025, 2027);
  function cardFromMapped(over: Partial<PlaidCreditLiability>): CardSnapshot {
    const credit: PlaidCreditLiability = {
      account_id: 'p-card',
      last_statement_balance: 0,
      last_statement_issue_date: '2026-05-28',
      minimum_payment_amount: null,
      next_payment_due_date: '2026-06-22',
      ...over,
    };
    const m = mapPlaidLiabilityToStatement(credit, 'card-1')!;
    return {
      id: 'card-1',
      name: 'Plaid Card',
      aprBps: 2400,
      autopay: null,
      statement: {
        statementBalanceCents: cents(m.statementBalanceCents),
        minimumPaymentCents: cents(m.minimumPaymentCents),
        dueDate: m.dueDate,
        cycleEnd: m.cycleEnd,
      },
      currentBalanceCents: cents(m.statementBalanceCents),
      paymentsAppliedCents: cents(0),
    };
  }
  function input(card: CardSnapshot, scenario: 'PAY_IN_FULL' | 'MINIMUM'): CashNeededInput {
    return {
      today: isoDate('2026-06-10'),
      paymentAccount: { name: 'Checking', balanceCents: cents(500000), pending: [], frozenSince: null },
      cards: [card],
      scheduled: [],
      scenario,
      holidayTable: HOLIDAYS,
    };
  }

  it('a statement CREDIT (negative balance) demands $0, not the abs() amount', () => {
    // Without the signed-balance fix this card abs()'d to +$50 owed and would have
    // demanded $50 of cash the holder does not owe.
    const r = computeCashNeeded(input(cardFromMapped({ last_statement_balance: -50.0 }), 'PAY_IN_FULL'));
    expect(r.headline.requiredCents).toBe(0);
    expect(r.cards.find((c) => c.cardId === 'card-1')!.cashRequiredCents).toBe(0);
  });

  it('a null minimum demands the estimated minimum (not $0) under the MINIMUM scenario', () => {
    // Without the estimate fix the minimum collapsed to $0 and the MINIMUM scenario
    // understated the cash needed to $0 on a real $8,000 statement.
    const r = computeCashNeeded(input(cardFromMapped({ last_statement_balance: 8000.0 }), 'MINIMUM'));
    expect(r.headline.requiredCents).toBe(8000); // max($35, 1% of $8,000) = $80
  });

  // DECISIONS #132 — critic P2: pin the $0 guarantee for CONTRADICTORY feed data
  // (a statement credit reported alongside a positive minimum). The mapper records the
  // provided minimum, but the engine's minCents/floorAtZero cap still demands $0.
  it('a CREDIT balance with a provided positive minimum still demands $0 (both scenarios)', () => {
    const credit: PlaidCreditLiability = {
      account_id: 'p-card',
      last_statement_balance: -50.0, // statement credit
      last_statement_issue_date: '2026-05-28',
      minimum_payment_amount: 25, // contradictory: a $25 minimum on a credit balance
      next_payment_due_date: '2026-06-22',
    };
    const mapped = mapPlaidLiabilityToStatement(credit, 'card-1')!;
    expect(mapped.minimumPaymentCents).toBe(2500); // provided value recorded verbatim
    expect(mapped.statementBalanceCents).toBe(-5000);
    const card = cardFromMapped({ last_statement_balance: -50.0, minimum_payment_amount: 25 });
    for (const scenario of ['PAY_IN_FULL', 'MINIMUM'] as const) {
      const r = computeCashNeeded(input(card, scenario));
      expect(r.headline.requiredCents).toBe(0);
      expect(r.headline.cardsDueCount).toBe(0);
    }
  });
});

describe('prepareIngestedTransaction — categorized, persist-ready row', () => {
  const base = { transaction_id: 'tx-1', account_id: 'p1', pending: false };

  it('a known-merchant purchase: negative amount, confident category, posted', () => {
    const txn: PlaidTransaction = {
      ...base,
      date: '2026-06-08',
      amount: 5.75,
      name: 'STARBUCKS STORE 123 ATLANTA',
      merchant_name: 'Starbucks',
    };
    const row = prepareIngestedTransaction(txn, 'acct-checking');
    expect(row.amountCents).toBe(-575);
    expect(row.categoryId).toBe('coffee'); // #163: Starbucks = coffee
    expect(row.needsReview).toBe(false);
    expect(row.isTransfer).toBe(false);
    expect(row.status).toBe('POSTED');
    expect(row.providerRef).toBe('tx-1');
    expect(row.accountId).toBe('acct-checking');
  });

  it('a payroll credit: positive amount, income', () => {
    const txn: PlaidTransaction = {
      ...base,
      date: '2026-06-05',
      amount: -2500.0, // Plaid inflow is negative
      name: 'ACH DEPOSIT ACME CO PAYROLL',
      pending: false,
    };
    const row = prepareIngestedTransaction(txn, 'acct-checking');
    expect(row.amountCents).toBe(250000);
    expect(row.categoryId).toBe('paycheck'); // #163: payroll = paycheck leaf
  });

  it('an online transfer is flagged isTransfer and excluded category', () => {
    const txn: PlaidTransaction = {
      ...base,
      date: '2026-06-06',
      amount: 500.0,
      name: 'ONLINE TRANSFER TO SAVINGS',
    };
    const row = prepareIngestedTransaction(txn, 'acct-checking');
    expect(row.isTransfer).toBe(true);
    expect(row.categoryId).toBe('transfer');
    expect(row.amountCents).toBe(-50000);
  });

  it('pending Plaid transactions map to PENDING status', () => {
    const txn: PlaidTransaction = {
      ...base,
      date: '2026-06-09',
      amount: 20,
      name: 'SQ *FOOD TRUCK',
      pending: true,
    };
    expect(prepareIngestedTransaction(txn, 'acct-checking').status).toBe('PENDING');
  });

  it('falls back through name → merchant_name → "Unknown Merchant"', () => {
    const noName: PlaidTransaction = { ...base, date: '2026-06-09', amount: 1, name: '', merchant_name: 'Etsy' };
    expect(prepareIngestedTransaction(noName, 'a').rawDescriptor).toBe('Etsy');
    const nothing: PlaidTransaction = { ...base, date: '2026-06-09', amount: 1, name: '', merchant_name: null };
    expect(prepareIngestedTransaction(nothing, 'a').rawDescriptor).toBe('Unknown Merchant');
  });

  it('applies a user rule when one matches', () => {
    const txn: PlaidTransaction = {
      ...base,
      date: '2026-06-08',
      amount: 5.75,
      name: 'STARBUCKS STORE 123',
    };
    const row = prepareIngestedTransaction(txn, 'acct-checking', [
      {
        id: 'r1',
        merchantCanonical: 'Starbucks',
        minAmountCents: null,
        maxAmountCents: null,
        weekendOnly: null,
        weekdayOnly: null,
        accountId: null,
        categoryId: 'household',
        priority: 100,
      },
    ]);
    expect(row.categoryId).toBe('household');
  });
});

describe('pickPlaidAprBps — APR percent → basis points (audit #126-followup)', () => {
  it('selects the purchase APR and converts to bps with no float drift', () => {
    expect(
      pickPlaidAprBps({
        aprs: [
          { apr_type: 'balance_transfer_apr', apr_percentage: 0, balance_subject_to_apr: null, interest_charge_amount: null },
          { apr_type: 'purchase_apr', apr_percentage: 24.99, balance_subject_to_apr: 1000, interest_charge_amount: 12.5 },
          { apr_type: 'cash_apr', apr_percentage: 29.99, balance_subject_to_apr: null, interest_charge_amount: null },
        ],
      }),
    ).toBe(2499); // 24.99% → 2499 bps (purchase APR chosen over the higher cash APR)
  });

  it('falls back to the highest non-special APR when no purchase APR is present', () => {
    expect(
      pickPlaidAprBps({
        aprs: [
          { apr_type: 'cash_apr', apr_percentage: 27.24, balance_subject_to_apr: null, interest_charge_amount: null },
          { apr_type: 'special', apr_percentage: 0, balance_subject_to_apr: null, interest_charge_amount: null },
          { apr_type: 'balance_transfer_apr', apr_percentage: 19.99, balance_subject_to_apr: null, interest_charge_amount: null },
        ],
      }),
    ).toBe(2724); // highest non-special (cash 27.24%), not the 0% promo
  });

  it('returns null when no usable APR is reported (so the rate is not zeroed)', () => {
    expect(pickPlaidAprBps({ aprs: [] })).toBeNull();
    expect(pickPlaidAprBps({})).toBeNull();
    expect(pickPlaidAprBps({ aprs: null })).toBeNull();
    expect(
      pickPlaidAprBps({ aprs: [{ apr_type: 'special', apr_percentage: 0, balance_subject_to_apr: null, interest_charge_amount: null }] }),
    ).toBeNull(); // a lone 0% promo is not a usable carrying rate
  });
});

describe('mapPlaidPersonalFinanceCategory — Plaid PFC → Pulse hint (DECISIONS #155)', () => {
  it('maps a DETAILED leaf to the specific category, confidence → bps', () => {
    expect(
      mapPlaidPersonalFinanceCategory({
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_GROCERIES',
        confidence_level: 'VERY_HIGH',
      }),
    ).toEqual({ categoryId: 'groceries', confidenceBps: 8800 });
    expect(
      mapPlaidPersonalFinanceCategory({
        primary: 'TRANSPORTATION',
        detailed: 'TRANSPORTATION_GAS',
        confidence_level: 'HIGH',
      }),
    ).toEqual({ categoryId: 'fuel', confidenceBps: 8000 });
  });

  it('falls back to the PRIMARY when the detailed leaf is missing/unmapped', () => {
    expect(
      mapPlaidPersonalFinanceCategory({ primary: 'FOOD_AND_DRINK', detailed: null, confidence_level: 'MEDIUM' }),
    ).toEqual({ categoryId: 'dining', confidenceBps: 7200 });
    // A future/unknown detailed leaf still falls back to its primary bucket.
    expect(
      mapPlaidPersonalFinanceCategory({
        primary: 'MEDICAL',
        detailed: 'MEDICAL_SOME_NEW_LEAF',
        confidence_level: 'HIGH',
      }),
    ).toEqual({ categoryId: 'health', confidenceBps: 8000 });
  });

  it('returns null for a LOW / UNKNOWN / absent / unrecognized confidence (Plaid unsure)', () => {
    for (const confidence_level of ['LOW', 'UNKNOWN', 'GARBAGE', '', null, undefined]) {
      expect(
        mapPlaidPersonalFinanceCategory({
          primary: 'FOOD_AND_DRINK',
          detailed: 'FOOD_AND_DRINK_GROCERIES',
          confidence_level,
        }),
      ).toBeNull();
    }
  });

  it('NEVER infers a transfer — every transfer taxonomy value maps to null (critic F4)', () => {
    expect(
      mapPlaidPersonalFinanceCategory({
        primary: 'TRANSFER_OUT',
        detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
        confidence_level: 'VERY_HIGH',
      }),
    ).toBeNull();
    expect(
      mapPlaidPersonalFinanceCategory({ primary: 'TRANSFER_IN', detailed: null, confidence_level: 'VERY_HIGH' }),
    ).toBeNull();
    expect(
      mapPlaidPersonalFinanceCategory({
        primary: 'TRANSFER_OUT',
        detailed: 'TRANSFER_OUT_WITHDRAWAL',
        confidence_level: 'VERY_HIGH',
      }),
    ).toBeNull();
  });

  it('an over-broad primary (GENERAL_SERVICES) is null, but its specific children map', () => {
    expect(
      mapPlaidPersonalFinanceCategory({ primary: 'GENERAL_SERVICES', detailed: null, confidence_level: 'VERY_HIGH' }),
    ).toBeNull();
    expect(
      mapPlaidPersonalFinanceCategory({
        primary: 'GENERAL_SERVICES',
        detailed: 'GENERAL_SERVICES_INSURANCE',
        confidence_level: 'HIGH',
      }),
    ).toEqual({ categoryId: 'insurance', confidenceBps: 8000 });
  });

  it('maps the loan/mortgage/card-payment leaves to their Pulse categories', () => {
    expect(
      mapPlaidPersonalFinanceCategory({ primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_MORTGAGE_PAYMENT', confidence_level: 'HIGH' }),
    ).toEqual({ categoryId: 'rent', confidenceBps: 8000 });
    expect(
      mapPlaidPersonalFinanceCategory({ primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', confidence_level: 'HIGH' }),
    ).toEqual({ categoryId: 'credit-card-payment', confidenceBps: 8000 });
  });

  it('tolerates lowercase / padded feed values and a null field', () => {
    expect(
      mapPlaidPersonalFinanceCategory({
        primary: ' food_and_drink ',
        detailed: ' food_and_drink_coffee ',
        confidence_level: ' very_high ',
      }),
    ).toEqual({ categoryId: 'coffee', confidenceBps: 8800 });
    expect(mapPlaidPersonalFinanceCategory(null)).toBeNull();
    expect(mapPlaidPersonalFinanceCategory(undefined)).toBeNull();
  });

  // Invariant 5, permanently locked: EVERY target in both maps must be a real Pulse
  // category and NEVER `transfer` (spend-erasure) or `uncategorized` (that is review).
  // A future typo would otherwise silently disable that leaf's rescue with a green suite.
  it('every PFC map target is a real, non-transfer, non-uncategorized Pulse category', () => {
    const targets = [
      ...Object.values(PFC_DETAILED_TO_CATEGORY),
      ...Object.values(PFC_PRIMARY_TO_CATEGORY),
    ];
    expect(targets.length).toBeGreaterThan(80); // the maps are populated, not accidentally emptied
    for (const id of targets) {
      expect(CATEGORY_BY_ID.has(id), `PFC target "${id}" must exist in CATEGORIES`).toBe(true);
      expect(id).not.toBe('transfer'); // a hint must never infer a transfer (critic F4)
      expect(id).not.toBe('uncategorized');
    }
  });

  // Invariant 6: the non-throwing contract rests on the typeof guards — a malformed
  // FIELD TYPE (Plaid feed drift) must degrade to null, never throw and abort a sync.
  it('never throws on a malformed field type — degrades to null', () => {
    const malformed = [
      { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES', confidence_level: 5 },
      { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES', confidence_level: { x: 1 } },
      { primary: 123, detailed: {}, confidence_level: 'VERY_HIGH' },
      {},
    ] as unknown as PlaidTransaction['personal_finance_category'][];
    for (const pfc of malformed) {
      expect(() => mapPlaidPersonalFinanceCategory(pfc)).not.toThrow();
      expect(mapPlaidPersonalFinanceCategory(pfc)).toBeNull();
    }
  });
});

describe('prepareIngestedTransaction + PFC passthrough (end-to-end, DECISIONS #155)', () => {
  const base = { transaction_id: 'pfc-1', account_id: 'p1', pending: false };

  it('rescues an UNKNOWN merchant from review with a confident PFC', () => {
    const noPfc: PlaidTransaction = { ...base, date: '2026-06-08', amount: 42.0, name: 'ACME WIDGETS LLC' };
    const before = prepareIngestedTransaction(noPfc, 'acct-checking');
    expect(before.categoryId).toBe('uncategorized');
    expect(before.needsReview).toBe(true);

    const withPfc: PlaidTransaction = {
      ...noPfc,
      personal_finance_category: {
        primary: 'GENERAL_MERCHANDISE',
        detailed: 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES',
        confidence_level: 'VERY_HIGH',
      },
    };
    const after = prepareIngestedTransaction(withPfc, 'acct-checking');
    expect(after.categoryId).toBe('shopping');
    expect(after.confidenceBps).toBe(8800);
    expect(after.needsReview).toBe(false);
    expect(after.isTransfer).toBe(false);
  });

  it('does NOT override a KNOWN merchant even with a confident, disagreeing PFC', () => {
    const txn: PlaidTransaction = {
      ...base,
      date: '2026-06-08',
      amount: 5.75,
      name: 'STARBUCKS STORE 123 ATLANTA',
      personal_finance_category: {
        primary: 'GENERAL_MERCHANDISE',
        detailed: 'GENERAL_MERCHANDISE_SUPERSTORES',
        confidence_level: 'VERY_HIGH',
      },
    };
    expect(prepareIngestedTransaction(txn, 'acct-checking').categoryId).toBe('coffee'); // #163: Starbucks = coffee
  });

  it('a LOW-confidence PFC does not rescue (stays in review)', () => {
    const txn: PlaidTransaction = {
      ...base,
      date: '2026-06-08',
      amount: 42.0,
      name: 'ACME WIDGETS LLC',
      personal_finance_category: { primary: 'GENERAL_MERCHANDISE', detailed: 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE', confidence_level: 'LOW' },
    };
    const row = prepareIngestedTransaction(txn, 'acct-checking');
    expect(row.categoryId).toBe('uncategorized');
    expect(row.needsReview).toBe(true);
  });

  it('sign guard: a spend PFC on a refund (inflow) is ignored', () => {
    const refund: PlaidTransaction = {
      ...base,
      date: '2026-06-08',
      amount: -42.0, // Plaid inflow negative → a positive (credit) in Pulse
      name: 'ACME WIDGETS LLC',
      personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_RESTAURANT', confidence_level: 'VERY_HIGH' },
    };
    const row = prepareIngestedTransaction(refund, 'acct-checking');
    expect(row.amountCents).toBe(4200); // inflow
    expect(row.categoryId).toBe('uncategorized'); // not booked as dining spend
    expect(row.needsReview).toBe(true);
  });

  it('sign guard (positive path): an INCOME PFC on an inflow files to an Income category', () => {
    // The full mapper→pipeline income path (the counterpart to the refund-rejection above):
    // an unknown payroll descriptor + a confident INCOME_WAGES PFC on a Plaid inflow.
    const payroll: PlaidTransaction = {
      ...base,
      date: '2026-06-05',
      amount: -3000.0, // Plaid inflow negative → +$3,000 in Pulse
      // A descriptor our normalizer does NOT recognize (no PAYROLL/DIRECT-DEP keyword),
      // so it would go to review — the PFC income hint is what rescues it.
      name: 'ACME WIDGETS LLC',
      personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_WAGES', confidence_level: 'VERY_HIGH' },
    };
    const row = prepareIngestedTransaction(payroll, 'acct-checking');
    expect(row.amountCents).toBe(300000);
    expect(row.categoryId).toBe('paycheck');
    expect(CATEGORY_BY_ID.get(row.categoryId)?.group).toBe('Income');
    expect(row.needsReview).toBe(false);
    expect(row.isTransfer).toBe(false);
  });

  it('a transfer descriptor stays a transfer regardless of the PFC', () => {
    const txn: PlaidTransaction = {
      ...base,
      date: '2026-06-06',
      amount: 500.0,
      name: 'ONLINE TRANSFER TO SAVINGS',
      personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_RESTAURANT', confidence_level: 'VERY_HIGH' },
    };
    const row = prepareIngestedTransaction(txn, 'acct-checking');
    expect(row.isTransfer).toBe(true);
    expect(row.categoryId).toBe('transfer');
  });

  // ── L.12: the persisted provider guess (independent of the auto-file verdict) ──
  it('persists Plaid’s guess on a REVIEW row that did NOT auto-file (the L.12 gap)', () => {
    // A LOW-confidence PFC leaves the row in review (auto-file behavior UNCHANGED) —
    // but the guess is now PERSISTED so the triage inbox can offer it as a one-tap
    // "Plaid’s guess" instead of "none yet".
    const txn: PlaidTransaction = {
      ...base,
      date: '2026-06-08',
      amount: 42.0,
      name: 'GOOSE POND BAR GRILLE', // an unknown local merchant our ruleset misses
      personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_RESTAURANT', confidence_level: 'LOW' },
    };
    const row = prepareIngestedTransaction(txn, 'acct-checking');
    expect(row.needsReview).toBe(true); // H1: unchanged — still goes to review
    expect(row.categoryId).toBe('uncategorized');
    expect(row.providerCategoryId).toBe('dining'); // Plaid’s guess, captured for the suggestion
    expect(row.providerCategoryConfidenceBps).toBe(4000);
  });

  it('persists the guess on an AUTO-FILED row too (provenance trail)', () => {
    const txn: PlaidTransaction = {
      ...base,
      date: '2026-06-08',
      amount: 42.0,
      name: 'ACME WIDGETS LLC',
      personal_finance_category: { primary: 'GENERAL_MERCHANDISE', detailed: 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES', confidence_level: 'VERY_HIGH' },
    };
    const row = prepareIngestedTransaction(txn, 'acct-checking');
    expect(row.needsReview).toBe(false); // auto-filed via the hint (existing behavior)
    expect(row.categoryId).toBe('shopping');
    expect(row.providerCategoryId).toBe('shopping');
    expect(row.providerCategoryConfidenceBps).toBe(8800);
  });

  it('no PFC / UNKNOWN / transfer → providerCategoryId null (demo & SimpleFIN stay byte-identical)', () => {
    const noPfc: PlaidTransaction = { ...base, date: '2026-06-08', amount: 42.0, name: 'ACME WIDGETS LLC' };
    const plain = prepareIngestedTransaction(noPfc, 'a');
    expect(plain.providerCategoryId).toBeNull();
    expect(plain.providerCategoryConfidenceBps).toBeNull();
    const unknown: PlaidTransaction = { ...noPfc, personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_RESTAURANT', confidence_level: 'UNKNOWN' } };
    expect(prepareIngestedTransaction(unknown, 'a').providerCategoryId).toBeNull();
    const transfer: PlaidTransaction = { ...noPfc, personal_finance_category: { primary: 'TRANSFER_OUT', detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER', confidence_level: 'VERY_HIGH' } };
    expect(prepareIngestedTransaction(transfer, 'a').providerCategoryId).toBeNull();
  });

  // #44 / F4 sign guard on the surfaced guess (critic P1): a one-tap suggestion must not
  // resurface the exact case the auto-file path blocks — an OUTFLOW booked as income.
  it('sign guard: an OUTFLOW guessed as INCOME is NOT persisted (one tap must never book spend as income)', () => {
    const spendTaggedIncome: PlaidTransaction = {
      ...base,
      date: '2026-06-08',
      amount: 42.0, // Plaid-positive = OUTFLOW → -4200 cents
      name: 'ACME WIDGETS LLC',
      personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_WAGES', confidence_level: 'HIGH' },
    };
    const row = prepareIngestedTransaction(spendTaggedIncome, 'acct-checking');
    expect(row.amountCents).toBeLessThan(0); // outflow
    expect(row.providerCategoryId).toBeNull(); // the income guess is dropped, never surfaced
    expect(row.providerCategoryConfidenceBps).toBeNull();
  });

  it('sign guard: an INFLOW guessed as INCOME IS persisted (income on a credit is legitimate)', () => {
    const incomeInflow: PlaidTransaction = {
      ...base,
      date: '2026-06-05',
      amount: -3000.0, // Plaid-negative = INFLOW → +300000 cents
      name: 'ACME WIDGETS LLC',
      personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_WAGES', confidence_level: 'HIGH' },
    };
    const row = prepareIngestedTransaction(incomeInflow, 'acct-checking');
    expect(row.amountCents).toBeGreaterThan(0); // inflow
    expect(row.providerCategoryId).toBe('paycheck');
  });

  it('sign guard: an INFLOW guessed as a SPEND category IS persisted (the refund case, matching the pipeline)', () => {
    const refund: PlaidTransaction = {
      ...base,
      date: '2026-06-08',
      amount: -42.0, // inflow
      name: 'ACME WIDGETS LLC',
      personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_RESTAURANT', confidence_level: 'LOW' },
    };
    const row = prepareIngestedTransaction(refund, 'acct-checking');
    expect(row.amountCents).toBeGreaterThan(0); // inflow
    expect(row.providerCategoryId).toBe('dining'); // refund → its spend category, left intact
  });
});

describe('mapPlaidProviderCategoryGuess — Plaid’s persisted guess incl. LOW (L.12)', () => {
  it('agrees with the auto-file map for VERY_HIGH / HIGH / MEDIUM (superset, shared core)', () => {
    for (const confidence_level of ['VERY_HIGH', 'HIGH', 'MEDIUM'] as const) {
      const pfc = { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES', confidence_level };
      expect(mapPlaidProviderCategoryGuess(pfc)).toEqual(mapPlaidPersonalFinanceCategory(pfc));
    }
  });

  it('KEEPS a LOW-confidence guess (4000 bps) that the auto-file map drops', () => {
    const pfc = { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_RESTAURANT', confidence_level: 'LOW' };
    expect(mapPlaidPersonalFinanceCategory(pfc)).toBeNull(); // auto-file map: unchanged
    expect(mapPlaidProviderCategoryGuess(pfc)).toEqual({ categoryId: 'dining', confidenceBps: 4000 });
  });

  it('the LOW guess bps sits below the tuned auto-file clamp FLOOR — it can never auto-file (H1)', () => {
    const low = mapPlaidProviderCategoryGuess({ primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_RESTAURANT', confidence_level: 'LOW' });
    expect(low).not.toBeNull();
    // isUsableProviderHint files only when confidenceBps >= flaggedBps; the tuned
    // flaggedBps is clamped to a floor of AUTO_FLAGGED_BPS - TUNE_SPAN_BPS (6500).
    expect(low!.confidenceBps).toBeLessThan(AUTO_FLAGGED_BPS - TUNE_SPAN_BPS);
  });

  it('null for UNKNOWN / absent / unrecognized confidence — Plaid has no guess', () => {
    for (const confidence_level of ['UNKNOWN', 'GARBAGE', '', null, undefined]) {
      expect(
        mapPlaidProviderCategoryGuess({ primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES', confidence_level }),
      ).toBeNull();
    }
  });

  it('never a transfer or over-broad bucket, at any confidence (shares resolvePfcCategoryId)', () => {
    expect(mapPlaidProviderCategoryGuess({ primary: 'TRANSFER_OUT', detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER', confidence_level: 'LOW' })).toBeNull();
    expect(mapPlaidProviderCategoryGuess({ primary: 'GENERAL_SERVICES', detailed: null, confidence_level: 'LOW' })).toBeNull();
  });

  it('resolvePfcCategoryId is confidence-agnostic (one shared core, no drift)', () => {
    expect(resolvePfcCategoryId({ primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE', confidence_level: 'LOW' })).toBe('coffee');
    expect(resolvePfcCategoryId({ primary: 'TRANSFER_IN', detailed: null, confidence_level: 'VERY_HIGH' })).toBeNull();
    expect(resolvePfcCategoryId(null)).toBeNull();
  });

  it('does not throw on malformed field types — degrades to null', () => {
    const malformed = [
      { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES', confidence_level: 5 },
      { primary: 123, detailed: {}, confidence_level: 'LOW' },
      {},
    ] as unknown as PlaidTransaction['personal_finance_category'][];
    for (const pfc of malformed) {
      expect(() => mapPlaidProviderCategoryGuess(pfc)).not.toThrow();
      expect(mapPlaidProviderCategoryGuess(pfc)).toBeNull();
    }
  });
});
