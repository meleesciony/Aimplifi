/**
 * Seed invariants (docs/SEED_SPEC.md ✔ marks), determinism, and the GOLDEN
 * integration test: assembled seed data → Cash-Needed Engine → the exact
 * hand-computed headline in docs/EDGE_CASES.md §Seed-headline.
 */
import { describe, expect, it } from 'vitest';
import { buildSeedData, seedChecksum } from '@/lib/seed/build';
import { assembleCashNeededInput, netWorthCents } from '@/lib/engine/cash-needed/assemble';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import { dayOfWeek, holidayTable, isWeekend, isoDate } from '@/lib/dates';

const seed = buildSeedData('2026-06-10');
const HOLIDAYS = holidayTable(2024, 2027);

function assemble(scenario: 'PAY_IN_FULL' | 'MINIMUM') {
  return assembleCashNeededInput({
    today: isoDate('2026-06-10'),
    scenario,
    paymentAccountId: seed.user.paymentAccountId,
    accounts: seed.accounts,
    autopays: seed.autopays,
    statements: seed.statements,
    cardPayments: seed.cardPayments,
    transactions: seed.transactions,
    scheduled: seed.scheduled,
    holidayTable: HOLIDAYS,
  });
}

describe('seed determinism (SEED_SPEC ✔)', () => {
  it('same asOf ⇒ identical dataset (checksum match over stable serialization)', () => {
    const again = buildSeedData('2026-06-10');
    expect(seedChecksum(again)).toBe(seedChecksum(seed));
    expect(again).toEqual(seed);
  });
  it('a different asOf produces a different dataset', () => {
    expect(seedChecksum(buildSeedData('2026-06-11'))).not.toBe(seedChecksum(seed));
  });
});

describe('accounts (SEED_SPEC ✔ counts and shapes)', () => {
  it('has the 9 specified accounts with spec balances', () => {
    expect(seed.accounts).toHaveLength(9);
    const byName = Object.fromEntries(seed.accounts.map((a) => [a.name, a]));
    expect(byName['Everyday Checking'].currentBalanceCents).toBe(340000);
    expect(byName['High-Yield Savings'].currentBalanceCents).toBe(1850000);
    expect(byName['Joint Checking'].currentBalanceCents).toBe(120000);
    expect(byName['Brokerage'].type).toBe('INVESTMENT');
    expect(byName['Auto Loan'].currentBalanceCents).toBe(1430000);
    expect(seed.accounts.filter((a) => a.type === 'CREDIT')).toHaveLength(4);
  });
  it('payment account is Everyday Checking', () => {
    expect(seed.user.paymentAccountId).toBe('acct-checking');
  });
  it('masks are last-4 only — no full account numbers anywhere', () => {
    for (const a of seed.accounts) expect(a.mask).toMatch(/^\d{4}$/);
  });
  it('only Platinum has autopay, mode STATEMENT_BALANCE', () => {
    expect(seed.autopays).toHaveLength(1);
    expect(seed.autopays[0].accountId).toBe('acct-platinum');
    expect(seed.autopays[0].mode).toBe('STATEMENT_BALANCE');
  });
});

describe('transactions (SEED_SPEC ✔)', () => {
  it('span 18 months ending at asOf', () => {
    const dates = seed.transactions.map((t) => t.date);
    expect(dates.some((x) => x <= '2025-01-15')).toBe(true);
    expect(dates.every((x) => x <= '2026-06-10')).toBe(true);
  });
  it('biweekly payroll: +$2,450.00, every other Friday, ≥35 deposits', () => {
    const payroll = seed.transactions.filter((t) => t.rawDescriptor.includes('PAYROLL'));
    expect(payroll.length).toBeGreaterThanOrEqual(35);
    for (const p of payroll) {
      expect(p.amountCents).toBe(245000);
      expect(dayOfWeek(isoDate(p.date))).toBe(5); // Friday
    }
    const sorted = payroll.map((p) => p.date).sort();
    expect(sorted[sorted.length - 1]).toBe('2026-05-29'); // last posted before asOf (next is 06-12)
  });
  it('≥3 pending at asOf, including −$250.00 on the payment account (edge case J)', () => {
    const pending = seed.transactions.filter((t) => t.status === 'PENDING');
    expect(pending.length).toBeGreaterThanOrEqual(3);
    expect(
      pending.some((t) => t.accountId === 'acct-checking' && t.amountCents === -25000),
    ).toBe(true);
  });
  it('≥40 distinct messy raw descriptors, with all required families present', () => {
    const distinct = new Set(seed.transactions.map((t) => t.rawDescriptor));
    expect(distinct.size).toBeGreaterThanOrEqual(40);
    const all = [...distinct].join('\n');
    for (const family of [
      'SQ *', 'TST*', 'AMZN Mktp US*', 'PAYPAL *', 'HMSHOST-ATL-T4-POS',
      'COSTCO GAS #', 'COSTCO WHSE #', 'UBER *TRIP', 'UBER *EATS', 'CHECK #', 'ACH ',
    ]) {
      expect(all).toContain(family);
    }
  });
  it('transfers are flagged: monthly $500 checking→savings pairs and card payments', () => {
    const out = seed.transactions.filter(
      (t) => t.accountId === 'acct-checking' && t.amountCents === -50000 && t.isTransfer,
    );
    const into = seed.transactions.filter(
      (t) => t.accountId === 'acct-savings' && t.amountCents === 50000 && t.isTransfer,
    );
    expect(out.length).toBeGreaterThanOrEqual(15);
    expect(out.length).toBe(into.length);
    const cardPays = seed.transactions.filter((t) => t.rawDescriptor === 'PAYMENT THANK YOU');
    expect(cardPays.length).toBeGreaterThan(0);
    expect(cardPays.every((t) => t.isTransfer)).toBe(true);
  });
  it('subscriptions: ≥8 recurring merchants billing monthly', () => {
    const subs = [
      'PAYPAL *SPOTIFYUSA', 'NETFLIX.COM', 'LA FITNESS', 'APPLE.COM/BILL',
      'GOOGLE *YOUTUBEPREMIUM', 'HELLOFRESH', 'GEICO', 'COMCAST',
    ];
    for (const s of subs) {
      const rows = seed.transactions.filter((t) => t.rawDescriptor.includes(s));
      expect(rows.length, `subscription ${s}`).toBeGreaterThanOrEqual(12);
    }
  });
  it('Netflix price increase: $15.49 → $17.99 four months before asOf (SEED_SPEC ✔)', () => {
    const netflix = seed.transactions.filter((t) => t.rawDescriptor.includes('NETFLIX'));
    const before = netflix.filter((t) => t.date < '2026-02-01');
    const after = netflix.filter((t) => t.date >= '2026-02-01');
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    expect(before.every((t) => t.amountCents === -1549)).toBe(true);
    expect(after.every((t) => t.amountCents === -1799)).toBe(true);
  });
  it('lifestyle creep: final-3-month discretionary spend ≥10% above the 6-months-prior window', () => {
    const diningShopping = (from: string, to: string) =>
      seed.transactions
        .filter((t) => !t.isTransfer && t.amountCents < 0 && t.date >= from && t.date < to)
        .filter((t) => /SQ \*|TST\*|AMZN Mktp|AMAZON|TARGET|WM SUPERCENTER|CHICK|MCDONALD|STARBUCKS|UBER \*EATS|WAFFLE|HOME DEPOT|LOWES|ETSY|HMSHOST|SPIRIT/.test(t.rawDescriptor))
        .reduce((s, t) => s - t.amountCents, 0);
    const recent = diningShopping('2026-03-01', '2026-06-01');
    const earlier = diningShopping('2025-09-01', '2025-12-01');
    expect(recent).toBeGreaterThan(earlier * 1.1);
  });
  it('the $50.00 Sapphire refund posts 2 days after the 05-18 statement close (edge case F ✔)', () => {
    const refund = seed.transactions.find(
      (t) => t.accountId === 'acct-sapphire' && t.amountCents === 5000 && !t.isTransfer,
    );
    expect(refund).toBeDefined();
    expect(refund!.date).toBe('2026-05-20');
  });
});

describe('statements (SEED_SPEC ✔)', () => {
  it('~18 months of history for the three main cards', () => {
    for (const id of ['acct-sapphire', 'acct-platinum', 'acct-freedom']) {
      expect(seed.statements.filter((s) => s.accountId === id).length).toBeGreaterThanOrEqual(17);
    }
  });
  it('minimum payment = max($35, 1% of balance) on every statement', () => {
    for (const s of seed.statements) {
      const expected = s.statementBalanceCents <= 0 ? 0 : Math.max(3500, Math.round(s.statementBalanceCents / 100));
      expect(s.minimumPaymentCents).toBe(expected);
    }
  });
  it('at least one historical due date falls on a weekend ✔', () => {
    expect(seed.statements.some((s) => isWeekend(isoDate(s.dueDate)))).toBe(true);
  });
  it('Store Card has NO statement due on/after asOf (estimate path ✔) and some $0-due history', () => {
    const store = seed.statements.filter((s) => s.accountId === 'acct-store');
    expect(store.length).toBeGreaterThan(0);
    expect(store.every((s) => s.dueDate < '2026-06-10')).toBe(true);
    expect(store.some((s) => s.statementBalanceCents === 0)).toBe(true);
  });
  it('Freedom has the $400.00 mid-cycle manual payment against the current statement ✔', () => {
    const current = seed.statements.find(
      (s) => s.accountId === 'acct-freedom' && s.cycleEnd === '2026-06-01',
    )!;
    const pays = seed.cardPayments.filter((p) => p.statementId === current.id);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ amountCents: 40000, date: '2026-06-05', source: 'manual' });
  });
});

describe('GOLDEN: seed → assembler → engine matches EDGE_CASES §Seed-headline exactly', () => {
  const result = computeCashNeeded(assemble('PAY_IN_FULL'));

  it('requires $5,412.33 across 3 cards by 2026-06-26', () => {
    expect(result.headline.requiredCents).toBe(541233);
    expect(result.headline.byDate).toBe('2026-06-26');
    expect(result.headline.cardsDueCount).toBe(3);
  });
  it('flags the engineered intra-period dip: −$1,012.33 on 2026-06-24, though both endpoints are positive', () => {
    expect(result.intraPeriodMinimum).toEqual({ date: '2026-06-24', balanceCents: -101233 });
    expect(result.headline.shortfallCents).toBe(101233);
    expect(result.headline.shortfallDate).toBe('2026-06-24');
    expect(result.perDueDate.map((p) => p.projectedBalanceAfterCents)).toEqual([78767, 83767]);
  });
  it('recommends transferring $1,050.00 by Tuesday 2026-06-23', () => {
    expect(result.headline.recommendation).toEqual({ amountCents: 105000, byDate: '2026-06-23' });
  });
  it('per-due-date points: 06-15 = $4,812.33 (Sapphire + Platinum), 06-26 = $600.00 (Freedom)', () => {
    expect(result.perDueDate).toHaveLength(2);
    expect(result.perDueDate[0]).toMatchObject({
      date: '2026-06-15',
      dayTotalCents: 481233,
      cumulativeNeedCents: 481233,
    });
    expect(result.perDueDate[1]).toMatchObject({
      date: '2026-06-26',
      dayTotalCents: 60000,
      cumulativeNeedCents: 541233,
    });
  });
  it('Freedom: weekend due date 06-28 → effective Friday 06-26; remaining $600 after the $400 payment', () => {
    const freedom = result.cards.find((c) => c.cardId === 'acct-freedom')!;
    expect(freedom.dueDate).toBe('2026-06-28');
    expect(freedom.effectiveDueDate).toBe('2026-06-26');
    expect(freedom.remainingDueCents).toBe(60000);
  });
  it('Platinum is autopay-covered (no user action); Sapphire requires action and notes the post-close credit', () => {
    const platinum = result.cards.find((c) => c.cardId === 'acct-platinum')!;
    expect(platinum.userActionCents).toBe(0);
    expect(platinum.autopayCents).toBe(210000);
    const sapphire = result.cards.find((c) => c.cardId === 'acct-sapphire')!;
    expect(sapphire.userActionCents).toBe(271233);
    expect(sapphire.notes.join(' ')).toMatch(/\$50\.00 credit posted after statement close/);
  });
  it('Store Card appears as an upcoming ESTIMATE of $43.50 due 2026-07-15, excluded from the headline', () => {
    expect(result.upcoming).toHaveLength(1);
    expect(result.upcoming[0]).toMatchObject({
      cardId: 'acct-store',
      isEstimated: true,
      cashRequiredCents: 4350,
      dueDate: '2026-07-15',
    });
  });

  it('MINIMUM scenario: $2,135.00 required, no shortfall, ADB interest $67.36 (hand math)', () => {
    // ADB per card (see critic5 seed re-derivation): Sapphire 5750 + Platinum 0
    // (autopay full) + Freedom 986 = 6736. Store Card is an estimate (upcoming), excluded.
    const min = computeCashNeeded(assemble('MINIMUM'));
    expect(min.headline.requiredCents).toBe(213500);
    expect(min.headline.byDate).toBe('2026-06-15');
    expect(min.headline.shortfallCents).toBe(0);
    expect(min.headline.recommendation).toBeNull();
    expect(min.minimumPathInterestCents).toBe(6736);
  });
});

describe('net worth (EDGE_CASES §Seed-headline)', () => {
  it('equals $144,804.74 at asOf (assets 165,100.00 − liabilities 20,295.26)', () => {
    expect(netWorthCents(seed.accounts)).toBe(14480474);
  });
  it('every account has 18 month-end balance snapshots for the trend chart', () => {
    for (const a of seed.accounts) {
      expect(seed.snapshots.filter((s) => s.accountId === a.id)).toHaveLength(18);
    }
  });
});
