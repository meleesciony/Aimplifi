/**
 * test_regression__resync_clobbers_corrections (PULSE_CATEGORIZATION_FIX Phase 3d).
 *
 * A user decision must outrank the pipeline. Before the fix, both sync paths rewrote
 * categoryId/confidenceBps/needsReview from a fresh pipeline verdict on UPDATE of an
 * existing row: SimpleFIN re-fetches a 5-day overlap window every sync (simplefin.ts
 * incremental window), and Plaid re-sends rows in `modified` — so a transaction the
 * user corrected in triage ("Just this once": Correction row, NO rule) was silently
 * REVERTED to the pre-correction verdict (an unknown merchant went BACK into review).
 * Only an "Always" rule masked the clobber. Diagnosed 2026-07-02 (Phase-1 workflow
 * wf_37625155, confidence-lens surprise #1); docs/CATEGORIZATION_DIAGNOSIS.md item 4.
 *
 * Locks BOTH providers via the real sync paths against mocked servers (the
 * plaid-balance-refresh / simplefin-pending-reconcile harness patterns), with the
 * correction made by the REAL applyCategory action. Also locks the complement: the
 * resync must still refresh the row's non-verdict fields (status PENDING→POSTED).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Passthrough spy (cycle-5): lets the deleted-in-window lock inject a mid-pass
// deletion in front of ONE guarded transaction without touching real behavior.
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, serializableTx: vi.fn(actual.serializableTx) };
});

import { auth } from '@/auth';
import { connectSimplefin } from '@/server/simplefin-actions';
import { syncFromSimplefin } from '@/lib/providers/simplefin';
import { PlaidProvider } from '@/lib/providers/plaid';
import { applyCategory } from '@/server/triage-actions';
import { recategorizeSharedTransaction } from '@/server/household-actions';
import { runBackfillForUser } from '@/server/backfill';
import { encryptToken } from '@/lib/crypto';
import { isoDate } from '@/lib/dates';
import { prisma, serializableTx } from '@/lib/db';

const KEY = Buffer.alloc(32, 7).toString('base64');
const TODAY = isoDate('2026-06-10');
const epoch = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 1000);

// An unknown merchant: pipeline verdict = uncategorized/5000/needsReview — the exact
// class the user has to correct by hand, and the exact class a resync used to revert.
const RAW = 'SQ *LITTLE TART STUDIO'; // keyword-free: BAKESHOP now auto-files as dining (#163)

describe('SimpleFIN resync preserves user corrections (real actions, mocked server)', () => {
  const USER = `sf-keep-${Date.now()}-${process.pid}`;
  const CLAIM_URL = 'https://claim.example/keep1';
  const SETUP_TOKEN = Buffer.from(CLAIM_URL, 'utf8').toString('base64');
  const ACCESS_URL = 'https://ro-user:secret@bridge.example/simplefin';

  interface RawTxn { id: string; posted: number; amount: string; description?: string; pending?: boolean; transacted_at?: number }
  let accountsPayload: { accounts: unknown[] } = { accounts: [] };
  const checking = (transactions: RawTxn[]) => ({
    id: 'chk-1', name: 'Everyday Checking', balance: '5000.00', org: { name: 'Demo CU' }, transactions,
  });

  function mockServer() {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = String(input);
      if (init?.method === 'POST' && url === CLAIM_URL) {
        return { ok: true, status: 200, text: async () => ACCESS_URL } as Response;
      }
      if (url.startsWith('https://bridge.example/simplefin/accounts')) {
        return { ok: true, status: 200, json: async () => accountsPayload } as Response;
      }
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) } as Response;
    }));
  }

  async function wipe() {
    await prisma.correction.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } }); // cascades txns
    await prisma.simpleFinConnection.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  const row = () =>
    prisma.transaction.findFirstOrThrow({ where: { account: { userId: USER }, providerRef: 't1' } });

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
    await prisma.correction.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.simpleFinConnection.deleteMany({ where: { userId: USER } });
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('a "just once" correction survives the 5-day-overlap resync (and status still refreshes)', async () => {
    // Ingest a PENDING unknown-merchant txn inside the overlap window (TODAY-5 .. TODAY).
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: 0, transacted_at: epoch(2026, 6, 8), amount: '-8.50', description: RAW, pending: true },
    ])] };
    await connectSimplefin(SETUP_TOKEN);
    const before = await row();
    expect(before.needsReview).toBe(true); // unknown merchant → review (precondition)

    // The user corrects it in triage — "Just this once" (Correction row, NO rule).
    await applyCategory({ transactionId: before.id, categoryId: 'coffee' });
    expect((await row()).categoryId).toBe('coffee');

    // Next sync re-sends the same row (5-day overlap), now POSTED.
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: epoch(2026, 6, 8), amount: '-8.50', description: RAW },
    ])] };
    await syncFromSimplefin(USER, TODAY);

    const after = await row();
    expect(after.status).toBe('POSTED'); // non-verdict fields still refresh
    expect(after.categoryId).toBe('coffee'); // the user's decision survives
    expect(after.needsReview).toBe(false); // …and does NOT return to the queue
    expect(after.confidenceBps).toBe(9900);
  });

  it('an UNDONE row (corrections exist, back in review) takes the fresh verdict again (checker cycle 1)', async () => {
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: 0, transacted_at: epoch(2026, 6, 8), amount: '-8.50', description: RAW, pending: true },
    ])] };
    await connectSimplefin(SETUP_TOKEN);
    const r0 = await row();
    await applyCategory({ transactionId: r0.id, categoryId: 'coffee' });
    // Simulate the undo path's restore: correction rows REMAIN, row back in review.
    await prisma.transaction.update({
      where: { id: r0.id },
      data: { categoryId: 'uncategorized', needsReview: true, confidenceBps: null },
    });
    // Resync re-sends the row with a now-recognizable descriptor: the fresh
    // confident verdict must land — a correction's mere EXISTENCE must not
    // freeze an un-decided row's verdict forever.
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: epoch(2026, 6, 8), amount: '-8.50', description: 'NETFLIX.COM 866-579-7172 CA' },
    ])] };
    await syncFromSimplefin(USER, TODAY);
    const after = await row();
    expect(after.needsReview).toBe(false);
    expect(after.categoryId).not.toBe('uncategorized');
  });

  it('a SPLIT PARENT is never resurrected by the resync (checker cycle 1)', async () => {
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: epoch(2026, 6, 8), amount: '-8.50', description: RAW },
    ])] };
    await connectSimplefin(SETUP_TOKEN);
    const r0 = await row();
    await prisma.transaction.update({
      where: { id: r0.id },
      data: { isSplitParent: true, categoryId: null, needsReview: false, confidenceBps: null },
    });
    await syncFromSimplefin(USER, TODAY); // 5-day overlap re-sends it
    const after = await row();
    expect(after.isSplitParent).toBe(true);
    expect(after.categoryId).toBeNull(); // container stays a container
    expect(after.needsReview).toBe(false); // no zombie triage card
  });

  it('test_regression__preserved_split_children_post (cycle-2 P0 family): a same-id, same-amount post carries children to POSTED', async () => {
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: 0, transacted_at: epoch(2026, 6, 8), amount: '-8.50', description: RAW, pending: true },
    ])] };
    await connectSimplefin(SETUP_TOKEN);
    const parent = await row();
    await prisma.transaction.update({
      where: { id: parent.id },
      data: { isSplitParent: true, categoryId: null, needsReview: false, confidenceBps: null },
    });
    await prisma.transaction.createMany({
      data: [
        { id: `sf-post-a-${process.pid}`, accountId: parent.accountId, date: parent.date, amountCents: -300, rawDescriptor: parent.rawDescriptor, merchantId: parent.merchantId, categoryId: 'coffee', confidenceBps: 9900, status: 'PENDING', needsReview: false, splitParentId: parent.id },
        { id: `sf-post-b-${process.pid}`, accountId: parent.accountId, date: parent.date, amountCents: -550, rawDescriptor: parent.rawDescriptor, merchantId: parent.merchantId, categoryId: 'groceries', confidenceBps: 9900, status: 'PENDING', needsReview: false, splitParentId: parent.id },
      ],
    });
    // Same id, SAME amount posts: the split is preserved — and the children must
    // POST with their parent (pre-fix they stayed PENDING forever, distorting
    // every pending projection).
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: epoch(2026, 6, 8), amount: '-8.50', description: RAW },
    ])] };
    await syncFromSimplefin(USER, TODAY);

    const after = await row();
    expect(after.isSplitParent).toBe(true); // still a container
    expect(after.status).toBe('POSTED');
    const children = await prisma.transaction.findMany({ where: { splitParentId: after.id } });
    expect(children).toHaveLength(2);
    for (const c of children) expect(c.status).toBe('POSTED');
    expect(children.map((c) => c.categoryId).sort()).toEqual(['coffee', 'groceries']); // decisions kept
  });

  it('test_regression__split_amount_drift_dissolves (cycle-2 P0 family): a split row whose amount changes under the SAME id dissolves to review', async () => {
    // Pending txn arrives and the user splits it (a supported flow — critic2 F1
    // models splitting the seeded pending Zelle). Split state written directly:
    // the exact shape splitTransaction persists.
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: 0, transacted_at: epoch(2026, 6, 8), amount: '-8.50', description: RAW, pending: true },
    ])] };
    await connectSimplefin(SETUP_TOKEN);
    const parent = await row();
    await prisma.transaction.update({
      where: { id: parent.id },
      data: { isSplitParent: true, categoryId: null, needsReview: false, confidenceBps: null },
    });
    await prisma.transaction.createMany({
      data: [
        { id: `sf-drift-a-${process.pid}`, accountId: parent.accountId, date: parent.date, amountCents: -300, rawDescriptor: parent.rawDescriptor, merchantId: parent.merchantId, categoryId: 'coffee', confidenceBps: 9900, status: 'PENDING', needsReview: false, splitParentId: parent.id },
        { id: `sf-drift-b-${process.pid}`, accountId: parent.accountId, date: parent.date, amountCents: -550, rawDescriptor: parent.rawDescriptor, merchantId: parent.merchantId, categoryId: 'groceries', confidenceBps: 9900, status: 'PENDING', needsReview: false, splitParentId: parent.id },
      ],
    });
    // The charge POSTS under the same id with a DIFFERENT amount (tip added):
    // the children no longer sum to the charge — the stale split must dissolve
    // to ONE row on the fresh verdict, back in review. Pre-fix the preserve
    // branch kept the split: children summed −8.50 while the bank charged −12.00.
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: epoch(2026, 6, 8), amount: '-12.00', description: RAW },
    ])] };
    await syncFromSimplefin(USER, TODAY);

    const all = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    expect(all).toHaveLength(1); // children gone with the stale split
    expect(all[0].isSplitParent).toBe(false);
    expect(all[0].amountCents).toBe(-1200);
    expect(all[0].needsReview).toBe(true); // triage IS the "please re-decide" notification
  });

  it('test_regression__dissolve_forces_review_despite_rule (cycle-3 P1): a user rule must NOT silently absorb a dissolved split', async () => {
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: 0, transacted_at: epoch(2026, 6, 8), amount: '-8.50', description: RAW, pending: true },
    ])] };
    await connectSimplefin(SETUP_TOKEN);
    const parent = await row();
    // The user has ALREADY ruled this merchant (the flagship group-file mints one).
    // Pre-fix the dissolve inherited the pipeline verdict, so the rule auto-filed
    // the full drifted amount at needsReview:false — the user's multi-category
    // split evaporated with NO triage card.
    await prisma.categorizationRule.create({
      data: { userId: USER, merchantId: parent.merchantId!, categoryId: 'coffee', priority: 100 },
    });
    await prisma.transaction.update({
      where: { id: parent.id },
      data: { isSplitParent: true, categoryId: null, needsReview: false, confidenceBps: null },
    });
    await prisma.transaction.createMany({
      data: [
        { id: `sf-rule-a-${process.pid}`, accountId: parent.accountId, date: parent.date, amountCents: -300, rawDescriptor: parent.rawDescriptor, merchantId: parent.merchantId, categoryId: 'coffee', confidenceBps: 9900, status: 'PENDING', needsReview: false, splitParentId: parent.id },
        { id: `sf-rule-b-${process.pid}`, accountId: parent.accountId, date: parent.date, amountCents: -550, rawDescriptor: parent.rawDescriptor, merchantId: parent.merchantId, categoryId: 'groceries', confidenceBps: 9900, status: 'PENDING', needsReview: false, splitParentId: parent.id },
      ],
    });
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: epoch(2026, 6, 8), amount: '-12.00', description: RAW },
    ])] };
    await syncFromSimplefin(USER, TODAY);

    const all = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    expect(all).toHaveLength(1);
    expect(all[0].needsReview).toBe(true); // FORCED review — a destroyed decision re-decides
    expect(all[0].confidenceBps).toBeNull(); // the rule's certainty does not extend here
    expect(all[0].categoryId).toBe('coffee'); // the rule still supplies the SUGGESTION
    expect(all[0].reviewPinned).toBe(true); // durable (cycle-4 P1, DECISIONS #148)

    // CYCLE-4 P1: the forced review must SURVIVE the next 5-day-overlap re-send —
    // pre-#148 the dissolved row was "undone-shaped", so sync N+1 re-applied the
    // rule verdict and the triage card vanished before the user ever saw it
    // (empirically probed by the cycle-4 checker).
    await syncFromSimplefin(USER, TODAY);
    const again = await row();
    expect(again.needsReview).toBe(true); // the pin holds
    expect(again.confidenceBps).toBeNull();

    // …until the USER decides: filing clears the pin, and the decision then
    // survives further re-sends through the normal corrected-row guard.
    await applyCategory({ transactionId: again.id, categoryId: 'groceries' });
    await syncFromSimplefin(USER, TODAY);
    const settled = await row();
    expect(settled.categoryId).toBe('groceries');
    expect(settled.needsReview).toBe(false);
    expect(settled.reviewPinned).toBe(false);
  });

  it('test_regression__sf_new_id_churn_bounded (cycle-4 #27, owner call): a NEW-id re-post keeps the split for the BOUNDED window; age-out heals it', async () => {
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: 0, transacted_at: epoch(2026, 6, 8), amount: '-8.50', description: RAW, pending: true },
    ])] };
    await connectSimplefin(SETUP_TOKEN);
    const parent = await row();
    await prisma.transaction.update({
      where: { id: parent.id },
      data: { isSplitParent: true, categoryId: null, needsReview: false, confidenceBps: null },
    });
    await prisma.transaction.createMany({
      data: [
        { id: `sf-churn-a-${process.pid}`, accountId: parent.accountId, date: parent.date, amountCents: -300, rawDescriptor: parent.rawDescriptor, merchantId: parent.merchantId, categoryId: 'coffee', confidenceBps: 9900, status: 'PENDING', needsReview: false, splitParentId: parent.id },
        { id: `sf-churn-b-${process.pid}`, accountId: parent.accountId, date: parent.date, amountCents: -550, rawDescriptor: parent.rawDescriptor, merchantId: parent.merchantId, categoryId: 'groceries', confidenceBps: 9900, status: 'PENDING', needsReview: false, splitParentId: parent.id },
      ],
    });
    // The bank drops t1 and re-posts under t2. OWNER CALL (cycle-4 #27): one absent
    // snapshot must never destroy a user split — pass 1 leaves it, accepting the
    // SAME ≤32d bounded double count #128 accepts for plain rows (pre-#147 this was
    // IMMORTAL; cycle-3 made it immediate-dissolve; cycle-5 lands on the bound).
    accountsPayload = { accounts: [checking([
      { id: 't2', posted: epoch(2026, 6, 8), amount: '-8.50', description: RAW },
    ])] };
    await syncFromSimplefin(USER, TODAY);
    const all = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    expect(all).toHaveLength(4); // split (parent+2 children) survives + the new t2 row

    // Age the parent past the 32d floor → the next sync's pass-2 age-out dissolves
    // the stale split WITH its children: the charge counts ONCE again.
    await prisma.transaction.update({ where: { id: parent.id }, data: { date: '2026-04-20' } });
    await syncFromSimplefin(USER, TODAY);
    const healed = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    expect(healed).toHaveLength(1);
    expect(healed[0].providerRef).toBe('t2');
    expect(healed[0].status).toBe('POSTED');
  });

  it('test_regression__deleted_in_window_skips (cycle-3 P2 lock): a row deleted mid-pass never aborts the sync', async () => {
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: 0, transacted_at: epoch(2026, 6, 8), amount: '-8.50', description: RAW, pending: true },
    ])] };
    await connectSimplefin(SETUP_TOKEN);
    const r0 = await row();
    // Re-send the same id, but delete the row IMMEDIATELY BEFORE the guarded update
    // runs — the reconcile/removed[]-style mid-window interleaving. The pre-#147
    // findUniqueOrThrow turned this into a P2025 that aborted the WHOLE pass-2 loop
    // (remaining rows, reconcile, and transfer pairing all skipped that sync).
    const injected: typeof serializableTx = async (fn, opts) => {
      await prisma.transaction.delete({ where: { id: r0.id } });
      const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
      return actual.serializableTx(fn, opts);
    };
    vi.mocked(serializableTx).mockImplementationOnce(injected);
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: epoch(2026, 6, 8), amount: '-8.50', description: RAW },
    ])] };
    await expect(syncFromSimplefin(USER, TODAY)).resolves.toBeDefined(); // no abort
  });

  it('test_regression__backfill_respects_pin (cycle-5 confirmation P1): the backfill button never decides a dissolve-pinned row', async () => {
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: 0, transacted_at: epoch(2026, 6, 8), amount: '-8.50', description: RAW, pending: true },
    ])] };
    await connectSimplefin(SETUP_TOKEN);
    const parent = await row();
    await prisma.categorizationRule.create({
      data: { userId: USER, merchantId: parent.merchantId!, categoryId: 'coffee', priority: 100 },
    });
    await prisma.transaction.update({
      where: { id: parent.id },
      data: { isSplitParent: true, categoryId: null, needsReview: false, confidenceBps: null },
    });
    await prisma.transaction.createMany({
      data: [
        { id: `sf-bf-a-${process.pid}`, accountId: parent.accountId, date: parent.date, amountCents: -300, rawDescriptor: parent.rawDescriptor, merchantId: parent.merchantId, categoryId: 'coffee', confidenceBps: 9900, status: 'PENDING', needsReview: false, splitParentId: parent.id },
        { id: `sf-bf-b-${process.pid}`, accountId: parent.accountId, date: parent.date, amountCents: -550, rawDescriptor: parent.rawDescriptor, merchantId: parent.merchantId, categoryId: 'groceries', confidenceBps: 9900, status: 'PENDING', needsReview: false, splitParentId: parent.id },
      ],
    });
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: epoch(2026, 6, 8), amount: '-12.00', description: RAW },
    ])] };
    await syncFromSimplefin(USER, TODAY); // drift → dissolve → PINNED review
    expect((await row()).reviewPinned).toBe(true);

    // The /triage backfill button is a BULK system action carrying no
    // per-transaction intent — pre-fix it re-ran the user's own rule over the
    // pinned row, auto-filed it silently, and left the contradictory
    // pinned-but-filed shape no surface could ever clear (cycle-5 conf. P1).
    await runBackfillForUser(USER, async () => null);
    const after = await row();
    expect(after.needsReview).toBe(true); // still the USER's decision
    expect(after.reviewPinned).toBe(true);
    expect(after.confidenceBps).toBeNull();
  });

  it('test_regression__sweep_launders_pin (cycle-5 confirmation P2): a pinned PENDING row survives a one-flake absence', async () => {
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: 0, transacted_at: epoch(2026, 6, 8), amount: '-8.50', description: RAW, pending: true },
    ])] };
    await connectSimplefin(SETUP_TOKEN);
    const parent = await row();
    await prisma.categorizationRule.create({
      data: { userId: USER, merchantId: parent.merchantId!, categoryId: 'coffee', priority: 100 },
    });
    await prisma.transaction.update({
      where: { id: parent.id },
      data: { isSplitParent: true, categoryId: null, needsReview: false, confidenceBps: null },
    });
    await prisma.transaction.createMany({
      data: [
        { id: `sf-lp-a-${process.pid}`, accountId: parent.accountId, date: parent.date, amountCents: -300, rawDescriptor: parent.rawDescriptor, merchantId: parent.merchantId, categoryId: 'coffee', confidenceBps: 9900, status: 'PENDING', needsReview: false, splitParentId: parent.id },
        { id: `sf-lp-b-${process.pid}`, accountId: parent.accountId, date: parent.date, amountCents: -550, rawDescriptor: parent.rawDescriptor, merchantId: parent.merchantId, categoryId: 'groceries', confidenceBps: 9900, status: 'PENDING', needsReview: false, splitParentId: parent.id },
      ],
    });
    // Amount drifts while STILL PENDING (tip/auth adjustment) → dissolve → the
    // row is now a plain pinned PENDING row, no longer sweep-protected as a split.
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: 0, transacted_at: epoch(2026, 6, 8), amount: '-12.00', description: RAW, pending: true },
    ])] };
    await syncFromSimplefin(USER, TODAY);
    const pinned = await row();
    expect(pinned.reviewPinned).toBe(true);
    expect(pinned.status).toBe('PENDING');

    // One flaky snapshot omits the id: pre-fix the in-window sweep DELETED the
    // pinned row; the next sync re-created it from the rule's confident verdict —
    // pin laundered, auto-filed, no user decision.
    accountsPayload = { accounts: [checking([])] };
    await syncFromSimplefin(USER, TODAY);
    expect(await prisma.transaction.count({ where: { account: { userId: USER } } })).toBe(1);

    // The feed re-reports it: the preserve predicate (pinned) keeps the review.
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: 0, transacted_at: epoch(2026, 6, 8), amount: '-12.00', description: RAW, pending: true },
    ])] };
    await syncFromSimplefin(USER, TODAY);
    const kept = await row();
    expect(kept.needsReview).toBe(true);
    expect(kept.reviewPinned).toBe(true);
  });

  it('test_regression__aged_out_split_dissolves (cycle-3 P0): a >32d-old pending split is swept WITH its children', async () => {
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: 0, transacted_at: epoch(2026, 4, 20), amount: '-8.50', description: RAW, pending: true },
    ])] };
    await connectSimplefin(SETUP_TOKEN);
    const parent = await row();
    await prisma.transaction.update({
      where: { id: parent.id },
      data: { isSplitParent: true, categoryId: null, needsReview: false, confidenceBps: null },
    });
    await prisma.transaction.createMany({
      data: [
        { id: `sf-age-a-${process.pid}`, accountId: parent.accountId, date: parent.date, amountCents: -300, rawDescriptor: parent.rawDescriptor, merchantId: parent.merchantId, categoryId: 'coffee', confidenceBps: 9900, status: 'PENDING', needsReview: false, splitParentId: parent.id },
        { id: `sf-age-b-${process.pid}`, accountId: parent.accountId, date: parent.date, amountCents: -550, rawDescriptor: parent.rawDescriptor, merchantId: parent.merchantId, categoryId: 'groceries', confidenceBps: 9900, status: 'PENDING', needsReview: false, splitParentId: parent.id },
      ],
    });
    // Next sync: the feed no longer mentions the ancient pending (age > 32d floor).
    // Pre-fix the age-out pass also skipped split parents → phantom spending forever.
    accountsPayload = { accounts: [checking([])] };
    await syncFromSimplefin(USER, TODAY);

    expect(await prisma.transaction.count({ where: { account: { userId: USER } } })).toBe(0);
  });

  it('an UNTOUCHED row still takes the fresh pipeline verdict on resync (guard is correction-scoped)', async () => {
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: 0, transacted_at: epoch(2026, 6, 8), amount: '-8.50', description: RAW, pending: true },
    ])] };
    await connectSimplefin(SETUP_TOKEN);

    // Feed re-sends the row with a DIFFERENT descriptor (bank finalized the payee):
    // no correction exists, so the fresh verdict must land.
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: epoch(2026, 6, 8), amount: '-8.50', description: 'NETFLIX.COM 866-579-7172 CA' },
    ])] };
    await syncFromSimplefin(USER, TODAY);

    const after = await row();
    expect(after.needsReview).toBe(false); // known merchant now — auto-filed
    expect(after.categoryId).not.toBe('uncategorized');
  });
});

describe('Plaid resync preserves user corrections (real provider, mocked server)', () => {
  const USER = `pl-keep-${Date.now()}-${process.pid}`;
  const ITEM_ID = 'item-keep-1';

  const plaidTxn = (over: Partial<Record<string, unknown>> = {}) => ({
    transaction_id: 'ptx-1',
    account_id: 'chk-1',
    amount: 8.5, // Plaid: positive = outflow
    date: '2026-06-08',
    name: RAW,
    pending: true,
    ...over,
  });
  const acct = {
    account_id: 'chk-1', name: 'Everyday Checking', mask: null, type: 'depository', subtype: 'checking',
    balances: { current: 5000, available: 5000, limit: null },
  };
  let syncPages: unknown[] = [];

  function mockServer() {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/accounts/get')) return { ok: true, status: 200, json: async () => ({ accounts: [acct] }) } as Response;
      if (url.endsWith('/liabilities/get')) return { ok: true, status: 200, json: async () => ({ liabilities: { credit: [] } }) } as Response;
      if (url.endsWith('/transactions/sync')) {
        const page = syncPages.shift() ?? { accounts: [], added: [], modified: [], removed: [], next_cursor: 'cur-x', has_more: false };
        return { ok: true, status: 200, json: async () => page } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as Response;
    }));
  }

  async function wipe() {
    await prisma.correction.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.deleteMany({ where: { userId: USER } });
    await prisma.auditLog.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  const row = () =>
    prisma.transaction.findFirstOrThrow({ where: { account: { userId: USER }, providerRef: 'ptx-1' } });

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(wipe);
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('PLAID_ENV', 'sandbox');
    vi.stubEnv('DEMO_TODAY', '2026-06-10');
    await prisma.correction.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.auditLog.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.create({
      data: { userId: USER, itemId: ITEM_ID, accessToken: encryptToken('access-tok', Buffer.from(KEY, 'base64')) },
    });
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('pending→posted ID CHURN transplants the corrected verdict onto the new id (checker P1)', async () => {
    // Sync 1: pending txn arrives under ptx-1; the user corrects it.
    syncPages = [{ accounts: [acct], added: [plaidTxn()], modified: [], removed: [], next_cursor: 'cur-1', has_more: false }];
    await new PlaidProvider().syncTransactions(USER);
    const before = await row();
    await applyCategory({ transactionId: before.id, categoryId: 'coffee' });

    // Sync 2: Plaid retires ptx-1 and posts the SAME charge as ptx-2, linked
    // via pending_transaction_id — the exact churn that used to orphan the
    // correction and revert the decision.
    syncPages = [{
      accounts: [acct],
      added: [plaidTxn({ transaction_id: 'ptx-2', pending: false, pending_transaction_id: 'ptx-1' })],
      modified: [],
      removed: [{ transaction_id: 'ptx-1' }],
      next_cursor: 'cur-2',
      has_more: false,
    }];
    await new PlaidProvider().syncTransactions(USER);

    const rows = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    expect(rows).toHaveLength(1); // no duplicate — the old id is gone
    expect(rows[0].providerRef).toBe('ptx-2');
    expect(rows[0].status).toBe('POSTED');
    expect(rows[0].categoryId).toBe('coffee'); // the decision survived the id churn
    expect(rows[0].needsReview).toBe(false);
    // Corrections followed the transaction (audit = state).
    const corrections = await prisma.correction.findMany({ where: { userId: USER } });
    expect(corrections.length).toBeGreaterThan(0);
    for (const c of corrections) expect(c.transactionId).toBe(rows[0].id);
  });

  it("test_regression__churn_destroys_reader_state (O.15 slice 6): a tag, a note, an exclusion and a reimbursement set on a PENDING row survive the pending→posted id churn", async () => {
    // Found while wiring the rule tag action, and fixed as a data CLASS rather
    // than as the one column that slice writes. Only `Correction` and
    // `CategoryPrediction` were followed across the churn, so every column the
    // READER owns was destroyed when Plaid re-sent a settled charge under a new
    // `transaction_id`: the predecessor row is deleted and these values live
    // nowhere else. Silent, on a schedule nobody watches, with the row still on
    // screen looking untouched.
    syncPages = [{ accounts: [acct], added: [plaidTxn()], modified: [], removed: [], next_cursor: 'cur-1', has_more: false }];
    await new PlaidProvider().syncTransactions(USER);
    const before = await row();
    await prisma.transaction.update({
      where: { id: before.id },
      data: {
        taxClass: 'business',
        note: 'client lunch, receipt in the folder',
        excludeFromTotals: true,
        reimbursement: 'awaiting',
      },
    });

    syncPages = [{
      accounts: [acct],
      added: [plaidTxn({ transaction_id: 'ptx-2', pending: false, pending_transaction_id: 'ptx-1' })],
      modified: [],
      removed: [{ transaction_id: 'ptx-1' }],
      next_cursor: 'cur-2',
      has_more: false,
    }];
    await new PlaidProvider().syncTransactions(USER);

    const rows = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].providerRef).toBe('ptx-2'); // the churn really happened
    expect(rows[0].id).not.toBe(before.id);
    expect(rows[0].taxClass).toBe('business');
    expect(rows[0].note).toBe('client lunch, receipt in the folder');
    expect(rows[0].excludeFromTotals).toBe(true);
    expect(rows[0].reimbursement).toBe('awaiting');
  });

  it("test_regression__churn_destroys_attachments (O.13h critic cycle): a RECEIPT attached to a pending row survives the pending→posted id churn", async () => {
    // The same defect as the test above, one slice later and one table over.
    // O.13h added a fifth piece of reader-owned state and did not join the carry —
    // and an attachment is a RELATION, so `carriedReaderState` (which can only carry
    // columns) could never have covered it: the rows have to be re-pointed. Both
    // fresh-context critics found this independently, and both proved it by
    // execution: attach a photo to a pending charge, let the bank post it, and the
    // file and its bytes are gone with the predecessor row via the FK cascade.
    syncPages = [{ accounts: [acct], added: [plaidTxn()], modified: [], removed: [], next_cursor: 'cur-1', has_more: false }];
    await new PlaidProvider().syncTransactions(USER);
    const before = await row();

    const attachment = await prisma.transactionAttachment.create({
      data: {
        transactionId: before.id,
        filename: 'lunch receipt.jpg',
        mimeType: 'image/jpeg',
        byteSize: 4,
        blob: { create: { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) } },
      },
      select: { id: true },
    });

    syncPages = [{
      accounts: [acct],
      added: [plaidTxn({ transaction_id: 'ptx-2', pending: false, pending_transaction_id: 'ptx-1' })],
      modified: [],
      removed: [{ transaction_id: 'ptx-1' }],
      next_cursor: 'cur-2',
      has_more: false,
    }];
    await new PlaidProvider().syncTransactions(USER);

    const rows = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].providerRef).toBe('ptx-2'); // the churn really happened
    expect(rows[0].id).not.toBe(before.id);

    // The receipt is still here, still attached to the charge, and its BYTES are
    // still behind it — the cascade would have taken the blob too.
    const carried = await prisma.transactionAttachment.findUnique({
      where: { id: attachment.id },
      select: { transactionId: true, filename: true, blob: { select: { bytes: true } } },
    });
    expect(carried).not.toBeNull();
    expect(carried!.transactionId).toBe(rows[0].id);
    expect(carried!.filename).toBe('lunch receipt.jpg');
    expect(Array.from(carried!.blob!.bytes)).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it('the same carry holds on the review-PINNED churn branch (O.15 slice 6, critic cycle 1)', async () => {
    // Cycle 1 noted that only the DEFAULT settled branch was asserted while three
    // other create sites took the same spread. A pinned predecessor takes its own
    // branch, and its pin is re-applied AFTER the spread — so this also proves the
    // carry does not smuggle the pin back off.
    syncPages = [{ accounts: [acct], added: [plaidTxn()], modified: [], removed: [], next_cursor: 'cur-1', has_more: false }];
    await new PlaidProvider().syncTransactions(USER);
    const before = await row();
    await prisma.transaction.update({
      where: { id: before.id },
      data: { reviewPinned: true, taxClass: 'charitable', note: 'pinned + tagged', excludeFromTotals: true },
    });

    syncPages = [{
      accounts: [acct],
      added: [plaidTxn({ transaction_id: 'ptx-2', pending: false, pending_transaction_id: 'ptx-1' })],
      modified: [],
      removed: [{ transaction_id: 'ptx-1' }],
      next_cursor: 'cur-2',
      has_more: false,
    }];
    await new PlaidProvider().syncTransactions(USER);

    const rows = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].providerRef).toBe('ptx-2');
    expect(rows[0].reviewPinned).toBe(true); // the pin still wins
    expect(rows[0].taxClass).toBe('charitable');
    expect(rows[0].note).toBe('pinned + tagged');
    expect(rows[0].excludeFromTotals).toBe(true);
  });

  it('slice 6 regression (hostile-critic finding): a PARTNER-attributed correction survives pending→posted id churn instead of stranding on the deleted id', async () => {
    const PARTNER = `pl-partner-${Date.now()}-${process.pid}`;
    const HOUSEHOLD_NAME = `Churn Household ${process.pid}`;
    await prisma.user.create({ data: { id: PARTNER, email: `${PARTNER}@test.local` } });
    await prisma.household.create({
      data: {
        name: HOUSEHOLD_NAME,
        members: {
          create: [
            { userId: USER, role: 'owner' },
            { userId: PARTNER, role: 'partner' },
          ],
        },
      },
    });
    try {
      // Sync 1: pending txn arrives on the OWNER's account.
      syncPages = [{ accounts: [acct], added: [plaidTxn()], modified: [], removed: [], next_cursor: 'cur-1', has_more: false }];
      await new PlaidProvider().syncTransactions(USER);
      const before = await row();

      // Owner shares the account; the PARTNER (not the owner) one-off
      // recategorizes it — the correction is attributed to PARTNER, not USER.
      await prisma.account.update({ where: { id: before.accountId }, data: { sharedToHousehold: true } });
      vi.mocked(auth).mockResolvedValueOnce({ user: { id: PARTNER } } as never);
      const res = await recategorizeSharedTransaction({ transactionId: before.id, categoryId: 'coffee' });
      expect(res).toEqual({ ok: true });
      vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never); // restore for the sync below

      // Sync 2: Plaid retires ptx-1 and posts the SAME charge as ptx-2, linked
      // via pending_transaction_id — the exact churn this finding was about.
      syncPages = [{
        accounts: [acct],
        added: [plaidTxn({ transaction_id: 'ptx-2', pending: false, pending_transaction_id: 'ptx-1' })],
        modified: [],
        removed: [{ transaction_id: 'ptx-1' }],
        next_cursor: 'cur-2',
        has_more: false,
      }];
      await new PlaidProvider().syncTransactions(USER);

      const rows = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
      expect(rows).toHaveLength(1);
      expect(rows[0].providerRef).toBe('ptx-2');
      // The partner's decision survived the id churn (pre-fix: the transplant's
      // `where: { transactionId, userId }` used the SYNCING OWNER's id, so a
      // partner-attributed correction never matched and was orphaned on the
      // deleted predecessor — the fresh pipeline verdict silently landed instead).
      expect(rows[0].categoryId).toBe('coffee');
      expect(rows[0].needsReview).toBe(false);
      const corrections = await prisma.correction.findMany({ where: { userId: PARTNER } });
      expect(corrections.length).toBeGreaterThan(0);
      for (const c of corrections) expect(c.transactionId).toBe(rows[0].id); // no dangling audit
    } finally {
      await prisma.household.deleteMany({ where: { name: HOUSEHOLD_NAME } });
      await prisma.user.deleteMany({ where: { id: PARTNER } });
    }
  });

  it('a corrected txn re-sent in `modified` keeps its category (and still posts)', async () => {
    // Sync 1: the pending txn arrives.
    syncPages = [{ accounts: [acct], added: [plaidTxn()], modified: [], removed: [], next_cursor: 'cur-1', has_more: false }];
    await new PlaidProvider().syncTransactions(USER);
    const before = await row();
    expect(before.needsReview).toBe(true); // precondition: unknown merchant → review

    await applyCategory({ transactionId: before.id, categoryId: 'coffee' });

    // Sync 2: Plaid re-sends the txn as modified (pending → posted).
    syncPages = [{ accounts: [acct], added: [], modified: [plaidTxn({ pending: false })], removed: [], next_cursor: 'cur-2', has_more: false }];
    await new PlaidProvider().syncTransactions(USER);

    const after = await row();
    expect(after.status).toBe('POSTED'); // non-verdict refresh still lands
    expect(after.categoryId).toBe('coffee'); // the correction survives
    expect(after.needsReview).toBe(false);
    expect(after.confidenceBps).toBe(9900);
  });

  /** Write the exact split state splitTransaction persists onto the current ptx-1 row. */
  async function splitCurrentRow(parts: { id: string; amountCents: number; categoryId: string }[]) {
    const parent = await row();
    await prisma.transaction.update({
      where: { id: parent.id },
      data: { isSplitParent: true, categoryId: null, needsReview: false, confidenceBps: null },
    });
    await prisma.transaction.createMany({
      data: parts.map((p) => ({
        id: p.id,
        accountId: parent.accountId,
        date: parent.date,
        amountCents: p.amountCents,
        rawDescriptor: parent.rawDescriptor,
        merchantId: parent.merchantId,
        categoryId: p.categoryId,
        confidenceBps: 9900,
        status: parent.status,
        needsReview: false,
        splitParentId: parent.id,
      })),
    });
    return parent;
  }

  it('test_regression__transplant_carries_split (cycle-2 P0): pending→posted id churn re-points children, no double count', async () => {
    syncPages = [{ accounts: [acct], added: [plaidTxn()], modified: [], removed: [], next_cursor: 'cur-1', has_more: false }];
    await new PlaidProvider().syncTransactions(USER);
    await splitCurrentRow([
      { id: `pl-split-a-${process.pid}`, amountCents: -300, categoryId: 'coffee' },
      { id: `pl-split-b-${process.pid}`, amountCents: -550, categoryId: 'groceries' },
    ]);
    // The SAME −$8.50 charge posts under ptx-2. Pre-fix: the transplant selected the
    // predecessor without isSplitParent, created a FULL-AMOUNT non-split ptx-2 row,
    // and deleted the parent — children dangled AND spending doubled (−8.50 counted
    // once by the children and again by the new row).
    syncPages = [{
      accounts: [acct],
      added: [plaidTxn({ transaction_id: 'ptx-2', pending: false, pending_transaction_id: 'ptx-1' })],
      modified: [],
      removed: [{ transaction_id: 'ptx-1' }],
      next_cursor: 'cur-2',
      has_more: false,
    }];
    await new PlaidProvider().syncTransactions(USER);

    const all = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    const parents = all.filter((t) => t.isSplitParent);
    const children = all.filter((t) => t.splitParentId !== null);
    expect(parents).toHaveLength(1); // the split SURVIVED the churn
    expect(parents[0].providerRef).toBe('ptx-2');
    expect(parents[0].status).toBe('POSTED');
    expect(parents[0].categoryId).toBeNull(); // still a container
    expect(children).toHaveLength(2);
    for (const c of children) {
      expect(c.splitParentId).toBe(parents[0].id); // re-pointed, not dangling
      expect(c.status).toBe('POSTED'); // children post with their parent
    }
    expect(children.map((c) => c.categoryId).sort()).toEqual(['coffee', 'groceries']);
    // NO double count: the countable (non-parent) rows sum to the charge exactly once.
    const countable = all.filter((t) => !t.isSplitParent);
    expect(countable).toHaveLength(2);
    expect(countable.reduce((s, t) => s + t.amountCents, 0)).toBe(-850);
  });

  it('test_regression__transplant_split_drift_dissolves (cycle-2 P0): churn with a CHANGED amount dissolves the stale split to review', async () => {
    syncPages = [{ accounts: [acct], added: [plaidTxn()], modified: [], removed: [], next_cursor: 'cur-1', has_more: false }];
    await new PlaidProvider().syncTransactions(USER);
    await splitCurrentRow([
      { id: `pl-drift-a-${process.pid}`, amountCents: -300, categoryId: 'coffee' },
      { id: `pl-drift-b-${process.pid}`, amountCents: -550, categoryId: 'groceries' },
    ]);
    // Posts under ptx-2 at −$10.00 (tip added): children sum −8.50 ≠ −10.00, so the
    // split is stale — dissolve to ONE row on the fresh verdict, back in review.
    syncPages = [{
      accounts: [acct],
      added: [plaidTxn({ transaction_id: 'ptx-2', amount: 10.0, pending: false, pending_transaction_id: 'ptx-1' })],
      modified: [],
      removed: [{ transaction_id: 'ptx-1' }],
      next_cursor: 'cur-2',
      has_more: false,
    }];
    await new PlaidProvider().syncTransactions(USER);

    const all = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    expect(all).toHaveLength(1);
    expect(all[0].providerRef).toBe('ptx-2');
    expect(all[0].isSplitParent).toBe(false);
    expect(all[0].amountCents).toBe(-1000);
    expect(all[0].needsReview).toBe(true); // triage IS the "please re-decide" notification
  });

  it('test_regression__transplant_dissolve_forces_review_despite_rule (cycle-3 P1): the churn dissolve must not auto-file under a user rule', async () => {
    syncPages = [{ accounts: [acct], added: [plaidTxn()], modified: [], removed: [], next_cursor: 'cur-1', has_more: false }];
    await new PlaidProvider().syncTransactions(USER);
    const parent = await row();
    // Rule exists (the flagship group-file mints one) — pre-fix the dissolve's
    // replacement row inherited the pipeline verdict, so it auto-filed at 9900
    // with needsReview:false and the user's split evaporated silently.
    await prisma.categorizationRule.create({
      data: { userId: USER, merchantId: parent.merchantId!, categoryId: 'coffee', priority: 100 },
    });
    await splitCurrentRow([
      { id: `pl-rule-a-${process.pid}`, amountCents: -300, categoryId: 'coffee' },
      { id: `pl-rule-b-${process.pid}`, amountCents: -550, categoryId: 'groceries' },
    ]);
    syncPages = [{
      accounts: [acct],
      added: [plaidTxn({ transaction_id: 'ptx-2', amount: 10.0, pending: false, pending_transaction_id: 'ptx-1' })],
      modified: [],
      removed: [{ transaction_id: 'ptx-1' }],
      next_cursor: 'cur-2',
      has_more: false,
    }];
    await new PlaidProvider().syncTransactions(USER);

    const all = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    expect(all).toHaveLength(1);
    expect(all[0].needsReview).toBe(true); // FORCED review — a destroyed decision re-decides
    expect(all[0].confidenceBps).toBeNull();
    expect(all[0].categoryId).toBe('coffee'); // the rule still supplies the SUGGESTION
    expect(all[0].reviewPinned).toBe(true); // durable (cycle-4 P1, DECISIONS #148)

    // CYCLE-4 P1: a modified[] re-send of the new id must not clobber the pin.
    syncPages = [{
      accounts: [acct],
      added: [],
      modified: [plaidTxn({ transaction_id: 'ptx-2', amount: 10.0, pending: false })],
      removed: [],
      next_cursor: 'cur-3',
      has_more: false,
    }];
    await new PlaidProvider().syncTransactions(USER);
    const again = await prisma.transaction.findFirstOrThrow({
      where: { account: { userId: USER }, providerRef: 'ptx-2' },
    });
    expect(again.needsReview).toBe(true); // the pin holds across the re-send
    expect(again.confidenceBps).toBeNull();
  });

  it('test_regression__removed_cascades_split_children (cycle-2 P0 family): a canceled split charge takes its children with it', async () => {
    syncPages = [{ accounts: [acct], added: [plaidTxn({ pending: false })], modified: [], removed: [], next_cursor: 'cur-1', has_more: false }];
    await new PlaidProvider().syncTransactions(USER);
    await splitCurrentRow([
      { id: `pl-rm-a-${process.pid}`, amountCents: -300, categoryId: 'coffee' },
      { id: `pl-rm-b-${process.pid}`, amountCents: -550, categoryId: 'groceries' },
    ]);
    // The bank REVERSES the charge: removed[] names ptx-1 with no successor. Pre-fix
    // the deleteMany matched only the providerRef'd parent — the children (providerRef
    // null) survived as phantom spending for money that never left.
    syncPages = [{ accounts: [acct], added: [], modified: [], removed: [{ transaction_id: 'ptx-1' }], next_cursor: 'cur-2', has_more: false }];
    await new PlaidProvider().syncTransactions(USER);

    expect(await prisma.transaction.count({ where: { account: { userId: USER } } })).toBe(0);
  });

  it('test_regression__removed_early_page_defeats_transplant (cycle-2 P2): removes are buffered until every page is applied', async () => {
    syncPages = [{ accounts: [acct], added: [plaidTxn()], modified: [], removed: [], next_cursor: 'cur-1', has_more: false }];
    await new PlaidProvider().syncTransactions(USER);
    const before = await row();
    await applyCategory({ transactionId: before.id, categoryId: 'coffee' });

    // ONE sync delivering TWO pages: removed[ptx-1] lands a page BEFORE the posted
    // twin. Pre-fix each page applied its removes immediately, so page 2's transplant
    // findFirst found nothing → plain create on the pipeline verdict → the user's
    // decision silently reverted and the corrections dangled on a dead id.
    syncPages = [
      { accounts: [acct], added: [], modified: [], removed: [{ transaction_id: 'ptx-1' }], next_cursor: 'cur-2a', has_more: true },
      { accounts: [acct], added: [plaidTxn({ transaction_id: 'ptx-2', pending: false, pending_transaction_id: 'ptx-1' })], modified: [], removed: [], next_cursor: 'cur-2b', has_more: false },
    ];
    await new PlaidProvider().syncTransactions(USER);

    const rows = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].providerRef).toBe('ptx-2');
    expect(rows[0].categoryId).toBe('coffee'); // the decision survived the page split
    expect(rows[0].needsReview).toBe(false);
    const corrections = await prisma.correction.findMany({ where: { userId: USER } });
    expect(corrections.length).toBeGreaterThan(0);
    for (const c of corrections) expect(c.transactionId).toBe(rows[0].id); // no dangling audit
  });

  it('test_regression__plaid_same_id_drift_pinned (cycle-4 #28 + P1): a modified[] amount change on a split dissolves to PINNED review; user filing releases it', async () => {
    syncPages = [{ accounts: [acct], added: [plaidTxn()], modified: [], removed: [], next_cursor: 'cur-1', has_more: false }];
    await new PlaidProvider().syncTransactions(USER);
    const parent = await row();
    await prisma.categorizationRule.create({
      data: { userId: USER, merchantId: parent.merchantId!, categoryId: 'coffee', priority: 100 },
    });
    await splitCurrentRow([
      { id: `pl-sid-a-${process.pid}`, amountCents: -300, categoryId: 'coffee' },
      { id: `pl-sid-b-${process.pid}`, amountCents: -550, categoryId: 'groceries' },
    ]);
    // The tip posts under the SAME id (no churn): modified[] carries the new amount.
    // Cycle-4 #28: this dissolve site had NO lock — reverting it left the whole
    // suite green while the rule silently re-absorbed the drifted charge.
    const drifted = () => [{
      accounts: [acct],
      added: [],
      modified: [plaidTxn({ amount: 10.0, pending: false })],
      removed: [],
      next_cursor: 'cur-2',
      has_more: false,
    }];
    syncPages = drifted();
    await new PlaidProvider().syncTransactions(USER);
    const dissolved = await row();
    expect(dissolved.isSplitParent).toBe(false);
    expect(dissolved.amountCents).toBe(-1000);
    expect(dissolved.needsReview).toBe(true);
    expect(dissolved.confidenceBps).toBeNull();
    expect(dissolved.reviewPinned).toBe(true);
    expect(await prisma.transaction.count({ where: { splitParentId: dissolved.id } })).toBe(0);

    // The pin survives an identical re-send…
    syncPages = drifted();
    await new PlaidProvider().syncTransactions(USER);
    expect((await row()).needsReview).toBe(true);

    // …and releases on the USER's decision, which then survives the next re-send.
    await applyCategory({ transactionId: dissolved.id, categoryId: 'groceries' });
    syncPages = drifted();
    await new PlaidProvider().syncTransactions(USER);
    const settled = await row();
    expect(settled.categoryId).toBe('groceries');
    expect(settled.needsReview).toBe(false);
    expect(settled.reviewPinned).toBe(false);
  });

  it('test_regression__churn_carries_pin (cycle-4 P1): id churn on a PINNED row keeps the forced review on the new id', async () => {
    syncPages = [{ accounts: [acct], added: [plaidTxn()], modified: [], removed: [], next_cursor: 'cur-1', has_more: false }];
    await new PlaidProvider().syncTransactions(USER);
    const parent = await row();
    await prisma.categorizationRule.create({
      data: { userId: USER, merchantId: parent.merchantId!, categoryId: 'coffee', priority: 100 },
    });
    await splitCurrentRow([
      { id: `pl-cp-a-${process.pid}`, amountCents: -300, categoryId: 'coffee' },
      { id: `pl-cp-b-${process.pid}`, amountCents: -550, categoryId: 'groceries' },
    ]);
    // Drift under the same id → dissolve → PINNED review.
    syncPages = [{ accounts: [acct], added: [], modified: [plaidTxn({ amount: 10.0, pending: false })], removed: [], next_cursor: 'cur-2', has_more: false }];
    await new PlaidProvider().syncTransactions(USER);
    expect((await row()).reviewPinned).toBe(true);
    // The id then churns: without carrying the pin, the transplant's settled
    // predicate hands the new id the RULE verdict — a pin-laundering path.
    syncPages = [{
      accounts: [acct],
      added: [plaidTxn({ transaction_id: 'ptx-2', amount: 10.0, pending: false, pending_transaction_id: 'ptx-1' })],
      modified: [],
      removed: [{ transaction_id: 'ptx-1' }],
      next_cursor: 'cur-3',
      has_more: false,
    }];
    await new PlaidProvider().syncTransactions(USER);
    const rows = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].providerRef).toBe('ptx-2');
    expect(rows[0].needsReview).toBe(true); // still the user's decision to make
    expect(rows[0].reviewPinned).toBe(true);
  });
});
