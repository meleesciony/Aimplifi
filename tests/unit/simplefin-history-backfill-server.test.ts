/**
 * H.5 — the SimpleFIN deep-history backfill, driven through the REAL
 * `syncSimplefinNow` action against a mocked SimpleFIN server.
 *
 * The owner's report was "i see a max date of march this year". The cause is not a
 * bank limit: a connection whose first pull ran under the old 90-day default is
 * pinned to that floor forever, because every later sync starts at
 * `lastSyncedAt - 5d`. These tests pin BOTH halves of the fix:
 *
 *   (a) it actually reaches back — the backfill's request carries the 1095-day
 *       window, and rows older than the incremental floor land;
 *   (b) it cannot cost anything — a request that re-fetches three years of
 *       already-stored rows leaves every one of them byte-identical, including a
 *       user-corrected verdict, a split parent, and a pending row.
 *
 * (b) is the reason this exists as a server test and not only a planner test. The
 * planner returning zero rows is necessary but not sufficient: the claim is about
 * what the LIVE PATH does, and the live path's own ingest would have refreshed
 * every one of those rows.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { connectSimplefin, disconnectSimplefin, syncSimplefinNow } from '@/server/simplefin-actions';
import { undoReconciliationFor } from '@/server/reconciliation';
import { encryptToken } from '@/lib/crypto';
import { addDays, isoDate, toEpochDays } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { BACKFILL_MAX_ROWS_PER_RUN, SIMPLEFIN_INITIAL_LOOKBACK_DAYS } from '@/lib/providers/simplefin';
import type { SimplefinTransaction } from '@/lib/providers/simplefin-map';

const ACCESS_URL = 'https://ro-user:secret@bridge.example/simplefin';
const KEY = Buffer.alloc(32, 7).toString('base64');
const TODAY = isoDate('2026-06-10');
/** The connection's last good sync — so the incremental window is TODAY-5d..TODAY. */
const LAST_SYNCED = isoDate('2026-06-08');

/** Every /accounts request this mock served, as its decoded start-date. */
let requestedStarts: string[] = [];

function txn(id: string, over: Partial<SimplefinTransaction> = {}): SimplefinTransaction {
  return {
    id,
    posted: toEpochDays(isoDate('2026-06-09')) * 86400,
    amount: '-42.50',
    description: 'STARBUCKS STORE 123 ATLANTA',
    ...over,
  };
}
const at = (date: string) => ({ posted: toEpochDays(isoDate(date)) * 86400 });

/**
 * Serve one payload for the INCREMENTAL window and another for the deep window,
 * discriminated by the start-date the caller actually asked for — so a test can
 * assert that the backfill widened the request, not merely that rows appeared.
 */
function mockServer(opts: {
  incremental: SimplefinTransaction[];
  deep: SimplefinTransaction[];
  deepFails?: boolean;
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = new URL(String(input));
      const startEpoch = Number(url.searchParams.get('start-date'));
      const start = isoDate(new Date(startEpoch * 1000).toISOString().slice(0, 10));
      requestedStarts.push(start);
      const isDeep = start <= addDays(TODAY, -365);
      if (isDeep && opts.deepFails) {
        return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          accounts: [
            {
              id: 'acc-1',
              name: 'Checking',
              balance: '3400.00',
              org: { name: 'My Bank' },
              transactions: isDeep ? opts.deep : opts.incremental,
            },
          ],
        }),
      } as Response;
    }),
  );
}

describe('SimpleFIN deep-history backfill (H.5) — real sync action, mocked server', () => {
  const USER = `sf-hb-${Date.now()}-${process.pid}`;
  let accountId: string;

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  /** An EXISTING connection: synced before, never backfilled — the owner's shape. */
  async function seedConnection(stored: { ref: string; date: string }[]) {
    await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
    await prisma.accountReconciliation.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.simpleFinConnection.deleteMany({ where: { userId: USER } });
    // Audit rows accumulate across tests on this one user; each test asserts about
    // the rows ITS run wrote.
    await prisma.auditLog.deleteMany({ where: { userId: USER } });
    await prisma.simpleFinConnection.create({
      data: {
        userId: USER,
        accessUrl: encryptToken(ACCESS_URL),
        lastSyncedAt: LAST_SYNCED,
        historyBackfilledAt: null,
      },
    });
    const acct = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'simplefin',
        providerRef: 'acc-1',
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

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(wipe);
  beforeEach(async () => {
    requestedStarts = [];
    // `syncSimplefinNow` is rate-limited (10/min) as of this slice; this file drives
    // it far more often than a human could, so clear the durable window per test
    // rather than let the limiter silently turn assertions into zeroes.
    await prisma.rateLimit.deleteMany({ where: { key: `sync-simplefin:${USER}` } });
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('DEMO_TODAY', TODAY);
    vi.stubEnv('XAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reaches past the incremental floor: requests the full window and ingests older rows', async () => {
    await seedConnection([{ ref: 'recent-1', date: '2026-06-09' }]);
    mockServer({
      incremental: [txn('recent-1')],
      // What the owner cannot currently see: rows before his March ceiling.
      deep: [txn('recent-1'), txn('old-1', at('2025-03-04')), txn('old-2', at('2024-11-20'))],
    });

    const r = await syncSimplefinNow();
    expect(r.ok).toBe(true);

    // (a) the request actually widened — this is the defect, stated as an assertion
    expect(requestedStarts).toContain(addDays(TODAY, -SIMPLEFIN_INITIAL_LOOKBACK_DAYS));
    expect(requestedStarts).toContain(addDays(LAST_SYNCED, -5)); // the incremental one still ran

    const rows = await prisma.transaction.findMany({
      where: { accountId },
      select: { providerRef: true, date: true },
      orderBy: { date: 'asc' },
    });
    expect(rows.map((x) => x.providerRef)).toEqual(['old-2', 'old-1', 'recent-1']);
    // and the depth the owner asked about is now real
    expect(rows[0].date).toBe('2024-11-20');
  });

  it('THE ADD-ONLY CLAIM: a three-year re-pull leaves every stored row byte-identical', async () => {
    await seedConnection([
      { ref: 'corrected-1', date: '2026-05-02' },
      { ref: 'plain-1', date: '2026-04-02' },
    ]);
    // A verdict the READER set, and the Correction row that records it — the exact
    // state `guardedVerdictRefresh` inspects, and the state a naive full pull
    // through the live ingest would have overwritten on every uncorrected row.
    const groceries = await prisma.category.findFirst({ where: { name: 'Groceries' }, select: { id: true } });
    const corrected = await prisma.transaction.findFirst({ where: { accountId, providerRef: 'corrected-1' } });
    await prisma.transaction.update({
      where: { id: corrected!.id },
      data: { categoryId: groceries?.id ?? corrected!.categoryId, needsReview: false, confidenceBps: 10000 },
    });
    await prisma.correction.create({
      data: { userId: USER, transactionId: corrected!.id, toCategoryId: groceries!.id },
    });

    const before = await prisma.transaction.findMany({ where: { accountId }, orderBy: { providerRef: 'asc' } });

    mockServer({
      incremental: [],
      // The feed re-sends BOTH stored rows (a full pull always does) plus one new one.
      deep: [
        txn('corrected-1', at('2026-05-02')),
        txn('plain-1', at('2026-04-02')),
        txn('old-1', at('2024-11-20')),
      ],
    });
    await syncSimplefinNow();

    const after = await prisma.transaction.findMany({ where: { accountId }, orderBy: { providerRef: 'asc' } });
    // The new row landed...
    expect(after.map((r) => r.providerRef)).toEqual(['corrected-1', 'old-1', 'plain-1']);
    // ...and NOTHING about the two pre-existing rows moved. Compared whole-record
    // rather than field-by-field: the claim is that the backfill does not touch
    // them, so any column drifting is the defect, including one added later.
    for (const prior of before) {
      const now = after.find((r) => r.providerRef === prior.providerRef);
      expect(now).toEqual(prior);
    }
  });

  it('does not delete or duplicate a stored PENDING row inside the widened window', async () => {
    // The #128 reconcile deletes in-window pendings the feed no longer reports, and
    // its window is the FETCHED one. Routing the deep pull through the live sync
    // would have widened that sweep from 5 days to three years; this backfill runs
    // outside it entirely.
    await seedConnection([]);
    await prisma.transaction.create({
      data: {
        accountId,
        providerRef: 'pend-1',
        date: '2026-06-09',
        amountCents: -1999,
        rawDescriptor: 'HOLD AT HOTEL',
        status: 'PENDING',
      },
    });
    mockServer({
      incremental: [txn('pend-1', { pending: true, ...at('2026-06-09') })],
      // The deep window does NOT re-report the hold — the absence a wider sweep
      // would have read as staleness.
      deep: [txn('old-1', at('2024-11-20'))],
    });

    await syncSimplefinNow();
    const pend = await prisma.transaction.findMany({ where: { accountId, providerRef: 'pend-1' } });
    expect(pend).toHaveLength(1);
    expect(pend[0].status).toBe('PENDING');
  });

  it('never re-creates a pending row the deep window reports (the posted twin would double-count)', async () => {
    await seedConnection([]);
    mockServer({
      incremental: [],
      deep: [txn('p-new', { pending: true, ...at('2025-01-05') }), txn('ok-new', at('2025-01-05'))],
    });
    await syncSimplefinNow();
    const refs = (await prisma.transaction.findMany({ where: { accountId }, select: { providerRef: true } })).map(
      (r) => r.providerRef,
    );
    expect(refs).toEqual(['ok-new']);
  });

  it('runs once: the flag is set on success and the next sync does not refetch the window', async () => {
    await seedConnection([]);
    mockServer({ incremental: [], deep: [txn('old-1', at('2024-11-20'))] });

    await syncSimplefinNow();
    const conn = await prisma.simpleFinConnection.findUnique({ where: { userId: USER } });
    expect(conn!.historyBackfilledAt).toBe(TODAY);

    requestedStarts = [];
    await syncSimplefinNow();
    expect(requestedStarts).not.toContain(addDays(TODAY, -SIMPLEFIN_INITIAL_LOOKBACK_DAYS));
    // and the second run added nothing
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(1);
  });

  it('a failed backfill leaves the flag null, does not fail the sync, and is audited', async () => {
    await seedConnection([]);
    mockServer({ incremental: [txn('recent-1')], deep: [], deepFails: true });

    const r = await syncSimplefinNow();
    // The sync itself SUCCEEDED — a backfill failure may not read as a broken bank.
    expect(r.ok).toBe(true);
    const conn = await prisma.simpleFinConnection.findUnique({ where: { userId: USER } });
    expect(conn!.lastSyncError).toBeNull();
    expect(conn!.lastSyncedAt).toBe(TODAY);
    // ...and the retry is still owed
    expect(conn!.historyBackfilledAt).toBeNull();
    const failures = await prisma.auditLog.findMany({
      where: { userId: USER, action: 'simplefin.history-backfill.failed' },
    });
    expect(failures).toHaveLength(1);
    // The credential-bearing access URL never reaches stored text (#5 / SEC-SF-4).
    expect(failures[0].meta ?? '').not.toContain('secret');
    expect(failures[0].meta ?? '').not.toContain('bridge.example');
  });

  it('marks itself done when the institution returns nothing older, and says so', async () => {
    // "Ran and found nothing" must be distinguishable from "never ran" — otherwise
    // every sync forever pays for a three-year fetch that can never add a row.
    await seedConnection([{ ref: 'recent-1', date: '2026-06-09' }]);
    mockServer({ incremental: [txn('recent-1')], deep: [txn('recent-1')] });

    await syncSimplefinNow();
    const conn = await prisma.simpleFinConnection.findUnique({ where: { userId: USER } });
    expect(conn!.historyBackfilledAt).toBe(TODAY);
    const audits = await prisma.auditLog.findMany({
      where: { userId: USER, action: 'simplefin.history-backfill' },
      orderBy: { createdAt: 'desc' },
    });
    const meta = JSON.parse(audits[0].meta ?? '{}');
    expect(meta.added).toBe(0);
    expect(meta.skipped.alreadyExists).toBe(1);
    expect(meta.windowStart).toBe(addDays(TODAY, -SIMPLEFIN_INITIAL_LOOKBACK_DAYS));
  });

  it('reports what it added in the sync result the caller renders', async () => {
    await seedConnection([]);
    mockServer({
      incremental: [txn('recent-1')],
      deep: [txn('recent-1'), txn('old-1', at('2024-11-20')), txn('old-2', at('2024-12-20'))],
    });
    const r = await syncSimplefinNow();
    // 1 from the incremental pass + 2 the backfill reached back for.
    expect(r.added).toBe(3);
    expect(r.changed).toBe(true);
  });

  // ── Critic cycle 1 ────────────────────────────────────────────────────────
  // Everything below locks a finding from the two fresh-context critic passes.

  it('P0-1: never writes into a SUPERSEDED PREDECESSOR account', async () => {
    // The boundary claims [predecessor.span.first, cutover] and DROPS every
    // successor row inside it. Backfilling three years onto a predecessor drags
    // span.first back three years, deleting three years of the successor's rows —
    // the ones carrying the reader's corrections — from every figure, without
    // updating a single row. Add-only is no defence; not writing is.
    await seedConnection([]);
    const successor = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'plaid',
        providerRef: 'plaid-succ-1',
        name: 'Checking (new)',
        type: 'CHECKING',
        currentBalanceCents: 340000,
      },
    });
    await prisma.accountReconciliation.create({
      data: {
        userId: USER,
        predecessorAccountId: accountId, // the SimpleFIN account the feed reports
        successorAccountId: successor.id,
        cutoverDate: '2026-06-01',
        matchSignal: 'persistent',
        confidence: 'high',
        undoneAt: null,
      },
    });

    mockServer({ incremental: [], deep: [txn('old-1', at('2024-11-20')), txn('old-2', at('2025-02-02'))] });
    await syncSimplefinNow();

    // No rows landed on the read-only predecessor...
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(0);
    // ...and none were invented on the successor either — the backfill files to the
    // account the FEED names, and it declined to.
    expect(await prisma.transaction.count({ where: { accountId: successor.id } })).toBe(0);
    // And — critic cycle 2, P1-2 — the run must NOT mark itself done. Supersession
    // is reversible (`undoneAt` is user-settable); marking done here would leave the
    // connection permanently unwidenable the moment the reader undoes the
    // combination, because the flag gates the only trigger, the first-seen pass
    // never fires for an account that already exists, and reconnect no longer nulls
    // `lastSyncedAt`. Refetching costs a request; the other direction costs the
    // reader their history forever.
    // It marks itself done rather than refetching three years on every sync forever
    // (critic cycle 3, P1-1 — cycle 2's retry-forever traded a trap for a loop). The
    // reversibility of supersession is handled as an EVENT instead; see the next test.
    const conn = await prisma.simpleFinConnection.findUnique({ where: { userId: USER } });
    expect(conn!.historyBackfilledAt).toBe(TODAY);
    const audits = await prisma.auditLog.findMany({
      where: { userId: USER, action: 'simplefin.history-backfill' },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.parse(audits[0].meta ?? '{}').skipped.unmappedAccount).toBe(2);
  });

  it('P1-1: undoing the combination RE-ARMS the backfill, which is what makes marking it done safe', async () => {
    // The half that makes the refusal above safe rather than merely cautious.
    await seedConnection([]);
    const successor = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'plaid',
        providerRef: 'plaid-succ-2',
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
    mockServer({ incremental: [], deep: [txn('old-1', at('2024-11-20'))] });
    await syncSimplefinNow();
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(0);
    // Marked done — nothing to write to.
    const done = await prisma.simpleFinConnection.findUnique({ where: { userId: USER } });
    expect(done!.historyBackfilledAt).toBe(TODAY);

    // The reader undoes the combination through the REAL action: the account is
    // writable history again, and the undo must re-arm the backfill — otherwise the
    // "done" above is a permanent trap, since the flag gates the only trigger.
    const undo = await undoReconciliationFor(USER, link.id);
    expect(undo.ok).toBe(true);
    const rearmed = await prisma.simpleFinConnection.findUnique({ where: { userId: USER } });
    expect(rearmed!.historyBackfilledAt).toBeNull();

    await prisma.rateLimit.deleteMany({ where: { key: `sync-simplefin:${USER}` } });
    await syncSimplefinNow();
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(1);
  });

  it('P1-1: rows that cannot be prepared never hold the cap hostage', async () => {
    // A row whose amount the parser rejects never reaches `create`, so it never
    // enters `existingRefs` and the next run re-plans it in the same oldest-first
    // position. Charging it to the budget let one bad-format bridge pin the cap
    // forever: nothing lands, the flag never sets, every sync pays a 3-year fetch.
    // MORE unpreparable rows than the whole per-run cap, all sorted ahead of the good
    // ones — the only shape that can distinguish "budget charged on examine" from
    // "budget charged on prepare". With fewer than the cap, both implementations pass
    // and the test certifies nothing (critic cycle 3, P1-2: reverting the fix left
    // the suite green).
    await seedConnection([]);
    const bad = Array.from({ length: BACKFILL_MAX_ROWS_PER_RUN + 5 }, (_, i) =>
      txn(`bad-${i}`, { amount: 'N/A', posted: toEpochDays(isoDate(addDays(TODAY, -900))) * 86400 }),
    );
    const good = Array.from({ length: 5 }, (_, i) =>
      txn(`good-${i}`, { posted: toEpochDays(isoDate(addDays(TODAY, -100 - i))) * 86400 }),
    );
    mockServer({ incremental: [], deep: [...bad, ...good] });

    await syncSimplefinNow();
    // The good rows landed even though 2005 unusable rows sat ahead of them...
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(5);
    const conn = await prisma.simpleFinConnection.findUnique({ where: { userId: USER } });
    // ...and the run COMPLETED, so it will never re-fetch three years again. Charging
    // the unusable rows to the budget would leave this null forever.
    expect(conn!.historyBackfilledAt).toBe(TODAY);
  }, 120_000);

  it('P1-3: a capped run spends its budget on the OLDEST rows first', async () => {
    // The cap's entire safety argument — a partial run extends the span downward
    // rather than holing the middle. The owner's complaint IS a floor, so a
    // newest-first sort would leave it in place run after run.
    await seedConnection([]);
    const deep = Array.from({ length: BACKFILL_MAX_ROWS_PER_RUN + 10 }, (_, i) =>
      // i=0 is the OLDEST; the last 10 are the newest and should be the ones deferred.
      txn(`ord-${i}`, { posted: toEpochDays(isoDate(addDays(TODAY, -1050 + Math.floor(i / 2)))) * 86400 }),
    );
    mockServer({ incremental: [], deep });

    await syncSimplefinNow();
    const landed = await prisma.transaction.findMany({
      where: { accountId },
      select: { date: true },
      orderBy: { date: 'desc' },
      take: 1,
    });
    const all = await prisma.transaction.findMany({ where: { accountId }, select: { date: true } });
    expect(all).toHaveLength(BACKFILL_MAX_ROWS_PER_RUN);
    // The newest row that landed must still be older than the newest row overall —
    // i.e. the deferred 10 are the NEWEST, not an arbitrary tail.
    const newestPlanned = addDays(TODAY, -1050 + Math.floor((BACKFILL_MAX_ROWS_PER_RUN + 9) / 2));
    expect(landed[0].date < newestPlanned).toBe(true);
  }, 120_000);

  it('the demo account never egresses, even reaching the backfill directly', async () => {
    // Defense in depth: `syncSimplefinNow` already refuses demo at the action, so no
    // test could otherwise reach this fence — deleting it left the whole suite green.
    const { syncFromSimplefin } = await import('@/lib/providers/simplefin');
    await prisma.simpleFinConnection.deleteMany({ where: { userId: 'user-demo' } });
    await prisma.simpleFinConnection.create({
      data: { userId: 'user-demo', accessUrl: encryptToken(ACCESS_URL), lastSyncedAt: LAST_SYNCED, historyBackfilledAt: null },
    });
    let deepFetches = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const start = Number(new URL(String(input)).searchParams.get('start-date'));
        if (start <= toEpochDays(addDays(TODAY, -365)) * 86400) deepFetches++;
        return { ok: true, status: 200, json: async () => ({ accounts: [] }) } as Response;
      }),
    );
    await syncFromSimplefin('user-demo', TODAY);
    expect(deepFetches).toBe(0);
    const conn = await prisma.simpleFinConnection.findUnique({ where: { userId: 'user-demo' } });
    expect(conn!.historyBackfilledAt).toBeNull(); // it did not even claim to have run
    await prisma.simpleFinConnection.deleteMany({ where: { userId: 'user-demo' } });
  });

  it('A-P1-1: does not run transfer pairing, so no stored row has its verdict flipped', async () => {
    // `refreshTransferFlags` writes `isTransfer: true` onto ALREADY-STORED rows when
    // a new row supplies a missing counterpart, on a coincidence rule (equal
    // magnitude, opposite sign, within 3 days). A three-year backfill would give
    // that rule three extra years of chances to fire against rows the reader had
    // already settled — silently removing them from every spending total.
    await seedConnection([]);
    const other = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'simplefin',
        providerRef: 'acc-2',
        name: 'Savings',
        type: 'SAVINGS',
        currentBalanceCents: 100000,
      },
    });
    // A settled row on ANOTHER account, waiting for a counterpart.
    const settled = await prisma.transaction.create({
      data: {
        accountId: other.id,
        providerRef: 'settled-1',
        date: '2025-03-04',
        amountCents: 50000,
        rawDescriptor: 'DEPOSIT',
        status: 'POSTED',
        isTransfer: false,
        needsReview: false,
      },
    });
    // The backfill adds its exact opposite, three days away — a textbook pair.
    mockServer({
      incremental: [],
      deep: [txn('old-1', { amount: '-500.00', description: 'WITHDRAWAL', ...at('2025-03-04') })],
    });

    await syncSimplefinNow();
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(1); // it DID add
    const after = await prisma.transaction.findUnique({ where: { id: settled.id } });
    expect(after).toEqual(settled); // ...and the settled row is untouched
  });

  it('A-P1-2: an inconclusive response is NOT marked done, so the retry survives', async () => {
    // A 200 carrying `errors` and no usable accounts produces the same empty plan as
    // "history already complete". Marking done on it would deny the fix permanently:
    // the flag gates the only trigger and no surface can ask for a retry.
    await seedConnection([{ ref: 'recent-1', date: '2026-06-09' }]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = new URL(String(input));
        requestedStarts.push(isoDate(new Date(Number(url.searchParams.get('start-date')) * 1000).toISOString().slice(0, 10)));
        return {
          ok: true,
          status: 200,
          // A partial response: the account is named but its transactions array is
          // ABSENT — which the planner refuses to read as "no transactions".
          json: async () => ({
            accounts: [{ id: 'acc-1', name: 'Checking', balance: '3400.00' }],
            errors: ['Connection to My Bank failed'],
          }),
        } as Response;
      }),
    );

    const r = await syncSimplefinNow();
    expect(r.ok).toBe(true);
    const conn = await prisma.simpleFinConnection.findUnique({ where: { userId: USER } });
    expect(conn!.historyBackfilledAt).toBeNull(); // still owed
    const inconclusive = await prisma.auditLog.findMany({
      where: { userId: USER, action: 'simplefin.history-backfill.inconclusive' },
    });
    expect(inconclusive).toHaveLength(1);
    // The bridge's own error text is recorded — nothing read this field before.
    expect(JSON.parse(inconclusive[0].meta ?? '{}').errors).toEqual(['Connection to My Bank failed']);
  });

  it('B-P1-2/4: a plan over the cap commits what it did, defers the rest, and stays owed', async () => {
    // A serverless timeout is not catchable, so a run that dies must leave progress
    // behind. Unchunked, the LLM assist ran over the whole plan BEFORE the first
    // create, so a kill committed nothing and the retry repeated it forever.
    await seedConnection([]);
    const over = BACKFILL_MAX_ROWS_PER_RUN + 25;
    const deep = Array.from({ length: over }, (_, i) =>
      txn(`bulk-${i}`, { posted: toEpochDays(isoDate(addDays(TODAY, -1000 + Math.floor(i / 4)))) * 86400 }),
    );
    mockServer({ incremental: [], deep });

    const first = await syncSimplefinNow();
    expect(first.added).toBe(BACKFILL_MAX_ROWS_PER_RUN);
    const conn = await prisma.simpleFinConnection.findUnique({ where: { userId: USER } });
    expect(conn!.historyBackfilledAt).toBeNull(); // NOT done — the rest is still owed
    const audits = await prisma.auditLog.findMany({
      where: { userId: USER, action: 'simplefin.history-backfill' },
      orderBy: { createdAt: 'desc' },
    });
    const meta = JSON.parse(audits[0].meta ?? '{}');
    expect(meta.deferredToNextSync).toBe(25);
    expect(meta.complete).toBe(false);

    // The next sync continues rather than restarting, and converges.
    const second = await syncSimplefinNow();
    expect(second.added).toBe(25);
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(over);
    const conn2 = await prisma.simpleFinConnection.findUnique({ where: { userId: USER } });
    expect(conn2!.historyBackfilledAt).toBe(TODAY);
  }, 120_000);

  it('B-P2-1: re-derives recurring series from the newly-deep history (the slice’s whole point)', async () => {
    // The stated reason three more years is worth having: an annual or semiannual
    // series needs occurrences the 90-day floor never stored. Nothing asserted it,
    // so deleting the refresh left the suite green.
    await seedConnection([]);
    const monthly = Array.from({ length: 14 }, (_, i) =>
      txn(`sub-${i}`, {
        amount: '-15.99',
        description: 'NETFLIX.COM SUBSCRIPTION',
        posted: toEpochDays(isoDate(addDays(TODAY, -30 * (i + 1)))) * 86400,
      }),
    );
    mockServer({ incremental: [], deep: monthly });

    await syncSimplefinNow();
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(14);
    const series = await prisma.recurringSeries.findMany({ where: { userId: USER } });
    expect(series.length).toBeGreaterThan(0);
  }, 60_000);

  it('P0-1: disconnect → reconnect does NOT re-file the history the disconnect kept', async () => {
    // `disconnectSimplefin` DELETES the connection row and deliberately KEEPS the
    // transactions, so reconnecting takes the upsert's `create:` branch — where a
    // null `lastSyncedAt` means a 1095-day pull through the LIVE ingest, over
    // retained rows, every one of which meets `guardedVerdictRefresh`. Measured on a
    // probe before the fix: a stored 2024 row filed as Groceries came back as Coffee,
    // silently, with no audit row. The disconnect copy actively invites this flow.
    await seedConnection([{ ref: 'old-1', date: '2024-11-20' }]);
    const groceries = await prisma.category.findFirst({ where: { name: 'Groceries' }, select: { id: true } });
    const stored = await prisma.transaction.findFirst({ where: { accountId, providerRef: 'old-1' } });
    await prisma.transaction.update({
      where: { id: stored!.id },
      // A settled row with NO Correction — the ordinary case, and the one
      // `guardedVerdictRefresh` does not preserve.
      data: { categoryId: groceries!.id, needsReview: false, confidenceBps: 9000 },
    });
    const before = await prisma.transaction.findUnique({ where: { id: stored!.id } });

    await disconnectSimplefin();
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(1); // history kept

    // The feed re-reports that same row, as it would, plus one genuinely older one.
    mockServer({
      incremental: [txn('old-1', { description: 'STARBUCKS STORE 123 ATLANTA', ...at('2024-11-20') })],
      deep: [
        txn('old-1', { description: 'STARBUCKS STORE 123 ATLANTA', ...at('2024-11-20') }),
        txn('older-1', at('2024-02-02')),
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: { method?: string }) => {
        const url = String(input);
        if (init?.method === 'POST') return { ok: true, status: 200, text: async () => ACCESS_URL } as Response;
        const startEpoch = Number(new URL(url).searchParams.get('start-date'));
        requestedStarts.push(isoDate(new Date(startEpoch * 1000).toISOString().slice(0, 10)));
        // Window-faithful, like a real bridge: a 5-day request cannot return a 2024
        // row. Without this the test would "fail" on the live ingest's intended
        // 5-day-overlap refresh instead of on the defect it is about.
        const all = [txn('old-1', at('2024-11-20')), txn('older-1', at('2024-02-02'))];
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accounts: [
              {
                id: 'acc-1',
                name: 'Checking',
                balance: '3400.00',
                transactions: all.filter((t) => t.posted >= startEpoch),
              },
            ],
          }),
        } as Response;
      }),
    );
    await prisma.rateLimit.deleteMany({ where: { key: `sync-simplefin:${USER}` } });
    const setupToken = Buffer.from('https://claim.example/abc123', 'utf8').toString('base64');
    const r = await connectSimplefin(setupToken);
    expect(r.ok).toBe(true);

    // The retained row is byte-identical: its verdict was not re-derived.
    expect(await prisma.transaction.findUnique({ where: { id: stored!.id } })).toEqual(before);
    // ...and the deep history still arrived, by the add-only path.
    expect(await prisma.transaction.count({ where: { accountId, providerRef: 'older-1' } })).toBe(1);
  });

  it('scopes the already-stored set to THIS user (another tenant cannot suppress rows)', async () => {
    // `existingRefs` decides what NOT to add. If it were unscoped, a providerRef
    // held by any other user would silently omit this user's row — a hole in the
    // history the backfill exists to fill, invisible to every test using one user.
    const OTHER = `${USER}-other`;
    await prisma.user.deleteMany({ where: { id: OTHER } });
    await prisma.user.create({ data: { id: OTHER, email: `${OTHER}@test.local` } });
    const otherAcct = await prisma.account.create({
      data: {
        userId: OTHER,
        provider: 'simplefin',
        providerRef: 'acc-other',
        name: 'Their Checking',
        type: 'CHECKING',
        currentBalanceCents: 1,
      },
    });
    await seedConnection([]);
    await prisma.transaction.create({
      data: {
        accountId: otherAcct.id,
        providerRef: 'shared-ref-1', // the SAME id our feed is about to report
        date: '2025-01-05',
        amountCents: -100,
        rawDescriptor: 'THEIRS',
        status: 'POSTED',
      },
    });

    mockServer({ incremental: [], deep: [txn('shared-ref-1', at('2025-01-05'))] });
    await syncSimplefinNow();

    // Ours landed despite the other tenant holding that id.
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(1);
    await prisma.user.deleteMany({ where: { id: OTHER } });
  });
});
