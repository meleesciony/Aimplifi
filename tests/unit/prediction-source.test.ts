/**
 * Why-This-Category §3.1 slice 1 — acceptance criterion 4 (write-path threading).
 *
 * The choke point logCategoryPredictions persists the composed provenance to
 * CategoryPrediction.source verbatim; a user-dictated (confidence 10000) row
 * still writes NO prediction row (unchanged #190 behavior). Drives the REAL
 * server helper against throwaway data (never the seeded demo user).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { logCategoryPredictions } from '@/server/predictions';
import { assistUnsureRows } from '@/server/categorize-assist';
import { parseLlmCategory } from '@/lib/engine/categorize/llm';
import { parseTransactionCsv, prepareImportedTransaction } from '@/lib/engine/transactions/csv-import';
import { describeProvenance, type PredictionSource } from '@/lib/engine/categorize/provenance';

describe('logCategoryPredictions persists provenance (Why-This-Category §3.1)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `prov-user-${stamp}`;
  let acctId = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    await wipe();
    // dining / software / uncategorized are system categories created by the seed
    // that runs before this suite — rely on those rather than upserting global rows
    // from a throwaway-user test (critic P2-3, cross-test global state).
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'T', type: 'CHECKING', currentBalanceCents: 0 },
    });
    acctId = acct.id;
  });
  afterAll(wipe);

  async function makeTxn(id: string, categoryId: string, confidenceBps: number): Promise<string> {
    const t = await prisma.transaction.create({
      data: { id: `${id}-${stamp}`, accountId: acctId, date: '2026-07-16', amountCents: -1500, rawDescriptor: id, categoryId, confidenceBps },
    });
    return t.id;
  }

  it('persists each composed source verbatim; the resolver reads it back correctly', async () => {
    const rows: Array<{ id: string; source: PredictionSource; expectKind: string }> = [
      { id: 'llmrow', source: 'llm', expectKind: 'ai-guess' },
      { id: 'merchrow', source: 'merchant-default', expectKind: 'merchant-default' },
      { id: 'rulerow', source: 'user-rule', expectKind: 'your-rule' },
    ];
    const logged = [];
    for (const r of rows) {
      const txnId = await makeTxn(r.id, r.source === 'llm' ? 'software' : 'dining', 9000);
      logged.push({ transactionId: txnId, categoryId: 'dining', confidenceBps: 9000, source: r.source });
    }
    await logCategoryPredictions(USER, logged);

    for (let i = 0; i < rows.length; i++) {
      const pred = await prisma.categoryPrediction.findUnique({ where: { transactionId: logged[i].transactionId } });
      expect(pred).not.toBeNull();
      expect(pred!.source).toBe(rows[i].source);
      // End-to-end: the persisted source drives the display verdict truthfully.
      const verdict = describeProvenance({
        source: pred!.source as PredictionSource,
        hasPredictionRow: true,
        txnConfidenceBps: 9000,
        userLabeled: false,
        predictedCategoryId: pred!.predictedCategoryId,
        currentCategoryId: pred!.predictedCategoryId, // fresh row: current === predicted
      });
      expect(verdict.kind).toBe(rows[i].expectKind);
      expect(verdict.needsConfirm).toBe(rows[i].source === 'llm');
    }
  });

  it('composed path (prepare→assist→create→log): a MAX-confidence LLM row persists as ai-guess, never dropped→user-set (critic P0-1)', async () => {
    // The model returns confidence 1.0 for an unknown merchant. Post-clamp it is
    // 9900, so it (a) still auto-files, (b) is LOGGED (not dropped by the <10000
    // filter), and (c) resolves to ai-guess — NOT the "you set this" fabrication.
    const parsed = parseLlmCategory({ categoryId: 'software', confidence: 1 });
    expect(parsed?.confidenceBps).toBe(9900); // the clamp held

    const [csvRow] = parseTransactionCsv('date,description,amount\n2026-07-16,ZZZQ UNKNOWN VENDOR 9987,-42.00').rows;
    const prep = prepareImportedTransaction(csvRow, acctId);
    expect(prep.needsReview).toBe(true); // genuinely unsure → eligible for the overlay

    const [assisted] = await assistUnsureRows([prep], async () => parsed);
    expect(assisted.source).toBe('llm');
    expect(assisted.confidenceBps).toBe(9900);

    const txn = await prisma.transaction.create({
      data: {
        id: `composed-${stamp}`,
        accountId: acctId,
        date: assisted.date,
        amountCents: assisted.amountCents,
        rawDescriptor: assisted.rawDescriptor,
        categoryId: assisted.categoryId,
        confidenceBps: assisted.confidenceBps,
        needsReview: assisted.needsReview,
        isTransfer: assisted.isTransfer,
      },
    });
    await logCategoryPredictions(USER, [
      { transactionId: txn.id, categoryId: assisted.categoryId, confidenceBps: assisted.confidenceBps, source: assisted.source },
    ]);

    const pred = await prisma.categoryPrediction.findUnique({ where: { transactionId: txn.id } });
    expect(pred).not.toBeNull(); // NOT dropped
    expect(pred!.source).toBe('llm');
    const verdict = describeProvenance({
      source: pred!.source as PredictionSource,
      hasPredictionRow: true,
      txnConfidenceBps: txn.confidenceBps ?? 0,
      userLabeled: false,
      predictedCategoryId: pred!.predictedCategoryId,
      currentCategoryId: txn.categoryId,
    });
    expect(verdict.kind).toBe('ai-guess');
    expect(verdict.needsConfirm).toBe(true);
  });

  it('writes NO prediction row for a user-dictated (confidence 10000) category — unchanged', async () => {
    const txnId = await makeTxn('dictated', 'dining', 10000);
    await logCategoryPredictions(USER, [{ transactionId: txnId, categoryId: 'dining', confidenceBps: 10000, source: undefined }]);
    const pred = await prisma.categoryPrediction.findUnique({ where: { transactionId: txnId } });
    expect(pred).toBeNull();
  });

  it('a threaded-but-sourceless row persists source NULL → resolver reads not-recorded', async () => {
    const txnId = await makeTxn('nosrc', 'dining', 8000);
    await logCategoryPredictions(USER, [{ transactionId: txnId, categoryId: 'dining', confidenceBps: 8000 }]);
    const pred = await prisma.categoryPrediction.findUnique({ where: { transactionId: txnId } });
    expect(pred!.source).toBeNull();
    expect(
      describeProvenance({
        source: null,
        hasPredictionRow: true,
        txnConfidenceBps: 8000,
        userLabeled: false,
        predictedCategoryId: 'dining',
        currentCategoryId: 'dining',
      }).kind,
    ).toBe('not-recorded');
  });
});

describe('criterion 5 — the seeded demo dataset carries real provenance (golden-safe)', () => {
  it('every demo prediction has a source; none is not-recorded or ai-guess (seed runs with no LLM)', async () => {
    const preds = await prisma.categoryPrediction.findMany({ where: { userId: 'user-demo' } });
    expect(preds.length).toBeGreaterThan(0);
    // Join the real transaction category so the P1-3 divergence guard is genuinely
    // exercised — a demo row whose current category had moved would surface here.
    const txns = await prisma.transaction.findMany({
      where: { id: { in: preds.map((p) => p.transactionId) } },
      select: { id: true, categoryId: true, confidenceBps: true },
    });
    const txnById = new Map(txns.map((t) => [t.id, t]));
    for (const p of preds) {
      expect(p.source).not.toBeNull();
      const txn = txnById.get(p.transactionId);
      const kind = describeProvenance({
        source: p.source as PredictionSource,
        hasPredictionRow: true,
        txnConfidenceBps: txn?.confidenceBps ?? p.confidenceBps,
        userLabeled: p.labeledAt != null,
        predictedCategoryId: p.predictedCategoryId,
        currentCategoryId: txn?.categoryId ?? null,
      }).kind;
      // The demo has no LLM at seed time and no category drift, so no row is an AI
      // guess or unrecorded — every badge names a real deterministic origin.
      expect(kind).not.toBe('ai-guess');
      expect(kind).not.toBe('not-recorded');
    }
  });
});
