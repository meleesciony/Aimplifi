/**
 * SimpleFIN connect + sync orchestration (ROADMAP: cheaper Plaid alternative).
 * Drives the REAL connectSimplefin/syncSimplefinNow actions against a throwaway
 * user with a MOCKED SimpleFIN server (claim POST + /accounts GET). Proves the
 * token claim, encrypted storage, account/transaction ingest with correct signs +
 * categories, and idempotent re-sync. The live network is UNVERIFIED; this pins
 * the logic that would corrupt the ledger if wrong.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { connectSimplefin, syncSimplefinNow } from '@/server/simplefin-actions';
import { decryptToken } from '@/lib/crypto';
import { isoDate, toEpochDays } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { isSyncFailureReason } from '@/lib/providers/sync-status';
import { SIMPLEFIN_INITIAL_LOOKBACK_DAYS } from '@/lib/providers/simplefin';

const CLAIM_URL = 'https://claim.example/abc123';
const SETUP_TOKEN = Buffer.from(CLAIM_URL, 'utf8').toString('base64');
const ACCESS_URL = 'https://ro-user:secret@bridge.example/simplefin';
const KEY = Buffer.alloc(32, 7).toString('base64'); // 32-byte AES key for the test

const ACCOUNTS = {
  accounts: [
    {
      id: 'acc-1',
      name: 'Checking',
      balance: '3400.00',
      org: { name: 'My Bank' },
      transactions: [
        { id: 'tx-1', posted: 1781049600, amount: '-42.50', description: 'STARBUCKS STORE 123 ATLANTA' },
        { id: 'tx-2', posted: 1781049600, amount: '2500.00', description: 'GUSTO PAYROLL DIRECT DEP' },
      ],
    },
  ],
};

function mockServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = String(input);
      if (init?.method === 'POST' && url === CLAIM_URL) {
        return { ok: true, status: 200, text: async () => ACCESS_URL } as Response;
      }
      if (url.startsWith('https://bridge.example/simplefin/accounts')) {
        return { ok: true, status: 200, json: async () => ACCOUNTS } as Response;
      }
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) } as Response;
    }),
  );
}

describe('SimpleFIN connect + sync (real actions, mocked server)', () => {
  const USER = `sf-user-${Date.now()}-${process.pid}`;

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(wipe);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('DEMO_TODAY', '2026-06-10');
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('refuses to connect without an encryption key (no plaintext credentials)', async () => {
    vi.stubEnv('DATA_ENCRYPTION_KEY', '');
    const r = await connectSimplefin(SETUP_TOKEN);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/DATA_ENCRYPTION_KEY/);
  });

  it('rejects an SSRF setup token (non-https or internal host) without fetching it', async () => {
    const fetchSpy = vi.mocked(fetch);
    const httpTok = Buffer.from('http://evil.example/claim', 'utf8').toString('base64');
    expect((await connectSimplefin(httpTok)).ok).toBe(false);
    const metaTok = Buffer.from('https://169.254.169.254/latest/meta-data', 'utf8').toString('base64');
    const r = await connectSimplefin(metaTok);
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled(); // blocked before any request
  });

  it('claims the token, stores the access URL encrypted, and ingests accounts + transactions', async () => {
    const r = await connectSimplefin(SETUP_TOKEN);
    expect(r.ok).toBe(true);
    // A swallowed first-sync throw (e.g. SQLITE_BUSY under load) returns ok:true
    // with an error set and added:0 — assert no error so it fails legibly as a sync
    // failure, not as a baffling wrong row count (the original flake's masking).
    expect(r.error).toBeUndefined();
    expect(r.added).toBe(2);

    // access URL stored ENCRYPTED (decrypts back to the original)
    const conn = await prisma.simpleFinConnection.findUnique({ where: { userId: USER } });
    expect(conn).not.toBeNull();
    expect(conn!.accessUrl).not.toContain('bridge.example'); // not plaintext
    expect(decryptToken(conn!.accessUrl)).toBe(ACCESS_URL);

    // account ingested with inferred type + positive balance
    const acct = await prisma.account.findFirst({ where: { userId: USER, provider: 'simplefin', providerRef: 'acc-1' } });
    expect(acct).not.toBeNull();
    expect(acct!.name).toBe('My Bank Checking');
    expect(acct!.type).toBe('CHECKING');
    expect(acct!.currentBalanceCents).toBe(340000);

    // transactions ingested with correct signs + categorization
    const starbucks = await prisma.transaction.findFirst({ where: { providerRef: 'tx-1', account: { userId: USER } } });
    expect(starbucks!.amountCents).toBe(-4250); // outflow negative
    expect(starbucks!.categoryId).toBe('coffee'); // #163: Starbucks = coffee
    const payroll = await prisma.transaction.findFirst({ where: { providerRef: 'tx-2', account: { userId: USER } } });
    expect(payroll!.amountCents).toBe(250000); // inflow positive
  });

  it('re-syncing is idempotent (updates, never duplicates by providerRef)', async () => {
    await connectSimplefin(SETUP_TOKEN);
    const before = await prisma.transaction.count({ where: { account: { userId: USER } } });
    const r = await syncSimplefinNow();
    expect(r.ok).toBe(true);
    const after = await prisma.transaction.count({ where: { account: { userId: USER } } });
    expect(after).toBe(before); // same rows, updated in place
    expect(await prisma.account.count({ where: { userId: USER, provider: 'simplefin' } })).toBe(1);
  });

  it('sends the access URL creds as a header and a start-date on incremental sync (CQ-4)', async () => {
    await connectSimplefin(SETUP_TOKEN); // 1st sync → lastSyncedAt = 2026-06-10
    await syncSimplefinNow(); // 2nd sync → start-date = 2026-06-05 (5-day overlap)
    const calls = vi.mocked(fetch).mock.calls as [unknown, { method?: string; headers?: Record<string, string> }][];
    const gets = calls.filter(([u, i]) => i?.method === 'GET' && String(u).includes('/accounts'));
    expect(gets.length).toBeGreaterThanOrEqual(2);
    expect(gets[0][1].headers?.Authorization).toBe('Basic ' + Buffer.from('ro-user:secret').toString('base64'));
    const startSec = toEpochDays(isoDate('2026-06-05')) * 86400;
    expect(gets.some(([u]) => String(u).includes(`start-date=${startSec}`))).toBe(true);
  });

  /**
   * Owner request 2026-08-04: "why are we only pulling 6 months of data? Can we
   * get at least 2-3 years?" The first pull used to ask for 90 days. These lock
   * the widened window at the one place it is decided — bounded like the Plaid
   * days_requested lock (plaid-oauth.test.ts), plus one hand-verified calendar
   * date: DEMO_TODAY pins "today" at 2026-06-10, and 1095 days before that is
   * 2023-06-11 (the window crosses the 2024 leap day, which is what makes it
   * the 11th, not the 10th — exactly the off-by-one this test exists to catch).
   */
  it('first sync asks for three years of history, not the old 90 days', async () => {
    expect(SIMPLEFIN_INITIAL_LOOKBACK_DAYS).toBeGreaterThanOrEqual(730); // never back below 2 years
    expect(SIMPLEFIN_INITIAL_LOOKBACK_DAYS).toBeLessThanOrEqual(1830); // sanity cap: 5 years
    await connectSimplefin(SETUP_TOKEN);
    const calls = vi.mocked(fetch).mock.calls as [unknown, { method?: string }][];
    const gets = calls.filter(([u, i]) => i?.method === 'GET' && String(u).includes('/accounts'));
    expect(gets.length).toBeGreaterThanOrEqual(1);
    const wideStartSec = toEpochDays(isoDate('2023-06-11')) * 86400;
    // Asserted across the GETs rather than on the first one: since H.5 a RECONNECT
    // keeps `lastSyncedAt` (nulling it drove a 1095-day pull through the live ingest,
    // which re-files stored rows — critic cycle 2 P0-1), so the wide window is
    // delivered by the add-only backfill instead of by the sync's first pass. The
    // invariant the owner cares about is unchanged: the connection asks for 3 years.
    expect(gets.some(([u]) => String(u).includes(`start-date=${wideStartSec}`))).toBe(true);
  });

  it('connecting does NOT pre-mark the deep-history backfill as done (H.5 critic P1-3)', async () => {
    // The tempting optimisation is to set `historyBackfilledAt` at connect, since a
    // fresh connection's first pull is already the full window. But that records a
    // sync that has not happened. A first sync that SUCCEEDS AND RETURNS NOTHING —
    // a 200 with an `errors` array — still writes `lastSyncedAt: today`, pinning
    // every later sync to a 5-day window while the flag blocks the one mechanism
    // that could widen it again: the reported "max date of March" defect, made
    // permanent by its own fix. Leaving it null costs one extra fetch.
    //
    // Driven through the failing-first-sync path, because that is where the two
    // designs differ: on a HEALTHY connect the following sync legitimately marks
    // itself done after an honest empty plan, so asserting null there would pass
    // either way.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: { method?: string }) => {
        const url = String(input);
        if (init?.method === 'POST' && url === CLAIM_URL) {
          return { ok: true, status: 200, text: async () => ACCESS_URL } as Response;
        }
        return { ok: false, status: 500, text: async () => '', json: async () => ({}) } as Response;
      }),
    );
    const r = await connectSimplefin(SETUP_TOKEN);
    expect(r.ok).toBe(true); // the link is saved even though the first sync failed
    const conn = await prisma.simpleFinConnection.findUnique({ where: { userId: USER } });
    expect(conn).not.toBeNull();
    expect(conn!.historyBackfilledAt).toBeNull(); // still owed a deep pull
  });

  it('backfills the full history of an account first seen on an incremental sync (DECISIONS #73)', async () => {
    await connectSimplefin(SETUP_TOKEN); // 1st sync → only acc-1, lastSyncedAt = 2026-06-10

    // 2nd (incremental) sync: a NEW acc-2 appears whose only transaction is OLDER
    // than the 5-day overlap — so it shows up only in the wide backfill window
    // (SIMPLEFIN_INITIAL_LOOKBACK_DAYS), never the incremental one. The mock
    // branches on the requested start-date.
    const oldPosted = toEpochDays(isoDate('2026-05-15')) * 86400; // inside the wide window, outside 5d
    const incrementalCutoff = toEpochDays(isoDate('2026-05-01')) * 86400;
    const acc2Tx = {
      id: 'acc-2',
      name: 'Card',
      balance: '-111.99',
      org: { name: 'Chase' },
      transactions: [{ id: 'tx-bf', posted: oldPosted, amount: '-111.99', description: 'ZONE PEST SOLUTIONS INC' }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: { method?: string }) => {
        const url = String(input);
        if (init?.method === 'POST' && url === CLAIM_URL) {
          return { ok: true, status: 200, text: async () => ACCESS_URL } as Response;
        }
        if (url.startsWith('https://bridge.example/simplefin/accounts')) {
          const sd = Number(new URL(url).searchParams.get('start-date') ?? '0');
          // incremental window: acc-2 is new but has no recent activity;
          // wide backfill window: acc-2's older transaction is returned.
          const accounts =
            sd >= incrementalCutoff
              ? [ACCOUNTS.accounts[0], { ...acc2Tx, transactions: [] }]
              : [ACCOUNTS.accounts[0], acc2Tx];
          return { ok: true, status: 200, json: async () => ({ accounts }) } as Response;
        }
        return { ok: false, status: 404, text: async () => '', json: async () => ({}) } as Response;
      }),
    );

    const r = await syncSimplefinNow();
    expect(r.ok).toBe(true);

    // The new account exists AND its older transaction was backfilled (it would be
    // missed by the 5-day incremental window alone — the real-bank bug).
    const acc2 = await prisma.account.findFirst({ where: { userId: USER, provider: 'simplefin', providerRef: 'acc-2' } });
    expect(acc2).not.toBeNull();
    const tx = await prisma.transaction.findFirst({ where: { providerRef: 'tx-bf', account: { userId: USER } } });
    expect(tx).not.toBeNull();
    expect(tx!.amountCents).toBe(-11199);
  });

  it('rejects an INTERNAL access URL returned by the claim server, before fetching it (CQ-3)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string }) => {
      if (init?.method === 'POST' && String(input) === CLAIM_URL) {
        return { ok: true, status: 200, text: async () => 'https://10.0.0.5/simplefin' } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }));
    expect((await connectSimplefin(SETUP_TOKEN)).ok).toBe(false);
  });

  it('blocks IPv6 internal setup tokens ([::1], [fd00::1]) (CQ-3)', async () => {
    expect((await connectSimplefin(Buffer.from('https://[::1]/claim', 'utf8').toString('base64'))).ok).toBe(false);
    expect((await connectSimplefin(Buffer.from('https://[fd00::1]/claim', 'utf8').toString('base64'))).ok).toBe(false);
  });

  it('skips a malformed transaction without aborting the sync (CQ-1)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string }) => {
      if (init?.method === 'POST' && String(input) === CLAIM_URL) return { ok: true, status: 200, text: async () => ACCESS_URL } as Response;
      if (String(input).startsWith('https://bridge.example/simplefin/accounts')) {
        return {
          ok: true, status: 200,
          json: async () => ({ accounts: [{ id: 'acc-9', name: 'Checking', balance: '100.00', transactions: [
            { id: 'good', posted: 1781049600, amount: '-5.00', description: 'KROGER #1' },
            { id: 'bad', posted: 1781049600, amount: 'not-a-number', description: 'JUNK' },
          ] }] }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }));
    const r = await connectSimplefin(SETUP_TOKEN);
    expect(r.ok).toBe(true);
    expect(r.added).toBe(1); // only the good row
    expect(await prisma.transaction.findFirst({ where: { providerRef: 'bad', account: { userId: USER } } })).toBeNull();
  });

  it('a failed sync persists a SANITIZED error signal and keeps the last-good date (Gap 1 §4)', async () => {
    await connectSimplefin(SETUP_TOKEN); // 1st sync succeeds → lastSyncedAt set, no error
    const healthy = await prisma.simpleFinConnection.findUnique({ where: { userId: USER } });
    expect(healthy!.lastSyncedAt).toBe('2026-06-10');
    expect(healthy!.lastSyncError).toBeNull();

    // Next sync: the /accounts GET fails with a message that embeds the credential URL.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: { method?: string }) => {
        if (init?.method === 'POST' && String(input) === CLAIM_URL) return { ok: true, status: 200, text: async () => ACCESS_URL } as Response;
        if (String(input).startsWith('https://bridge.example/simplefin/accounts')) {
          return { ok: false, status: 500, text: async () => `boom ${ACCESS_URL}`, json: async () => ({}) } as Response;
        }
        return { ok: false, status: 404 } as Response;
      }),
    );
    const r = await syncSimplefinNow();
    expect(r.ok).toBe(false);
    expect(r.error).not.toContain('bridge.example'); // fixed message, no credential leak

    const broken = await prisma.simpleFinConnection.findUnique({ where: { userId: USER } });
    expect(broken!.lastSyncError).not.toBeNull();
    expect(isSyncFailureReason(broken!.lastSyncError)).toBe(true); // an allow-listed reason…
    expect(broken!.lastSyncError).not.toContain('bridge.example'); // …never the raw URL
    expect(broken!.lastSyncedAt).toBe('2026-06-10'); // last GOOD data preserved
    expect(broken!.lastSyncAttemptAt).toBe('2026-06-10'); // attempt recorded
  });

  it('a later successful sync clears the failure signal (Gap 1 §4)', async () => {
    await connectSimplefin(SETUP_TOKEN);
    // Force a broken state, then let the healthy mock (restored by beforeEach) sync.
    await prisma.simpleFinConnection.update({ where: { userId: USER }, data: { lastSyncError: 'server' } });
    const r = await syncSimplefinNow();
    expect(r.ok).toBe(true);
    const conn = await prisma.simpleFinConnection.findUnique({ where: { userId: USER } });
    expect(conn!.lastSyncError).toBeNull(); // cleared on success
  });
});
