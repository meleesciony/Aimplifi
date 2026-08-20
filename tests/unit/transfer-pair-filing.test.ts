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

    it('test_regression__o20j_r6_unpaired_overdraft_transfer_descriptor_overturns_fees', () => {
      // Live shape: settled Fees & Charges, isTransfer false, no opposite
      // amount. After KNOWN_MERCHANTS recognizes OVERDRAFT TRANSFER, descriptor
      // evidence alone must overturn — pair matching cannot rescue it.
      const plan = planTransferUpdates([
        txn({
          id: 'large',
          accountId: 'checking',
          date: '2026-07-06',
          amountCents: -779_297,
          rawDescriptor: 'Overdraft Transfer from Brokerage -7383',
          categoryId: 'fees',
          needsReview: false,
        }),
      ]);
      expect(plan.overturnIds).toEqual(['large']);
      expect(plan.flagIds).toEqual([]);
      // Competing verdict stays on file (H.7) — spend gates use isTransfer.
      expect(plan.fileIds).toEqual([]);
    });

    it('test_regression__o20j_filed_transfer_category_flags_without_pair_or_descriptor', () => {
      // Live shape (DECISIONS #446 R5 / O.20j): categoryId=transfer,
      // isTransfer=false, descriptor that does NOT normalize to transfer
      // (Venmo → uncategorized aggregate), no opposite-amount pair. Pairing
      // window / amount uniqueness is exactly why these missed the 132
      // correctly-flagged siblings — filed leaf must supply the evidence.
      // Fixture cents are hand-picked for the lock, not a production dollar.
      const alone = {
        id: 'venmo-out',
        accountId: 'checking',
        date: '2026-06-10',
        amountCents: -5_000,
        rawDescriptor: 'VENMO PAYMENT 123456',
        categoryId: 'transfer' as const,
      };
      expect(detectTransfers([alone]), 'detectTransfers must see the filed leaf').toEqual(
        new Set(['venmo-out']),
      );
      expect(detectTransfers([{ ...alone, categoryId: undefined }]), 'without filed leaf: miss').toEqual(
        new Set(),
      );

      const plan = planTransferUpdates([
        txn({
          ...alone,
          needsReview: false,
          isTransfer: false,
        }),
      ]);
      expect(plan.flagIds).toEqual(['venmo-out']);
      expect(plan.overturnIds).toEqual([]);
      // Already settled on transfer — non-competing; do not re-file.
      expect(plan.fileIds).toEqual([]);
    });

    it('test_regression__o20j_automatic_payment_and_brokerage_sweep_filed_transfer_flag', () => {
      // The other two named R5 families: "AUTOMATIC PAYMENT" is NOT in
      // TRANSFER_DESCRIPTOR (AUTOPAY PAYMENT is); "Funds Transfer to Brokerage"
      // is also uncategorized by the normalizer. Both stay unflagged without
      // the filed-leaf evidence path.
      const plan = planTransferUpdates([
        txn({
          id: 'card-autopay',
          accountId: 'card',
          accountType: 'CREDIT',
          amountCents: -25_000,
          rawDescriptor: 'AUTOMATIC PAYMENT - THANK YOU',
          categoryId: 'transfer',
        }),
        txn({
          id: 'brokerage-sweep',
          accountId: 'checking',
          amountCents: -87_654, // unique fixture cents — no pair in this set
          rawDescriptor: 'Funds Transfer to Brokerage',
          categoryId: 'transfer',
        }),
      ]);
      expect(plan.flagIds.sort()).toEqual(['brokerage-sweep', 'card-autopay']);
      expect(plan.overturnIds).toEqual([]);
      expect(plan.fileIds).toEqual([]);
    });

    it('test_regression__o20j_converse_leak_spend_category_not_touched_by_filed_leaf_rule', () => {
      // Converse leak (still OPEN on O.20j): isTransfer=true under a real spend
      // category must NOT be "fixed" by re-filing to transfer. This slice only
      // ADDS flags when the category leaf is already transfer — never clears,
      // never files a spend row from the filed-leaf rule alone.
      const plan = planTransferUpdates([
        txn({
          id: 'rent-flagged',
          rawDescriptor: 'LANDLORD LLC',
          categoryId: 'rent',
          isTransfer: true,
          needsReview: false,
          amountCents: -150_000,
        }),
        txn({
          id: 'rent-unflagged',
          rawDescriptor: 'LANDLORD LLC JUNE',
          categoryId: 'rent',
          isTransfer: false,
          needsReview: false,
          amountCents: -151_000, // unique — no pair
        }),
      ]);
      expect(plan.flagIds).toEqual([]);
      expect(plan.overturnIds).toEqual([]);
      expect(plan.fileIds).toEqual([]);
    });

    it('an INVESTMENT account can SEND: a brokerage withdrawal filed as income is overturned', () => {
      // The mirror of the funding case below, which puts the investment account
      // on the INFLOW side — so deleting 'INVESTMENT' from the sender set left
      // the whole suite green (cycle-2 critic P2-3). A $78,000 withdrawal filed
      // as Income would otherwise stay Income, in the income bars, the FI
      // savings rate and the tax export.
      const plan = planTransferUpdates([
        txn({
          id: 'withdrawal',
          accountId: 'brokerage',
          accountType: 'INVESTMENT',
          amountCents: -7_800_000,
          rawDescriptor: 'CASH WITHDRAWAL TO BANK',
          categoryId: 'investment',
        }),
        txn({
          id: 'received',
          accountId: 'checking',
          date: '2026-06-11',
          amountCents: 7_800_000,
          rawDescriptor: 'DEPOSIT',
          categoryId: 'income',
        }),
      ]);
      expect(plan.overturnIds.sort()).toEqual(['received', 'withdrawal']);
    });

    /**
     * Cycle-2 critic P1-2, executed: evidence is a property of the PAIR, not of
     * one row. A $5,000 cash advance out of a card arrives as "ONLINE TRANSFER
     * FROM VISA", which the normalizer knows — so the inflow left income while
     * the CREDIT outflow stayed in spending, minting a $5,000 expense that had
     * not existed before this slice.
     */
    it('never half-actions a pair: descriptor evidence on one leg carries to the other', () => {
      const advance = (): TransferStateTxn[] => [
        txn({
          id: 'advance-out',
          accountId: 'visa',
          accountType: 'CREDIT',
          amountCents: -500_000,
          rawDescriptor: 'CASH ADVANCE',
          needsReview: true,
        }),
        txn({
          id: 'advance-in',
          accountId: 'checking',
          date: '2026-06-11',
          amountCents: 500_000,
          rawDescriptor: 'ONLINE TRANSFER FROM VISA 4001',
          needsReview: true,
        }),
      ];
      // Premise: the inflow's descriptor really is transfer-known on its own.
      expect(detectTransfers([advance()[1]])).toEqual(new Set(['advance-in']));

      const plan = planTransferUpdates(advance());
      expect(plan.flagIds.sort(), 'both legs or neither — never one').toEqual([
        'advance-in',
        'advance-out',
      ]);
      expect(plan.fileIds.sort()).toEqual(['advance-in', 'advance-out']);
    });

    it('carrying descriptor evidence across a pair does NOT re-open the live repro', () => {
      // Neither leg of the KALSHI/CEF coincidence is descriptor-known, so the
      // symmetry rule above cannot reach it.
      const plan = planTransferUpdates(coincidence());
      expect(plan.flagIds).toEqual([]);
      expect(plan.overturnIds).toEqual([]);
      expect(plan.fileIds).toEqual([]);
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
      // Deliberately a COHERENT pair (cash sends), so this isolates the VERDICT
      // question. On the incoherent fixture nothing is written at all, and the
      // test would pass for the wrong reason.
      const coherent = (): TransferStateTxn[] => [
        txn({
          id: 'out-leg',
          accountId: 'checking',
          amountCents: -50_000,
          rawDescriptor: 'ONLINE WITHDRAWAL',
          categoryId: 'shopping',
        }),
        txn({
          id: 'in-leg',
          accountId: 'savings',
          accountType: 'SAVINGS',
          date: '2026-06-11',
          amountCents: 50_000,
          rawDescriptor: 'DEPOSIT',
          categoryId: 'income',
        }),
      ];
      for (const categoryId of ['uncategorized', 'transfer', null]) {
        const plan = planTransferUpdates(
          coherent().map((t) => (t.id === 'in-leg' ? { ...t, categoryId } : t)),
        );
        expect(plan.flagIds, `categoryId=${categoryId}`).toEqual(['in-leg']);
        expect(plan.overturnIds, `categoryId=${categoryId}`).toEqual(['out-leg']);
      }
    });

    /**
     * Cycle-1 critic P0-1, executed: gating only the SETTLED case left the
     * coincidence winning on the very first sweep, because every synced row is
     * BORN needsReview — and filing is the heavier write (it also stamps
     * categoryId 'transfer' and clears needsReview, removing the row from
     * triage), so the owner would never see the income that vanished.
     */
    it('an UNSETTLED row on the same incoherent coincidence is neither flagged nor filed', () => {
      const plan = planTransferUpdates(
        coincidence().map((t) => (t.id === 'distribution' ? { ...t, needsReview: true } : t)),
      );
      expect(plan.flagIds).toEqual([]);
      expect(plan.overturnIds).toEqual([]);
      expect(plan.fileIds).toEqual([]);
    });

    it('an unsettled row on a COHERENT pair is still flagged and filed (#165 preserved)', () => {
      const plan = planTransferUpdates(ccPaidPair());
      expect(plan.flagIds.sort()).toEqual(['in', 'out']);
      expect(plan.fileIds.sort()).toEqual(['in', 'out']);
    });

    it('a LOAN draw can send: the sender vocabulary is not just cash (critic P1-2)', () => {
      // A $20,000 HELOC draw the owner filed as Income. Refusing to overturn it
      // left borrowed money in the income bars, the FI savings rate and the TAX
      // EXPORT — so LOAN/MORTGAGE senders are inside the bar, CREDIT is not.
      const plan = planTransferUpdates([
        txn({
          id: 'draw',
          accountId: 'heloc',
          accountType: 'LOAN',
          amountCents: -2_000_000,
          rawDescriptor: 'HELOC ADVANCE',
          categoryId: 'loan-payment',
        }),
        txn({
          id: 'landed',
          accountId: 'checking',
          amountCents: 2_000_000,
          rawDescriptor: 'DEPOSIT',
          categoryId: 'income',
        }),
      ]);
      expect(plan.overturnIds.sort()).toEqual(['draw', 'landed']);
    });

    it('two rows on the SAME real account never pair, even across a confirmed duplicate', () => {
      // The eBay case: a purchase and its own refund on one card that exists as
      // two rows. Identity, not a filter on the input — see transfer-refresh.ts.
      const plan = planTransferUpdates([
        txn({
          id: 'buy',
          accountId: 'card-simplefin',
          accountIdentityId: 'card-real',
          accountType: 'CREDIT',
          amountCents: -42_990,
          rawDescriptor: 'eBay O*02-14853-76644',
          categoryId: 'shopping',
        }),
        txn({
          id: 'refund',
          accountId: 'card-plaid',
          accountIdentityId: 'card-real',
          accountType: 'CREDIT',
          date: '2026-06-11',
          amountCents: 42_990,
          rawDescriptor: 'eBay O*02-14853-76644',
          categoryId: 'shopping',
        }),
      ]);
      expect(plan.flagIds).toEqual([]);
      expect(plan.overturnIds).toEqual([]);
      expect(plan.fileIds).toEqual([]);
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
    expect(res).toEqual({ flagged: 2, overturned: 0, filed: 2 });

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
    expect(await refreshTransferFlags(USER)).toEqual({ flagged: 0, overturned: 0, filed: 0 });
  });

  it('never clobbers a user-resolved category: flag only', async () => {
    await prisma.transaction.createMany({
      data: [
        row({ id: `${USER}-out2`, categoryId: 'dining', confidenceBps: 10_000, needsReview: false }),
        row({ id: `${USER}-in2`, accountId: CARD, date: '2026-06-11', amountCents: 123_456, rawDescriptor: 'PAYMENT RECEIVED - THANK YOU' }),
      ],
    });
    const res = await refreshTransferFlags(USER);
    // The settled 'dining' row is an OVERTURN, reported separately now.
    expect(res).toEqual({ flagged: 1, overturned: 1, filed: 1 });
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
    expect(res).toEqual({ flagged: 2, overturned: 0, filed: 1 });
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
    expect(await refreshTransferFlags(USER)).toEqual({ flagged: 2, overturned: 0, filed: 1 });
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
    expect(await refreshTransferFlags(USER)).toEqual({ flagged: 2, overturned: 0, filed: 1 });
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
    expect(await refreshTransferFlags(USER)).toEqual({ flagged: 0, overturned: 0, filed: 0 });
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
