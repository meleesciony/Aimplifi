/**
 * TASKS U.5 — the account detail panel and the net-worth trend must not name
 * different balances for the same date.
 *
 * `getAccountDetail` read `BalanceSnapshot` RAW while the trend on the SAME page
 * reads it through `applyReconciliationBoundary`. U.4 writes both sides of a
 * combined pair at ONE date (deliberately — it is what lets the boundary
 * de-duplicate them), so every month a combined pair produces a same-dated
 * collision and the boundary drops one side. The panel showed the dropped row
 * as an ordinary recorded balance, under a "counted as" marker and notes that
 * say which side of net worth the date lands on — claims that were false for
 * exactly those rows.
 *
 * These are real-Prisma tests because the property under test is that TWO
 * SERVER READS AGREE: what `getAccountDetail` marks uncounted is exactly what
 * `getAccountsView`'s trend leaves out. A pure test of the boundary would pass
 * while the panel's own query kept bypassing it — which is the bug.
 *
 * Isolation mirrors reconcile-accounts-view.test.ts: collision-proof throwaway
 * user ids, wipe in before/afterAll, links reset per-test.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { getAccountDetail, getAccountsView } from '@/server/transactions';

const STAMP = `${Date.now()}-${process.pid}`;
const OWNER = `ad-owner-${STAMP}`;
const FOREIGN = `ad-foreign-${STAMP}`;
const ALL_USERS = [OWNER, FOREIGN];

// The U.5 shape, with the row's own numbers: an auto loan that moved from
// SimpleFIN to Plaid. Both sides carry a row on the SAME three dates, which is
// what U.4's writer produces for every account a user holds.
const DATES = ['2026-03-15', '2026-04-15', '2026-05-15'] as const;
const CUTOVER = '2026-04-15';
const PRED_BALANCE = 1_430_000; // $14,300.00
const SUCC_BALANCE = 1_290_000; // $12,900.00

let pred = '';
let succ = '';
let foreignPred = '';
let foreignSucc = '';

async function wipe() {
  await prisma.user.deleteMany({ where: { id: { in: ALL_USERS } } });
}

async function seedPair(userId: string, predCurrency: string) {
  const p = await prisma.account.create({
    data: {
      userId, provider: 'simplefin', providerRef: `sf-${userId}`, name: 'Auto Loan (old)',
      type: 'LOAN', mask: '6619', currency: predCurrency, currentBalanceCents: PRED_BALANCE,
    },
  });
  await prisma.plaidItem.create({ data: { userId, itemId: `ad-item-${userId}`, accessToken: 'ct-ad' } });
  const s = await prisma.account.create({
    data: {
      userId, provider: 'plaid', providerRef: `pl-${userId}`, plaidItemId: `ad-item-${userId}`,
      name: 'Auto Loan', type: 'LOAN', mask: '6619', currency: 'USD', currentBalanceCents: SUCC_BALANCE,
    },
  });
  await prisma.balanceSnapshot.createMany({
    data: DATES.flatMap((date) => [
      { accountId: p.id, date, balanceCents: PRED_BALANCE, accountType: 'LOAN' },
      { accountId: s.id, date, balanceCents: SUCC_BALANCE, accountType: 'LOAN' },
    ]),
  });
  return { predId: p.id, succId: s.id };
}

beforeAll(async () => {
  await wipe();
  await prisma.user.createMany({ data: ALL_USERS.map((id) => ({ id, email: `${id}@test.local` })) });
  ({ predId: pred, succId: succ } = await seedPair(OWNER, 'USD'));
  ({ predId: foreignPred, succId: foreignSucc } = await seedPair(FOREIGN, 'EUR'));
});

afterEach(async () => {
  await prisma.accountReconciliation.deleteMany({ where: { userId: { in: ALL_USERS } } });
});

afterAll(wipe);

async function link(userId: string, predecessorAccountId: string, successorAccountId: string, undone = false) {
  await prisma.accountReconciliation.create({
    data: {
      userId, predecessorAccountId, successorAccountId, cutoverDate: CUTOVER,
      matchSignal: 'mask', confidence: 'high', ...(undone ? { undoneAt: new Date() } : {}),
    },
  });
}

const uncountedDates = (d: Awaited<ReturnType<typeof getAccountDetail>>) =>
  (d?.history ?? []).filter((h) => !h.countsInNetWorth).map((h) => h.date);

const countedInsteadAt = (d: Awaited<ReturnType<typeof getAccountDetail>>, date: string) =>
  (d?.history ?? []).find((h) => h.date === date)?.countedInstead ?? null;

/** The dates the TREND actually counts for an account — read off the same view
 *  the page renders, so the comparison is between two real surfaces. */
async function trendDatesFor(userId: string, accountId: string): Promise<string[]> {
  const view = await getAccountsView(userId);
  return view.trend
    .filter((p) => p.constituents.some((c) => c.accountId === accountId))
    .map((p) => p.date);
}

describe('getAccountDetail — nothing combined (the shape every demo panel has)', () => {
  it('counts every recorded row and names no counterpart', async () => {
    const detail = await getAccountDetail(OWNER, succ);
    expect(detail?.history.map((h) => h.date)).toEqual([...DATES]);
    expect(detail?.history.every((h) => h.countsInNetWorth)).toBe(true);
    expect(detail?.history.every((h) => h.countedInstead === null)).toBe(true);
    // U.10 control: none of these dates is today (2026-06-10).
    expect(detail?.history.every((h) => h.replacedByLive === false)).toBe(true);
  });
});

describe('getAccountDetail — a combined pair', () => {
  it('marks the successor rows the trend drops, and names the account counted instead (FAIL-OLD: every row read as counted)', async () => {
    await link(OWNER, pred, succ);
    const detail = await getAccountDetail(OWNER, succ);

    // The boundary keeps the PREDECESSOR on/before the cutover, so the
    // successor's own rows on those dates are not what net worth counts.
    expect(uncountedDates(detail)).toEqual(['2026-03-15', '2026-04-15']);
    expect(detail?.history.find((h) => h.date === '2026-05-15')?.countsInNetWorth).toBe(true);
    // The figure the trend used for that date, carried per row.
    expect(countedInsteadAt(detail, '2026-03-15')).toEqual({
      name: 'Auto Loan (old)',
      balanceCents: PRED_BALANCE,
      isLiability: true,
    });
    expect(countedInsteadAt(detail, '2026-05-15')).toBeNull();

    // Every row is still SHOWN — a balance the bank really did send for this
    // account is never deleted to make the page tidy.
    expect(detail?.history.map((h) => h.date)).toEqual([...DATES]);
    expect(detail?.history.every((h) => h.balanceCents === SUCC_BALANCE)).toBe(true);
  });

  it('THE U.5 PROPERTY: the panel marks uncounted exactly the dates the trend leaves the account out of', async () => {
    await link(OWNER, pred, succ);
    const detail = await getAccountDetail(OWNER, succ);
    const counted = (detail?.history ?? []).filter((h) => h.countsInNetWorth).map((h) => h.date);
    const inTrend = await trendDatesFor(OWNER, succ);

    // Two independent server reads, one page: the dates the panel calls counted
    // are the dates the chart's own constituents contain, and the rest are not.
    //
    // SCOPE, stated rather than implied: the forward direction holds for dates
    // inside the trend's 19-month render window (every fixture date here is).
    // That window bounds a payload, not a counting rule — it is a uniform date
    // filter, so it removes whole dates and never changes a collision verdict.
    for (const d of counted) expect(inTrend).toContain(d);
    for (const d of uncountedDates(detail)) expect(inTrend).not.toContain(d);
  });

  it('the other side of the same collision: the predecessor loses the dates AFTER the cutover', async () => {
    await link(OWNER, pred, succ);
    const detail = await getAccountDetail(OWNER, pred);
    expect(uncountedDates(detail)).toEqual(['2026-05-15']);
    expect(countedInsteadAt(detail, '2026-05-15')?.name).toBe('Auto Loan');
    const inTrend = await trendDatesFor(OWNER, pred);
    expect(inTrend).not.toContain('2026-05-15');
  });

  it('undo restores every row (R9 — a reversible act may not leave a permanent mark on history)', async () => {
    await link(OWNER, pred, succ, true);
    const detail = await getAccountDetail(OWNER, succ);
    expect(detail?.history.every((h) => h.countsInNetWorth)).toBe(true);
    expect(detail?.history.every((h) => h.countedInstead === null)).toBe(true);
  });
});

describe('getAccountDetail — the boundary inputs mirror the trend`s', () => {
  it('a link whose side the currency guard withholds is INERT here too (R7), so nothing is marked uncounted', async () => {
    // The predecessor is EUR: the trend never sees it (#135), so the link takes
    // no effect there. Building this account set WITHOUT the same withhold
    // would mark the successor's rows uncounted against a trend that counts
    // them — the panel disagreeing with the chart in the opposite direction.
    await link(FOREIGN, foreignPred, foreignSucc);
    const detail = await getAccountDetail(FOREIGN, foreignSucc);
    expect(detail?.history.every((h) => h.countsInNetWorth)).toBe(true);
    expect(detail?.history.every((h) => h.countedInstead === null)).toBe(true);

    const inTrend = await trendDatesFor(FOREIGN, foreignSucc);
    for (const d of DATES) expect(inTrend).toContain(d);
  });

  it('the withheld account ITSELF gets null, not a verdict it has no honest value for', async () => {
    // A non-USD account is in no net-worth figure at all, and `getAccountsView`
    // builds its rows from the supported set — so this page never renders a
    // panel for it. `true` would claim a counting that never happens; `false`
    // would be explained by a combine note about a combine that never happened.
    // Both were shipped during this slice and both were caught; null is the same
    // answer a stale or foreign id gets, and the page renders identically.
    expect(await getAccountDetail(FOREIGN, foreignPred)).toBeNull();
    const view = await getAccountsView(FOREIGN);
    expect(
      [...view.assets.accounts, ...view.liabilities.accounts].some((a) => a.id === foreignPred),
    ).toBe(false);
  });
});

describe('getAccountDetail — a CHAIN (A→B→C), where the winner is not the direct counterpart', () => {
  // FAIL-OLD for the U.5 money critic's P0: `keepsSnapshot` walks the chain
  // TRANSITIVELY, so a row of C's can be dropped in favour of A's. Feeding the
  // boundary only C's DIRECT counterpart (B) hid A and produced both a wrong
  // verdict ("counted", when the trend counts nothing of C's that date) and a
  // wrong figure (naming B's balance where the chart used A's).
  const CHAIN = `ad-chain-${STAMP}`;
  let a = '';
  let b = '';
  let c = '';

  beforeAll(async () => {
    await prisma.user.create({ data: { id: CHAIN, email: `${CHAIN}@test.local` } });
    const mk = async (name: string, balanceCents: number, dates: string[]) => {
      const acct = await prisma.account.create({
        data: {
          userId: CHAIN, provider: 'simplefin', providerRef: `sf-${name}-${STAMP}`, name,
          type: 'LOAN', mask: '4242', currency: 'USD', currentBalanceCents: balanceCents,
        },
      });
      await prisma.balanceSnapshot.createMany({
        data: dates.map((date) => ({ accountId: acct.id, date, balanceCents, accountType: 'LOAN' })),
      });
      return acct.id;
    };
    // A and C hold 2026-03-15; B deliberately does NOT — so only a transitive
    // walk can see that A owns that date.
    a = await mk('Loan A', 1_430_000, ['2026-03-15', '2026-04-15']);
    b = await mk('Loan B', 1_400_000, ['2026-04-15']);
    c = await mk('Loan C', 1_290_000, ['2026-03-15', '2026-04-15']);
    await prisma.accountReconciliation.createMany({
      data: [
        { userId: CHAIN, predecessorAccountId: a, successorAccountId: b, cutoverDate: '2026-04-30', matchSignal: 'mask', confidence: 'high' },
        { userId: CHAIN, predecessorAccountId: b, successorAccountId: c, cutoverDate: '2026-05-31', matchSignal: 'mask', confidence: 'high' },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: CHAIN } });
  });

  it("C's rows are judged over the WHOLE chain, and a date its direct counterpart does not own is never attributed to it", async () => {
    const detail = await getAccountDetail(CHAIN, c);
    // Both of C's dates are owned upstream: 2026-03-15 by A (B has no row),
    // 2026-04-15 by A as well (A's cutover is 2026-04-30, so A wins it).
    expect(uncountedDates(detail)).toEqual(['2026-03-15', '2026-04-15']);
    const inTrend = await trendDatesFor(CHAIN, c);
    for (const d of uncountedDates(detail)) expect(inTrend).not.toContain(d);
    // B is C's direct counterpart but owns NEITHER date, so no row may name it.
    // Naming a balance the chart did not use is the same defect as the one this
    // slice exists to fix, one link further out.
    expect(countedInsteadAt(detail, '2026-03-15')).toBeNull();
    expect(countedInsteadAt(detail, '2026-04-15')?.name ?? null).not.toBe('Loan B');
  });
});

describe('getAccountDetail — SIBLINGS (two stale rows continued onto ONE live account, TASKS U.9)', () => {
  // FAIL-OLD for the U.9 double-count. `keepsSnapshot` compared each stale row
  // against the successor and never against its TWIN — siblings are neither
  // `upstreamsOf` nor `downstreamsOf` each other — so on a date both cutovers
  // covered, BOTH survived and one real account contributed twice. This is a
  // real-Prisma test for the same reason the file exists: the property is that
  // the panel's verdict and the TREND'S OWN CONSTITUENTS agree.
  const SIB = `ad-sib-${STAMP}`;
  const BAL = 500_000; // $5,000.00 — the figure the U.5 critic measured as $10,000.00
  const BOTH = '2026-03-15'; // on/before BOTH cutovers → the double-count date
  const MIDDLE = '2026-05-15'; // past s1 cutover, inside s2's
  // Past both cutovers AND still in the past relative to this environment's
  // `today` (2026-06-10 — the seed's asOf). A fixture dated after it is filtered
  // out of the series entirely and proves nothing:
  // docs/lessons/the-fixture-must-live-at-the-same-today-as-the-server.md
  const AFTER = '2026-06-05';
  let s1 = '';
  let s2 = '';
  let live = '';

  beforeAll(async () => {
    await prisma.user.create({ data: { id: SIB, email: `${SIB}@test.local` } });
    const mk = async (name: string) => {
      const acct = await prisma.account.create({
        data: {
          userId: SIB, provider: 'simplefin', providerRef: `sf-${name}-${STAMP}`, name,
          type: 'LOAN', mask: '7788', currency: 'USD', currentBalanceCents: BAL,
        },
      });
      await prisma.balanceSnapshot.createMany({
        data: [BOTH, MIDDLE, AFTER].map((date) => ({ accountId: acct.id, date, balanceCents: BAL, accountType: 'LOAN' })),
      });
      return acct.id;
    };
    s1 = await mk('Loan (SimpleFIN)');
    s2 = await mk('Loan (Plaid old)');
    live = await mk('Loan');
    await prisma.accountReconciliation.createMany({
      data: [
        { userId: SIB, predecessorAccountId: s1, successorAccountId: live, cutoverDate: '2026-04-30', matchSignal: 'mask', confidence: 'high' },
        { userId: SIB, predecessorAccountId: s2, successorAccountId: live, cutoverDate: '2026-05-31', matchSignal: 'mask', confidence: 'high' },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: SIB } });
  });

  it('the trend counts ONE balance per date — $5,000.00 once, not twice (FAIL-OLD: two constituents, −$10,000.00)', async () => {
    const view = await getAccountsView(SIB);
    const at = (date: string) => view.trend.find((p) => p.date === date);

    // The date both dead feeds still covered: pre-fix s1 AND s2 both survived.
    expect(at(BOTH)?.constituents.map((c) => c.accountId)).toEqual([s1]);
    expect(at(BOTH)?.netWorthCents).toBe(-BAL);
    // Past s1's cutover, s2 is the side still covering the date.
    expect(at(MIDDLE)?.constituents.map((c) => c.accountId)).toEqual([s2]);
    expect(at(MIDDLE)?.netWorthCents).toBe(-BAL);
    // Past both cutovers the live row owns it.
    expect(at(AFTER)?.constituents.map((c) => c.accountId)).toEqual([live]);
    expect(at(AFTER)?.netWorthCents).toBe(-BAL);
  });

  it('the losing SIBLING row is marked uncounted and names nothing — never the wrong account', async () => {
    // s2 loses BOTH to s1, and s1 is not s2's direct counterpart (they meet only
    // through `live`), so the honest answer is a verdict with no attribution.
    //
    // REACHABILITY, stated rather than implied (a U.9 critic caught the previous
    // slice making this mistake): a superseded predecessor is folded out of the
    // /accounts groups and the panel renders only inside a rendered row, so no user
    // can currently OPEN s2's panel. This asserts SERVER behaviour — the verdict
    // `getAccountDetail` returns for a predecessor — as defence in depth, not a
    // rendered claim. The rendered sibling case is the live row's panel, in the
    // next test, and that one a user can reach.
    const detail = await getAccountDetail(SIB, s2);
    // BOTH is lost to the sibling s1; AFTER is lost to `live` (ordinary post-cutover
    // behaviour, unchanged by U.9). MIDDLE is the date s2 still covers.
    expect(uncountedDates(detail)).toEqual([BOTH, AFTER]);
    expect(countedInsteadAt(detail, BOTH)).toBeNull();
    // The successor IS a direct counterpart, so that row may name it — the contrast
    // with the unnamed sibling row above is the whole point.
    expect(countedInsteadAt(detail, AFTER)).toEqual({ name: 'Loan', balanceCents: BAL, isLiability: true });
    expect(detail?.history.find((h) => h.date === MIDDLE)?.countsInNetWorth).toBe(true);
    // Every row is still shown — a balance the bank sent is never deleted.
    expect(detail?.history.map((h) => h.date)).toEqual([BOTH, MIDDLE, AFTER]);
  });

  it("the live row's dropped dates name the sibling that won them, and the panel matches the trend exactly", async () => {
    const detail = await getAccountDetail(SIB, live);
    expect(uncountedDates(detail)).toEqual([BOTH, MIDDLE]);
    // Both winners ARE direct counterparts of `live`, so both can be named.
    expect(countedInsteadAt(detail, BOTH)).toEqual({ name: 'Loan (SimpleFIN)', balanceCents: BAL, isLiability: true });
    expect(countedInsteadAt(detail, MIDDLE)).toEqual({ name: 'Loan (Plaid old)', balanceCents: BAL, isLiability: true });
    // The two surfaces agree: what the panel calls uncounted is exactly what the
    // trend leaves out for this account.
    const inTrend = await trendDatesFor(SIB, live);
    for (const d of uncountedDates(detail)) expect(inTrend).not.toContain(d);
    expect(inTrend).toContain(AFTER);
  });
});

describe('U.10 — a snapshot dated today does not feed the live point', () => {
  // The series always overwrites today's bucket with current balances so the
  // latest point matches the headline. The panel used to call that recording
  // "counted". DEMO_TODAY is pinned at 2026-06-10 (vitest.config.ts).
  const U10 = `ad-u10-${STAMP}`;
  const TODAY = '2026-06-10';
  const PAST = '2026-05-15';
  const RECORDED = 100_000; // $1,000.00 on the snapshot
  const LIVE = 150_000; // $1,500.00 live — the chart must use this
  let loan = '';
  let pred = '';
  let succ = '';

  beforeAll(async () => {
    await prisma.user.create({ data: { id: U10, email: `${U10}@test.local` } });
    const lone = await prisma.account.create({
      data: {
        userId: U10, provider: 'manual', providerRef: `u10-lone-${STAMP}`, name: 'Solo Loan',
        type: 'LOAN', currency: 'USD', currentBalanceCents: LIVE,
      },
    });
    loan = lone.id;
    await prisma.balanceSnapshot.createMany({
      data: [
        { accountId: loan, date: PAST, balanceCents: RECORDED, accountType: 'LOAN' },
        { accountId: loan, date: TODAY, balanceCents: RECORDED, accountType: 'LOAN' },
      ],
    });
    const p = await prisma.account.create({
      data: {
        userId: U10, provider: 'simplefin', providerRef: `u10-pred-${STAMP}`, name: 'Loan (old)',
        type: 'LOAN', currency: 'USD', currentBalanceCents: RECORDED,
      },
    });
    await prisma.plaidItem.create({ data: { userId: U10, itemId: `u10-item-${STAMP}`, accessToken: 'ct-u10' } });
    const s = await prisma.account.create({
      data: {
        userId: U10, provider: 'plaid', providerRef: `u10-succ-${STAMP}`, plaidItemId: `u10-item-${STAMP}`,
        name: 'Loan (live)', type: 'LOAN', currency: 'USD', currentBalanceCents: LIVE,
      },
    });
    pred = p.id;
    succ = s.id;
    await prisma.balanceSnapshot.createMany({
      data: [PAST, TODAY].flatMap((date) => [
        { accountId: pred, date, balanceCents: RECORDED, accountType: 'LOAN' },
        { accountId: succ, date, balanceCents: LIVE, accountType: 'LOAN' },
      ]),
    });
    await prisma.accountReconciliation.create({
      data: {
        userId: U10, predecessorAccountId: pred, successorAccountId: succ,
        cutoverDate: TODAY, matchSignal: 'mask', confidence: 'high',
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: U10 } });
  });

  it('test_regression__today-snapshot-marked-replaced-by-live-chart-uses-current-balance', async () => {
    const detail = await getAccountDetail(U10, loan);
    const todayRow = detail?.history.find((h) => h.date === TODAY);
    const pastRow = detail?.history.find((h) => h.date === PAST);
    // The panel still shows the RECORDING — hiding it would delete a real read.
    expect(todayRow?.balanceCents).toBe(RECORDED);
    expect(todayRow?.countsInNetWorth).toBe(true);
    expect(todayRow?.replacedByLive).toBe(true);
    expect(todayRow?.countedInstead).toBeNull();
    expect(pastRow?.replacedByLive).toBe(false);
    expect(pastRow?.countsInNetWorth).toBe(true);

    const view = await getAccountsView(U10);
    const livePoint = view.trend.find((p) => p.date === TODAY);
    const liveConstituent = livePoint?.constituents.find((c) => c.accountId === loan);
    // FAIL-OLD: the panel called the $1,000.00 recording counted while the
    // chart's today point used the $1,500.00 live balance (signed: liability).
    expect(liveConstituent?.balanceCents).toBe(-LIVE);
    expect(liveConstituent?.balanceCents).not.toBe(-RECORDED);
    const pastPoint = view.trend.find((p) => p.date === PAST);
    expect(pastPoint?.constituents.find((c) => c.accountId === loan)?.balanceCents).toBe(-RECORDED);
  });

  it('a today-row the boundary DROPS stays the combine mark — not replaced-by-live', async () => {
    // Cutover is today: the predecessor keeps on/before it, so the live
    // successor's today recording is dropped. The reachable panel is the
    // successor's. The combine note is the true reason; the live note would
    // claim the account still counts via this recording's date.
    const detail = await getAccountDetail(U10, succ);
    const todayRow = detail?.history.find((h) => h.date === TODAY);
    expect(todayRow?.countsInNetWorth).toBe(false);
    expect(todayRow?.replacedByLive).toBe(false);
    expect(todayRow?.countedInstead?.name).toBe('Loan (old)');
    const pastRow = detail?.history.find((h) => h.date === PAST);
    expect(pastRow?.countsInNetWorth).toBe(false);
    expect(pastRow?.replacedByLive).toBe(false);
  });

  it('the predecessor today-row the boundary KEPT is replaced-by-live (defense in depth)', async () => {
    // Folded out of /accounts groups, so a reader cannot open this panel.
    // The verdict must still be honest: the boundary kept the row, the chart
    // does not read it.
    const detail = await getAccountDetail(U10, pred);
    const todayRow = detail?.history.find((h) => h.date === TODAY);
    expect(todayRow?.countsInNetWorth).toBe(true);
    expect(todayRow?.replacedByLive).toBe(true);
    expect(todayRow?.countedInstead).toBeNull();
  });
});
