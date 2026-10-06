/**
 * DECISIONS #789, critic cycle 1 — the places "Investment & Savings is never spending"
 * did not reach, and the categorizer names it would have turned into deleted spending.
 *
 * P0-1 the coach's cut list (and the Money Review and the FI counterfactual built on it)
 * read a brokerage deposit as a cuttable subscription; P1-1 /coach "biggest purchases"
 * listed deposits; P1-2 a money dial on Investment & Savings vanished without a word;
 * P1-3 bare brokerage names ("LES SCHWAB TIRES", "MERRILL GARDENS") were filed Investment
 * & Savings, so real spending would have left every figure; P2-1 Ask could not reach the
 * category's own answer; P2-2 "how much did I spend at Vanguard" denied the money moved;
 * P2-4 the register's totals and type filter still read deposits as Money out / Expense;
 * P3-1 the unusual-charge radar called a lump-sum deposit a "charge".
 *
 * Every amount and name below is invented.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { isoDate } from '@/lib/dates';
import { INVESTING_MOVE_WORD_RE, readsAsBrokerageMove } from '@/lib/engine/categorize/brokerage-move';
import { isMoneyMoveCategoryId } from '@/lib/engine/categorize/categories';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { isSpendRow } from '@/lib/engine/reports/reports';
import { countsInFlows, findOpportunities, isMoneyMoveSeries, moneyMoveMerchantCanonicals } from '@/lib/engine/fi/insights';
import { detectRecurring, type RecurringTxn } from '@/lib/engine/recurring/detect';
import { detectUnusualCharges } from '@/lib/engine/anomaly/detect';
import { answerMerchantSpend, merchantSpend, toAskTxnRows } from '@/lib/engine/assistant/answer';
import { parseAssistantQuery, type Timeframe } from '@/lib/engine/assistant/intent';
import { summarizeTransactions } from '@/lib/engine/transactions/query';
import { buildPostedCalendarMonth, type PostedTxnLike } from '@/lib/engine/calendar/posted';
import { INVESTMENT_DIAL_RETIRED_NOTE, storedDialOnInvestment } from '@/lib/engine/settings/money-dial-ids';
import { getCoachData } from '@/server/coach';

const MAY: Timeframe = { fromYm: '2026-05', toYm: '2026-05', label: 'last month' };

describe('P1-3 — a brokerage name means money moving only where a business cannot carry it', () => {
  it('the categorizer no longer files a same-named business as Investment & Savings', () => {
    for (const d of [
      'LES SCHWAB TIRES #0123 BEND OR',
      'LES SCHWAB TIRE CTR 1234',
      'SQ *SCHWAB MEATS',
      'MERRILL GARDENS AT RENTON',
      'MERRILL GARDENS RENT PMT',
      'VANGUARD CLEANING SYSTEMS',
      'VANGUARD CAR RENTAL',
      'VANGUARD PRINTING LLC',
      'TST* ROBINHOOD BURGERS',
      'BETTERMENT HOME SERVICES',
      'LITTLE ACORNS DAYCARE',
      'LES SCHWAB TIRES REFUND',
    ]) {
      const r = categorize({ rawDescriptor: d, amountCents: -85000, date: '2026-05-22', accountId: 'chk', isTransfer: false } as never);
      expect(r.categoryId, d).not.toBe('investment');
      expect(readsAsBrokerageMove(d), d).toBe(false);
    }
  });

  it('…and still files what brokerages actually send', () => {
    for (const d of [
      'VANGUARD BUY INVESTMENT PPD ID: 0000000001',
      'VANGUARD SELL INVESTMENT',
      'FID BKG SVC LLC MONEYLINE PPD',
      'SCHWAB BROKERAGE MONEYLINK TRANSFER',
      'CHARLES SCHWAB',
      'ROBINHOOD DEBITS',
      'ROBINHOOD FUNDS',
      'MERRILL LYNCH',
      'ACORNS INVEST',
      'WEALTHFRONT EDI PYMNTS',
      'E*TRADE ACH',
      'COINBASE.COM',
    ]) {
      const r = categorize({ rawDescriptor: d, amountCents: -50000, date: '2026-05-04', accountId: 'chk', isTransfer: false } as never);
      expect(r.categoryId, d).toBe('investment');
      expect(readsAsBrokerageMove(d), d).toBe(true);
    }
    expect(INVESTING_MOVE_WORD_RE.test('TIRES')).toBe(false);
  });

  it('the FILING decides, whoever filed it — the bank’s text never overrides it (critic cycle 2, P1-1)', () => {
    expect(isMoneyMoveCategoryId('investment')).toBe(true);
    expect(isMoneyMoveCategoryId('transfer')).toBe(true);
    expect(isMoneyMoveCategoryId('groceries')).toBe(false);
    expect(isMoneyMoveCategoryId(null)).toBe(false);
    // A bare "Vanguard" the reader filed Investment & Savings is not spending.
    const mine = { date: '2026-05-22', amountCents: -100000, categoryId: 'investment', rawDescriptor: 'Vanguard', isTransfer: false };
    expect(isSpendRow(mine, { fromYm: '2026-05', toYm: '2026-05' })).toBe(false);
    expect(countsInFlows({ ...mine, accountId: 'chk', status: 'POSTED' })).toBe(false);
    // Filed to a spending leaf, the same text is spending.
    const groceries = { ...mine, categoryId: 'groceries' };
    expect(isSpendRow(groceries, { fromYm: '2026-05', toYm: '2026-05' })).toBe(true);
    expect(countsInFlows({ ...groceries, accountId: 'chk', status: 'POSTED' })).toBe(true);
  });
});

describe('P0-1 — money moved into investing is never a cut', () => {
  const T = (date: string, amountCents: number, rawDescriptor: string): RecurringTxn => ({ id: `${date}:${rawDescriptor}`, accountId: 'chk', date, amountCents, rawDescriptor });
  const rows: RecurringTxn[] = [
    ...['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15'].map((d) => T(d, -50000, 'VANGUARD BUY INVESTMENT')),
    T('2026-05-15', -60000, 'VANGUARD BUY INVESTMENT'),
    // A reader-filed 529 plan the categorizer cannot name, rising too.
    ...['2026-01-20', '2026-02-20', '2026-03-20', '2026-04-20'].map((d) => T(d, -20000, 'NY 529 COLLEGE SAVINGS PLAN')),
    T('2026-05-20', -25000, 'NY 529 COLLEGE SAVINGS PLAN'),
    // A real subscription that rose.
    ...['2026-01-08', '2026-02-08', '2026-03-08', '2026-04-08'].map((d) => T(d, -1599, 'NETFLIX.COM')),
    T('2026-05-08', -1799, 'NETFLIX.COM'),
  ];
  const series = detectRecurring(rows, isoDate('2026-06-10'), []);
  const stored = rows.map((r) => ({ ...r, categoryId: r.rawDescriptor.startsWith('NY 529') ? 'investment' : null }));

  it('a rising auto-invest — by its default filing, or by the reader’s — is not a price that crept; Netflix still is', () => {
    const moves = moneyMoveMerchantCanonicals(stored);
    const opps = findOpportunities(series, 700, 250, [], moves);
    expect(opps.some((o) => /vanguard/i.test(o.merchant))).toBe(false);
    expect(opps.some((o) => /529/i.test(o.merchant))).toBe(false);
    expect(opps.some((o) => o.kind === 'price-increase' && /netflix/i.test(o.merchant))).toBe(true);
    expect(series.filter((s) => isMoneyMoveSeries(s, moves)).length).toBe(2);
    // Anti-vacuity: with no money-move knowledge the 529 rise WOULD be a cut.
    expect(findOpportunities(series, 700, 250, [], new Set()).some((o) => /529/i.test(o.merchant))).toBe(true);
  });
});

describe('P2-1 / P2-2 — Ask', () => {
  it('reaches the category by its own name', () => {
    for (const q of ['how much did I spend on Investment & Savings last month', 'how much did i spend on investment and savings last month']) {
      const p = parseAssistantQuery(q, isoDate('2026-06-10'), []);
      expect(p.kind, q).toBe('spend_by_category');
      expect(p.kind === 'spend_by_category' && p.target).toMatchObject({ type: 'category', categoryId: 'investment' });
    }
  });

  it('"how much did I spend at Vanguard" says the money went there and is saving — never "no spending"', () => {
    const rows = toAskTxnRows([
      { id: 'v1', date: '2026-05-15', amountCents: -60000, rawDescriptor: 'VANGUARD BUY INVESTMENT', status: 'POSTED', isTransfer: false, categoryId: 'investment' },
      { id: 'v2', date: '2026-05-28', amountCents: -40000, rawDescriptor: 'VANGUARD BUY INVESTMENT', status: 'POSTED', isTransfer: false, categoryId: 'investment' },
    ]);
    const res = merchantSpend(rows, MAY, 'vanguard buy investment', '2026-06-10');
    expect(res.count).toBe(0);
    expect([res.moneyMoveCount, res.moneyMoveCents]).toEqual([2, 100000]);
    const a = answerMerchantSpend(res, MAY);
    expect(a.headline).toBe("Money sent to Vanguard Buy Investment isn't spending last month.");
    expect(a.detail).toBe('$1,000.00 went there across 2 transfers — money moved into investing or savings is saving, not spending.');
  });

  it('the filing decides (critic cycle 2, P1-1): a tire shop filed to spending is spending; a "Vanguard" the reader filed Investment & Savings is not', () => {
    const tires = toAskTxnRows([{ id: 't1', date: '2026-05-22', amountCents: -85000, rawDescriptor: 'LES SCHWAB TIRES #0123', status: 'POSTED', isTransfer: false, categoryId: 'auto-maintenance' }]);
    const atTires = merchantSpend(tires, MAY, tires[0]!.merchant.toLowerCase(), '2026-06-10');
    expect([atTires.count, atTires.moneyMoveCount]).toEqual([1, 0]);
    expect(answerMerchantSpend(atTires, MAY).headline).toContain('$850.00');
    const mine = toAskTxnRows([{ id: 'v1', date: '2026-05-04', amountCents: -100000, rawDescriptor: 'Vanguard', status: 'POSTED', isTransfer: false, categoryId: 'investment' }]);
    const atVanguard = merchantSpend(mine, MAY, mine[0]!.merchant.toLowerCase(), '2026-06-10');
    expect([atVanguard.count, atVanguard.moneyMoveCount, atVanguard.moneyMoveCents]).toEqual([0, 1, 100000]);
  });
});

describe('P2-4 — the register and the calendar total money in and out by the same rule', () => {
  const june = [
    { date: '2026-06-01', amountCents: 500000, isTransfer: false, categoryId: 'paycheck', rawDescriptor: 'NORTHWIND PAYROLL' },
    { date: '2026-06-03', amountCents: -40000, isTransfer: false, categoryId: 'groceries', rawDescriptor: 'KROGER' },
    { date: '2026-06-04', amountCents: -100000, isTransfer: false, categoryId: 'investment', rawDescriptor: 'VANGUARD BUY INVESTMENT' },
    { date: '2026-06-08', amountCents: 25000, isTransfer: false, categoryId: 'investment', rawDescriptor: 'VANGUARD SELL INVESTMENT' },
    { date: '2026-06-09', amountCents: -85000, isTransfer: false, categoryId: 'auto-maintenance', rawDescriptor: 'LES SCHWAB TIRES #0123' },
  ];
  it('Money in $5,000.00, Money out $1,250.00 (groceries + tires) — the deposit and the money back are moves', () => {
    const s = summarizeTransactions(june);
    expect([s.inflowCents, s.outflowCents]).toEqual([500000, 125000]);
    const cal = buildPostedCalendarMonth({
      month: '2026-06',
      today: isoDate('2026-06-10'),
      rows: june.map((r): PostedTxnLike => ({ ...r, excludeFromTotals: false, onHandoverDay: false })),
      oldestPostedDate: isoDate('2026-06-01'),
      newestPostedDate: isoDate('2026-06-09'),
    });
    expect([cal.totalInCents, cal.totalOutCents]).toEqual([s.inflowCents, s.outflowCents]);
  });
});

describe('P3-1 — a lump-sum deposit is not an unusual charge', () => {
  it('six Vanguard deposits, one of $5,000.00: nothing flagged; the same rows filed to spending would be', () => {
    const mk = (cat: string) =>
      ['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15'].map((d, i) => ({ id: `v${i}`, date: d, amountCents: -50000, rawDescriptor: 'VANGUARD BUY INVESTMENT', isTransfer: false, status: 'POSTED', categoryId: cat })).concat([
        { id: 'v9', date: '2026-06-02', amountCents: -500000, rawDescriptor: 'VANGUARD BUY INVESTMENT', isTransfer: false, status: 'POSTED', categoryId: cat },
      ]);
    expect(detectUnusualCharges(mk('investment'), isoDate('2026-06-10'))).toEqual([]);
    expect(detectUnusualCharges(mk('shopping'), isoDate('2026-06-10')).length).toBe(1);
  });
});

describe('P1-2 — a money dial on Investment & Savings is named, not dropped silently', () => {
  it('by id or by its built-in name; never for any other dial', () => {
    expect(storedDialOnInvestment(['dining', 'investment'])).toBe(true);
    expect(storedDialOnInvestment(['Investment & Savings'])).toBe(true);
    expect(storedDialOnInvestment(['dining', 'travel'])).toBe(false);
    expect(INVESTMENT_DIAL_RETIRED_NOTE).toBe(
      'Investment & Savings was one of your money dials. Money moved into investing or savings isn’t spending, so it can’t be a dial — it isn’t shown above, and saving these settings removes it.',
    );
  });
});

describe('P0-1 / P1-1 / P3-1 — the real /coach loader', () => {
  const USER = `inv-not-spend-${Date.now()}-${process.pid}`;
  const CHK = `${USER}-chk`;
  beforeAll(async () => {
    vi.stubEnv('DEMO_TODAY', '2026-06-10');
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local`, paymentAccountId: null } });
    await prisma.account.create({
      data: { id: CHK, userId: USER, provider: 'manual', providerRef: `${USER}-r`, name: 'Everyday Checking', type: 'CHECKING', mask: '3318', currentBalanceCents: 900000, currency: 'USD' },
    });
    await prisma.user.update({ where: { id: USER }, data: { paymentAccountId: CHK } });
    const r = (date: string, amountCents: number, rawDescriptor: string, categoryId: string) => ({ accountId: CHK, date, amountCents, rawDescriptor, categoryId, confidenceBps: 10000, needsReview: false });
    const data = [];
    for (const m of ['01', '02', '03', '04', '05']) {
      data.push(r(`2026-${m}-01`, 500000, 'NORTHWIND PAYROLL PPD', 'paycheck'));
      data.push(r(`2026-${m}-03`, -40000, 'KROGER #0412', 'groceries'));
      data.push(r(`2026-${m}-15`, m === '05' ? -60000 : -50000, 'VANGUARD BUY INVESTMENT', 'investment'));
    }
    data.push(r('2026-05-22', -85000, 'LES SCHWAB TIRES #0123', 'auto-maintenance'));
    // Critic cycle 2, P1-1: a bare "Vanguard" the reader entered and filed Investment &
    // Savings, rising $500 → $600 — the reader's filing, never second-guessed from the text.
    for (const m of ['01', '02', '03', '04', '05']) data.push(r(`2026-${m}-20`, m === '05' ? -60000 : -50000, 'Vanguard', 'investment'));
    data.push(r('2026-06-02', -500000, 'VANGUARD BUY INVESTMENT', 'investment'));
    await prisma.transaction.createMany({ data });
  });
  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
    vi.unstubAllEnvs();
  });

  it('no Vanguard cut, no Vanguard "biggest purchase", no Vanguard "unusual charge"; the tire purchase still counts', async () => {
    const d = await getCoachData(USER, { cutImpact: true });
    expect(d.opportunities.some((o) => /vanguard/i.test(o.merchant))).toBe(false);
    expect(d.lifeEnergy.some((x) => /vanguard/i.test(x.merchant))).toBe(false);
    expect(d.lifeEnergy.some((x) => /schwab/i.test(x.merchant))).toBe(true);
    expect(d.unusualCharges.some((u) => /vanguard/i.test(u.merchantCanonical))).toBe(false);
    expect(JSON.stringify(d.review)).not.toMatch(/vanguard/i);
  });
});
