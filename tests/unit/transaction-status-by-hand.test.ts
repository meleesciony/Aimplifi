/**
 * O.13g / O.15 slice 7 — the reader may mark a transaction pending or cleared.
 *
 * Two things are locked here, and the second is the unusual one:
 *
 *  1. WHO may write `status` (the availability rules), including the asymmetry
 *     that marking CLEARED can never be refused on a row the app owns.
 *
 *  2. THAT THE DISCLOSURE SENTENCE IS TRUE. `STATUS_PENDING_EFFECT` names which
 *     figures keep counting a pending row and which drop it, and the obvious
 *     version of that sentence is FALSE here — `isSpendRow` does not read
 *     `status`, so /reports and /budgets count a pending row exactly like a
 *     cleared one. The clauses are therefore executed against the engines they
 *     describe: add a status gate to reports, or remove one from the tax export,
 *     and a test fails telling you the copy is now a lie. (Repo rule: changed
 *     money COPY needs locks as much as changed money MATH.)
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  STATUS_BLOCKED_BANK_OWNED,
  STATUS_BLOCKED_INFLOW,
  STATUS_BLOCKED_SPLIT_CHILD,
  STATUS_BLOCKED_SPLIT_PARENT,
  STATUS_PENDING_EFFECT,
  type ActionRowFacts,
  txnActionAvailability,
} from '@/lib/engine/transactions/actions';
import { rowOrigin } from '@/lib/engine/transactions/origin';
import { isSpendRow, spendingByCategory } from '@/lib/engine/reports/reports';
import { monthlyFlows } from '@/lib/engine/fi/insights';
import { buildMerchantProfile } from '@/lib/engine/merchant/profile';
import { buildTaxExport } from '@/lib/engine/tax/export';
import { summarizeSharedMovement } from '@/lib/engine/household/digest';
import { detectUnusualCharges } from '@/lib/engine/anomaly/detect';
import { discretionaryDailyOutflows } from '@/lib/engine/radar/burn';
import { isoDate } from '@/lib/dates';

const RANGE = { fromYm: '2026-06', toYm: '2026-06' };

const facts = (over: Partial<ActionRowFacts> = {}): ActionRowFacts => ({
  amountCents: -12550,
  isTransfer: false,
  isSplitParent: false,
  splitParentId: null,
  taxClass: null,
  excludeFromTotals: false,
  reimbursement: null,
  status: 'POSTED',
  descriptorOrigin: 'entered',
  ...over,
});

const statusOf = (t: ActionRowFacts) => txnActionAvailability(t).find((a) => a.kind === 'status')!;

describe('rowOrigin — who owns the row', () => {
  it('a feed id means the feed owns it, whatever the account says', () => {
    // The ROW decides, not the account: a hand-typed row on a Plaid-linked card
    // is the reader's (O.13b critic cycle 2, F3).
    expect(rowOrigin({ providerRef: 'plaid-abc', accountProvider: 'plaid' })).toBe('bank');
    expect(rowOrigin({ providerRef: null, accountProvider: 'plaid' })).toBe('entered');
    expect(rowOrigin({ providerRef: null, accountProvider: 'manual' })).toBe('entered');
  });

  it('the demo dataset presents as a feed despite carrying no provider ref', () => {
    expect(rowOrigin({ providerRef: null, accountProvider: 'demo' })).toBe('bank');
  });
});

describe('the status action — who may write it', () => {
  it('is refused on a fed row in BOTH directions: the feed re-asserts status every sync', () => {
    for (const status of ['POSTED', 'PENDING']) {
      const a = statusOf(facts({ descriptorOrigin: 'bank', status }));
      expect(a.enabled).toBe(false);
      expect(a.reason).toBe(STATUS_BLOCKED_BANK_OWNED);
      expect(a.nextStatus).toBeUndefined();
    }
  });

  it('offers the opposite state on a row the reader entered', () => {
    const posted = statusOf(facts({ status: 'POSTED' }));
    expect(posted.enabled).toBe(true);
    expect(posted.label).toBe('Mark as pending');
    expect(posted.nextStatus).toBe('PENDING');

    const pending = statusOf(facts({ status: 'PENDING' }));
    expect(pending.enabled).toBe(true);
    expect(pending.label).toBe('Mark as cleared');
    expect(pending.nextStatus).toBe('POSTED');
  });

  it('refuses a split container both ways — its status is inert in every sum', () => {
    for (const status of ['POSTED', 'PENDING']) {
      const a = statusOf(facts({ isSplitParent: true, status }));
      expect(a.enabled).toBe(false);
      expect(a.reason).toBe(STATUS_BLOCKED_SPLIT_PARENT);
    }
  });

  it('does NOT refuse a transfer: an entered transfer that has not landed is the point', () => {
    expect(statusOf(facts({ isTransfer: true })).enabled).toBe(true);
  });

  /**
   * Both critics found this INDEPENDENTLY, which is the strongest signal available
   * that a finding is real — and it falsified the asymmetry this slice originally
   * shipped ("clearing is never refused"). A split PIECE is not reader-owned state:
   * `splitTransaction` gives children no `providerRef`, so a piece of a BANK charge
   * reads as 'entered', and both providers push the parent's status onto its
   * children on every sync. The write would have been silently reverted — the exact
   * failure the bank refusal exists to prevent.
   *
   * The invariant is AMENDED here rather than deleted (repo rule): never-lock-the-
   * undo protects state the reader owns, and a piece's status is the charge's.
   */
  it('refuses a split piece in BOTH directions — the feed rewrites pieces from the parent', () => {
    for (const status of ['POSTED', 'PENDING']) {
      const a = statusOf(facts({ splitParentId: 'p1', status }));
      expect(a.enabled).toBe(false);
      expect(a.reason).toBe(STATUS_BLOCKED_SPLIT_CHILD);
      expect(a.nextStatus).toBeUndefined();
    }
  });

  it('refuses a piece even when its own row looks reader-owned (the fed-split hole)', () => {
    // This is the shape that shipped broken: origin 'entered' (no providerRef of
    // its own) while the parent is a bank charge. Nothing about the piece itself
    // reveals that, which is why the refusal is on being a piece at all.
    const piece = statusOf(facts({ splitParentId: 'p1', descriptorOrigin: 'entered', status: 'PENDING' }));
    expect(piece.enabled).toBe(false);
  });

  /**
   * Critic A, executed against the real cash-needed engine: the pending sum is
   * SIGNED, so a hand-typed "+$2,000 expected paycheck" marked pending took a $500
   * shortfall to $0 and deleted the dashboard's transfer instruction. A stale
   * figure can be weighed; a missing instruction bounces an autopay (L.14).
   */
  it('refuses MONEY IN in both directions — a pending inflow adds to today’s cash', () => {
    for (const status of ['POSTED', 'PENDING']) {
      const a = statusOf(facts({ amountCents: 200000, status }));
      expect(a.enabled).toBe(false);
      expect(a.reason).toBe(STATUS_BLOCKED_INFLOW);
    }
    // A zero-amount row is not money out either — the boundary is explicit.
    expect(statusOf(facts({ amountCents: 0 })).enabled).toBe(false);
    // …and an outflow of the same magnitude is still offered.
    expect(statusOf(facts({ amountCents: -200000 })).enabled).toBe(true);
  });

  it('every enabled status action writes the state the row is NOT in', () => {
    for (const status of ['POSTED', 'PENDING']) {
      for (const over of [{}, { isTransfer: true }, { splitParentId: 'p1' }, { taxClass: 'medical' }]) {
        const a = statusOf(facts({ ...over, status }));
        if (a.enabled) expect(a.nextStatus).not.toBe(status);
      }
    }
  });
});

/**
 * The disclosure, executed. Each block is one clause of STATUS_PENDING_EFFECT.
 */
describe('STATUS_PENDING_EFFECT is true — clause by clause', () => {
  it('"your category totals and budgets still count it" — isSpendRow ignores status', () => {
    const pending = { date: '2026-06-10', amountCents: -21240, categoryId: 'groceries', isTransfer: false, isSplitParent: false, status: 'PENDING' };
    const posted = { ...pending, status: 'POSTED' };
    expect(isSpendRow(pending, RANGE)).toBe(true);
    expect(isSpendRow(posted, RANGE)).toBe(true);
    // Not merely "both admitted" — the FIGURES must be identical, or the sentence
    // is true of the predicate and false of the number the reader sees.
    expect(spendingByCategory([pending], RANGE)).toEqual(spendingByCategory([posted], RANGE));
    expect(spendingByCategory([pending], RANGE).totalCents).toBe(21240);
  });

  it('"your savings rate ... leave it out" — monthlyFlows drops a pending outflow', () => {
    const row = (status: string) => ({
      date: '2026-06-10',
      amountCents: -21240,
      rawDescriptor: 'COSTCO WHSE',
      accountId: 'a1',
      isTransfer: false,
      status,
      categoryId: 'groceries',
    });
    // A POSTED paycheck keeps the month present in both runs, so the assertion is
    // "the expense left", not "the month vanished" — two different facts, and only
    // the first is what the sentence claims.
    const income = { ...row('POSTED'), amountCents: 500000, categoryId: 'paycheck', rawDescriptor: 'PAYROLL' };
    expect(monthlyFlows([income, row('POSTED')])[0].expensesCents).toBe(21240);
    expect(monthlyFlows([income, row('PENDING')])[0].expensesCents).toBe(0);
    expect(monthlyFlows([income, row('PENDING')])[0].incomeCents).toBe(500000);
  });

  it('"merchant totals ... leave it out" — the lens drops a pending charge', () => {
    const rows = (status: string) => [
      { date: '2026-05-05', amountCents: -1000, merchant: 'Blue Bottle', status: 'POSTED', isTransfer: false },
      { date: '2026-06-05', amountCents: -9000, merchant: 'Blue Bottle', status, isTransfer: false },
    ];
    expect(buildMerchantProfile(rows('POSTED'), 'Blue Bottle', isoDate('2026-06-20'))?.totalCents).toBe(10000);
    expect(buildMerchantProfile(rows('PENDING'), 'Blue Bottle', isoDate('2026-06-20'))?.totalCents).toBe(1000);
  });

  it('"and the tax export leave it out" — a TAGGED pending row reaches no total', () => {
    const row = (status: string) => ({
      date: '2026-06-10',
      description: 'CVS PHARMACY',
      amountCents: -21240,
      status,
      isTransfer: false,
      isSplitParent: false,
      taxClass: 'medical',
      note: null,
    });
    const posted = buildTaxExport([row('POSTED')], 2026);
    const pending = buildTaxExport([row('PENDING')], 2026);
    expect(posted.groups.flatMap((g) => g.lines)).toHaveLength(1);
    expect(pending.groups.flatMap((g) => g.lines)).toHaveLength(0);
    // This is exactly why STATUS_PENDING_TAX_CAUTION exists: the deduction the
    // reader asked for silently leaves a figure bound for a preparer.
  });

  it('the other named-out surfaces drop it too (digest, anomaly, radar burn)', () => {
    const movement = (status: string) =>
      summarizeSharedMovement({
        rows: [
          { date: isoDate('2026-06-10'), amountCents: -4000, isTransfer: false, isSplitParent: false, status },
        ],
        accountCount: 1,
        since: isoDate('2026-06-01'),
        today: isoDate('2026-06-20'),
      });
    expect(movement('POSTED').outflowCents).toBe(4000);
    expect(movement('PENDING').outflowCents).toBe(0);

    const base = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      date: `2026-06-0${i + 1}`,
      amountCents: -2000,
      rawDescriptor: 'BLUE BOTTLE',
      isTransfer: false,
      status: 'POSTED',
    }));
    const spike = { id: 'spike', date: '2026-06-20', amountCents: -50000, rawDescriptor: 'BLUE BOTTLE', isTransfer: false, status: 'PENDING' };
    expect(detectUnusualCharges([...base, spike], isoDate('2026-06-21')).map((f) => f.txnId)).not.toContain('spike');

    const burn = (status: string) =>
      discretionaryDailyOutflows(
        [
          {
            date: '2026-06-10',
            amountCents: -3000,
            accountId: 'pay1',
            rawDescriptor: 'BLUE BOTTLE',
            isTransfer: false,
            isSplitParent: false,
            status,
          },
        ],
        {
          paymentAccountId: 'pay1',
          excludedCanonicals: new Set<string>(),
          today: isoDate('2026-06-20'),
        },
      );
    // Same-length day series either way; what changes is the money in it.
    expect(burn('POSTED').reduce((a, b) => a + b, 0)).toBe(3000);
    expect(burn('PENDING').reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('"bill detection ... leaves it out" is a SERVER-INTAKE fact, and is asserted where it lives', () => {
    // detectRecurring itself never reads `status` — the POSTED narrowing is applied
    // by each caller (the O.5 rule: sharing an engine is not sharing a basis). A
    // pure fixture therefore cannot prove this clause, so the intake is asserted
    // structurally. If the filter moves, this fails and the sentence gets re-checked.
    for (const f of ['src/server/recurring.ts', 'src/server/coach.ts']) {
      expect(readFileSync(f, 'utf8')).toContain("t.status === 'POSTED'");
    }
  });
});

describe('STATUS_PENDING_EFFECT does not claim what it cannot', () => {
  it('names the payment-account condition rather than asserting it of every row', () => {
    // cash-needed sums pending rows only on the PAYMENT account
    // (cash-needed/assemble.ts:107), so an unconditional "counts as cash still to
    // leave" would be false on every other account.
    expect(STATUS_PENDING_EFFECT).toContain('on your payment account');
  });

  it('does not claim reports or budgets drop the row', () => {
    expect(STATUS_PENDING_EFFECT).toContain('still count it');
    expect(STATUS_PENDING_EFFECT).not.toMatch(/reports.{0,20}leave it out/i);
  });
});
