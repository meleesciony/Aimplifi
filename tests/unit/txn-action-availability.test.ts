/**
 * O.15 slice 2 — the one action menu's availability basis. The contract under
 * guard: ALL ELEVEN actions are always returned (disabled-with-reason, never
 * hidden), the reasons are the same sentences the server actions refuse with,
 * and the reimbursement slot's label follows the row's state.
 */
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_BLOCKED_SPLIT_PARENT,
  RECURRING_BLOCKED_SPLIT_PARENT,
  RECURRING_BLOCKED_TRANSFER,
  EXCLUDE_BLOCKED_SPLIT_PARENT,
  EXCLUDE_BLOCKED_TRANSFER,
  REIMBURSE_BLOCKED_INFLOW,
  REIMBURSE_BLOCKED_TRANSFER,
  SPEND_CLASS_BLOCKED_OUT_OF_SCOPE,
  SPLIT_BLOCKED_CHILD,
  SPLIT_BLOCKED_REIMBURSED,
  SPLIT_PARENT_HAS_UNDO,
  TAX_BLOCKED_SPLIT_PARENT,
  type ActionRowFacts,
  txnActionAvailability,
} from '@/lib/engine/transactions/actions';
import { DEMO_ENTRY_BLOCKED } from '@/lib/demo-user';

const ALL_KINDS = [
  'category',
  'spendClass',
  'rule',
  'renamePayee',
  'note',
  'taxTag',
  'split',
  'markRecurring',
  'reimbursement',
  'excludeFromTotals',
  'status',
] as const;

// Base row: POSTED and ENTERED BY THE READER. 'entered' is the deliberate default
// because it is the only shape where the status action is live at all — a 'bank'
// base would make every status assertion below pass on the refusal branch and
// never exercise the rule (the vacuous-fixture trap).
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
  spendClass: 'guilt-free',
  canEditSpendClass: true,
  ...over,
});

const byKind = (t: ActionRowFacts) =>
  new Map(txnActionAvailability(t).map((a) => [a.kind, a]));

describe('txnActionAvailability — every action, always', () => {
  it('returns all eleven actions in menu order, for every row shape', () => {
    for (const t of [
      facts(),
      facts({ isTransfer: true }),
      facts({ isSplitParent: true }),
      facts({ splitParentId: 'p1' }),
      facts({ amountCents: 50000 }),
      facts({ spendClass: 'out-of-scope' }),
      facts({ canEditSpendClass: false }),
    ]) {
      expect(txnActionAvailability(t).map((a) => a.kind)).toEqual([...ALL_KINDS]);
    }
  });

  it('a disabled action always carries a reason; an enabled one never does', () => {
    for (const t of [facts(), facts({ isTransfer: true }), facts({ isSplitParent: true })]) {
      for (const a of txnActionAvailability(t)) {
        if (a.enabled) expect(a.reason).toBeNull();
        else expect(a.reason).toBeTruthy();
      }
    }
  });

  it('an ordinary purchase: everything enabled', () => {
    const m = byKind(facts());
    for (const kind of ALL_KINDS) expect(m.get(kind)?.enabled).toBe(true);
  });
});

describe('the disabled reasons, by row shape', () => {
  it('split parent: category, tax, split, reimbursement, exclude are blocked with their sentences', () => {
    const m = byKind(facts({ isSplitParent: true }));
    expect(m.get('category')).toMatchObject({ enabled: false, reason: CATEGORY_BLOCKED_SPLIT_PARENT });
    expect(m.get('taxTag')).toMatchObject({ enabled: false, reason: TAX_BLOCKED_SPLIT_PARENT });
    expect(m.get('split')).toMatchObject({ enabled: false, reason: SPLIT_PARENT_HAS_UNDO });
    expect(m.get('reimbursement')?.enabled).toBe(false);
    expect(m.get('excludeFromTotals')).toMatchObject({ enabled: false, reason: EXCLUDE_BLOCKED_SPLIT_PARENT });
    // The note and the two rule links stay live — a container still deserves a memo.
    expect(m.get('note')?.enabled).toBe(true);
    expect(m.get('rule')?.enabled).toBe(true);
  });

  it('transfer: split, reimbursement, exclude are blocked with their sentences', () => {
    const m = byKind(facts({ isTransfer: true }));
    expect(m.get('split')?.enabled).toBe(false);
    expect(m.get('reimbursement')).toMatchObject({ enabled: false, reason: REIMBURSE_BLOCKED_TRANSFER });
    expect(m.get('excludeFromTotals')).toMatchObject({ enabled: false, reason: EXCLUDE_BLOCKED_TRANSFER });
  });

  it('split child: split is blocked as "already one piece"', () => {
    const m = byKind(facts({ splitParentId: 'p1' }));
    expect(m.get('split')).toMatchObject({ enabled: false, reason: SPLIT_BLOCKED_CHILD });
  });

  it('inflow: reimbursement is blocked as money-in (until tracked)', () => {
    const m = byKind(facts({ amountCents: 50000 }));
    expect(m.get('reimbursement')).toMatchObject({ enabled: false, reason: REIMBURSE_BLOCKED_INFLOW });
  });
});

describe('the reimbursement slot follows the row state', () => {
  it("untracked purchase → 'Awaiting reimbursement' writing 'awaiting'", () => {
    const a = byKind(facts()).get('reimbursement');
    expect(a).toMatchObject({ enabled: true, label: 'Awaiting reimbursement', nextReimbursement: 'awaiting' });
  });

  it("awaiting → primary writes 'received', secondary stops tracking", () => {
    const a = byKind(facts({ reimbursement: 'awaiting' })).get('reimbursement');
    expect(a).toMatchObject({ enabled: true, label: 'Reimbursement received', nextReimbursement: 'received' });
    expect(a?.secondary).toMatchObject({ label: 'Stop tracking reimbursement', nextReimbursement: null });
  });

  it('received → the slot stops tracking; unknown stored value reads as untracked', () => {
    expect(byKind(facts({ reimbursement: 'received' })).get('reimbursement')).toMatchObject({
      label: 'Stop tracking reimbursement',
      nextReimbursement: null,
    });
    expect(byKind(facts({ reimbursement: 'garbage' })).get('reimbursement')).toMatchObject({
      label: 'Awaiting reimbursement',
      nextReimbursement: 'awaiting',
    });
  });
});

describe('the undo asymmetry (critic P1-3): stopping is always reachable', () => {
  it('a tracked row that BECAME a transfer still offers "Stop tracking reimbursement", enabled', () => {
    for (const shape of [
      facts({ isTransfer: true, reimbursement: 'awaiting' }),
      facts({ isTransfer: true, reimbursement: 'received' }),
      facts({ isSplitParent: true, reimbursement: 'awaiting' }),
    ]) {
      const a = byKind(shape).get('reimbursement');
      expect(a).toMatchObject({ enabled: true, label: 'Stop tracking reimbursement', nextReimbursement: null });
    }
  });

  it('an excluded row that BECAME a transfer still offers "Include in totals again", enabled', () => {
    for (const shape of [
      facts({ isTransfer: true, excludeFromTotals: true }),
      facts({ isSplitParent: true, excludeFromTotals: true }),
    ]) {
      const a = byKind(shape).get('excludeFromTotals');
      expect(a).toMatchObject({ enabled: true, label: 'Include in totals again' });
    }
  });

  it('split is refused on a tracked row, with the reimbursement sentence (P1-2)', () => {
    expect(byKind(facts({ reimbursement: 'awaiting' })).get('split')).toMatchObject({
      enabled: false,
      reason: SPLIT_BLOCKED_REIMBURSED,
    });
    expect(byKind(facts({ reimbursement: 'received' })).get('split')?.enabled).toBe(false);
  });
});

describe('the exclusion slot follows the row state', () => {
  it('toggles its label with the stored flag', () => {
    expect(byKind(facts()).get('excludeFromTotals')?.label).toBe('Exclude from totals');
    expect(byKind(facts({ excludeFromTotals: true })).get('excludeFromTotals')?.label).toBe(
      'Include in totals again',
    );
  });
});

describe('markRecurring (O.13f) — refused exactly where an instruction would match nothing', () => {
  const recurring = (t: ActionRowFacts) =>
    txnActionAvailability(t).find((a) => a.kind === 'markRecurring')!;

  it('is offered on an ordinary charge — and on an INFLOW, which the reimbursement slot is not', () => {
    // A paycheck is a recurring series too; "does this repeat?" is a different
    // question from "are you owed this back?", and only the second is outflow-only.
    expect(recurring(facts())).toMatchObject({ enabled: true, reason: null });
    expect(recurring(facts({ amountCents: 380000 }))).toMatchObject({ enabled: true, reason: null });
  });

  it('is refused on the two row shapes the detector never reads, with its reason', () => {
    // Refused rather than silently accepted: `detectRecurring` skips split
    // containers and transfers, so a verdict stored from one would look obeyed
    // and do nothing at all.
    expect(recurring(facts({ isSplitParent: true }))).toMatchObject({
      enabled: false,
      reason: RECURRING_BLOCKED_SPLIT_PARENT,
    });
    expect(recurring(facts({ isTransfer: true }))).toMatchObject({
      enabled: false,
      reason: RECURRING_BLOCKED_TRANSFER,
    });
  });

  it('carries no state in its label — the destination is what knows the verdict', () => {
    // These row facts do not include the reader's verdict, so a label claiming
    // one would be wrong on exactly the rows he has already acted on.
    for (const t of [facts(), facts({ excludeFromTotals: true }), facts({ reimbursement: 'awaiting' })]) {
      expect(recurring(t).label).toBe('Recurring…');
    }
  });
});

describe('the spend-class verb (C.16) — the write lives in the menu now', () => {
  const sc = (t: ActionRowFacts) => txnActionAvailability(t).find((a) => a.kind === 'spendClass')!;

  it('is offered on an ordinary in-scope row', () => {
    expect(sc(facts())).toMatchObject({ enabled: true, reason: null });
  });

  it('carries no state in its label — the badge and the pick step show what is in force', () => {
    for (const t of [facts(), facts({ spendClass: 'fixed' }), facts({ spendClass: 'guilt-free' })]) {
      expect(sc(t).label).toBe('Change spending class…');
    }
  });

  it('is refused on an out-of-scope row with the SAME sentence the server actions refuse with', () => {
    // `SPEND_CLASS_BLOCKED_OUT_OF_SCOPE` is imported verbatim by
    // setTransactionSpendClass (transaction-flags-actions.ts) — this equality
    // is the invariant's testable form: a disabled menu row and a refused
    // write can never say different things.
    expect(sc(facts({ spendClass: 'out-of-scope' }))).toMatchObject({
      enabled: false,
      reason: SPEND_CLASS_BLOCKED_OUT_OF_SCOPE,
    });
  });

  it('is refused on the shared demo with the demo sentence — first, matching the wire', () => {
    // The server fences the demo BEFORE it looks at the row, so even an
    // out-of-scope demo row refuses with the demo sentence, never the row's.
    expect(sc(facts({ canEditSpendClass: false }))).toMatchObject({
      enabled: false,
      reason: DEMO_ENTRY_BLOCKED,
    });
    expect(sc(facts({ canEditSpendClass: false, spendClass: 'out-of-scope' }))).toMatchObject({
      enabled: false,
      reason: DEMO_ENTRY_BLOCKED,
    });
  });

  it('is refused on a split container the moment the caller reports its derived class', () => {
    // The engine classifies a split parent out-of-scope (spend-class.ts), so
    // the availability rule needs only the derived class — the caller's
    // coupling is locked here and end-to-end by the detail-page e2e.
    expect(sc(facts({ isSplitParent: true, spendClass: 'out-of-scope' }))).toMatchObject({
      enabled: false,
      reason: SPEND_CLASS_BLOCKED_OUT_OF_SCOPE,
    });
  });

  it('the undo direction is never locked: a reader-set row still offers the verb, enabled', () => {
    // The F8 marker is display-only — availability does not read it, so a row
    // the reader already decided can always be changed (the
    // never-lock-the-undo rule, critic P1-3).
    expect(sc(facts({ spendClass: 'fixed' }))).toMatchObject({ enabled: true, reason: null });
  });
});
