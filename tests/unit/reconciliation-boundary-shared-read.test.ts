/**
 * U.31 — `getReconciliationBoundary` reads the link table ONCE and returns both the keep
 * filter and the handover-key set from that single read, replacing the sequential
 * `getReconciliationTxnKeep` + `getReconciliationHandoverKeys` pair three loaders used to
 * call (`getTransactions`, `getPostedCalendarRows`, `getTransactionDetail` in transactions.ts,
 * and `getDashboardRecent`) — the exact shape `getAccountsView` (transactions.ts, critic F-4)
 * already argued against in writing: two independent reads of the link table leave a window
 * where a confirm/undo landing between them desyncs whatever each read derives.
 *
 * This file proves two things a type-level refactor cannot: (1) the combined function's two
 * outputs agree EXACTLY with what the two standalone functions would have separately computed
 * over the identical fixture (no behavior change), and (2) both outputs are scoped to the same
 * (account, day) pair — same fixture shape as U.24's calendar-posted-server test.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { handoverKey } from '@/lib/engine/account/reconcile-boundary';
import { isoDate } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { auth } from '@/auth';
import { askAssistant } from '@/server/assistant';
import { getCoachData } from '@/server/coach';
import { getProvider } from '@/lib/providers/demo';
import { getReports } from '@/server/reports';
import { refreshRecurringForUser } from '@/server/recurring';
import { getSpendingPlan } from '@/server/spending-plan';
import { getTaxExport } from '@/server/tax';
import { getSpendingTrends } from '@/server/trends';
import {
  getReconciliationBoundary,
  getReconciliationTxnKeep,
} from '@/server/reconciliation';

const USER = `recon-boundary-${Date.now()}-${process.pid}`;
const CUTOVER = '2026-07-08';
let predId = '';
let succId = '';
let otherId = '';

async function txn(id: string, accountId: string, date: string, amountCents: number) {
  await prisma.transaction.create({
    data: {
      id: `${id}-${process.pid}`,
      accountId,
      date,
      amountCents,
      rawDescriptor: `ROW ${id}`,
      categoryId: 'groceries',
      status: 'POSTED',
    },
  });
}

async function wipe() {
  await prisma.accountReconciliation.deleteMany({ where: { userId: USER } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
}

describe('U.31 — getReconciliationBoundary matches the two standalone reads, from one fetch', () => {
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const mk = async (ref: string, name: string) =>
      (
        await prisma.account.create({
          data: {
            userId: USER,
            provider: 'simplefin',
            providerRef: ref,
            name,
            type: 'CREDIT',
            currentBalanceCents: -120_000,
            currency: 'USD',
          },
        })
      ).id;
    predId = await mk('rbsr-pred', 'Everyday Card');
    succId = await mk('rbsr-succ', 'Everyday Card');
    otherId = await mk('rbsr-other', 'Household Checking');
    await prisma.accountReconciliation.create({
      data: {
        userId: USER,
        predecessorAccountId: predId,
        successorAccountId: succId,
        cutoverDate: CUTOVER,
        matchSignal: 'name',
        confidence: 'high',
        confirmedByUserAt: new Date(),
      },
    });

    await txn('rbsr-p', predId, CUTOVER, -5_000);
    await txn('rbsr-s', succId, CUTOVER, -5_000);
    await txn('rbsr-other', otherId, CUTOVER, -2_500);
    await txn('rbsr-early', predId, '2026-07-02', -3_000);
  });
  afterAll(wipe);

  it('the combined keep filter agrees with the standalone getReconciliationTxnKeep on every row', async () => {
    const standalone = await getReconciliationTxnKeep(USER);
    const { keepsReconciled } = await getReconciliationBoundary(USER);
    const rows = [
      [predId, CUTOVER],
      [succId, CUTOVER],
      [otherId, CUTOVER],
      [predId, '2026-07-02'],
      [succId, '2026-07-02'], // successor has no row here — the point is the FILTER agrees, not the data
    ] as const;
    for (const [accountId, date] of rows) {
      expect(keepsReconciled(accountId, date)).toBe(standalone(accountId, date));
    }
  });

  it('the snapshot emits the same handover-key set the boundary does, from its own link read', async () => {
    const snap = await getProvider().getFinanceSnapshot(USER);
    const { handoverKeys } = await getReconciliationBoundary(USER);
    expect([...snap.handoverKeys].sort()).toEqual([...handoverKeys].sort());
    // And the fixture's own (account, day)-scoping shape: both pair sides flagged on the
    // cutover, the unrelated account on the same date is not, and the off-cutover row is not.
    expect(snap.handoverKeys.has(handoverKey(predId, CUTOVER))).toBe(true);
    expect(snap.handoverKeys.has(handoverKey(succId, CUTOVER))).toBe(true);
    expect(snap.handoverKeys.has(handoverKey(otherId, CUTOVER))).toBe(false);
    expect(snap.handoverKeys.has(handoverKey(predId, '2026-07-02'))).toBe(false);
  });

  it('with no active links, both outputs are the unconditional fast path', async () => {
    const NO_LINKS = `${USER}-nolinks`;
    await prisma.user.create({ data: { id: NO_LINKS, email: `${NO_LINKS}@test.local` } });
    try {
      const { keepsReconciled, handoverKeys } = await getReconciliationBoundary(NO_LINKS);
      expect(keepsReconciled('anything', '2026-01-01')).toBe(true);
      expect(handoverKeys.size).toBe(0);
    } finally {
      await prisma.user.deleteMany({ where: { id: NO_LINKS } });
    }
  });
});

/**
 * U.33 — the two views U.31 left behind.
 *
 * U.31 consolidated the keep filter and the (account, day) handover KEYS. It left
 * `getReconciliationHandoverDates` holding the last hand-rolled copy of the same three
 * queries, and it did not touch `activeTerminalSuccessorMap` at all — so `refreshRecurring`
 * still read this one table FOUR times and fed three of those reads into a SINGLE
 * `collapseHandoverDuplicates` call whose output is PERSISTED (RecurringSeries +
 * ScheduledTransaction, which drive forecast, the calendar, the spending plan and the
 * Cash-Needed Engine), while `getTaxExport` assembled a file that leaves the app entirely
 * from two independent reads.
 *
 * These tests prove the two added views are the SAME values the standalone functions
 * compute — a refactor that quietly changed either would be changing persisted money —
 * and that they are genuinely different shapes rather than one output renamed.
 */
describe('U.33 — handoverDates and terminalOf agree with their standalone functions', () => {
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const mk = async (ref: string, name: string) =>
      (
        await prisma.account.create({
          data: {
            userId: USER,
            provider: 'simplefin',
            providerRef: ref,
            name,
            type: 'CREDIT',
            currentBalanceCents: -120_000,
            currency: 'USD',
          },
        })
      ).id;
    predId = await mk('u33-pred', 'Everyday Card');
    succId = await mk('u33-succ', 'Everyday Card');
    otherId = await mk('u33-other', 'Household Checking');
    await prisma.accountReconciliation.create({
      data: {
        userId: USER,
        predecessorAccountId: predId,
        successorAccountId: succId,
        cutoverDate: CUTOVER,
        matchSignal: 'name',
        confidence: 'high',
        confirmedByUserAt: new Date(),
      },
    });
    await txn('u33-p', predId, CUTOVER, -5_000);
    await txn('u33-s', succId, CUTOVER, -5_000);
    await txn('u33-other', otherId, CUTOVER, -2_500);
    await txn('u33-early', predId, '2026-07-02', -3_000);
  });
  afterAll(wipe);

  it('the handover DATES are the released day, and only it', async () => {
    // U.33 critic F-3: this test used to compare `handoverDates` against
    // `getReconciliationHandoverDates`, which after the consolidation ran the SAME two lines —
    // f(x) vs f(x), failing only if the boundary stopped calling the engine at all. That
    // function is now deleted (F-2) and this asserts the values themselves. The old-vs-new
    // parity it appeared to prove was executed for real by the critic instead, against a
    // verbatim copy of the pre-U.33 body on a hostile fixture (an out-of-order A→B→C chain,
    // a currency-withheld pair, a cross-type pair and a degenerate claim).
    const { handoverDates } = await getReconciliationBoundary(USER);
    expect([...handoverDates]).toEqual([CUTOVER]);
    expect(handoverDates.has('2026-07-02')).toBe(false);
  });

  it('the terminal map is the predecessor → live successor, and only that', async () => {
    // U.34: `activeTerminalSuccessorMap` is deleted (zero production callers after
    // this slice). Comparing the boundary against a wrapper that ran the same two
    // lines would be f(x) vs f(x) — U.33 critic F-3. Assert the values themselves.
    const { terminalOf } = await getReconciliationBoundary(USER);
    expect(terminalOf.get(predId)).toBe(succId);
    expect(terminalOf.has(succId)).toBe(false);
    expect(terminalOf.has(otherId)).toBe(false);
    expect(terminalOf.size).toBe(1);
  });

  it('dates and keys are DIFFERENT sets, not one output renamed', async () => {
    const { handoverDates, handoverKeys } = await getReconciliationBoundary(USER);
    // A bare date is not a key, and a key is not a bare date — the distinction the U.16
    // critic paid for (a date-only marker labels every account the reader owns).
    expect(handoverDates.has(handoverKey(predId, CUTOVER))).toBe(false);
    expect(handoverKeys.has(CUTOVER)).toBe(false);
    // One released day, both sides of the one pair keyed on it.
    expect(handoverDates.size).toBe(1);
    expect(handoverKeys.size).toBe(2);
  });

  it('with no active links, all four views are the empty / constant-true fast path', async () => {
    const NO_LINKS = `${USER}-u33-nolinks`;
    await prisma.user.create({ data: { id: NO_LINKS, email: `${NO_LINKS}@test.local` } });
    try {
      const { keepsReconciled, handoverKeys, handoverDates, terminalOf } =
        await getReconciliationBoundary(NO_LINKS);
      expect(keepsReconciled('anything', '2026-01-01')).toBe(true);
      expect(handoverKeys.size).toBe(0);
      expect(handoverDates.size).toBe(0);
      expect(terminalOf.size).toBe(0);
    } finally {
      await prisma.user.deleteMany({ where: { id: NO_LINKS } });
    }
  });
});

/**
 * U.33 — the COUNT, which is the claim the slice actually makes.
 *
 * The equivalence tests above prove the consolidated views are the right values; they would
 * pass just as well against four separate reads. These two count the reads, so the defect
 * cannot come back: they fail on the pre-U.33 code (`getTaxExport` read the link table twice,
 * `refreshRecurringForUser` four times) and pass on one read each.
 *
 * The count is what matters because both call sites combine their reads into ONE artifact —
 * a file that leaves the app, and rows that are written to the database — so a confirm or an
 * undo landing between two awaits does not merely render inconsistently, it is recorded.
 */
describe('U.33 — one read of the link table per assembled artifact', () => {
  const RUSER = `${USER}-u33-reads`;
  let cardId = '';

  beforeAll(async () => {
    await prisma.accountReconciliation.deleteMany({ where: { userId: RUSER } });
    await prisma.account.deleteMany({ where: { userId: RUSER } });
    await prisma.user.deleteMany({ where: { id: RUSER } });
    await prisma.user.create({ data: { id: RUSER, email: `${RUSER}@test.local` } });
    const mkCard = async (ref: string) =>
      (
        await prisma.account.create({
          data: {
            userId: RUSER,
            provider: 'simplefin',
            providerRef: ref,
            name: 'Everyday Card',
            type: 'CREDIT',
            currentBalanceCents: -50_000,
            currency: 'USD',
          },
        })
      ).id;
    // U.33 critic F-4: this fixture used to hold NO link, so both counts below were measured on
    // the `links.length === 0` fast path — the one branch that reads the table once no matter
    // how many times you ask it. A real ACTIVE link puts the counts on the branch that actually
    // costs the queries: the boundary derives all four views, and `collapseHandoverDuplicates`
    // receives a non-empty `handoverDates` and a populated `terminalOf` instead of
    // short-circuiting. The predecessor carries a row of its own so its span is non-degenerate
    // and the released day is real rather than a claim about nothing.
    const predCardId = await mkCard('u33-reads-pred');
    cardId = await mkCard('u33-reads-card');
    await prisma.accountReconciliation.create({
      data: {
        userId: RUSER,
        predecessorAccountId: predCardId,
        successorAccountId: cardId,
        cutoverDate: '2026-03-04',
        matchSignal: 'name',
        confidence: 'high',
        confirmedByUserAt: new Date(),
      },
    });
    await prisma.transaction.create({
      data: {
        id: `u33-reads-pred-row-${process.pid}`,
        accountId: predCardId,
        date: '2026-02-01',
        amountCents: -4_000,
        rawDescriptor: 'CORNER STORE',
        categoryId: 'groceries',
        status: 'POSTED',
      },
    });
    // A tax-tagged row, so getTaxExport has something to speak about rather than
    // short-circuiting on an empty set.
    await prisma.transaction.create({
      data: {
        id: `u33-reads-tax-${process.pid}`,
        accountId: cardId,
        date: '2026-03-04',
        amountCents: -12_500,
        rawDescriptor: 'CITY DENTAL',
        categoryId: 'health',
        status: 'POSTED',
        taxClass: 'medical',
      },
    });
  });

  afterAll(async () => {
    await prisma.accountReconciliation.deleteMany({ where: { userId: RUSER } });
    await prisma.account.deleteMany({ where: { userId: RUSER } });
    await prisma.user.deleteMany({ where: { id: RUSER } });
  });

  it('getTaxExport reads accountReconciliation exactly once', async () => {
    const spy = vi.spyOn(prisma.accountReconciliation, 'findMany');
    try {
      const out = await getTaxExport(RUSER, 2026);
      // The read count is the point, but a count over an export that produced nothing
      // would prove nothing — assert the file was really assembled.
      expect(out.totalPaidCents).toBe(12_500);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('refreshRecurringForUser reads accountReconciliation exactly once', async () => {
    const spy = vi.spyOn(prisma.accountReconciliation, 'findMany');
    try {
      await refreshRecurringForUser(RUSER, isoDate('2026-06-10'));
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * U.34 — the two loaders U.33 filed rather than fixed.
 *
 * `getSpendingPlan` read `activeTerminalSuccessorMap` for the income median's
 * account scope, then `countedExpenseSeriesForPlan` read it again for expenses —
 * one rendered plan, two snapshots of one table, with a detectRecurring pass
 * between them. `askAssistant` fetched handover keys in four spend cases, the
 * links again for account_balance, and the keys a fifth time for the Glass-Box
 * trace, so a spend_total's disclosure and the tick behind it could disagree.
 *
 * Equivalence is already proven for `terminalOf` / `handoverKeys` above. These
 * lock the COUNT, on a fixture with a real ACTIVE link (U.33 critic F-4: the
 * no-links fast path reads once however you ask). Fail-old: the pre-U.34 plan
 * issued 3 link-table reads (snapshot + two terminal maps); a spend_total Ask
 * issued 3 (snapshot + buildAnswer keys + composer-trace keys).
 *
 * The snapshot's own read is a different artifact and stays. The claim is that
 * each loader adds exactly ONE more.
 */
describe('U.34 — one extra link-table read per rendered plan / Ask answer', () => {
  const U34 = `${USER}-u34-reads`;
  let cardId = '';

  beforeAll(async () => {
    await prisma.accountReconciliation.deleteMany({ where: { userId: U34 } });
    await prisma.account.deleteMany({ where: { userId: U34 } });
    await prisma.user.deleteMany({ where: { id: U34 } });
    await prisma.user.create({ data: { id: U34, email: `${U34}@test.local` } });
    const mkCard = async (ref: string) =>
      (
        await prisma.account.create({
          data: {
            userId: U34,
            provider: 'simplefin',
            providerRef: ref,
            name: 'Everyday Card',
            type: 'CREDIT',
            currentBalanceCents: -50_000,
            currency: 'USD',
          },
        })
      ).id;
    const predCardId = await mkCard('u34-reads-pred');
    cardId = await mkCard('u34-reads-card');
    await prisma.accountReconciliation.create({
      data: {
        userId: U34,
        predecessorAccountId: predCardId,
        successorAccountId: cardId,
        cutoverDate: '2026-06-04',
        matchSignal: 'name',
        confidence: 'high',
        confirmedByUserAt: new Date(),
      },
    });
    // A posted spend in the demo-pinned month so getSpendingPlan and a
    // spend_total Ask both assemble a real figure, not an empty short-circuit.
    await prisma.transaction.create({
      data: {
        id: `u34-reads-spend-${process.pid}`,
        accountId: cardId,
        date: '2026-06-08',
        amountCents: -4_200,
        rawDescriptor: 'CORNER STORE',
        categoryId: 'groceries',
        status: 'POSTED',
      },
    });
  });

  afterAll(async () => {
    await prisma.accountReconciliation.deleteMany({ where: { userId: U34 } });
    await prisma.account.deleteMany({ where: { userId: U34 } });
    await prisma.user.deleteMany({ where: { id: U34 } });
  });

  it('getSpendingPlan reads accountReconciliation exactly twice (snapshot + boundary)', async () => {
    const spy = vi.spyOn(prisma.accountReconciliation, 'findMany');
    try {
      const plan = await getSpendingPlan(U34);
      // A count over a plan that produced nothing proves nothing.
      expect(typeof plan.leftToSpendCents).toBe('number');
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('askAssistant spend_total reads accountReconciliation exactly twice (snapshot + boundary)', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: U34 } } as never);
    const spy = vi.spyOn(prisma.accountReconciliation, 'findMany');
    try {
      const answer = await askAssistant('how much did I spend this month');
      expect(answer.kind).toBe('spend_total');
      expect(answer.headlineCents).toBe(4_200);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * U.35 — the three pages U.34's critic filed rather than fixed.
 *
 * `/reports`, `/trends`, and `/coach` already held a snapshot (which reads
 * `accountReconciliation` and applies the keep) and then fetched
 * `getReconciliationHandoverKeys` independently — keep from one snapshot,
 * disclosure from a later read. #466 parked passing a pre-fetched boundary
 * *into* `getFinanceSnapshot`. The shape that shipped is the inverse: the
 * assembler already has the links and the spans, so it emits the keys, and
 * the three loaders stop fetching them.
 *
 * Fail-old: each of these issued 2 link-table reads (snapshot + keys). The
 * snapshot's own read stays. The claim is that the loader adds ZERO more.
 */
describe('U.35 — reports / trends / coach take handover keys off the snapshot', () => {
  const U35 = `${USER}-u35-reads`;
  let cardId = '';

  beforeAll(async () => {
    await prisma.accountReconciliation.deleteMany({ where: { userId: U35 } });
    await prisma.account.deleteMany({ where: { userId: U35 } });
    await prisma.user.deleteMany({ where: { id: U35 } });
    await prisma.user.create({ data: { id: U35, email: `${U35}@test.local` } });
    const mkCard = async (ref: string) =>
      (
        await prisma.account.create({
          data: {
            userId: U35,
            provider: 'simplefin',
            providerRef: ref,
            name: 'Everyday Card',
            type: 'CREDIT',
            currentBalanceCents: -50_000,
            currency: 'USD',
          },
        })
      ).id;
    const predCardId = await mkCard('u35-reads-pred');
    cardId = await mkCard('u35-reads-card');
    await prisma.accountReconciliation.create({
      data: {
        userId: U35,
        predecessorAccountId: predCardId,
        successorAccountId: cardId,
        cutoverDate: '2026-06-04',
        matchSignal: 'name',
        confidence: 'high',
        confirmedByUserAt: new Date(),
      },
    });
    // Predecessor row ON the cutover (this month) so the span is
    // non-degenerate AND the reports lock can see a counted handover-day
    // row. A May pred (the first cut) left `countedOnHandoverDays` at 0
    // for June — the figure lock could go green without the keys being
    // used (U.35 critic P2-4).
    await prisma.transaction.create({
      data: {
        id: `u35-reads-pred-${process.pid}`,
        accountId: predCardId,
        date: '2026-06-04',
        amountCents: -1_100,
        rawDescriptor: 'CORNER STORE',
        categoryId: 'groceries',
        status: 'POSTED',
      },
    });
    await prisma.transaction.create({
      data: {
        id: `u35-reads-spend-${process.pid}`,
        accountId: cardId,
        date: '2026-06-08',
        amountCents: -4_200,
        rawDescriptor: 'CORNER STORE',
        categoryId: 'groceries',
        status: 'POSTED',
      },
    });
  });

  afterAll(async () => {
    await prisma.accountReconciliation.deleteMany({ where: { userId: U35 } });
    await prisma.account.deleteMany({ where: { userId: U35 } });
    await prisma.user.deleteMany({ where: { id: U35 } });
  });

  it('getReports reads accountReconciliation exactly once', async () => {
    const spy = vi.spyOn(prisma.accountReconciliation, 'findMany');
    try {
      const out = await getReports(U35);
      // June grocery on the successor PLUS the predecessor's cutover-day
      // copy. If handoverKeys were dropped, totalCents would still be
      // 5300 (both rows are kept) but countedOnHandoverDays would be 0.
      expect(out.breakdown.totalCents).toBe(5_300);
      expect(out.breakdown.countedOnHandoverDays).toBeGreaterThan(0);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('getSpendingTrends reads accountReconciliation exactly once', async () => {
    const spy = vi.spyOn(prisma.accountReconciliation, 'findMany');
    try {
      const out = await getSpendingTrends(U35);
      expect(typeof out.asOfDate).toBe('string');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('getCoachData reads accountReconciliation exactly once', async () => {
    const spy = vi.spyOn(prisma.accountReconciliation, 'findMany');
    try {
      const out = await getCoachData(U35);
      expect(out.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
