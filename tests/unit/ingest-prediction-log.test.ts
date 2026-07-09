/**
 * test_regression__live_ingest_logs_predictions (DECISIONS #190, completing #37).
 *
 * Before #190, ONLY the demo seed ever created CategoryPrediction rows: every
 * live ingest path (SimpleFIN, Plaid, CSV, manual) inserted transactions with
 * no prediction log, so for a real user the filing actions' labeling
 * `updateMany` no-op'd against absent rows — the #177 accuracy panel stayed at
 * "No data yet" forever and per-user threshold tuning could never accrue a
 * single sample. This locks the live loop end-to-end on the reachable paths:
 * ingest logs the pipeline's verdict → the user files/corrects → the label +
 * labeledAt land → getThresholdTuning counts the committed sample.
 *
 * Also locks the semantic boundary: a USER-dictated category (explicit manual
 * pick / CSV category column, confidence 10000) is NOT a prediction and logs
 * nothing — the pipeline made no claim to score.
 *
 * Real server actions + the real SimpleFIN sync against a mocked bridge
 * (sync-preserves-corrections harness pattern); throwaway user, never the
 * seeded demo user.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { connectSimplefin } from '@/server/simplefin-actions';
import { getThresholdTuning } from '@/server/tuning';
import { applyCategory } from '@/server/triage-actions';
import { createManualTransaction, importTransactionsCsv } from '@/server/transaction-actions';

const KEY = Buffer.alloc(32, 7).toString('base64');
const epoch = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 1000);

describe('live ingest logs CategoryPrediction rows (DECISIONS #190)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `predlog-${stamp}`;
  const CLAIM_URL = 'https://claim.example/predlog1';
  const SETUP_TOKEN = Buffer.from(CLAIM_URL, 'utf8').toString('base64');
  const ACCESS_URL = 'https://ro-user:secret@bridge.example/simplefin';

  let accountsPayload: { accounts: unknown[] } = { accounts: [] };
  const checking = (transactions: unknown[]) => ({
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
    await prisma.user.deleteMany({ where: { id: USER } }); // cascades accounts/txns/predictions
  }

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
    await prisma.categoryPrediction.deleteMany({ where: { userId: USER } });
    await prisma.correction.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.simpleFinConnection.deleteMany({ where: { userId: USER } });
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('SimpleFIN sync → prediction logged → user correction labels it → tuning counts the sample', async () => {
    // A recognizable merchant so the pipeline COMMITS (auto-files) a verdict.
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: epoch(2026, 6, 8), amount: '-15.49', description: 'NETFLIX.COM 866-579-7172 CA' },
    ])] };
    await connectSimplefin(SETUP_TOKEN); // performs the initial sync

    const txn = await prisma.transaction.findFirstOrThrow({
      where: { account: { userId: USER }, providerRef: 't1' },
    });
    expect(txn.needsReview).toBe(false); // committed verdict (precondition)

    // Fail-old: before #190 no prediction row existed for a live-synced txn.
    const pred = await prisma.categoryPrediction.findUniqueOrThrow({
      where: { transactionId: txn.id },
    });
    expect(pred.predictedCategoryId).toBe(txn.categoryId); // the pipeline's own verdict
    expect(pred.confidenceBps).toBe(txn.confidenceBps);
    expect(pred.actualCategoryId).toBeNull(); // unlabeled until the USER decides
    expect(pred.labeledAt).toBeNull();

    // The user corrects the auto-filing → labeled miss with a user stamp…
    await applyCategory({ transactionId: txn.id, categoryId: 'shopping' });
    const labeled = await prisma.categoryPrediction.findUniqueOrThrow({
      where: { transactionId: txn.id },
    });
    expect(labeled.actualCategoryId).toBe('shopping');
    expect(labeled.labeledAt).not.toBeNull();

    // …and the tuning loop finally has live evidence (committed sample counted).
    const tuning = await getThresholdTuning(USER);
    expect(tuning.sampleCount).toBe(1);
    expect(tuning.reason).toBe('insufficient-samples'); // 1 < 20 — honest cold start
  });

  it('a review-routed sync row logs its abstention — labeled later, but never a tuning sample', async () => {
    accountsPayload = { accounts: [checking([
      { id: 't2', posted: epoch(2026, 6, 8), amount: '-8.50', description: 'SQ *LITTLE TART STUDIO' },
    ])] };
    await connectSimplefin(SETUP_TOKEN);
    const txn = await prisma.transaction.findFirstOrThrow({
      where: { account: { userId: USER }, providerRef: 't2' },
    });
    expect(txn.needsReview).toBe(true); // unknown merchant → review (precondition)
    const pred = await prisma.categoryPrediction.findUniqueOrThrow({ where: { transactionId: txn.id } });
    expect(pred.predictedCategoryId).toBe('uncategorized'); // honest abstention, like the seed

    await applyCategory({ transactionId: txn.id, categoryId: 'coffee' });
    const tuning = await getThresholdTuning(USER);
    expect(tuning.sampleCount).toBe(0); // abstentions are excluded (feedback-loop guard)
  });

  it('manual entry: pipeline verdict logs a prediction; an EXPLICIT category logs nothing', async () => {
    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'Checking', type: 'CHECKING', currentBalanceCents: 0 },
    });
    const form = (descriptor: string, categoryId?: string) => {
      const f = new FormData();
      f.set('accountId', acct.id);
      f.set('descriptor', descriptor);
      f.set('amount', '15.49');
      f.set('direction', 'out');
      f.set('date', '2026-06-09');
      if (categoryId) f.set('categoryId', categoryId);
      return f;
    };

    // Auto-categorized (pipeline claim) → logged.
    const r1 = await createManualTransaction(null, form('NETFLIX.COM'));
    expect(r1.ok).toBe(true);
    const auto = await prisma.transaction.findFirstOrThrow({
      where: { account: { userId: USER }, rawDescriptor: 'NETFLIX.COM' },
    });
    const pred = await prisma.categoryPrediction.findUniqueOrThrow({ where: { transactionId: auto.id } });
    expect(pred.predictedCategoryId).toBe(auto.categoryId);

    // User-dictated (confidence 10000 — no pipeline claim) → NOT logged.
    const r2 = await createManualTransaction(null, form('MY OWN THING', 'groceries'));
    expect(r2.ok).toBe(true);
    const explicit = await prisma.transaction.findFirstOrThrow({
      where: { account: { userId: USER }, rawDescriptor: 'MY OWN THING' },
    });
    expect(await prisma.categoryPrediction.findUnique({ where: { transactionId: explicit.id } })).toBeNull();
  });

  it('CSV import: predictions for pipeline rows only, none for category-column rows', async () => {
    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'Checking2', type: 'CHECKING', currentBalanceCents: 0 },
    });
    const f = new FormData();
    f.set('accountId', acct.id);
    f.set(
      'csv',
      ['date,description,amount,category', '2026-06-08,NETFLIX.COM,-15.49,', '2026-06-08,CSV DICTATED ROW,-9.99,Groceries'].join('\n'),
    );
    const res = await importTransactionsCsv(null, f);
    expect(res.imported).toBe(2);

    const rows = await prisma.transaction.findMany({ where: { accountId: acct.id } });
    const byDesc = new Map(rows.map((r) => [r.rawDescriptor, r]));
    const piped = byDesc.get('NETFLIX.COM')!;
    const dictated = byDesc.get('CSV DICTATED ROW')!;
    expect(await prisma.categoryPrediction.findUnique({ where: { transactionId: piped.id } })).not.toBeNull();
    expect(await prisma.categoryPrediction.findUnique({ where: { transactionId: dictated.id } })).toBeNull();
  });
});
