/**
 * The PLAID deep-history backfill, driven through the REAL
 * `PlaidProvider.syncTransactions` (the backfill's only trigger) against a
 * mocked Plaid server — the H.5 mirror (STATUS 2026-08-05, OPEN P1: "the PLAID
 * deep-history backfill has the same superseded-predecessor defect this slice
 * rated P0").
 *
 * Shapes locked here, each one a finding H.5's critics executed on the
 * SimpleFIN twin and this file re-executes on the Plaid path:
 *
 *   - P0: a fetched row mapping to a SUPERSEDED PREDECESSOR is never written.
 *     The reconciliation boundary claims [span.first, cutover] from the
 *     predecessor's full-history minimum date; writing two years onto it drags
 *     that edge back and silently deletes the successor's corrected rows from
 *     every figure. Add-only is no defence; not writing is.
 *   - the undo RE-ARMS the backfill (`PlaidItem.historyBackfilledAt` cleared),
 *     which is what makes the refusal above a terminal state instead of a trap.
 *   - the per-run cap defers, oldest-first, and stays owed until consumed —
 *     the ordering asserted directly (H.5 cycle-3: a newest-first sort left the
 *     suite green while the owner's floor survived every run).
 *   - a malformed row neither aborts the run (the old code prepared the WHOLE
 *     plan in one map, so one bad row failed the entire backfill) nor holds the
 *     cap hostage.
 *   - a TRUNCATED fetch is never marked done: its rows are real but its
 *     absences are not.
 *   - the per-chunk commit actually commits per chunk: a run killed mid-plan
 *     leaves its finished chunks behind and converges on the next sync (the
 *     H.5 "filed, not built" residual — built here for the Plaid path).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Wrapped so ONE test can kill the run at the seam the chunking exists for —
// the per-chunk LLM assist. Default behavior is the real implementation.
vi.mock('@/server/categorize-assist', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/server/categorize-assist')>();
  return { ...mod, assistUnsureRows: vi.fn(mod.assistUnsureRows) };
});
import { assistUnsureRows } from '@/server/categorize-assist';

import {
  PLAID_BACKFILL_CHUNK_ROWS,
  PLAID_BACKFILL_MAX_ROWS_PER_RUN,
  PLAID_DAYS_REQUESTED,
  PlaidProvider,
} from '@/lib/providers/plaid';
import type { PlaidTransaction } from '@/lib/providers/plaid-map';
import { undoReconciliationFor } from '@/server/reconciliation';
import { encryptToken } from '@/lib/crypto';
import { addDays, isoDate } from '@/lib/dates';
import { prisma } from '@/lib/db';

const KEY = Buffer.alloc(32, 7).toString('base64');
const TODAY = isoDate('2026-06-10');
/** The deep window the backfill must request: today − PLAID_DAYS_REQUESTED. */
const WINDOW_START = addDays(TODAY, -PLAID_DAYS_REQUESTED);

function ptxn(id: string, over: Partial<PlaidTransaction> = {}): PlaidTransaction {
  return {
    transaction_id: id,
    account_id: 'pa-A',
    date: '2025-06-09',
    amount: 42.5, // dollars, outflow-positive (Plaid sign convention)
    name: 'STARBUCKS STORE 123 ATLANTA',
    pending: false,
    ...over,
  };
}

/** Every /transactions/get request this mock served: its start_date + offset. */
let getCalls: Array<{ start_date: string; offset: number }> = [];

/**
 * Fake Plaid. `/accounts/get` answers empty (the balance refresh no-ops and the
 * feed-presence rule never stamps from an empty census); `/transactions/sync`
 * answers an empty single page (the incremental path is not under test here);
 * `/transactions/get` serves `deep` in offset pages of `count`, unless
 * `truncateAfterFirstPage` forces the misbehaving-server shape (an empty page
 * with total_transactions still ahead).
 */
function mockServer(opts: { deep: PlaidTransaction[]; truncateAfterFirstPage?: boolean }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        start_date?: string;
        options?: { count?: number; offset?: number };
      };
      const ok = (json: unknown): Response =>
        ({ ok: true, status: 200, json: async () => json }) as Response;
      if (url.endsWith('/accounts/get')) return ok({ accounts: [] });
      if (url.endsWith('/transactions/sync')) {
        return ok({ added: [], modified: [], removed: [], next_cursor: 'cur-1', has_more: false });
      }
      if (url.endsWith('/transactions/get')) {
        const offset = body.options?.offset ?? 0;
        const count = body.options?.count ?? 500;
        getCalls.push({ start_date: body.start_date ?? '', offset });
        if (opts.truncateAfterFirstPage && offset > 0) {
          // The misbehaving server: a 200 whose page is EMPTY while its own
          // total says more rows exist. The O.12d guard stops the loop; the
          // backfill must treat the fetch as incomplete, not as proof of absence.
          return ok({ transactions: [], total_transactions: opts.deep.length });
        }
        return ok({
          transactions: opts.deep.slice(offset, offset + count),
          total_transactions: opts.deep.length,
        });
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => 'NOT_MOCKED' } as Response;
    }),
  );
}

describe('Plaid deep-history backfill — real syncTransactions, mocked Plaid server', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `plaid-hb-${stamp}`;
  const ITEM_ID = `item-hb-${stamp}`;
  const provider = new PlaidProvider();
  let accountId: string;
  let itemRowId: string;

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  /** An EXISTING item: synced before, never backfilled — the owner's shape. */
  async function seedItem(stored: { ref: string; date: string }[]) {
    await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
    await prisma.accountReconciliation.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.deleteMany({ where: { userId: USER } });
    // Audit rows accumulate across tests on this one user; each test asserts
    // about the rows ITS run wrote.
    await prisma.auditLog.deleteMany({ where: { userId: USER } });
    const item = await prisma.plaidItem.create({
      data: {
        userId: USER,
        itemId: ITEM_ID,
        accessToken: encryptToken('tok-1', Buffer.from(KEY, 'base64')),
        cursor: 'cur-0',
        lastSyncedAt: '2026-06-08',
        historyBackfilledAt: null,
      },
    });
    itemRowId = item.id;
    const acct = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'plaid',
        providerRef: 'pa-A',
        name: 'Checking',
        type: 'CHECKING',
        currentBalanceCents: 340000,
      },
    });
    accountId = acct.id;
    const cat = await prisma.category.findFirst({ select: { id: true } });
    for (const s of stored) {
      await prisma.transaction.create({
        data: {
          accountId,
          providerRef: s.ref,
          date: s.date,
          amountCents: -4250,
          rawDescriptor: 'STARBUCKS STORE 123 ATLANTA',
          status: 'POSTED',
          categoryId: cat?.id ?? null,
          needsReview: false,
        },
      });
    }
  }

  const flag = async () =>
    (await prisma.plaidItem.findUnique({ where: { id: itemRowId } }))!.historyBackfilledAt;
  interface BackfillAuditMeta {
    added: number;
    deferredToNextSync: number;
    complete: boolean;
    fetchComplete: boolean;
    skipped: Record<string, number>;
  }
  const lastAuditMeta = async () => {
    const rows = await prisma.auditLog.findMany({
      where: { userId: USER, action: 'plaid.item.history-backfill' },
      orderBy: { createdAt: 'desc' },
    });
    return rows.length > 0 ? (JSON.parse(rows[0].meta ?? '{}') as BackfillAuditMeta) : null;
  };

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(wipe);
  beforeEach(() => {
    getCalls = [];
    vi.clearAllMocks();
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('PLAID_ENV', 'sandbox');
    vi.stubEnv('DEMO_TODAY', TODAY);
    vi.stubEnv('XAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reaches past the sync floor, add-only: older rows land, a stored corrected row stays byte-identical', async () => {
    await seedItem([{ ref: 'stored-1', date: '2026-05-02' }]);
    // A verdict the READER effectively holds (settled, no review) — the state a
    // full pull through the live ingest would have refreshed.
    const stored = await prisma.transaction.findFirst({ where: { accountId, providerRef: 'stored-1' } });
    const before = await prisma.transaction.findUnique({ where: { id: stored!.id } });

    mockServer({
      deep: [
        ptxn('stored-1', { date: '2026-05-02' }), // re-fetched — must be skipped, not refreshed
        ptxn('old-1', { date: '2025-03-04' }),
        ptxn('old-2', { date: '2024-11-20' }),
      ],
    });
    await provider.syncTransactions(USER);

    // The request actually widened to the full 730-day window.
    expect(getCalls.some((c) => c.start_date === WINDOW_START)).toBe(true);
    const rows = await prisma.transaction.findMany({
      where: { accountId },
      select: { providerRef: true, date: true },
      orderBy: { date: 'asc' },
    });
    expect(rows.map((r) => r.providerRef)).toEqual(['old-2', 'old-1', 'stored-1']);
    expect(await prisma.transaction.findUnique({ where: { id: stored!.id } })).toEqual(before);
    expect(await flag()).toBe(TODAY);
    expect((await lastAuditMeta())!.complete).toBe(true);
  });

  it('P0: never writes into a SUPERSEDED PREDECESSOR account', async () => {
    // The boundary claims [predecessor.span.first, cutover] and DROPS every
    // successor row inside it. Backfilling two years onto a predecessor drags
    // span.first back two years, deleting the successor's corrected rows from
    // every figure without updating a single row.
    await seedItem([]);
    const successor = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'manual',
        name: 'Checking (new)',
        type: 'CHECKING',
        currentBalanceCents: 340000,
      },
    });
    await prisma.accountReconciliation.create({
      data: {
        userId: USER,
        predecessorAccountId: accountId, // the account the item's fetch maps to
        successorAccountId: successor.id,
        cutoverDate: '2026-06-01',
        matchSignal: 'persistent',
        confidence: 'high',
        undoneAt: null,
      },
    });

    mockServer({ deep: [ptxn('old-1', { date: '2024-11-20' }), ptxn('old-2', { date: '2025-02-02' })] });
    await provider.syncTransactions(USER);

    // No rows landed on the read-only predecessor...
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(0);
    // ...and none were invented on the successor either — the backfill files to
    // the account the FEED names, and it declined to.
    expect(await prisma.transaction.count({ where: { accountId: successor.id } })).toBe(0);
    // It marks itself done rather than refetching two years on every sync
    // forever; reversibility is an EVENT (the undo re-arms it — next test).
    expect(await flag()).toBe(TODAY);
    const meta = await lastAuditMeta();
    expect(meta!.skipped.unmappedAccount).toBe(2);
  });

  it('undoing the combination RE-ARMS the backfill, which is what makes marking it done safe', async () => {
    await seedItem([]);
    const successor = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'manual',
        name: 'Checking (new)',
        type: 'CHECKING',
        currentBalanceCents: 1,
      },
    });
    const link = await prisma.accountReconciliation.create({
      data: {
        userId: USER,
        predecessorAccountId: accountId,
        successorAccountId: successor.id,
        cutoverDate: '2026-06-01',
        matchSignal: 'persistent',
        confidence: 'high',
        undoneAt: null,
      },
    });
    mockServer({ deep: [ptxn('old-1', { date: '2024-11-20' })] });
    await provider.syncTransactions(USER);
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(0);
    expect(await flag()).toBe(TODAY); // done — nothing to write to

    // The reader undoes the combination through the REAL action: the account is
    // writable history again, and the undo must re-arm the backfill — otherwise
    // the "done" above is a permanent trap, since the flag gates the only trigger.
    const undo = await undoReconciliationFor(USER, link.id);
    expect(undo.ok).toBe(true);
    expect(await flag()).toBeNull();

    await provider.syncTransactions(USER);
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(1);
    expect(await flag()).toBe(TODAY);
  });

  it('a plan over the cap commits OLDEST-first, defers the rest, and stays owed', async () => {
    // A serverless timeout is not catchable, so a run that dies must leave
    // progress behind — and the progress must be the history the reader is
    // actually missing (oldest first), not the newest rows re-sorted by luck.
    await seedItem([]);
    const over = PLAID_BACKFILL_MAX_ROWS_PER_RUN + 25;
    // Dates strictly increase with i, so "the last 25" is exactly "the newest 25".
    const deep = Array.from({ length: over }, (_, i) =>
      ptxn(`bulk-${i}`, { date: addDays(TODAY, -700 + Math.floor(i / 4)) }),
    );
    mockServer({ deep });

    const first = await provider.syncTransactions(USER);
    expect(first.added).toBe(PLAID_BACKFILL_MAX_ROWS_PER_RUN);
    expect(await flag()).toBeNull(); // NOT done — the rest is still owed
    let meta = await lastAuditMeta();
    expect(meta!.deferredToNextSync).toBe(25);
    expect(meta!.complete).toBe(false);
    // Oldest-first, asserted directly: every deferred row is NEWER than every
    // ingested one (H.5 cycle-3 — the ordering the cap's safety argument rests
    // on was asserted by nothing, and a newest-first sort left the suite green).
    const newest25 = deep.slice(-25).map((t) => t.transaction_id);
    expect(
      await prisma.transaction.count({ where: { accountId, providerRef: { in: newest25 } } }),
    ).toBe(0);

    // The next sync continues rather than restarting, and converges.
    const second = await provider.syncTransactions(USER);
    expect(second.added).toBe(25);
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(over);
    expect(await flag()).toBe(TODAY);
    meta = await lastAuditMeta();
    expect(meta!.complete).toBe(true);
  }, 180_000);

  it('rows that cannot be prepared neither abort the run nor hold the cap hostage', async () => {
    // OLD code prepared the WHOLE plan in one `.map`, so one unparseable amount
    // threw out of the backfill and NOTHING landed — every sync then repeated
    // the fetch and the failure forever. And a bad row charged to the budget
    // could pin the cap on every future run (it can never be stored). MORE
    // unpreparable rows than the whole per-run cap, all dated OLDER than the
    // good ones so they are examined first — the only shape that distinguishes
    // "budget charged on examine" from "budget charged on prepare".
    await seedItem([]);
    const bad = Array.from({ length: PLAID_BACKFILL_MAX_ROWS_PER_RUN + 5 }, (_, i) =>
      ptxn(`bad-${i}`, { date: '2024-07-01', amount: Number.NaN }),
    );
    const good = Array.from({ length: 5 }, (_, i) =>
      ptxn(`good-${i}`, { date: addDays(TODAY, -100 - i) }),
    );
    mockServer({ deep: [...bad, ...good] });

    await provider.syncTransactions(USER);

    const rows = await prisma.transaction.findMany({
      where: { accountId },
      select: { providerRef: true },
    });
    expect(rows.map((r) => r.providerRef).sort()).toEqual(['good-0', 'good-1', 'good-2', 'good-3', 'good-4']);
    // The whole plan was consumed — the bad rows are discarded, not deferred —
    // so the backfill is DONE, not stuck.
    expect(await flag()).toBe(TODAY);
    const meta = await lastAuditMeta();
    expect(meta!.skipped.malformed).toBe(PLAID_BACKFILL_MAX_ROWS_PER_RUN + 5);
    expect(meta!.deferredToNextSync).toBe(0);
    expect(meta!.complete).toBe(true);
  }, 120_000);

  it('a TRUNCATED fetch ingests the rows it got but is never marked done', async () => {
    // An empty page with total_transactions still ahead is a misbehaving server
    // (the O.12d guard). Its rows are real; its ABSENCES are not. Marking done
    // on it would deny the reader the missing history permanently, because the
    // flag gates the only trigger.
    await seedItem([]);
    const deep = Array.from({ length: 600 }, (_, i) =>
      ptxn(`t-${i}`, { date: addDays(TODAY, -600 + i) }),
    );
    mockServer({ deep, truncateAfterFirstPage: true });

    await provider.syncTransactions(USER);

    // The first page's 500 rows landed…
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(500);
    // …but the run is NOT done: the fetch never reached the server's own total.
    expect(await flag()).toBeNull();
    const meta = await lastAuditMeta();
    expect(meta!.fetchComplete).toBe(false);
    expect(meta!.complete).toBe(false);
  }, 120_000);

  it('a run killed during chunk 2 keeps chunk 1 and converges on the next sync', async () => {
    // The point of committing per chunk (the H.5 "per-chunk commit is reasoned,
    // not asserted" residual, built for the Plaid path). The discriminating seam
    // is the ASSIST: creates commit row-by-row under any structure, but the old
    // shape ran ONE assist over the whole plan before the first create — so a
    // run killed there committed NOTHING, and every retry repeated it. Killing
    // the SECOND chunk's assist proves both halves at once: chunk 1's rows are
    // already on disk (per-chunk commit), and a second assist call exists at all
    // (per-chunk fan-out). Under the unchunked shape this test fails twice over:
    // the single assist is never called a second time, so nothing dies — all
    // rows land and the flag sets, the exact opposite of what a mid-plan death
    // must leave behind.
    await seedItem([]);
    const total = PLAID_BACKFILL_CHUNK_ROWS * 2 + 100; // 600: two full chunks + a tail
    const deep = Array.from({ length: total }, (_, i) =>
      ptxn(`c-${i}`, { date: addDays(TODAY, -650 + i) }),
    );
    mockServer({ deep });

    const { assistUnsureRows: realAssist } =
      await vi.importActual<typeof import('@/server/categorize-assist')>('@/server/categorize-assist');
    let nonEmptyCalls = 0;
    vi.mocked(assistUnsureRows).mockImplementation(async (rows, suggest) => {
      // The live sync's own page assist runs with [] here; only backfill chunks
      // are non-empty. Die during the SECOND chunk's assist.
      if (rows.length > 0 && ++nonEmptyCalls === 2) throw new Error('simulated mid-run death');
      return realAssist(rows, suggest);
    });

    await provider.syncTransactions(USER); // backfill dies inside; sync survives (audited .failed)
    vi.mocked(assistUnsureRows).mockImplementation(realAssist);

    // Chunk 1 committed and survived the death; nothing after it landed; still owed.
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(PLAID_BACKFILL_CHUNK_ROWS);
    expect(await flag()).toBeNull();
    const failed = await prisma.auditLog.findMany({
      where: { userId: USER, action: 'plaid.item.history-backfill.failed' },
    });
    expect(failed.length).toBe(1);

    // The next sync continues from the committed prefix and converges.
    await provider.syncTransactions(USER);
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(total);
    expect(await flag()).toBe(TODAY);
  }, 120_000);
});
