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

const USER = `h8-${Date.now()}-${process.pid}`;

let OLD = ''; // predecessor (keeps its history)
let NEW = ''; // successor (its in-claim copy is disowned)
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
        ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
      },
    });

  // Predecessor history — span [2026-05-10 .. 2026-06-20], all kept (≤ cutover).
  await row(OLD, '2026-05-10', -5000, { categoryId: 'dining', needsReview: false });
  await row(OLD, '2026-06-20', -1200, { needsReview: true });
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
    expect(dup?.excludedReason).toMatch(/duplicate copy from a connection you combined/);
    const live = await getRuleSourceTransaction(LIVE_ID);
    expect(live?.excludedReason).toBeNull();
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
