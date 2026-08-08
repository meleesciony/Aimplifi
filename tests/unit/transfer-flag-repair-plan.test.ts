/**
 * H.7b — the transfer-flag repair planner (STATUS §STILL OPEN after H.7,
 * residual 1): an owner-triggered pass that clears `isTransfer` on settled
 * substantive rows whose flag TODAY'S evidence rule declines.
 *
 * Why this exists: pre-H.7, a coincidental same-|amount| counterpart within ±3
 * days silently flagged settled rows — measured live at 53 rows / $29,848.84
 * withheld from the owner's income and spending totals. H.7 fixed the RULE but
 * flags are add-only, so the wrongly-written flags stand until an explicit,
 * owner-authorised repair. This planner decides; it never writes.
 *
 * The doctrine, carried over from H.7 unchanged:
 *  - the repair and the sweep share ONE rule (`planTransferUpdates` replayed
 *    from scratch) — a flag is cleared only when the shipped rule, asked today,
 *    would not re-justify it; so a cleared row can NEVER bounce back on the
 *    next sweep unless genuinely new evidence arrives (locked below);
 *  - a review-pinned row is the user's to decide, never the system's (the
 *    backfill precedent) — declined or not, it is counted, not cleared;
 *  - rows outside the settled-substantive scope (still needsReview, or filed
 *    AS 'transfer' by the old rule) are DISCLOSED as a count, never silently
 *    dropped from the story ("no silent caps") and never acted on here.
 */
import { describe, expect, it } from 'vitest';

import {
  planTransferFlagRepair,
  type TransferFlagRepairPlan,
} from '@/lib/engine/categorize/transfer-flag-repair';
import { planTransferUpdates, type TransferStateTxn } from '@/lib/engine/categorize/transfers';

const base = {
  isTransfer: false,
  needsReview: false,
  reviewPinned: false,
  status: 'POSTED',
  currencySupported: true,
  categoryId: null as string | null,
  accountType: 'CHECKING',
};

function txn(over: Partial<TransferStateTxn> & Pick<TransferStateTxn, 'id'>): TransferStateTxn {
  return {
    accountId: 'checking',
    date: '2026-06-10',
    amountCents: -50_000,
    rawDescriptor: 'KALSHI INC PAYMENT',
    ...base,
    ...over,
  };
}

/** The live repro H.7 was built around: a settled $500.00 income row flagged
 * because an unrelated $500.00 outflow on a CREDIT card landed two days
 * earlier. The pair is directionally INCOHERENT (a card outflow is a
 * purchase), so today's rule declines the flag on both legs. */
function kalshiPair(): TransferStateTxn[] {
  return [
    txn({
      id: 'income-leg',
      accountId: 'checking',
      amountCents: 50_000,
      rawDescriptor: 'CEF I CEF IV PPD',
      isTransfer: true,
      categoryId: 'income',
    }),
    txn({
      id: 'card-leg',
      accountId: 'card',
      accountType: 'CREDIT',
      amountCents: -50_000,
      date: '2026-06-08',
      rawDescriptor: 'KALSHI INC PAYMENT',
      isTransfer: true,
      categoryId: 'entertainment',
    }),
  ];
}

/** A genuine brokerage funding: settled substantive verdicts, but the pair is
 * coherent (CHECKING sends) — today's rule still endorses the flags. */
function coherentPair(): TransferStateTxn[] {
  return [
    txn({
      id: 'fund-out',
      accountId: 'checking',
      amountCents: -200_000,
      rawDescriptor: 'WIRE OUT 20260610',
      isTransfer: true,
      categoryId: 'groceries', // wrong verdict, but the flag itself is evidenced
    }),
    txn({
      id: 'fund-in',
      accountId: 'brokerage',
      accountType: 'INVESTMENT',
      amountCents: 200_000,
      date: '2026-06-11',
      rawDescriptor: 'INCOMING WIRE',
      isTransfer: true,
      categoryId: 'income',
    }),
  ];
}

describe('H.7b planner: what clears, what stays, what is only counted', () => {
  it('clears a settled substantive flag today\'s rule declines, and splits the dollars by direction', () => {
    const plan = planTransferFlagRepair(kalshiPair());
    expect(plan.clearIds.sort()).toEqual(['card-leg', 'income-leg']);
    expect(plan.inflowCents).toBe(50_000); // the income leg returns to money-in
    expect(plan.outflowCents).toBe(50_000); // the card leg returns to money-out
    expect(plan.incomeCategorisedCount).toBe(1);
    expect(plan.endorsedCount).toBe(0);
    expect(plan.flaggedCount).toBe(2);
  });

  it('keeps a flag the rule re-justifies via a directionally coherent pair', () => {
    const plan = planTransferFlagRepair(coherentPair());
    expect(plan.clearIds).toEqual([]);
    expect(plan.endorsedCount).toBe(2);
  });

  it('keeps a flag the rule re-justifies via a descriptor the merchant table knows', () => {
    const plan = planTransferFlagRepair([
      txn({
        id: 'descr',
        isTransfer: true,
        categoryId: 'groceries',
        rawDescriptor: 'ONLINE TRANSFER TO SAVINGS',
      }),
    ]);
    expect(plan.clearIds).toEqual([]);
    expect(plan.endorsedCount).toBe(1);
  });

  it('never clears a review-pinned row — declined or not, it is the user\'s, and it is counted', () => {
    const rows = kalshiPair().map((t) =>
      t.id === 'income-leg' ? { ...t, reviewPinned: true } : t,
    );
    const plan = planTransferFlagRepair(rows);
    expect(plan.clearIds).toEqual(['card-leg']);
    expect(plan.declinedOutOfScopeCount).toBe(1);
  });

  it('counts, and never touches, a declined flag still awaiting review (the wedge shape)', () => {
    const plan = planTransferFlagRepair([
      txn({
        id: 'wedged',
        isTransfer: true,
        needsReview: true,
        categoryId: 'uncategorized',
      }),
    ]);
    expect(plan.clearIds).toEqual([]);
    expect(plan.declinedOutOfScopeCount).toBe(1);
  });

  it('counts, and never touches, a declined row the old rule FILED as transfer', () => {
    const plan = planTransferFlagRepair([
      txn({ id: 'filed', isTransfer: true, categoryId: 'transfer' }),
    ]);
    expect(plan.clearIds).toEqual([]);
    expect(plan.declinedOutOfScopeCount).toBe(1);
  });

  it('a filed-as-transfer row the rule still endorses is neither cleared nor counted as declined', () => {
    const rows = coherentPair().map((t) =>
      t.id === 'fund-out' ? { ...t, categoryId: 'transfer' } : t,
    );
    const plan = planTransferFlagRepair(rows);
    expect(plan.clearIds).toEqual([]);
    expect(plan.declinedOutOfScopeCount).toBe(0);
  });

  it('an unflagged row is invisible to the repair, whatever its evidence', () => {
    const plan = planTransferFlagRepair([
      txn({ id: 'plain', categoryId: 'dining' }),
      txn({ id: 'plain-2', amountCents: 50_000, accountId: 'other', categoryId: 'income', date: '2026-06-09' }),
    ]);
    expect(plan.clearIds).toEqual([]);
    expect(plan.endorsedCount).toBe(0);
    expect(plan.declinedOutOfScopeCount).toBe(0);
    // …and the which-zero discriminator says NO MARKS EXIST, not "all fine".
    expect(plan.flaggedCount).toBe(0);
  });

  it('is idempotent: applying the clear and re-planning finds nothing left to clear', () => {
    const rows = kalshiPair();
    const first = planTransferFlagRepair(rows);
    const repaired = rows.map((t) =>
      first.clearIds.includes(t.id) ? { ...t, isTransfer: false } : t,
    );
    const second = planTransferFlagRepair(repaired);
    expect(second.clearIds).toEqual([]);
    expect(second.endorsedCount).toBe(0);
  });

  it('SWEEP STABILITY: the next sweep cannot re-flag a repaired row, because repair and sweep share one rule', () => {
    const rows = kalshiPair();
    const plan = planTransferFlagRepair(rows);
    const repaired = rows.map((t) =>
      plan.clearIds.includes(t.id) ? { ...t, isTransfer: false } : t,
    );
    const sweep = planTransferUpdates(repaired);
    for (const id of plan.clearIds) {
      expect(sweep.flagIds).not.toContain(id);
      expect(sweep.overturnIds).not.toContain(id);
      expect(sweep.fileIds).not.toContain(id);
    }
  });

  it('exposes the cleared rows themselves, so a surface can state what it will change before it changes it', () => {
    const plan: TransferFlagRepairPlan = planTransferFlagRepair(kalshiPair());
    const ids = plan.clear.map((r) => r.id).sort();
    expect(ids).toEqual(['card-leg', 'income-leg']);
    // The row detail a preview needs travels with the plan.
    const income = plan.clear.find((r) => r.id === 'income-leg')!;
    expect(income.categoryId).toBe('income');
    expect(income.amountCents).toBe(50_000);
  });
});
