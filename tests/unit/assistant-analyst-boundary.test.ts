/**
 * The comparison through the REAL reconciliation boundary — the path a combined card
 * takes in the app: raw rows → `applyReconciliationBoundary` (what the snapshot applies)
 * → each account's own stored span, as `loadAccountRecordFacts` reads it → the cutovers
 * `getReconciliationBoundary` reports → `buildAnalystAnswer`.
 *
 * Critic cycle 2, P1-1: with a cutover earlier than the old record's last row, the old
 * rows after it are dropped and the new record's history did not reach them — the days
 * were on no kept record, yet the raw spans overlapped and the card was priced at $300
 * for a $600 July. Values worked by hand in tests/edge-cases/ask-same-account-comparison.md §E3.
 */
import { describe, expect, it } from 'vitest';
import { applyReconciliationBoundary, reconciliationDroppedRanges } from '@/lib/engine/account/reconcile-boundary';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { buildAnalystAnswer } from '@/server/analyst';

const TODAY = '2026-10-02';
const acct = (id: string, name: string, provider: string, plaidItemId: string | null) => ({
  id,
  name,
  displayName: null,
  provider,
  type: 'CREDIT',
  currentBalanceCents: 0,
  feedDroppedAt: null,
  plaidItemId,
  currency: 'USD',
});
const tx = (id: string, accountId: string, date: string, dollars: number) => ({
  id,
  accountId,
  date,
  amountCents: -Math.round(dollars * 100),
  categoryId: 'dining',
  isTransfer: false,
  isSplitParent: false,
  excludeFromTotals: false,
  status: 'POSTED',
});

const OLD = acct('old', 'Freedom (old)', 'simplefin', null);
const NEW = acct('new', 'Freedom Unlimited', 'plaid', 'item-1');
// The old record: $300 on the 10th and 20th of April … August (last row Aug 20).
const OLD_ROWS = ['04', '05', '06', '07', '08'].flatMap((m) => [
  tx(`o${m}a`, 'old', `2026-${m}-10`, 300),
  tx(`o${m}b`, 'old', `2026-${m}-20`, 300),
]);
// The new connection's history starts Aug 18.
const NEW_ROWS = [
  tx('n1', 'new', '2026-08-18', 1),
  tx('n2', 'new', '2026-08-20', 300),
  tx('n3', 'new', '2026-09-10', 300),
  tx('n4', 'new', '2026-09-20', 300),
];
const ROWS = [...OLD_ROWS, ...NEW_ROWS];

type Row = ReturnType<typeof tx>;
type Link = { predecessorAccountId: string; successorAccountId: string; cutoverDate: string };

/** The app's path: boundary on raw rows; spans capped at today; dropped ranges from the boundary module itself. */
type Words = Record<string, { start?: string; end?: string }>;

function answerFor(
  accounts: ReturnType<typeof acct>[],
  rows: Row[],
  links: Link[],
  intent: object,
  opts: { today?: string; words?: Words } = {},
) {
  const today = opts.today ?? TODAY;
  const words = opts.words ?? {};
  const b = applyReconciliationBoundary({
    paymentAccountId: null,
    accounts,
    transactions: rows,
    balanceSnapshots: [],
    statements: [],
    scheduled: [],
    links,
  } as never) as unknown as { accounts: unknown[]; transactions: Row[]; terminalOf: Map<string, string>; handoverKeys: Set<string> };
  // As `loadAccountRecordFacts` reads them: every row up to today.
  const rawSpans = new Map<string, { first: string; last: string }>();
  // As `loadReconciliationBoundaryInputs` reads predecessor spans: EVERY row, future-dated included.
  const allSpans = new Map<string, { first: string; last: string }>();
  for (const t of rows) {
    for (const [m, ok] of [[rawSpans, t.date <= today], [allSpans, true]] as const) {
      if (!ok) continue; // (capped at `today` below)
      const sp = m.get(t.accountId);
      if (!sp) m.set(t.accountId, { first: t.date, last: t.date });
      else {
        if (t.date < sp.first) sp.first = t.date;
        if (t.date > sp.last) sp.last = t.date;
      }
    }
  }
  const predecessorSpans = links.flatMap((l) => {
    const sp = allSpans.get(l.predecessorAccountId);
    return sp ? [{ accountId: l.predecessorAccountId, ...sp }] : [];
  });
  return buildAnalystAnswer({
    intent: intent as never,
    snap: { accounts: b.accounts, transactions: b.transactions } as never,
    facts: {
      byAccount: new Map(
        accounts.map((a) => [
          a.id,
          {
            plaidItemId: a.plaidItemId,
            recordStartWord: words[a.id]?.start ? { forDate: words[a.id]!.start!, verdict: 'real' } : null,
            recordEndWord: words[a.id]?.end ? { forDate: words[a.id]!.end!, verdict: 'real' } : null,
          },
        ]),
      ),
      plaidItems: [{ itemId: 'item-1', lastSyncedAt: today, lastSyncError: null }],
      rawSpans,
    },
    meta: CATEGORY_BY_ID,
    handoverKeys: b.handoverKeys,
    terminalOf: b.terminalOf,
    droppedOf: reconciliationDroppedRanges(accounts, links, predecessorSpans),
    today,
  });
}

function answer(cutoverDate: string, intent: object) {
  return answerFor([OLD, NEW], ROWS, [{ predecessorAccountId: 'old', successorAccountId: 'new', cutoverDate }], intent);
}

const JUL_VS_JUN = { kind: 'spend_compare' as const, currentYm: '2026-07', baselineYm: '2026-06', target: null };

describe('a combined card through the real reconciliation boundary', () => {
  it('a cutover earlier than both the old last row and the new history leaves a stated gap, priced at nothing', () => {
    const a = answer('2026-07-15', JUL_VS_JUN);
    expect(a.headline).toBe("I can't compare July 2026 with June 2026 yet — no account has complete records for both months.");
    // Kept: old rows on or before Jul 15 (Jul 10 = $300 in July; Jun 10 + Jun 20 = $600 in June).
    expect(a.detail).toContain(
      "Freedom Unlimited ($300.00 in July 2026, $600.00 in June 2026; nothing counted from Jul 16, 2026 to Aug 17, 2026 — those days of Freedom (old)'s record stopped counting when it was combined with another account).",
    );
    // No answer can prove days whose rows were dropped: nothing is asked.
    expect(a.accountQuestions).toBeUndefined();
  });

  it('the default cutover — the old record’s own last row — leaves no gap: one whole record', () => {
    const a = answer('2026-08-20', JUL_VS_JUN);
    expect(a.headline).toBe('You spent $600.00 in July 2026 — the same as in June 2026.');
    expect(a.detail).toContain('on the 1 account you spend from');
  });

  it('a future-dated row on the old record does not hide the days the boundary drops (critic cycle 3, C3)', () => {
    // A hand-typed fee dated December on the old card, combined at today: the boundary's claim
    // runs to today, so the new card's August rows are dropped. Not a real $0 August.
    const oldCard = acct('m-old', 'Wallet Card', 'manual', null);
    const plaid = acct('p-new', 'Wallet Card (Plaid)', 'plaid', 'item-1');
    const rows = [
      tx('m1', 'm-old', '2026-07-10', 300),
      tx('m2', 'm-old', '2026-07-20', 300),
      tx('m3', 'm-old', '2026-12-01', 5),
      tx('p1', 'p-new', '2026-06-05', 1),
      tx('p2', 'p-new', '2026-08-10', 300),
      tx('p3', 'p-new', '2026-08-20', 300),
      tx('p4', 'p-new', '2026-09-10', 300),
    ];
    const a = answerFor([oldCard, plaid], rows, [{ predecessorAccountId: 'm-old', successorAccountId: 'p-new', cutoverDate: TODAY }], {
      kind: 'spend_compare',
      currentYm: '2026-08',
      baselineYm: '2026-07',
      target: null,
    });
    expect(a.headline).not.toMatch(/\$0\.00 in August/);
    expect(a.headline).toBe("I can't compare August 2026 with July 2026 yet — no account has complete records for both months.");
    expect(a.accountQuestions).toBeUndefined();
  });

  it('three records in a chain: a dropped stretch of the middle one is never a real $0 (critic cycle 3, C2)', () => {
    // One → Two → Three, both cutovers Jul 31. Two's August rows are dropped (after its cutover)
    // and Three's history starts in September.
    const one = acct('c1', 'Card one', 'manual', null);
    const two = acct('c2', 'Card two', 'manual', null);
    const three = acct('c3', 'Card three', 'plaid', 'item-1');
    const rows = [
      tx('a1', 'c1', '2026-06-10', 300),
      tx('a2', 'c1', '2026-07-10', 300),
      tx('b1', 'c2', '2026-07-05', 1),
      tx('b2', 'c2', '2026-08-05', 300),
      tx('b3', 'c2', '2026-08-15', 300),
      tx('b4', 'c2', '2026-08-25', 300),
      tx('c1r', 'c3', '2026-09-05', 300),
      tx('c2r', 'c3', '2026-09-25', 300),
    ];
    const links = [
      { predecessorAccountId: 'c1', successorAccountId: 'c2', cutoverDate: '2026-07-31' },
      { predecessorAccountId: 'c2', successorAccountId: 'c3', cutoverDate: '2026-07-31' },
    ];
    const a = answerFor([one, two, three], rows, links, { kind: 'spend_compare', currentYm: '2026-08', baselineYm: '2026-07', target: null });
    expect(a.headline).not.toMatch(/\$0\.00 in August/);
    expect(a.headline).toBe("I can't compare August 2026 with July 2026 yet — no account has complete records for both months.");
    expect(a.accountQuestions).toBeUndefined();
  });

  describe('critic cycle 4 — a trimmed card takes no word: two true "yes" answers never make a third record whole', () => {
    const SEP_VS_JUN = { kind: 'spend_compare', currentYm: '2026-09', baselineYm: '2026-06', target: null };
    const monthly = (id: string, acctId: string, months: string[]) =>
      months.flatMap((m) => [tx(`${id}${m}a`, acctId, `2026-${m}-10`, 300), tx(`${id}${m}b`, acctId, `2026-${m}-20`, 300)]);

    it('R1 — a chain one → two → three, both cut Jul 31; two ran to Aug 25, three began Oct 10', () => {
      const one = acct('A', 'Card one', 'manual', null);
      const two = acct('B', 'Card two', 'simplefin', null);
      const three = acct('C', 'Card three', 'plaid', 'item-1');
      const rows = [
        ...monthly('a', 'A', ['01', '02', '03', '04', '05', '06']),
        tx('a31', 'A', '2026-07-31', 300),
        ...monthly('b', 'B', ['02', '03', '04', '05', '06', '07']),
        tx('b25', 'B', '2026-08-25', 300),
        tx('c10', 'C', '2026-10-10', 300),
        tx('c20', 'C', '2026-10-20', 300),
      ];
      const links = [
        { predecessorAccountId: 'A', successorAccountId: 'B', cutoverDate: '2026-07-31' },
        { predecessorAccountId: 'B', successorAccountId: 'C', cutoverDate: '2026-07-31' },
      ];
      const words = { A: { end: '2026-07-31' }, C: { start: '2026-10-10' } };
      const a = answerFor([one, two, three], rows, links, SEP_VS_JUN, { today: '2026-11-02', words });
      expect(a.headline).not.toMatch(/\$0\.00 in September/);
      expect(a.headline).toBe("I can't compare September 2026 with June 2026 yet — no account has complete records for both months.");
      expect(a.accountQuestions).toBeUndefined();
    });

    it('R2 — fan-in: two old records of one card into a third; the same answer whichever sibling began first', () => {
      for (const bridgeFirst of ['03', '01']) {
        const typed = acct('T', 'Visa (typed)', 'manual', null);
        const bridge = acct('S', 'Visa (bridge)', 'simplefin', null);
        const plaid = acct('P', 'Visa', 'plaid', 'item-1');
        const rows = [
          ...monthly('t', 'T', ['02', '03', '04', '05', '06']),
          tx('t31', 'T', '2026-07-31', 300),
          tx('s0', 'S', `2026-${bridgeFirst}-05`, 300),
          ...monthly('s', 'S', ['04', '05', '06', '07']),
          tx('s25', 'S', '2026-08-25', 300),
          tx('p10', 'P', '2026-10-10', 300),
        ];
        const links = [
          { predecessorAccountId: 'T', successorAccountId: 'P', cutoverDate: '2026-07-31' },
          { predecessorAccountId: 'S', successorAccountId: 'P', cutoverDate: '2026-07-31' },
        ];
        const words = { T: { end: '2026-07-31' }, P: { start: '2026-10-10' } };
        const a = answerFor([typed, bridge, plaid], rows, links, SEP_VS_JUN, { today: '2026-11-02', words });
        expect(a.headline, bridgeFirst).toBe("I can't compare September 2026 with June 2026 yet — no account has complete records for both months.");
        expect(a.accountQuestions, bridgeFirst).toBeUndefined();
      }
    });

    it('R3 — the end edge: one "yes" about the typed record does not vouch for the bridge that ran on after it', () => {
      const typed = acct('T', 'Visa (typed)', 'manual', null);
      const bridge = acct('S', 'Visa (bridge)', 'simplefin', null);
      const plaid = acct('P', 'Visa', 'plaid', 'item-1');
      const rows = [
        ...monthly('t', 'T', ['02', '03', '04', '05', '06', '07']),
        tx('t10', 'T', '2026-08-10', 300),
        ...monthly('s', 'S', ['03', '04', '05', '06', '07']),
        tx('s25', 'S', '2026-08-25', 300),
      ];
      const links = [
        { predecessorAccountId: 'T', successorAccountId: 'P', cutoverDate: '2026-08-10' },
        { predecessorAccountId: 'S', successorAccountId: 'P', cutoverDate: '2026-07-31' },
      ];
      const a = answerFor([typed, bridge, plaid], rows, links, SEP_VS_JUN, { words: { T: { end: '2026-08-10' } } });
      expect(a.headline).not.toMatch(/\$0\.00 in September/);
      expect(a.accountQuestions).toBeUndefined();
    });

    it('a card whose every spending row the boundary dropped is still named (P2-3)', () => {
      const old = acct('O', 'Freedom (old)', 'manual', null);
      const fresh = acct('N', 'Freedom', 'plaid', 'item-1');
      const plain = acct('K', 'Checking', 'plaid', 'item-1');
      const rows = [
        tx('o0', 'O', '2026-02-01', 1),
        ...monthly('o', 'O', ['02', '03', '04', '05', '06', '07', '08', '09']),
        ...monthly('k', 'K', ['06', '07', '08', '09']),
      ];
      // Cut at its own first row: the boundary keeps only that day of it.
      const links = [{ predecessorAccountId: 'O', successorAccountId: 'N', cutoverDate: '2026-02-01' }];
      const a = answerFor([old, fresh, plain], rows, links, { kind: 'spend_compare', currentYm: '2026-09', baselineYm: '2026-08', target: null });
      expect(a.detail).toContain('Freedom');
      expect(a.detail).not.toContain('on the 1 account you spend from');
    });

    it('an account whose only rows are future-dated is not counted as complete (P2-4)', () => {
      const plain = acct('K', 'Checking', 'plaid', 'item-1');
      const fresh = acct('F', 'New Card', 'manual', null);
      const rows = [...monthly('k', 'K', ['07', '08', '09']), tx('f1', 'F', '2026-12-01', 40)];
      const a = answerFor([plain, fresh], rows, [], { kind: 'spend_compare', currentYm: '2026-09', baselineYm: '2026-08', target: null });
      expect(a.detail).toContain('New Card (no spending on record in either month; no transactions on record yet)');
      expect(a.headline).toMatch(/^On the 1 account with complete records/);
    });
  });
});
