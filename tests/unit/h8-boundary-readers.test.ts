/**
 * H.8 — three readers that skipped the reconciliation boundary now agree with
 * the register (measured live 2026-08-05, `scripts/audit-probes/h8-boundary-readers.mts`):
 *
 *  - self-audit counted 75/2456 "needed sorting" while the boundaried triage
 *    queue held 7/1332 — the settings card contradicted the queue it audits;
 *  - keyword-rules preview counted 1,124 invisible duplicate rows ($271,467.59)
 *    and the apply WROTE categories onto them;
 *  - backfill fanned the LLM out over 68 invisible rows of 75 scanned, stamping
 *    `needsReview: false` on rows an undo would bring back silently pre-filed.
 *
 * Seed shape: one real account arriving from two providers, reconciled. The
 * predecessor keeps its history (rows ≤ cutover); the SUCCESSOR's copy dated
 * inside the predecessor's claim span is the disowned duplicate no register,
 * total, or triage shows. Each test asserts the reader excludes exactly that
 * row — and the exact counts are the fail-old proof (each is one higher with
 * the filter deleted).
 *
 * NOT filtered, deliberately: `loadCorrectionInputs` (learned rules). A
 * correction on a disowned row is still the user's genuine decision about that
 * payee — blinding a rule-learner to evidence is the H.7 P1-3 shape. Recorded
 * in TASKS H.8, not a defect.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers/demo';
import { runBackfillForUser } from '@/server/backfill';
import {
  createKeywordRule,
  getRuleSourceTransaction,
  previewKeywordRule,
} from '@/server/keyword-rules';
import { gatherSelfAuditCounts, weekStartMonday } from '@/server/self-audit';
import { getTriageItems } from '@/server/triage';
import { applyToAllSimilar, fileMerchantGroup, recategorize } from '@/server/triage-actions';

const USER = `h8-${Date.now()}-${process.pid}`;
const MERCHANT_CANONICAL = `acme coffee ${USER}`;

let OLD = ''; // predecessor (keeps its history)
let NEW = ''; // successor (its in-claim copy is disowned)
let MERCHANT_ID = '';
let P2_ID = ''; // the predecessor's kept unresolved row (batch anchor)
let DUP_ID = ''; // the successor's disowned duplicate row
let LIVE_ID = ''; // the successor's own post-claim row

async function wipe() {
  await prisma.correction.deleteMany({ where: { userId: USER } });
  await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
  await prisma.categoryPrediction.deleteMany({ where: { userId: USER } });
  await prisma.accountReconciliation.deleteMany({ where: { userId: USER } });
  await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.auditLog.deleteMany({ where: { userId: USER } });
  await prisma.merchant.deleteMany({ where: { canonical: MERCHANT_CANONICAL } });
  await prisma.user.deleteMany({ where: { id: USER } });
}

beforeAll(async () => {
  await wipe();
  await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
});
afterAll(wipe);

beforeEach(async () => {
  vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  await prisma.correction.deleteMany({ where: { userId: USER } });
  await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
  await prisma.categoryPrediction.deleteMany({ where: { userId: USER } });
  await prisma.accountReconciliation.deleteMany({ where: { userId: USER } });
  await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
  await prisma.account.deleteMany({ where: { userId: USER } });

  const mk = (provider: string, ref: string, name: string) =>
    prisma.account.create({
      data: {
        userId: USER,
        provider,
        providerRef: ref,
        name,
        type: 'CHECKING',
        currentBalanceCents: 100000,
        currency: 'USD',
      },
    });
  OLD = (await mk('simplefin', `${USER}-old`, 'Checking (old feed)')).id;
  NEW = (await mk('plaid', `${USER}-new`, 'Checking (new feed)')).id;
  await prisma.accountReconciliation.create({
    data: {
      userId: USER,
      predecessorAccountId: OLD,
      successorAccountId: NEW,
      cutoverDate: '2026-06-30',
      matchSignal: 'mask',
      confidence: 'high',
    },
  });

  MERCHANT_ID = (
    await prisma.merchant.upsert({
      where: { canonical: MERCHANT_CANONICAL },
      create: { canonical: MERCHANT_CANONICAL },
      update: {},
    })
  ).id;

  const row = (
    accountId: string,
    date: string,
    cents: number,
    opts: { categoryId?: string; needsReview: boolean },
  ) =>
    prisma.transaction.create({
      data: {
        accountId,
        date,
        rawDescriptor: 'ACME COFFEE #12',
        amountCents: cents,
        status: 'POSTED',
        needsReview: opts.needsReview,
        merchantId: MERCHANT_ID,
        ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
      },
    });

  // Predecessor history — span [2026-05-10 .. 2026-06-20], all kept (≤ cutover).
  await row(OLD, '2026-05-10', -5000, { categoryId: 'dining', needsReview: false });
  P2_ID = (await row(OLD, '2026-06-20', -1200, { needsReview: true })).id;
  // Successor: one copy INSIDE the predecessor's claim (disowned duplicate) and
  // one row of its own after it (kept).
  DUP_ID = (await row(NEW, '2026-06-01', -800, { needsReview: true })).id;
  LIVE_ID = (await row(NEW, '2026-07-10', -1500, { needsReview: true })).id;
});

describe('H.8 [3] self-audit counts what the register counts', () => {
  it('excludes the disowned duplicate from reviewNeeding AND reviewTotal', async () => {
    const counts = await gatherSelfAuditCounts(USER, weekStartMonday(getProvider().today()));
    // Kept rows: both predecessor rows + the successor's post-claim row. The
    // disowned duplicate (needsReview) is in neither tally — with the keep
    // filter deleted this reads 3/4, the live contradiction shape.
    expect(counts.reviewTotal).toBe(3);
    expect(counts.reviewNeeding).toBe(2);
  });
});

describe('H.8 [4] keyword-rules preview and apply stop at the boundary', () => {
  it('preview counts only rows a register can show', async () => {
    const preview = await previewKeywordRule({ keywordsRaw: 'acme', categoryId: 'dining' });
    expect(preview.matchCount).toBe(3); // not 4 — the duplicate is not matchable
  });

  it('apply-to-existing never writes to the disowned duplicate', async () => {
    const res = await createKeywordRule({
      keywordsRaw: 'acme',
      categoryId: 'dining',
      applyToExisting: true,
    });
    // Eligible kept rows: the two unresolved (predecessor 06-20 + successor
    // 07-10); the predecessor's 05-10 row is already 'dining'.
    expect(res.affected).toBe(2);

    const dup = await prisma.transaction.findUniqueOrThrow({ where: { id: DUP_ID } });
    expect(dup.categoryId).toBeNull();
    expect(dup.needsReview).toBe(true);
    expect(
      await prisma.correction.count({ where: { userId: USER, transactionId: DUP_ID } }),
    ).toBe(0);

    const live = await prisma.transaction.findUniqueOrThrow({ where: { id: LIVE_ID } });
    expect(live.categoryId).toBe('dining');
  });

  it('a /rules?from= link to the duplicate names the reason instead of contradicting the count', async () => {
    const dup = await getRuleSourceTransaction(DUP_ID);
    // The sentence claims ABSENCE from activity/totals, never that a counted
    // twin exists — it must stay true for a superseded predecessor's own
    // post-cutover row, which can have no surviving copy (critic P3).
    expect(dup?.excludedReason).toMatch(/connection you combined/);
    expect(dup?.excludedReason).toMatch(/does not appear in your activity or totals/);
    const live = await getRuleSourceTransaction(LIVE_ID);
    expect(live?.excludedReason).toBeNull();
  });
});

describe('H.8 critic P1-1: the merchant-batch writers stop at the boundary too', () => {
  it('fileMerchantGroup files what the card counted — never the disowned duplicate', async () => {
    const res = await fileMerchantGroup({ anchorTransactionId: P2_ID, categoryId: 'dining' });
    // Review-queued kept rows: P2 + LIVE. Pre-fix this was 3 — the card said
    // "File all 2" while the write filed the invisible duplicate and minted a
    // Correction on it that read back as a hand decision.
    expect(res.affected).toBe(2);
    const dup = await prisma.transaction.findUniqueOrThrow({ where: { id: DUP_ID } });
    expect(dup.categoryId).toBeNull();
    expect(dup.needsReview).toBe(true);
    expect(
      await prisma.correction.count({ where: { userId: USER, transactionId: DUP_ID } }),
    ).toBe(0);
  });

  it('applyToAllSimilar batches only rows a screen shows', async () => {
    const res = await applyToAllSimilar({ transactionId: P2_ID, categoryId: 'dining' });
    expect(res.affected).toBe(2); // P2 + LIVE, not the duplicate
    const dup = await prisma.transaction.findUniqueOrThrow({ where: { id: DUP_ID } });
    expect(dup.needsReview).toBe(true);
  });

  it("recategorize scope:'merchant' re-files every VISIBLE row, filed ones included", async () => {
    const res = await recategorize({ transactionId: P2_ID, categoryId: 'coffee', scope: 'merchant' });
    // onlyNeedsReview:false → all three kept rows (the filed 05-10 row too);
    // pre-fix this was 4.
    expect(res.affected).toBe(3);
    const dup = await prisma.transaction.findUniqueOrThrow({ where: { id: DUP_ID } });
    expect(dup.categoryId).toBeNull();
    expect(dup.needsReview).toBe(true);
  });

  it('the "apply to N similar" count matches the batch write set', async () => {
    const items = await getTriageItems(USER);
    const anchor = items.find((i) => i.id === P2_ID);
    expect(anchor).toBeDefined();
    expect(anchor!.similarCount).toBe(2); // P2 + LIVE; pre-fix 3
    // And the queue itself never shows the duplicate (pre-existing C-9 lock,
    // re-asserted here because similarCount now shares its keep fetch).
    expect(items.map((i) => i.id)).not.toContain(DUP_ID);
  });
});

describe('H.8 fail direction: an INERT link falls open to the pre-H.8 behavior', () => {
  it('a cross-type drift disables the filter everywhere at once — a visible double, never a silent split', async () => {
    // Feed-driven type drift (the H.7 cycle-2 shape): the predecessor is
    // reclassified, the confirmed link goes inert, and the keep-rule's
    // documented fail-OPEN default keeps EVERYTHING. All three readers must
    // then agree on the OLD counts — the failure is the same visible double
    // the register shows, never a reader disagreeing with the screen.
    await prisma.account.update({ where: { id: OLD }, data: { type: 'SAVINGS' } });
    const counts = await gatherSelfAuditCounts(USER, weekStartMonday(getProvider().today()));
    expect(counts.reviewTotal).toBe(4);
    expect(counts.reviewNeeding).toBe(3);
    const preview = await previewKeywordRule({ keywordsRaw: 'acme', categoryId: 'dining' });
    expect(preview.matchCount).toBe(4);
  });
});

describe('H.8 [5] backfill neither scans nor files the disowned duplicate', () => {
  it('a rule that matches the duplicate still cannot reach it', async () => {
    // The rule exists but was NOT applied to history — backfill is the pass
    // under test. Without the keep filter, planBackfill files the duplicate too
    // (scanned 3, the duplicate stamped needsReview:false with no visible row
    // anywhere to undo it from).
    await createKeywordRule({ keywordsRaw: 'acme', categoryId: 'dining', applyToExisting: false });

    const result = await runBackfillForUser(USER, async () => null);
    expect(result.scanned).toBe(2); // predecessor 06-20 + successor 07-10 only

    const dup = await prisma.transaction.findUniqueOrThrow({ where: { id: DUP_ID } });
    expect(dup.categoryId).toBeNull();
    expect(dup.needsReview).toBe(true);

    const live = await prisma.transaction.findUniqueOrThrow({ where: { id: LIVE_ID } });
    expect(live.categoryId).toBe('dining');
    expect(live.needsReview).toBe(false);
  });
});
