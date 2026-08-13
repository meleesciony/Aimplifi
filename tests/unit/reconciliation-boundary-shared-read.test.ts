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
import { refreshRecurringForUser } from '@/server/recurring';
import { getTaxExport } from '@/server/tax';
import {
  activeTerminalSuccessorMap,
  getReconciliationBoundary,
  getReconciliationHandoverKeys,
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

  it('the combined handover-key set agrees with the standalone getReconciliationHandoverKeys', async () => {
    const standalone = await getReconciliationHandoverKeys(USER);
    const { handoverKeys } = await getReconciliationBoundary(USER);
    expect([...handoverKeys].sort()).toEqual([...standalone].sort());
    // And the fixture's own (account, day)-scoping shape: both pair sides flagged on the
    // cutover, the unrelated account on the same date is not, and the off-cutover row is not.
    expect(handoverKeys.has(handoverKey(predId, CUTOVER))).toBe(true);
    expect(handoverKeys.has(handoverKey(succId, CUTOVER))).toBe(true);
    expect(handoverKeys.has(handoverKey(otherId, CUTOVER))).toBe(false);
    expect(handoverKeys.has(handoverKey(predId, '2026-07-02'))).toBe(false);
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

  it('the combined terminal map agrees with the standalone activeTerminalSuccessorMap', async () => {
    const standalone = await activeTerminalSuccessorMap(USER);
    const { terminalOf } = await getReconciliationBoundary(USER);
    expect([...terminalOf.entries()].sort()).toEqual([...standalone.entries()].sort());
    // The fixture's own shape: the predecessor resolves to the live successor, and an
    // account in no pair is absent (not mapped to itself).
    expect(terminalOf.get(predId)).toBe(succId);
    expect(terminalOf.has(otherId)).toBe(false);
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
