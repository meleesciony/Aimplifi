/**
 * DECISIONS #792 — the readers #789's third critic found still giving a money move a
 * second verdict: /recurring's renewal list (P2-A), the merchant set that carries the
 * reader's filings to recurring series (P2-B), the cash-flow radar's spending pace
 * (P2-C), the transfer-flag repair card's dollar claim (P2-D), the investing word list
 * (P3-1), the learned-rule and backfill sign guards (P3-2), the register's type filter
 * (P3-4) and recurring income (P3-7) — and #792's own critic cycle 1 (P1-1 a stopped
 * brokerage deposit stays pausable, P2-1 a majority not a veto, P2-2 listed not counted,
 * P2-3 the learner, P3-1 truncated INVEST). Every amount and name below is invented.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { confirmedPauseState, lapsedIncomeSeries } from '@/lib/engine/income/pause';
import { categorize, type RuleLike } from '@/lib/engine/categorize/pipeline';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { planTransferFlagRepair, type TransferFlagRepairRow } from '@/lib/engine/categorize/transfer-flag-repair';
import { moneyMoveMerchantCanonicals } from '@/lib/engine/fi/insights';
import { discretionaryDailyOutflows } from '@/lib/engine/radar/burn';
import { detectRecurring, type RecurringTxn } from '@/lib/engine/recurring/detect';
import { summarizeRecurring } from '@/lib/engine/recurring/summary';
import { upcomingRenewals } from '@/lib/engine/recurring/renewals';
import { filterTransactions, type TxnView } from '@/lib/engine/transactions/query';
import { planBackfill } from '@/lib/engine/categorize/backfill';
import { deriveLearnedRules, type LearnedCorrectionInput } from '@/lib/engine/categorize/learn';
import { proposeCategory } from '@/lib/engine/categorize/propose';
import { shouldApplyRematchCategory } from '@/lib/engine/transactions/descriptor';

const filed = (rawDescriptor: string, amountCents = -50000, rules: RuleLike[] = []) =>
  categorize({ rawDescriptor, amountCents, date: '2026-05-04', accountId: 'chk' }, rules).categoryId;

describe('P2-A — a contribution that rose is not marked as a price rise in the renewal list', () => {
  it('the 529 rise carries no "was" figure; Netflix’s does', () => {
    const T = (date: string, amountCents: number, rawDescriptor: string): RecurringTxn => ({ id: `${date}:${rawDescriptor}`, accountId: 'chk', date, amountCents, rawDescriptor });
    const rows: RecurringTxn[] = [
      ...['2026-01-20', '2026-02-20', '2026-03-20', '2026-04-20'].map((d) => T(d, -20000, 'NY 529 COLLEGE SAVINGS PLAN')),
      T('2026-05-20', -25000, 'NY 529 COLLEGE SAVINGS PLAN'),
      ...['2026-01-08', '2026-02-08', '2026-03-08', '2026-04-08'].map((d) => T(d, -1599, 'NETFLIX.COM')),
      T('2026-05-08', -1799, 'NETFLIX.COM'),
    ];
    const series = detectRecurring(rows, isoDate('2026-06-01'), []);
    const plan529 = series.find((s) => /529/i.test(s.merchantCanonical))!.merchantCanonical;
    const summary = summarizeRecurring(series, '2026-06-01', new Set([plan529]));
    const renewals = upcomingRenewals(summary.items, '2026-06-01');
    const all = renewals.occurrences;
    const of = (re: RegExp) => all.filter((o) => re.test(o.merchantCanonical));
    expect(of(/529/).length).toBeGreaterThan(0);
    expect(of(/529/).every((o) => o.increasedFromCents === null)).toBe(true);
    expect(of(/netflix/i).every((o) => o.increasedFromCents === 1599)).toBe(true);
  });
});

describe('P2-B — one row’s filing is never the verdict on another merchant’s series', () => {
  const r = (rawDescriptor: string, categoryId: string | null, isTransfer = false) => ({ rawDescriptor, categoryId, isTransfer });
  const venmo = normalizeMerchant('VENMO PAYMENT').canonical;

  it('a Venmo cash-out filed Transfer (flagged or not) does not turn Venmo rent filed Rent into money moved', () => {
    const rent = ['1', '2', '3', '4', '5'].map(() => r('VENMO PAYMENT', 'rent'));
    expect(moneyMoveMerchantCanonicals([...rent, r('VENMO CASHOUT', 'transfer', true)]).has(venmo)).toBe(false);
    expect(normalizeMerchant('VENMO CASHOUT').canonical).toBe(venmo); // the aggregate name both rows share
    expect(moneyMoveMerchantCanonicals([...rent, r('VENMO CASHOUT', 'transfer', false)]).has(venmo)).toBe(false);
  });

  it('a merchant most of whose filed rows move money is in the set; a row not filed yet does not change that', () => {
    const vg = normalizeMerchant('Vanguard').canonical;
    expect(moneyMoveMerchantCanonicals([r('Vanguard', 'investment'), r('Vanguard', 'investment'), r('Vanguard', null), r('Vanguard', 'uncategorized')]).has(vg)).toBe(true);
    // A tie counts as a move (calling a contribution a cut is the costlier mistake); fewer does not.
    expect(moneyMoveMerchantCanonicals([r('Vanguard', 'investment'), r('Vanguard', 'shopping')]).has(vg)).toBe(true);
    expect(moneyMoveMerchantCanonicals([r('Vanguard', 'investment'), r('Vanguard', 'shopping'), r('Vanguard', 'shopping')]).has(vg)).toBe(false);
    // A transfer-flagged row is never read here — the recurring detector never reads it either.
    expect(moneyMoveMerchantCanonicals([r('Vanguard', 'investment', true)]).has(vg)).toBe(false);
  });

  it('test_regression__792_one_misfiled_contribution_does_not_veto_the_series: four 529 rows filed Investment & Savings and one a bank hint filed Education stay a move', () => {
    const plan = normalizeMerchant('NY 529 COLLEGE SAVINGS PLAN').canonical;
    const rows = [...['1', '2', '3', '4'].map(() => r('NY 529 COLLEGE SAVINGS PLAN', 'investment')), r('NY 529 COLLEGE SAVINGS PLAN', 'education')];
    expect(moneyMoveMerchantCanonicals(rows).has(plan)).toBe(true);
    // The rise it holds is more saving, never a price increase or a cut.
    const T = (date: string, amountCents: number): RecurringTxn => ({ id: date, accountId: 'chk', date, amountCents, rawDescriptor: 'NY 529 COLLEGE SAVINGS PLAN' });
    const series = detectRecurring(
      [...['2026-01-20', '2026-02-20', '2026-03-20', '2026-04-20'].map((d) => T(d, -20000)), T('2026-05-20', -25000)],
      isoDate('2026-06-01'),
      [],
    );
    expect(summarizeRecurring(series, '2026-06-01', moneyMoveMerchantCanonicals(rows)).priceIncreases).toEqual([]);
  });
});

describe('P2-C — the radar’s spending pace leaves out money moved into investing', () => {
  it('two $2,000.00 deposits filed Investment & Savings add nothing to the daily outflows', () => {
    const today = isoDate('2026-06-01');
    const day = (n: number) => isoDate(`2026-05-${String(n).padStart(2, '0')}`);
    const base = { accountId: 'chk', status: 'POSTED', isTransfer: false, isSplitParent: false };
    const groceries = [3, 10, 17, 24].map((n) => ({ ...base, date: day(n), amountCents: -20000, rawDescriptor: 'KROGER', categoryId: 'groceries' }));
    const deposits = [5, 19].map((n) => ({ ...base, date: day(n), amountCents: -200000, rawDescriptor: 'VANGUARD BUY INVESTMENT', categoryId: 'investment' }));
    const sum = (rows: typeof groceries) =>
      discretionaryDailyOutflows(rows, { paymentAccountId: 'chk', excludedCanonicals: new Set(), today, lookbackDays: 31 }).reduce((a, b) => a + b, 0);
    expect(sum(groceries)).toBe(80000);
    expect(sum([...groceries, ...deposits])).toBe(80000);
    // Anti-vacuity: the same rows filed to spending are a pace.
    expect(sum([...groceries, ...deposits.map((d) => ({ ...d, categoryId: 'shopping' }))])).toBe(480000);
  });
});

describe('P2-D — the repair card never claims money no figure regains', () => {
  it('a flagged row filed Investment & Savings is declined, not cleared; a flagged grocery run is cleared', () => {
    const row = (id: string, amountCents: number, categoryId: string, rawDescriptor: string): TransferFlagRepairRow =>
      ({ id, accountId: 'chk', date: '2026-05-04', amountCents, rawDescriptor, categoryId, isTransfer: true, needsReview: false, reviewPinned: false, status: 'POSTED', currencySupported: true, excludeFromTotals: false }) as TransferFlagRepairRow;
    const plan = planTransferFlagRepair([row('a', -200000, 'investment', 'VANGUARD BUY INVESTMENT'), row('b', -4000, 'groceries', 'KROGER #0412')]);
    expect(plan.clearIds).toEqual(['b']);
    expect(plan.outflowCents).toBe(4000);
    expect(plan.declinedOutOfScopeCount).toBe(1);
  });
});

describe('P3-1 / P3-2 — the categorizer', () => {
  it('INVEST reads every INVEST… word but INVESTIGAT…: an investigations firm is a business, a truncated bank word is still the move', () => {
    for (const d of ['VANGUARD INVESTIGATIONS LLC', 'FIDELITY INVESTIGATIONS LLC']) expect(filed(d, -85000), d).not.toBe('investment');
    for (const d of [
      'VANGUARD BUY INVESTMENT',
      'ACORNS INVEST',
      'SCHWAB INVESTING TRANSFER',
      'ROBINHOOD INVESTMENTS',
      // #792 critic cycle 1, P3-1: banks truncate.
      'VANGUARD INVESTMNT',
      'ROBINHOOD INVESTMNTS',
      'SCHWAB DES:INVESTMNT',
    ])
      expect(filed(d), d).toBe('investment');
  });

  it('a learned Investment & Savings rule files the withdrawal as well as the deposit', () => {
    const desc = 'BETTERMENT DES:BETTERMENT ID:0000123 INDN:SAM SAVER';
    const rule = {
      id: 'learned-1',
      merchantCanonical: normalizeMerchant(desc).canonical,
      minAmountCents: null,
      maxAmountCents: null,
      weekendOnly: null,
      weekdayOnly: null,
      accountId: null,
      categoryId: 'investment',
      priority: 100,
      isLearned: true,
    } as RuleLike;
    expect(filed(desc, -50000, [rule])).toBe('investment');
    expect(filed(desc, 50000, [rule])).toBe('investment');
    // Anti-vacuity: a learned SPENDING rule still refuses the inflow.
    expect(filed(desc, 50000, [{ ...rule, categoryId: 'shopping' }])).not.toBe('shopping');
  });

  it('test_regression__792_one_withdrawal_does_not_unlearn_the_deposits: deposits and a withdrawal all filed Investment & Savings learn a rule that files both', () => {
    const desc = 'BETTERMENT DES:BETTERMENT ID:0000123 INDN:SAM SAVER';
    const c = (id: string, seq: number, amountCents: number): LearnedCorrectionInput => ({ transactionId: id, toCategoryId: 'investment', isUndo: false, seq, rawDescriptor: desc, amountCents });
    const history = [c('d1', 1, -50000), c('d2', 2, -50000), c('d3', 3, -50000), c('w1', 4, 120000)];
    const rules = deriveLearnedRules(history);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((x) => x.categoryId === 'investment')).toBe(true);
    expect(filed(desc, -50000, rules)).toBe('investment');
    expect(filed(desc, 120000, rules)).toBe('investment');
    // Anti-vacuity: the same mixed signs filed to a spending category still learn nothing.
    expect(deriveLearnedRules(history.map((x) => ({ ...x, toCategoryId: 'shopping' })))).toEqual([]);
  });

  it('a proposal from deposits filed Investment & Savings is offered for the withdrawal too', () => {
    const desc = 'BETTERMENT DES:BETTERMENT ID:0000123 INDN:SAM SAVER';
    const deposits: LearnedCorrectionInput[] = [1, 2].map((seq) => ({ transactionId: `d${seq}`, toCategoryId: 'investment', isUndo: false, seq, rawDescriptor: desc, amountCents: -50000 }));
    expect(proposeCategory({ rawDescriptor: desc, amountCents: 120000 }, deposits)?.categoryId).toBe('investment');
    // Anti-vacuity: deposits filed to spending are never proposed for money coming in.
    expect(proposeCategory({ rawDescriptor: desc, amountCents: 120000 }, deposits.map((d) => ({ ...d, toCategoryId: 'shopping' })))).toBeNull();
  });
});

describe('P3-4 — the register’s type filter reads the filing', () => {
  it('Expense lists the groceries only; Transfer lists the moves, flagged or filed', () => {
    const view = (id: string, amountCents: number, categoryId: string, isTransfer = false) =>
      ({ id, date: '2026-05-04', accountId: 'chk', amountCents, categoryId, isTransfer, status: 'POSTED', rawDescriptor: id, merchantName: id, categoryName: categoryId, excludeFromTotals: false, onHandoverDay: false, needsReview: false, tags: [] }) as unknown as TxnView;
    const rows = [view('paycheck', 500000, 'paycheck'), view('kroger', -40000, 'groceries'), view('vg-buy', -100000, 'investment'), view('vg-sell', 25000, 'investment'), view('to-savings', -50000, 'groceries', true)];
    const ids = (type: 'income' | 'expense' | 'transfer') => filterTransactions(rows, { type }).map((t) => t.id).sort();
    expect(ids('expense')).toEqual(['kroger']);
    expect(ids('income')).toEqual(['paycheck']);
    expect(ids('transfer')).toEqual(['to-savings', 'vg-buy', 'vg-sell']);
  });
});

describe('P3-7 — a recurring withdrawal from a brokerage is listed, never counted as recurring income', () => {
  const T = (date: string, amountCents: number, rawDescriptor: string): RecurringTxn => ({ id: `${date}:${rawDescriptor}`, accountId: 'chk', date, amountCents, rawDescriptor });
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
  const rows: RecurringTxn[] = [
    ...months.map((m) => T(`${m}-10`, 50000, 'ROBINHOOD CREDITS')),
    ...months.map((m) => T(`${m}-01`, 400000, 'NORTHWIND PAYROLL PPD')),
  ];

  it('listed with the money coming in, badged as a move, and left out of the monthly income figure (#792 critic cycle 1, P2-2)', () => {
    const series = detectRecurring(rows, isoDate('2026-06-05'), []);
    expect(series.find((s) => /robinhood/i.test(s.merchantCanonical))?.categoryId).toBe('investment');
    const s = summarizeRecurring(series, '2026-06-05');
    const rh = s.income.find((i) => /robinhood/i.test(i.merchantCanonical));
    const payroll = s.income.find((i) => /northwind/i.test(i.merchantCanonical));
    expect(rh?.movesMoney).toBe(true);
    expect(payroll?.movesMoney).toBe(false);
    // Every active series is in a section — none falls out of the page.
    expect(s.items.filter((i) => i.active).every((i) => s.subscriptions.includes(i) || s.bills.includes(i) || s.income.includes(i))).toBe(true);
    expect(s.monthlyIncomeCents).toBe(payroll!.monthlyEquivalentCents);
  });

  it('test_regression__792_money_move_deposit_stays_pausable: a stopped brokerage deposit is still a pause, so a confirmation keeps it out of the projection (#792 critic cycle 1, P1-1)', () => {
    const series = detectRecurring(rows, isoDate('2026-06-05'), []);
    const rh = series.find((s) => /robinhood/i.test(s.merchantCanonical))!.merchantCanonical;
    const payroll = series.find((s) => /northwind/i.test(s.merchantCanonical))!.merchantCanonical;
    // Both stop. A MONTHLY income series is projected whether or not it is still arriving,
    // so a confirmed pause is the reader's only way to stop counting it.
    const lapsed = lapsedIncomeSeries(series, isoDate('2026-07-25')).map((p) => p.merchantCanonical);
    expect(lapsed).toContain(rh);
    expect(lapsed).toContain(payroll);
    expect(confirmedPauseState(series, isoDate('2026-07-25'), rh).status).toBe('paused');
    expect(confirmedPauseState(series, isoDate('2026-07-25'), payroll).status).toBe('paused');
  });
});

describe('P3-2 — the bulk re-file and the bank-text edit take money coming back as a move', () => {
  it('"VANGUARD ACH RTN" waiting in review is re-filed Investment & Savings, not left unsure', () => {
    const row = { id: 'w', rawDescriptor: 'VANGUARD ACH RTN', amountCents: 500000, date: '2026-05-09', accountId: 'chk', categoryId: null, needsReview: true, isSplitParent: false, taxClass: null };
    const plan = planBackfill([row]);
    expect(plan.refiles.map((r) => [r.id, r.toCategoryId])).toEqual([['w', 'investment']]);
    // Anti-vacuity: an inflow the categorizer files to spending still stays unsure.
    expect(planBackfill([{ ...row, rawDescriptor: 'KROGER #0412' }]).refiles).toEqual([]);
  });

  it('a bank-text edit on an unsure inflow applies a money-move verdict, never a spending one', () => {
    const row = { isSplitParent: false, needsReview: true, categoryId: null, amountCents: 500000 };
    expect(shouldApplyRematchCategory(row, { matchedRuleId: null, categoryId: 'investment', needsReview: false })).toBe(true);
    expect(shouldApplyRematchCategory(row, { matchedRuleId: null, categoryId: 'shopping', needsReview: false })).toBe(false);
  });
});
