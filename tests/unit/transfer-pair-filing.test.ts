/**
 * Transfer pair FILING (#165) — a pair-detected transfer is never wedged in review.
 *
 * Pre-#165 defect: pair detection was add-flag-only. A pair whose descriptor the
 * normalizer doesn't know (the owner's real "CREDIT CARD PAID") was excluded from
 * every sum yet stayed needsReview:true under a wrong guess — permanently stuck in
 * the triage queue until the user hand-filed it (the #161 learned-rule workaround).
 *
 * Pure: planTransferUpdates splits detected ids into flag-only vs file.
 * Integration: refreshTransferFlags applies the plan; the triage queue, badge, and
 * backfill all exclude filed transfers; a review-pinned row is flagged but never
 * filed and STILL surfaces in the queue (pin wins, #148).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import {
  PAIR_TRANSFER_CONFIDENCE_BPS,
  type TransferStateTxn,
  detectTransfers,
  planTransferUpdates,
} from '@/lib/engine/categorize/transfers';
import { refreshTransferFlags } from '@/lib/providers/transfer-refresh';
import { runBackfillForUser } from '@/server/backfill';
import { getReviewCount, getTriageGroups, getTriageItems, similarTransactionsWhere } from '@/server/triage';
import { undoCorrections } from '@/server/triage-actions';

const base = {
  isTransfer: false,
  needsReview: false,
  reviewPinned: false,
  status: 'POSTED',
  currencySupported: true,
  // H.7: the row's settled verdict and the type of the account it sits on.
  // `null` here means "no verdict recorded", which is what every pre-H.7 case
  // in this file was implicitly asserting.
  categoryId: null as string | null,
  accountType: 'CHECKING',
};

function txn(over: Partial<TransferStateTxn> & Pick<TransferStateTxn, 'id'>): TransferStateTxn {
  return {
    accountId: 'checking',
    date: '2026-06-10',
    amountCents: -123_456,
    rawDescriptor: 'CREDIT CARD PAID',
    ...base,
    ...over,
  };
}

/** The owner's real case: unrecognized descriptors on both sides, exact opposite
 * amounts, different accounts, 1 day apart — both still awaiting review. */
function ccPaidPair(): TransferStateTxn[] {
  return [
    txn({ id: 'out', accountId: 'checking', amountCents: -123_456, needsReview: true }),
    txn({
      id: 'in',
      accountId: 'card',
      accountType: 'CREDIT',
      date: '2026-06-11',
      amountCents: 123_456,
      rawDescriptor: 'PAYMENT RECEIVED - THANK YOU',
      needsReview: true,
    }),
  ];
}

describe('planTransferUpdates (pure)', () => {
  it('premise lock: "CREDIT CARD PAID" is pair-detected, not descriptor-detected', () => {
    const pair = ccPaidPair();
    expect(detectTransfers([pair[0]])).toEqual(new Set()); // alone: no descriptor match
    expect(detectTransfers(pair)).toEqual(new Set(['out', 'in'])); // paired: detected
  });

  it('files BOTH sides of an in-review pair (and flags them)', () => {
    const plan = planTransferUpdates(ccPaidPair());
    expect(plan.flagIds.sort()).toEqual(['in', 'out']);
    expect(plan.fileIds.sort()).toEqual(['in', 'out']);
  });

  it('never re-files a user-resolved row: flag only', () => {
    const [out, inn] = ccPaidPair();
    const plan = planTransferUpdates([{ ...out, needsReview: false }, inn]);
    expect(plan.flagIds.sort()).toEqual(['in', 'out']);
    expect(plan.fileIds).toEqual(['in']);
  });

  it('never files a review-pinned row (pin wins, #148): flag only', () => {
    const [out, inn] = ccPaidPair();
    const plan = planTransferUpdates([{ ...out, reviewPinned: true }, inn]);
    expect(plan.flagIds.sort()).toEqual(['in', 'out']);
    expect(plan.fileIds).toEqual(['in']);
  });

  it('heals a legacy WEDGED row (already flagged, still in review): file, no re-flag', () => {
    const [out, inn] = ccPaidPair();
    const plan = planTransferUpdates([{ ...out, isTransfer: true }, { ...inn, isTransfer: true }]);
    expect(plan.flagIds).toEqual([]);
    expect(plan.fileIds.sort()).toEqual(['in', 'out']);
  });

  it('F4 invariant: unpaired real spend is never flagged or filed', () => {
    const plan = planTransferUpdates([
      txn({ id: 'phone', rawDescriptor: 'T-MOBILE PREPAY', amountCents: -4500, needsReview: true }),
      txn({ id: 'coffee', rawDescriptor: 'SQ *BLUE BOTTLE', amountCents: -650, needsReview: true }),
    ]);
    expect(plan.flagIds).toEqual([]);
    expect(plan.fileIds).toEqual([]);
  });

  it('a PENDING row is flagged but never FILED (settles under a new id — critic F3)', () => {
    const [out, inn] = ccPaidPair();
    const plan = planTransferUpdates([{ ...out, status: 'PENDING' }, inn]);
    expect(plan.flagIds.sort()).toEqual(['in', 'out']);
    expect(plan.fileIds).toEqual(['in']);
  });

  it('a withheld-currency row is flagged but never FILED (DECISIONS #135 — critic F3)', () => {
    const [out, inn] = ccPaidPair();
    const plan = planTransferUpdates([{ ...out, currencySupported: false }, inn]);
    expect(plan.flagIds.sort()).toEqual(['in', 'out']);
    expect(plan.fileIds).toEqual(['in']);
  });

  /**
   * H.7 — the flag branch may not silently reverse a recorded answer.
   *
   * Every fixture below is the shape of a row measured on the owner's live
   * corpus (scripts/audit-probes/h7-pair-evidence.mts), not an invented one.
   */
  describe('H.7: a pair-only guess against a settled verdict', () => {
    /** The live repro: a $500.00 distribution settled as income at 9900 bps,
     * and an unrelated $500.00 card charge two days earlier. */
    function coincidence(): TransferStateTxn[] {
      return [
        txn({
          id: 'kalshi',
          accountId: 'venture-card',
          accountType: 'CREDIT',
          date: '2026-06-13',
          amountCents: -50_000,
          rawDescriptor: 'KALSHI',
          categoryId: 'entertainment',
        }),
        txn({
          id: 'distribution',
          accountId: 'checking',
          date: '2026-06-15',
          amountCents: 50_000,
          rawDescriptor: '5006-DB/CR-CEF I CEF IV PPD',
          categoryId: 'income',
        }),
      ];
    }

    it('does NOT flag a settled income row paired only with a card charge (the live repro)', () => {
      const plan = planTransferUpdates(coincidence());
      expect(plan.flagIds).toEqual([]);
      expect(plan.overturnIds).toEqual([]);
      expect(plan.fileIds).toEqual([]);
    });

    it('premise lock: that coincidence IS still a detected pair — only the WRITE is refused', () => {
      // If this ever stops detecting, the test above would pass vacuously.
      expect(detectTransfers(coincidence())).toEqual(new Set(['kalshi', 'distribution']));
    });

    it('still overturns a settled row when the pair can actually send money (brokerage funding)', () => {
      const plan = planTransferUpdates([
        txn({
          id: 'funding',
          accountId: 'checking',
          date: '2026-05-06',
          amountCents: -7_800_000,
          rawDescriptor: 'Funds Transfer to Brokerage -7383',
          categoryId: 'investment',
        }),
        txn({
          id: 'landed',
          accountId: 'brokerage',
          accountType: 'INVESTMENT',
          date: '2026-05-06',
          amountCents: 7_800_000,
          rawDescriptor: 'RECEIVED FROM BANK',
          categoryId: 'investment',
        }),
      ]);
      expect(plan.flagIds).toEqual([]);
      expect(plan.overturnIds.sort()).toEqual(['funding', 'landed']);
    });

    it('still overturns a settled row for a card autopay (cash out, card in)', () => {
      const plan = planTransferUpdates([
        txn({
          id: 'autopay',
          accountId: 'checking',
          date: '2026-07-06',
          amountCents: -11_199,
          rawDescriptor: 'CHASE CREDIT CRD AUTOPAYBUS 260705',
          categoryId: 'credit-card-payment',
        }),
        txn({
          id: 'received',
          accountId: 'card',
          accountType: 'CREDIT',
          date: '2026-07-05',
          amountCents: 11_199,
          rawDescriptor: 'AUTOMATIC PAYMENT - THANK',
          categoryId: 'credit-card-payment',
        }),
      ]);
      expect(plan.overturnIds.sort()).toEqual(['autopay', 'received']);
    });

    it('a DESCRIPTOR-named transfer still overturns a settled verdict, unpaired (no regression)', () => {
      const plan = planTransferUpdates([
        txn({
          id: 'named',
          rawDescriptor: 'ONLINE TRANSFER TO SAVINGS',
          amountCents: -25_000,
          categoryId: 'rent',
        }),
      ]);
      expect(plan.overturnIds).toEqual(['named']);
      expect(plan.flagIds).toEqual([]);
    });

    it("'uncategorized' and 'transfer' are not verdicts to overturn — they flag as before", () => {
      for (const categoryId of ['uncategorized', 'transfer', null]) {
        const plan = planTransferUpdates(
          coincidence().map((t) => (t.id === 'distribution' ? { ...t, categoryId } : t)),
        );
        expect(plan.flagIds, `categoryId=${categoryId}`).toEqual(['distribution']);
        expect(plan.overturnIds, `categoryId=${categoryId}`).toEqual([]);
      }
    });

    it('an unsettled row is unaffected by the gate: still flagged AND filed on the same coincidence', () => {
      const plan = planTransferUpdates(
        coincidence().map((t) => (t.id === 'distribution' ? { ...t, needsReview: true } : t)),
      );
      expect(plan.flagIds).toEqual(['distribution']);
      expect(plan.fileIds).toEqual(['distribution']);
    });
  });

  it('same-account opposite amounts (a refund) are NOT a pair', () => {
    const plan = planTransferUpdates([
      txn({ id: 'buy', accountId: 'card', amountCents: -8999, rawDescriptor: 'AMZN MKTP', needsReview: true }),
      txn({ id: 'refund', accountId: 'card', amountCents: 8999, rawDescriptor: 'AMZN MKTP REFUND', needsReview: true }),
    ]);
    expect(plan.flagIds).toEqual([]);
    expect(plan.fileIds).toEqual([]);
  });
});

describe('refreshTransferFlags + triage exclusion (integration)', () => {
  const USER = `tpf-${Date.now()}-${process.pid}`;
  let CHECKING = '';
  let CARD = '';

  async function wipe() {
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(wipe);

  beforeEach(async () => {
    await prisma.account.deleteMany({ where: { userId: USER } });
    CHECKING = (
      await prisma.account.create({
        data: { userId: USER, provider: 'simplefin', providerRef: 'tpf-chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500_000, currency: 'USD' },
      })
    ).id;
    CARD = (
      await prisma.account.create({
        data: { userId: USER, provider: 'simplefin', providerRef: 'tpf-card', name: 'Card', type: 'CREDIT', currentBalanceCents: -123_456, currency: 'USD' },
      })
    ).id;
  });

  function row(over: Record<string, unknown>) {
    return {
      accountId: CHECKING,
      date: '2026-06-10',
      amountCents: -123_456,
      rawDescriptor: 'CREDIT CARD PAID',
      categoryId: 'uncategorized',
      confidenceBps: 5000,
      needsReview: true,
      ...over,
    };
  }

  it('files a wedged CC-paid pair: transfer category, out of queue and badge', async () => {
    await prisma.transaction.createMany({
      data: [
        row({ id: `${USER}-out` }),
        row({ id: `${USER}-in`, accountId: CARD, date: '2026-06-11', amountCents: 123_456, rawDescriptor: 'PAYMENT RECEIVED - THANK YOU' }),
        row({ id: `${USER}-spend`, date: '2026-06-09', amountCents: -650, rawDescriptor: 'SQ *SEAWOLF SUNDRIES' }),
      ],
    });

    // Wedged pre-state: the pair IS in the review queue.
    expect((await getTriageGroups(USER)).flatMap((g) => g.rows.map((r) => r.id)).sort()).toEqual(
      [`${USER}-in`, `${USER}-out`, `${USER}-spend`].sort(),
    );

    const res = await refreshTransferFlags(USER);
    expect(res).toEqual({ flagged: 2, filed: 2 });

    const pair = await prisma.transaction.findMany({ where: { id: { in: [`${USER}-out`, `${USER}-in`] } } });
    for (const t of pair) {
      expect(t.isTransfer).toBe(true);
      expect(t.categoryId).toBe('transfer');
      expect(t.needsReview).toBe(false);
      // Pair-only evidence files in the FLAGGED band (visible AI provenance).
      expect(t.confidenceBps).toBe(PAIR_TRANSFER_CONFIDENCE_BPS);
    }
    // The unpaired spend row is untouched and still queued; queue, singles
    // queue, and badge all agree.
    const groups = await getTriageGroups(USER);
    expect(groups.flatMap((g) => g.rows.map((r) => r.id))).toEqual([`${USER}-spend`]);
    expect((await getTriageItems(USER)).map((i) => i.id)).toEqual([`${USER}-spend`]);
    expect(await getReviewCount(USER)).toBe(1);

    // Idempotent: a second run changes nothing.
    expect(await refreshTransferFlags(USER)).toEqual({ flagged: 0, filed: 0 });
  });

  it('never clobbers a user-resolved category: flag only', async () => {
    await prisma.transaction.createMany({
      data: [
        row({ id: `${USER}-out2`, categoryId: 'dining', confidenceBps: 10_000, needsReview: false }),
        row({ id: `${USER}-in2`, accountId: CARD, date: '2026-06-11', amountCents: 123_456, rawDescriptor: 'PAYMENT RECEIVED - THANK YOU' }),
      ],
    });
    const res = await refreshTransferFlags(USER);
    expect(res).toEqual({ flagged: 2, filed: 1 });
    const out = await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-out2` } });
    expect(out.isTransfer).toBe(true); // flagged (sums exclude it)
    expect(out.categoryId).toBe('dining'); // the user's call stands
    expect(out.needsReview).toBe(false);
  });

  it('pin wins (#148): a pinned pair row is flagged, NOT filed, and still surfaces in the queue', async () => {
    await prisma.transaction.createMany({
      data: [
        row({ id: `${USER}-out3`, reviewPinned: true }),
        row({ id: `${USER}-in3`, accountId: CARD, date: '2026-06-11', amountCents: 123_456, rawDescriptor: 'PAYMENT RECEIVED - THANK YOU' }),
      ],
    });
    const res = await refreshTransferFlags(USER);
    expect(res).toEqual({ flagged: 2, filed: 1 });
    const out = await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-out3` } });
    expect(out.isTransfer).toBe(true);
    expect(out.needsReview).toBe(true); // the pin holds the review
    expect(out.categoryId).toBe('uncategorized');
    // …and the queue + badge still show it (transfer guard yields to the pin).
    expect((await getTriageGroups(USER)).flatMap((g) => g.rows.map((r) => r.id))).toEqual([`${USER}-out3`]);
    expect(await getReviewCount(USER)).toBe(1);
  });

  it('a PENDING pair row is flagged but not filed; it stays OUT of the queue (transfer guard) — critic F3', async () => {
    await prisma.transaction.createMany({
      data: [
        row({ id: `${USER}-outp`, status: 'PENDING' }),
        row({ id: `${USER}-inp`, accountId: CARD, date: '2026-06-11', amountCents: 123_456, rawDescriptor: 'PAYMENT RECEIVED - THANK YOU' }),
      ],
    });
    expect(await refreshTransferFlags(USER)).toEqual({ flagged: 2, filed: 1 });
    const out = await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-outp` } });
    expect(out.isTransfer).toBe(true);
    expect(out.categoryId).toBe('uncategorized'); // no filing on provisional data
  });

  it('a withheld-currency (EUR) pair row is flagged but never category-written — critic F3', async () => {
    const EUR = (
      await prisma.account.create({
        data: { userId: USER, provider: 'simplefin', providerRef: 'tpf-eur', name: 'EUR Card', type: 'CREDIT', currentBalanceCents: -123_456, currency: 'EUR' },
      })
    ).id;
    await prisma.transaction.createMany({
      data: [
        row({ id: `${USER}-oute` }),
        row({ id: `${USER}-ine`, accountId: EUR, date: '2026-06-11', amountCents: 123_456, rawDescriptor: 'PAYMENT RECEIVED - THANK YOU' }),
      ],
    });
    expect(await refreshTransferFlags(USER)).toEqual({ flagged: 2, filed: 1 });
    const eurRow = await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-ine` } });
    expect(eurRow.isTransfer).toBe(true);
    expect(eurRow.categoryId).toBe('uncategorized'); // withheld accounts get no system writes
  });
});

describe('cycle-1 critic locks: batch scope, undo pin, backfill guard (integration)', () => {
  const USER = `tpfc-${Date.now()}-${process.pid}`;
  const CANONICAL = `Aimplifi TPF Card Paid ${process.pid}`;
  let CHECKING = '';
  let CARD = '';
  let MERCH = '';

  async function wipe() {
    await prisma.correction.deleteMany({ where: { userId: USER } });
    await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.merchant.deleteMany({ where: { canonical: CANONICAL } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    MERCH = (
      await prisma.merchant.upsert({
        where: { canonical: CANONICAL },
        create: { id: `tpfc-merch-${process.pid}`, canonical: CANONICAL },
        update: {},
      })
    ).id;
  });
  afterAll(wipe);

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    await prisma.correction.deleteMany({ where: { userId: USER } });
    await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    CHECKING = (
      await prisma.account.create({
        data: { userId: USER, provider: 'simplefin', providerRef: 'tpfc-chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500_000, currency: 'USD' },
      })
    ).id;
    CARD = (
      await prisma.account.create({
        data: { userId: USER, provider: 'simplefin', providerRef: 'tpfc-card', name: 'Card', type: 'CREDIT', currentBalanceCents: -123_456, currency: 'USD' },
      })
    ).id;
  });

  it('batch scope excludes a hidden wedged row: count shown = rows mutated (critic F2)', async () => {
    // Two rows on ONE merchant: a visible review row + a hidden wedge
    // (isTransfer && needsReview && !pinned — hidden by the queue guard).
    await prisma.transaction.createMany({
      data: [
        { id: `${USER}-vis`, accountId: CHECKING, date: '2026-06-09', amountCents: -5000, rawDescriptor: 'TPF CARD PAID A', merchantId: MERCH, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
        { id: `${USER}-wedge`, accountId: CHECKING, date: '2026-06-08', amountCents: -5000, rawDescriptor: 'TPF CARD PAID B', merchantId: MERCH, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true, isTransfer: true },
      ],
    });
    const where = similarTransactionsWhere(USER, { merchantId: MERCH, rawDescriptor: 'TPF CARD PAID A', aggregate: false });
    expect(await prisma.transaction.count({ where })).toBe(1); // the hidden wedge is neither counted…
    const items = await getTriageItems(USER);
    expect(items.map((i) => i.id)).toEqual([`${USER}-vis`]); // …nor shown
    expect(items[0].similarCount).toBe(1);
    // The register scope (onlyNeedsReview:false) still reaches transfers (DECISIONS #36).
    const registerWhere = similarTransactionsWhere(USER, { merchantId: MERCH, rawDescriptor: 'TPF CARD PAID A', aggregate: false }, { onlyNeedsReview: false });
    expect(await prisma.transaction.count({ where: registerWhere })).toBe(2);
  });

  it('undo of a transfer-flagged filing PINS the row: it resurfaces and a later sync cannot re-file it (critic F1)', async () => {
    // A filed pair row (as the pair pass leaves it) that the user then re-decides.
    await prisma.transaction.createMany({
      data: [
        { id: `${USER}-und`, accountId: CHECKING, date: '2026-06-10', amountCents: -123_456, rawDescriptor: 'CREDIT CARD PAID', categoryId: 'dining', confidenceBps: 10_000, needsReview: false, isTransfer: true },
        { id: `${USER}-und-in`, accountId: CARD, date: '2026-06-11', amountCents: 123_456, rawDescriptor: 'PAYMENT RECEIVED - THANK YOU', categoryId: 'transfer', confidenceBps: 8500, needsReview: false, isTransfer: true },
      ],
    });
    // The user's filing left a correction trail; now they undo it.
    const corr = await prisma.correction.create({
      data: { userId: USER, transactionId: `${USER}-und`, fromCategoryId: 'uncategorized', toCategoryId: 'dining' },
    });
    await undoCorrections([corr.id]);

    const und = await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-und` } });
    expect(und.needsReview).toBe(true);
    expect(und.categoryId).toBe('uncategorized');
    expect(und.reviewPinned).toBe(true); // the undo PINS a transfer-flagged row
    // …so the restored card is actually VISIBLE (undo's contract)…
    expect((await getTriageGroups(USER)).flatMap((g) => g.rows.map((r) => r.id))).toEqual([`${USER}-und`]);
    // …and the next sync's pair pass cannot file over the user's re-decision.
    expect(await refreshTransferFlags(USER)).toEqual({ flagged: 0, filed: 0 });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-und` } })).needsReview).toBe(true);
  });

  it('backfill never re-files a wedged transfer row, even one it has a confident verdict for (backfill guard)', async () => {
    // NETFLIX is pipeline-confident — without the isTransfer guard, backfill
    // would deterministically refile this wedged row (fail-old by construction).
    await prisma.transaction.create({
      data: { id: `${USER}-bf`, accountId: CHECKING, date: '2026-06-09', amountCents: -1599, rawDescriptor: 'NETFLIX', categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true, isTransfer: true },
    });
    await runBackfillForUser(USER, async () => null);
    const bf = await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-bf` } });
    expect(bf.categoryId).toBe('uncategorized'); // untouched — the transfer pass owns it
    expect(bf.needsReview).toBe(true);
  });
});
