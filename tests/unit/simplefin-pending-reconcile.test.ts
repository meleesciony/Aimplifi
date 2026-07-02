/**
 * SimpleFIN PENDING-transaction reconcile (DECISIONS #128, live-ingest backlog #4) —
 * real connect/sync actions against a throwaway user with a MOCKED SimpleFIN server.
 *
 * SimpleFIN sends a stateless per-window snapshot with NO `removed[]` list, and the
 * spec lets a transaction's id CHANGE when a pending charge posts. So without an
 * absence-based reconcile, a pending row that (a) never posts lingers forever
 * (overstating spend) or (b) re-posts under a new id is DOUBLE-COUNTED. This locks the
 * reconcile and — critically — its safety rails: POSTED rows, out-of-window rows, split
 * parents, manual (null-providerRef) rows, and accounts with a transiently OMITTED
 * transactions field are all left untouched. Live network path is UNVERIFIED.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { connectSimplefin } from '@/server/simplefin-actions';
import { syncFromSimplefin } from '@/lib/providers/simplefin';
import { isoDate } from '@/lib/dates';
import { prisma } from '@/lib/db';

const CLAIM_URL = 'https://claim.example/abc123';
const SETUP_TOKEN = Buffer.from(CLAIM_URL, 'utf8').toString('base64');
const ACCESS_URL = 'https://ro-user:secret@bridge.example/simplefin';
const KEY = Buffer.alloc(32, 7).toString('base64');

const TODAY = isoDate('2026-06-10'); // matches DEMO_TODAY; incremental window = 2026-06-05
const epoch = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 1000);

interface RawTxn {
  id: string;
  posted: number; // unix seconds; 0 = still-pending sentinel
  amount: string;
  description?: string;
  pending?: boolean;
  transacted_at?: number;
}
interface RawAccount {
  id: string;
  name: string;
  balance: string;
  org?: { name?: string };
  transactions?: RawTxn[];
}

// A plain deposit account so its transactions ingest into the spending register
// (not skipped like INVESTMENT/LOAN). `transactions` is passed through verbatim so a
// test can send an explicit [] vs an OMITTED field — the two are deliberately distinct.
const checking = (transactions?: RawTxn[]): RawAccount => ({
  id: 'chk-1',
  name: 'Everyday Checking',
  balance: '5000.00',
  org: { name: 'Demo CU' },
  transactions,
});
const posted = (id: string, on: [number, number, number], amount = '-50.00'): RawTxn => ({
  id,
  posted: epoch(...on),
  amount,
  description: `${id} PURCHASE`,
});
const pending = (id: string, on: [number, number, number], amount = '-50.00'): RawTxn => ({
  id,
  posted: 0,
  transacted_at: epoch(...on),
  amount,
  description: `${id} PENDING`,
  pending: true,
});

let accountsPayload: { accounts: RawAccount[] } = { accounts: [] };

function mockServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = String(input);
      if (init?.method === 'POST' && url === CLAIM_URL) {
        return { ok: true, status: 200, text: async () => ACCESS_URL } as Response;
      }
      if (url.startsWith('https://bridge.example/simplefin/accounts')) {
        return { ok: true, status: 200, json: async () => accountsPayload } as Response;
      }
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) } as Response;
    }),
  );
}

describe('SimpleFIN pending reconcile (real actions, mocked server)', () => {
  const USER = `sf-pend-${Date.now()}-${process.pid}`;

  async function wipe() {
    await prisma.account.deleteMany({ where: { userId: USER } }); // cascades txns
    await prisma.simpleFinConnection.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  const txns = () => prisma.transaction.findMany({ where: { account: { userId: USER } } });
  const count = () => prisma.transaction.count({ where: { account: { userId: USER } } });
  const accountId = async () =>
    (
      await prisma.account.findFirstOrThrow({
        where: { userId: USER, provider: 'simplefin', providerRef: 'chk-1' },
        select: { id: true },
      })
    ).id;

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(wipe);
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('DEMO_TODAY', '2026-06-10');
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.simpleFinConnection.deleteMany({ where: { userId: USER } });
    accountsPayload = { accounts: [checking([])] };
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('deletes an in-window pending row the feed no longer reports; posted survives', async () => {
    accountsPayload = { accounts: [checking([posted('p1', [2026, 6, 8]), pending('g1', [2026, 6, 8])])] };
    await connectSimplefin(SETUP_TOKEN); // full pull ingests both
    expect(await count()).toBe(2);
    expect((await txns()).find((t) => t.providerRef === 'g1')!.status).toBe('PENDING');

    accountsPayload = { accounts: [checking([posted('p1', [2026, 6, 8])])] }; // g1 vanished
    const r = await syncFromSimplefin(USER, TODAY);

    expect(r.removed).toBe(1);
    const rows = await txns();
    expect(rows).toHaveLength(1);
    expect(rows[0].providerRef).toBe('p1');
    expect(rows[0].status).toBe('POSTED');
  });

  it('pending → posted under the SAME id: updates in place, never duplicates (removed 0)', async () => {
    accountsPayload = { accounts: [checking([pending('t1', [2026, 6, 8])])] };
    await connectSimplefin(SETUP_TOKEN);
    expect((await txns())[0].status).toBe('PENDING');

    accountsPayload = { accounts: [checking([posted('t1', [2026, 6, 8])])] }; // same id, now posted
    const r = await syncFromSimplefin(USER, TODAY);

    expect(r.removed).toBe(0);
    const rows = await txns();
    expect(rows).toHaveLength(1);
    expect(rows[0].providerRef).toBe('t1');
    expect(rows[0].status).toBe('POSTED');
  });

  it('pending → posted under a NEW id: old deleted, new added, exactly one row (no double-count)', async () => {
    accountsPayload = { accounts: [checking([pending('pend-1', [2026, 6, 8])])] };
    await connectSimplefin(SETUP_TOKEN);

    accountsPayload = { accounts: [checking([posted('posted-1', [2026, 6, 8])])] }; // re-posted, new id
    const r = await syncFromSimplefin(USER, TODAY);

    expect(r.added).toBe(1);
    expect(r.removed).toBe(1);
    const rows = await txns();
    expect(rows).toHaveLength(1); // NOT 2 — the stale pending was reconciled away
    expect(rows[0].providerRef).toBe('posted-1');
    expect(rows[0].status).toBe('POSTED');
  });

  it('an explicit empty feed reconciles in-window pending, but NEVER a POSTED row', async () => {
    accountsPayload = { accounts: [checking([posted('p1', [2026, 6, 8]), pending('g1', [2026, 6, 8])])] };
    await connectSimplefin(SETUP_TOKEN);
    expect(await count()).toBe(2);

    accountsPayload = { accounts: [checking([])] }; // explicit empty window
    const r = await syncFromSimplefin(USER, TODAY);

    expect(r.removed).toBe(1); // only the pending
    const rows = await txns();
    expect(rows).toHaveLength(1);
    expect(rows[0].providerRef).toBe('p1');
    expect(rows[0].status).toBe('POSTED'); // posted is institution-authoritative — untouched
  });

  it('preserves a pending row outside the fetch overlap but within the age-out horizon', async () => {
    // Full pull ingests a pending dated 2026-06-02: before the incremental window
    // (startDate 2026-06-05) so the absence-reconcile skips it, yet newer than the
    // age-out floor (2026-05-09) so it is NOT swept — it must survive untouched.
    accountsPayload = { accounts: [checking([pending('hold', [2026, 6, 2])])] };
    await connectSimplefin(SETUP_TOKEN);
    expect((await txns())[0].providerRef).toBe('hold');

    accountsPayload = { accounts: [checking([posted('fresh', [2026, 6, 8])])] };
    const r = await syncFromSimplefin(USER, TODAY);

    expect(r.removed).toBe(0); // 'hold' is < startDate (not in-window) and > ageOutFloor (not aged)
    const refs = (await txns()).map((t) => t.providerRef).sort();
    expect(refs).toEqual(['fresh', 'hold']);
  });

  it('ages out a feed-owned pending older than the max hold, even out of the fetch window (critic P1-1)', async () => {
    // A multi-day hold dated 2026-04-15 (56 days before today) that drifted past the
    // incremental overlap. Without the age-out it lingers forever and double-counts on a
    // re-post under a new id; the age-out (floor 2026-05-09) sweeps it.
    accountsPayload = { accounts: [checking([pending('aged', [2026, 4, 15]), posted('p1', [2026, 6, 8])])] };
    await connectSimplefin(SETUP_TOKEN);
    expect(await count()).toBe(2);

    accountsPayload = { accounts: [checking([posted('p1', [2026, 6, 8])])] }; // 'aged' gone from the feed
    const r = await syncFromSimplefin(USER, TODAY);

    expect(r.removed).toBe(1); // the aged pending (out of the in-window pass, caught by age-out)
    const rows = await txns();
    expect(rows).toHaveLength(1);
    expect(rows[0].providerRef).toBe('p1');
    expect(rows[0].status).toBe('POSTED');
  });

  it('does NOT age out a long hold the CURRENT snapshot still reports as pending', async () => {
    // An old pending (2026-04-15) that the feed STILL returns as pending must survive the
    // age-out — corroboration beats the age threshold (no false delete of a real hold).
    accountsPayload = { accounts: [checking([pending('longhold', [2026, 4, 15])])] };
    await connectSimplefin(SETUP_TOKEN);

    accountsPayload = { accounts: [checking([pending('longhold', [2026, 4, 15])])] }; // still pending
    const r = await syncFromSimplefin(USER, TODAY);

    expect(r.removed).toBe(0);
    const rows = await txns();
    expect(rows).toHaveLength(1);
    expect(rows[0].providerRef).toBe('longhold');
    expect(rows[0].status).toBe('PENDING');
  });

  it('a feed sending `transactions: null` does NOT throw/abort the sync (critic P1-2)', async () => {
    accountsPayload = { accounts: [checking([pending('g1', [2026, 6, 8])])] };
    await connectSimplefin(SETUP_TOKEN);
    expect(await count()).toBe(1);

    // Untrusted feed: an explicit null (not just an omitted field). The old `=== undefined`
    // guard let this reach `for...of null` → TypeError → whole sync aborted.
    accountsPayload = { accounts: [{ id: 'chk-1', name: 'Everyday Checking', balance: '5000.00', transactions: null as unknown as RawTxn[] }] };
    const r = await syncFromSimplefin(USER, TODAY); // must RESOLVE, not throw

    expect(r.removed).toBe(0);
    const rows = await txns();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('PENDING'); // untouched (not ingested, not reconciled)
  });

  it('a CORROBORATED pending split is kept; a stale one survives IN-WINDOW and dissolves at AGE-OUT with its children (cycle-4 #27, DECISIONS #148)', async () => {
    // Contract history: pre-#147 split parents were NEVER swept (immortal → the
    // cycle-3 P0 permanent double count); cycle-3 swept them on ANY absence (one
    // flaky snapshot destroyed a real user split — cycle-4 #27); the owner-ratified
    // landing point: in-window absence NEVER touches a split, the ≤32d age-out
    // dissolves it WITH children (never orphaned, never immortal, bounded cost).
    accountsPayload = { accounts: [checking([pending('sp-1', [2026, 6, 8])])] };
    await connectSimplefin(SETUP_TOKEN);
    const parent0 = await prisma.transaction.findFirstOrThrow({
      where: { account: { userId: USER }, providerRef: 'sp-1' },
    });
    await prisma.transaction.update({
      where: { id: parent0.id },
      data: { isSplitParent: true, categoryId: null, needsReview: false, confidenceBps: null },
    });
    await prisma.transaction.createMany({
      data: [
        { id: `rec-sp-a-${process.pid}`, accountId: parent0.accountId, date: parent0.date, amountCents: -300, rawDescriptor: parent0.rawDescriptor, status: 'PENDING', needsReview: false, splitParentId: parent0.id },
        { id: `rec-sp-b-${process.pid}`, accountId: parent0.accountId, date: parent0.date, amountCents: parent0.amountCents + 300, rawDescriptor: parent0.rawDescriptor, status: 'PENDING', needsReview: false, splitParentId: parent0.id },
      ],
    });

    // While the feed still REPORTS the pending id, the split is corroborated: kept.
    accountsPayload = { accounts: [checking([pending('sp-1', [2026, 6, 8])])] };
    await syncFromSimplefin(USER, TODAY);
    expect(await prisma.transaction.count({ where: { account: { userId: USER } } })).toBe(3);

    // The feed drops it IN-WINDOW (flaky snapshot / new-id re-post): the split
    // SURVIVES pass 1 — one absence must never destroy a user decision.
    accountsPayload = { accounts: [checking([])] };
    const inWindow = await syncFromSimplefin(USER, TODAY);
    expect(inWindow.removed).toBe(0);
    expect(await prisma.transaction.count({ where: { account: { userId: USER } } })).toBe(3);

    // Aged past the 32-day floor and still unreported: pass 2 dissolves it WITH
    // its children — never orphaned, never immortal.
    await prisma.transaction.update({ where: { id: parent0.id }, data: { date: '2026-04-20' } });
    const aged = await syncFromSimplefin(USER, TODAY);
    expect(aged.removed).toBe(1); // the feed-owned parent; children are collateral
    expect(await prisma.transaction.count({ where: { account: { userId: USER } } })).toBe(0);
    // The original pre-#147 intent, restated on the final contract: NO dangling children.
    expect(
      await prisma.transaction.count({
        where: { account: { userId: USER }, splitParentId: { not: null } },
      }),
    ).toBe(0);
  });

  it('a GARBLED row still corroborates its pending — a parse failure never reads as absence (cycle-4 #26)', async () => {
    accountsPayload = { accounts: [checking([pending('g1', [2026, 6, 8])])] };
    await connectSimplefin(SETUP_TOKEN);
    expect(await count()).toBe(1);

    // The same id re-sent with a garbled amount: ingest SKIPS the row (malformed-row
    // guard), but the feed still REPORTED the id — pre-#148 the reconcile read the
    // skip as absence and swept a still-real pending row (destroying a user split,
    // had one existed). Corroboration now comes from the RAW feed ids.
    accountsPayload = { accounts: [checking([
      { id: 'g1', posted: 0, transacted_at: epoch(2026, 6, 8), amount: '-8.5O', description: 'g1 PENDING', pending: true },
    ])] };
    const r = await syncFromSimplefin(USER, TODAY);

    expect(r.removed).toBe(0); // reported-but-unparseable ≠ stale
    const rows = await txns();
    expect(rows).toHaveLength(1);
    expect(rows[0].providerRef).toBe('g1');
    expect(rows[0].status).toBe('PENDING');
  });

  it('NEVER deletes a manual (null-providerRef) row, even on an emptied account', async () => {
    accountsPayload = { accounts: [checking([pending('g1', [2026, 6, 8])])] };
    await connectSimplefin(SETUP_TOKEN);
    const acctId = await accountId();
    // A non-feed row with no providerRef sitting in the same window.
    await prisma.transaction.create({
      data: {
        accountId: acctId,
        providerRef: null,
        date: '2026-06-08',
        amountCents: -1234,
        rawDescriptor: 'MANUAL ENTRY',
        status: 'PENDING',
      },
    });

    accountsPayload = { accounts: [checking([])] }; // empty branch (no notIn guard)
    const r = await syncFromSimplefin(USER, TODAY);

    expect(r.removed).toBe(1); // only the feed-owned 'g1'
    const rows = await txns();
    expect(rows).toHaveLength(1);
    expect(rows[0].providerRef).toBeNull(); // the manual row survived
    expect(rows[0].rawDescriptor).toBe('MANUAL ENTRY');
  });

  it('a transiently OMITTED transactions field does NOT wipe pending (only an explicit [] reconciles)', async () => {
    accountsPayload = { accounts: [checking([pending('g1', [2026, 6, 8])])] };
    await connectSimplefin(SETUP_TOKEN);
    expect(await count()).toBe(1);

    accountsPayload = { accounts: [checking(undefined)] }; // partial/transient response: no transactions field
    const r = await syncFromSimplefin(USER, TODAY);

    expect(r.removed).toBe(0);
    const rows = await txns();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('PENDING'); // untouched
  });
});
