/**
 * Reconciliation boundary engine (TASKS Wave 4.6 slice 3) — pure known-answer tests.
 * Hand-verified fixture: docs/EDGE_CASES.md §Reconciliation-Boundary.
 *
 *   R1 — half-open date split: predecessor owns date <= cutover, successor owns
 *        date > cutover; exactly one side owns each date (no overlap, no gap).
 *   R2 — predecessor balance contributes 0; successor + bystanders untouched.
 *   R7 — a link with a missing side is inert (both remaining rows count fully).
 *   R8 — no effective links ⇒ the EXACT input references (golden byte-identity
 *        is structural, not incidental).
 *
 * Inertness cases are the majority on purpose (docs/lessons/
 * context-carrying-features-must-abstain.md): every malformed link must change
 * NOTHING, because "inert" here means "today's behavior", never a dropped figure.
 */
import { describe, expect, it } from 'vitest';
import {
  applyReconciliationBoundary,
  collapseHandoverDuplicates,
  effectiveReconciliationLinks,
  isCarriedForwardSnapshot,
  type ReconciliationLinkLike,
} from '@/lib/engine/account/reconcile-boundary';
import { netWorthSeries } from '@/lib/engine/networth/series';

// ─── the EDGE_CASES fixture ─────────────────────────────────────────────────

const PRED = { id: 'pred', name: 'Pred', type: 'CHECKING', currentBalanceCents: 240_000, availableBalanceCents: 239_000, feedDroppedAt: null };
const SUCC = { id: 'succ', name: 'Succ', type: 'CHECKING', currentBalanceCents: 250_000, availableBalanceCents: 251_000, feedDroppedAt: null };
const OTHER = { id: 'other', name: 'Other', type: 'SAVINGS', currentBalanceCents: 100_000, availableBalanceCents: null, feedDroppedAt: null };
const ACCOUNTS = [PRED, SUCC, OTHER];

const LINK: ReconciliationLinkLike = {
  predecessorAccountId: 'pred',
  successorAccountId: 'succ',
  cutoverDate: '2026-06-30',
};

const TXNS = [
  { accountId: 'pred', date: '2026-06-29', amountCents: -1_000 }, // pred, before cutover → kept
  { accountId: 'pred', date: '2026-06-30', amountCents: -2_000 }, // pred, ON cutover → kept (R1 boundary)
  { accountId: 'pred', date: '2026-07-01', amountCents: -3_000 }, // pred, after → dropped
  { accountId: 'succ', date: '2026-06-30', amountCents: -4_000 }, // succ, ON cutover → dropped (pred owns it)
  { accountId: 'succ', date: '2026-07-01', amountCents: -5_000 }, // succ, after → kept
  { accountId: 'other', date: '2026-06-30', amountCents: -6_000 }, // bystander → always kept
];

const SNAPSHOTS = [
  { accountId: 'pred', date: '2026-06-30', balanceCents: 240_000, accountType: 'CHECKING' }, // kept
  { accountId: 'pred', date: '2026-07-31', balanceCents: 240_000, accountType: 'CHECKING' }, // dropped
  { accountId: 'succ', date: '2026-06-30', balanceCents: 249_000, accountType: 'CHECKING' }, // dropped
  { accountId: 'succ', date: '2026-07-31', balanceCents: 252_000, accountType: 'CHECKING' }, // kept
  { accountId: 'other', date: '2026-06-30', balanceCents: 100_000, accountType: 'CHECKING' }, // kept
];

// Slice 4 (R4/F6): statements are full-dropped for a predecessor; scheduled rows
// are re-keyed predecessor→successor. Both carry a stable `id`/`description` so a
// re-keyed row's IDENTITY (only its accountId changes) is checkable.
const STATEMENTS = [
  { id: 'st-pred', accountId: 'pred', cycleEnd: '2026-06-20', statementBalanceCents: 50_000 }, // dropped (R4)
  { id: 'st-succ', accountId: 'succ', cycleEnd: '2026-07-20', statementBalanceCents: 60_000 }, // kept
  { id: 'st-other', accountId: 'other', cycleEnd: '2026-06-20', statementBalanceCents: 0 }, // kept (bystander)
];
const SCHEDULED = [
  { accountId: 'pred', description: 'Paycheck', amountCents: 300_000, nextDate: '2026-07-15', cadence: 'BIWEEKLY' }, // re-keyed → succ
  { accountId: 'succ', description: 'Rent', amountCents: -200_000, nextDate: '2026-07-01', cadence: 'MONTHLY' }, // kept
  { accountId: 'other', description: 'Gym', amountCents: -5_000, nextDate: '2026-07-05', cadence: 'MONTHLY' }, // kept
];

function apply(links: ReconciliationLinkLike[], paymentAccountId: string | null = null) {
  return applyReconciliationBoundary({
    paymentAccountId,
    accounts: ACCOUNTS,
    transactions: TXNS,
    balanceSnapshots: SNAPSHOTS,
    statements: STATEMENTS,
    scheduled: SCHEDULED,
    links,
  });
}

describe('applyReconciliationBoundary — the money core', () => {
  it('R1: half-open split — the handover DAY is released to both sides, every earlier day is the predecessor’s alone', () => {
    const out = apply([LINK]);
    // U.13: the claim is [first, claimEnd) — exclusive at the end. The successor's
    // 6/30 row is KEPT because the handover happens inside 6/30 and neither feed's
    // silence that day proves anything. Awarding the day either way silently loses
    // real money on the owner's corpus (u13a/u13b: $2,086.40 one way, $25,574.13
    // the other). 6/29 is strictly inside the claim and is still the predecessor's
    // alone — the release is ONE day, never a widened window.
    expect(out.transactions).toEqual([
      { accountId: 'pred', date: '2026-06-29', amountCents: -1_000 },
      { accountId: 'pred', date: '2026-06-30', amountCents: -2_000 },
      { accountId: 'succ', date: '2026-06-30', amountCents: -4_000 },
      { accountId: 'succ', date: '2026-07-01', amountCents: -5_000 },
      { accountId: 'other', date: '2026-06-30', amountCents: -6_000 },
    ]);
  });

  it('U.35: the assembler emits handover keys from the same spans as the keep', () => {
    const out = apply([LINK]);
    // Released day is min(cutover, pred last) = 2026-06-30. Both sides of the
    // pair, not the bystander on the same calendar day.
    expect([...out.handoverKeys].sort()).toEqual(['pred|2026-06-30', 'succ|2026-06-30']);
  });

  it('R1: no gap ever, and the ONLY doubled date is the handover day (union check)', () => {
    const out = apply([LINK]);
    const pairRows = out.transactions.filter((t) => t.accountId !== 'other');
    const dates = pairRows.map((t) => t.date).sort();
    // NO GAP — the half that prevents a silent loss: every date either side had
    // activity on survives somewhere in the output.
    const inputDates = [...new Set(TXNS.filter((t) => t.accountId !== 'other').map((t) => t.date))].sort();
    expect([...new Set(dates)]).toEqual(inputDates);
    // BOUNDED OVERLAP — at most one date may appear from both sides, and it must be
    // the claim end (min(cutover, predecessor's last row) = 2026-06-30). This is the
    // assertion that would catch a release that widened beyond the handover day.
    const doubled = [...new Set(dates.filter((d, i) => dates.indexOf(d) !== i))];
    expect(doubled).toEqual(['2026-06-30']);
    // Hand-verified pair total (EDGE_CASES): −1000 −2000 −4000 −5000 = −12000.
    // The 6/30 date now carries BOTH feeds' rows: a visible, advisory-covered
    // double (accounts-list.tsx already tells the reader this can happen at the
    // boundary), which this engine prefers to a silent loss.
    expect(pairRows.reduce((s, t) => s + t.amountCents, 0)).toBe(-12_000);
  });

  it('R2: predecessor balance contributes 0 (current AND available); successor + bystander keep identity', () => {
    const out = apply([LINK]);
    const pred = out.accounts.find((a) => a.id === 'pred')!;
    expect(pred.currentBalanceCents).toBe(0);
    expect(pred.availableBalanceCents).toBe(0);
    // Untouched rows are the SAME objects — golden safety by construction.
    expect(out.accounts.find((a) => a.id === 'succ')).toBe(SUCC);
    expect(out.accounts.find((a) => a.id === 'other')).toBe(OTHER);
    // Hand-verified: 0 + 250_000 + 100_000 = 350_000 (pre-fix double-count: 590_000).
    expect(out.accounts.reduce((s, a) => s + a.currentBalanceCents, 0)).toBe(350_000);
  });

  it('R2 composed with the real series engine: live point counts the successor only, history splits at the cutover', () => {
    const out = apply([LINK]);
    const series = netWorthSeries({
      snapshots: out.balanceSnapshots,
      accounts: out.accounts,
      today: '2026-08-15',
    });
    // 2026-06-30: pred 240_000 + other 100_000 (succ's same-day snapshot dropped — pred owns the date).
    expect(series.find((p) => p.date === '2026-06-30')?.netWorthCents).toBe(340_000);
    // 2026-07-31: succ 252_000 only (pred's post-cutover snapshot dropped).
    expect(series.find((p) => p.date === '2026-07-31')?.netWorthCents).toBe(252_000);
    // Live point: 0 + 250_000 + 100_000.
    expect(series.find((p) => p.date === '2026-08-15')?.netWorthCents).toBe(350_000);
  });

  it('balance snapshots obey the same half-open rule as transactions', () => {
    const out = apply([LINK]);
    // The boundary FILTERS rows; it never rewrites one. So the recorded class
    // (U.6) rides through untouched — which is what lets a surviving row keep
    // signing itself by what it was read under.
    expect(out.balanceSnapshots).toEqual([
      { accountId: 'pred', date: '2026-06-30', balanceCents: 240_000, accountType: 'CHECKING' },
      { accountId: 'succ', date: '2026-07-31', balanceCents: 252_000, accountType: 'CHECKING' },
      { accountId: 'other', date: '2026-06-30', balanceCents: 100_000, accountType: 'CHECKING' },
    ]);
  });

  it('remaps a superseded paymentAccountId to its successor; leaves any other id alone', () => {
    expect(apply([LINK], 'pred').paymentAccountId).toBe('succ');
    expect(apply([LINK], 'succ').paymentAccountId).toBe('succ');
    expect(apply([LINK], 'other').paymentAccountId).toBe('other');
    expect(apply([LINK], null).paymentAccountId).toBeNull();
  });

  it('chain A→B→C: B owns exactly the window (cutAB, cutBC]; payment designation follows to the terminal', () => {
    const A = { id: 'a', type: 'CHECKING', currentBalanceCents: 10_000, feedDroppedAt: null };
    const B = { id: 'b', type: 'CHECKING', currentBalanceCents: 20_000, feedDroppedAt: null };
    const C = { id: 'c', type: 'CHECKING', currentBalanceCents: 30_000, feedDroppedAt: null };
    const out = applyReconciliationBoundary({
      paymentAccountId: 'a',
      accounts: [A, B, C],
      transactions: [
        { accountId: 'a', date: '2026-03-31' }, // ≤ cutAB → kept
        { accountId: 'a', date: '2026-04-01' }, // > cutAB → dropped
        { accountId: 'b', date: '2026-03-31' }, // A's handover day → KEPT (U.13 release)
        { accountId: 'b', date: '2026-04-01' }, // in window → kept
        { accountId: 'b', date: '2026-06-30' }, // ON cutBC → kept
        { accountId: 'b', date: '2026-07-01' }, // > cutBC → dropped
        { accountId: 'c', date: '2026-06-30' }, // B's handover day → KEPT (U.13 release)
        { accountId: 'c', date: '2026-07-01' }, // > cutBC → kept
      ],
      balanceSnapshots: [],
      statements: [],
      scheduled: [],
      links: [
        { predecessorAccountId: 'a', successorAccountId: 'b', cutoverDate: '2026-03-31' },
        { predecessorAccountId: 'b', successorAccountId: 'c', cutoverDate: '2026-06-30' },
      ],
    });
    // U.13: each handover day is released to BOTH generations, so a chain has one
    // doubled date per link and no others. Every day strictly inside a claim is
    // still owned once — b:2026-04-01 is not doubled by a, c is not doubled by b.
    expect(out.transactions.map((t) => `${t.accountId}:${t.date}`)).toEqual([
      'a:2026-03-31',
      'b:2026-03-31',
      'b:2026-04-01',
      'b:2026-06-30',
      'c:2026-06-30',
      'c:2026-07-01',
    ]);
    // Both stale generations contribute 0; only the terminal live side counts.
    expect(out.accounts.map((a) => a.currentBalanceCents)).toEqual([0, 0, 30_000]);
    expect(out.paymentAccountId).toBe('c');
  });

  it('two predecessors → one successor: each predecessor claims only its own covered span', () => {
    const P1 = { id: 'p1', type: 'CHECKING', currentBalanceCents: 1_000, feedDroppedAt: null };
    const P2 = { id: 'p2', type: 'CHECKING', currentBalanceCents: 2_000, feedDroppedAt: null };
    const S = { id: 's', type: 'CHECKING', currentBalanceCents: 3_000, feedDroppedAt: null };
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [P1, P2, S],
      transactions: [
        { accountId: 's', date: '2026-04-01' }, // neither predecessor has data there → KEPT (F2 class)
        { accountId: 's', date: '2026-05-15' }, // STRICTLY inside P2's claim → dropped (P2 owns it)
        { accountId: 's', date: '2026-06-30' }, // P2's handover day → KEPT (U.13 release)
        { accountId: 's', date: '2026-07-01' }, // beyond both claims → kept
        { accountId: 'p1', date: '2026-03-31' }, // kept
        { accountId: 'p2', date: '2026-05-01' }, // P2's history starts here, so its claim is real
        { accountId: 'p2', date: '2026-06-30' }, // kept
      ],
      balanceSnapshots: [],
      statements: [],
      scheduled: [],
      links: [
        { predecessorAccountId: 'p1', successorAccountId: 's', cutoverDate: '2026-03-31' },
        { predecessorAccountId: 'p2', successorAccountId: 's', cutoverDate: '2026-06-30' },
      ],
    });
    // P2 now holds MULTI-DAY history [05-01, 06-30], so its claim [05-01, 06-30) is a real
    // window and `s:2026-05-15` inside it is dropped. This is the discriminating assertion:
    // the U.13 money critic proved the earlier one-day-each fixture had gone hollow — both
    // claims were empty, so DELETING EITHER LINK left the expected output unchanged and the
    // test asserted nothing about sibling composition. P1 keeps its single day on purpose,
    // so the two shapes sit side by side: a one-day predecessor de-duplicates nothing (its
    // only day is entirely a handover day), a multi-day one still owns its interior.
    expect(out.transactions.map((t) => `${t.accountId}:${t.date}`)).toEqual([
      's:2026-04-01',
      's:2026-06-30',
      's:2026-07-01',
      'p1:2026-03-31',
      'p2:2026-05-01',
      'p2:2026-06-30',
    ]);
    expect(out.accounts.map((a) => a.currentBalanceCents)).toEqual([0, 0, 3_000]);
    expect(out.supersededAccountIds).toEqual(['p1', 'p2']);
  });

  it('F2: the successor’s deeper backfill BEFORE the predecessor’s first transaction is never dropped', () => {
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: ACCOUNTS,
      transactions: [
        ...TXNS,
        { accountId: 'succ', date: '2024-11-05', amountCents: -120_000 }, // Plaid 24-mo backfill
        { accountId: 'succ', date: '2026-03-15', amountCents: -80_000 }, // before pred's first row (6/29)
      ],
      balanceSnapshots: [],
      statements: [],
      scheduled: [],
      links: [LINK],
    });
    const succDates = out.transactions.filter((t) => t.accountId === 'succ').map((t) => t.date);
    // 2026-06-30 is the handover day, released to both sides by U.13; the deep
    // backfill dates are the F2 property under test and are untouched by it.
    expect(succDates).toEqual(['2026-06-30', '2026-07-01', '2024-11-05', '2026-03-15']);
    // Total spend is the union, with the handover day's two rows both present.
    expect(out.transactions.reduce((s, t) => s + (t.amountCents ?? 0), 0)).toBe(
      -1_000 - 2_000 - 4_000 - 5_000 - 6_000 - 120_000 - 80_000,
    );
  });

  it('F4-by-construction: a cutover past the predecessor’s last data claims nothing extra', () => {
    // Pred's rows span [06-29, 07-01]; the user pushed the cutover to 07-15.
    // The successor's rows in (07-01, 07-15] have no predecessor counterpart and survive.
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: ACCOUNTS,
      transactions: [
        { accountId: 'pred', date: '2026-06-29', amountCents: -1_000 },
        { accountId: 'pred', date: '2026-07-01', amountCents: -3_000 },
        { accountId: 'succ', date: '2026-07-01', amountCents: -3_000 }, // claim END (pred's last row) → KEPT (U.13)
        { accountId: 'succ', date: '2026-07-10', amountCents: -9_000 }, // in the empty tail → KEPT
      ],
      balanceSnapshots: [],
      statements: [],
      scheduled: [],
      links: [{ ...LINK, cutoverDate: '2026-07-15' }],
    });
    // U.13: the claim END here is the predecessor's LAST row (07-01), not the
    // stored cutover — the feed stopped inside that day, so it is released.
    expect(out.transactions.map((t) => `${t.accountId}:${t.date}`)).toEqual([
      'pred:2026-06-29',
      'pred:2026-07-01',
      'succ:2026-07-01',
      'succ:2026-07-10',
    ]);
  });

  /**
   * test_regression__u13_handover_day_never_silently_drops_a_row
   *
   * The production shape, with the owner's real numbers (scripts/audit-probes/
   * u11c, u11i, u13a, u13b). The retired Schwab feed's LAST day was the cutover
   * 2026-07-21 and it reported exactly one row that day (−$11.00 Venmo). The live
   * Plaid feed reported that same Venmo AND a +$2,086.40 "Deposit Mobile Banking",
   * and the retired side holds no row of that amount on ANY date. Under the old
   * inclusive claim end the deposit was dropped from the register, budgets,
   * reports and the tax export, with nothing replacing it.
   *
   * FAIL-OLD: with `compareDates(d, claimEnd) <= 0` this test goes red on the
   * deposit assertion — the row is absent from the output entirely.
   */
  it('test_regression__u13_handover_day_never_silently_drops_a_row', () => {
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: ACCOUNTS,
      transactions: [
        { accountId: 'pred', date: '2026-07-20', amountCents: -621_707 }, // both feeds have it
        { accountId: 'succ', date: '2026-07-20', amountCents: -621_707 }, // inside the claim → dropped
        { accountId: 'pred', date: '2026-07-21', amountCents: -1_100 }, // the feed's last row
        { accountId: 'succ', date: '2026-07-21', amountCents: -1_100 }, // handover day → kept (visible double)
        { accountId: 'succ', date: '2026-07-21', amountCents: 208_640 }, // ONLY the live feed saw this
      ],
      balanceSnapshots: [],
      statements: [],
      scheduled: [],
      links: [{ ...LINK, cutoverDate: '2026-07-21' }],
    });
    const survived = out.transactions.map((t) => `${t.accountId}:${t.date}:${t.amountCents}`);
    // The money that was disappearing is present.
    expect(survived).toContain('succ:2026-07-21:208640');
    // The day BEFORE the handover is still de-duplicated — the release did not
    // widen into the claim, which is what keeps the double bounded to one day.
    expect(survived).not.toContain('succ:2026-07-20:-621707');
    expect(survived).toEqual([
      'pred:2026-07-20:-621707',
      'pred:2026-07-21:-1100',
      'succ:2026-07-21:-1100',
      'succ:2026-07-21:208640',
    ]);
    // Net effect on every spending surface: the $2,086.40 inflow is counted, and
    // the handover day's shared −$11.00 appears twice rather than the deposit
    // vanishing. −621707 −1100 −1100 +208640.
    expect(out.transactions.reduce((s, t) => s + (t.amountCents ?? 0), 0)).toBe(-415_267);
  });

  /**
   * test_regression__u13_handover_duplicates_collapse_for_cadence_detection
   *
   * The U.13 money critic executed these against the real `detectRecurring`: the released
   * handover day injects a 0-day gap, and because cadence is a median over gaps, two real
   * monthly sightings plus one duplicate became a fabricated BIWEEKLY series, a real
   * QUARTERLY bill was DESTROYED, and a BIWEEKLY $3,000.00 paycheck became WEEKLY income —
   * understating the shortfall, which this codebase names as the expensive direction. Those
   * series PERSIST into forecast and cash-needed.
   *
   * The collapse is what stops that, and it must stay narrow: same component, same date,
   * same amount, DIFFERENT accounts.
   */
  describe('test_regression__u13_handover_duplicates_collapse_for_cadence_detection', () => {
    const terminal = new Map([
      ['pred', 'succ'],
      ['sib', 'succ'],
    ]);
    const handover = new Set(['2026-07-01']);

    it('collapses one real charge reported by both sides of a handover into one occurrence', () => {
      const out = collapseHandoverDuplicates(
        [
          { accountId: 'pred', date: '2026-07-01', amountCents: -1_599 },
          { accountId: 'succ', date: '2026-07-01', amountCents: -1_599 },
        ],
        handover,
        terminal,
      );
      expect(out).toEqual([{ accountId: 'pred', date: '2026-07-01', amountCents: -1_599 }]);
    });

    it('NEVER collapses two genuine charges on the SAME account — a transaction is a flow', () => {
      // Two $5.00 coffees in a day are ordinary (the U.11 reasoning). Collapsing these
      // would be the silent loss U.13 exists to end, reintroduced by its own remedy.
      const out = collapseHandoverDuplicates(
        [
          { accountId: 'succ', date: '2026-07-01', amountCents: -500 },
          { accountId: 'succ', date: '2026-07-01', amountCents: -500 },
        ],
        handover,
        terminal,
      );
      expect(out).toHaveLength(2);
    });

    it('is a MULTISET match: three copies against two accounts keep the third', () => {
      const out = collapseHandoverDuplicates(
        [
          { accountId: 'pred', date: '2026-07-01', amountCents: -500 },
          { accountId: 'succ', date: '2026-07-01', amountCents: -500 },
          { accountId: 'succ', date: '2026-07-01', amountCents: -500 },
        ],
        handover,
        terminal,
      );
      expect(out).toHaveLength(2);
    });

    it('touches no date but a handover date, and no row outside the component', () => {
      const rows = [
        { accountId: 'pred', date: '2026-06-30', amountCents: -1_599 },
        { accountId: 'succ', date: '2026-06-30', amountCents: -1_599 },
        { accountId: 'other', date: '2026-07-01', amountCents: -1_599 },
        { accountId: 'succ', date: '2026-07-01', amountCents: -1_599 },
      ];
      // 'other' is its own component, so its row is not the successor's counterpart.
      expect(collapseHandoverDuplicates(rows, handover, terminal)).toEqual(rows);
    });

    it('is inert with no links at all (R8 golden path)', () => {
      const rows = [{ accountId: 'a', date: '2026-07-01', amountCents: -100 }];
      expect(collapseHandoverDuplicates(rows, new Set<string>(), new Map())).toEqual(rows);
    });
  });

  it('F3: a snapshot with no same-date counterpart is ALWAYS kept — no fabricated trend dip', () => {
    // Pred's month-end snapshots continue past the cutover (it stayed live until
    // disconnect); succ's first snapshot is a month later. Nothing collides → all kept.
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: ACCOUNTS,
      transactions: [],
      balanceSnapshots: [
        { accountId: 'pred', date: '2026-05-31', balanceCents: 238_000, accountType: 'CHECKING' },
        { accountId: 'pred', date: '2026-06-30', balanceCents: 240_000, accountType: 'CHECKING' }, // AFTER cutover 06-25, no succ copy → kept
        { accountId: 'succ', date: '2026-04-30', balanceCents: 230_000, accountType: 'CHECKING' }, // deep backfill, no pred copy → kept
        { accountId: 'succ', date: '2026-07-31', balanceCents: 252_000, accountType: 'CHECKING' },
      ],
      statements: [],
      scheduled: [],
      links: [{ ...LINK, cutoverDate: '2026-06-25' }],
    });
    expect(out.balanceSnapshots).toHaveLength(4);
    const series = netWorthSeries({
      snapshots: out.balanceSnapshots,
      accounts: out.accounts.filter((a) => a.id !== 'other'),
      today: '2026-08-15',
    });
    // The 06-30 point keeps the predecessor's real observed 240_000 — pre-fix this
    // dropped to 0 for the pair, a fabricated ~100% dip on the dashboard trend.
    expect(series.find((p) => p.date === '2026-06-30')?.netWorthCents).toBe(240_000);
  });

  it('F3: on an exact-date collision the cutover picks the winner — one contribution per date', () => {
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: ACCOUNTS,
      transactions: [],
      balanceSnapshots: [
        { accountId: 'pred', date: '2026-06-30', balanceCents: 240_000 }, // ≤ cutover, collision → pred wins
        { accountId: 'succ', date: '2026-06-30', balanceCents: 241_000 }, // dropped
        { accountId: 'pred', date: '2026-07-31', balanceCents: 240_000 }, // > cutover, collision → dropped
        { accountId: 'succ', date: '2026-07-31', balanceCents: 252_000 }, // succ wins
      ],
      statements: [],
      scheduled: [],
      links: [LINK],
    });
    expect(out.balanceSnapshots).toEqual([
      { accountId: 'pred', date: '2026-06-30', balanceCents: 240_000 },
      { accountId: 'succ', date: '2026-07-31', balanceCents: 252_000 },
    ]);
  });

  it('documented residual: inside the predecessor’s covered span, the predecessor is authoritative', () => {
    // A sparse (e.g. manual) predecessor claims its whole span [first, cutover]:
    // a successor row on a mid-span date the predecessor never recorded is dropped.
    // This is the deliberate no-fuzzy-matching tradeoff (EDGE_CASES §Reconciliation
    // boundary — residuals); the mitigation is choosing an early cutover.
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: ACCOUNTS,
      transactions: [
        { accountId: 'pred', date: '2026-05-01', amountCents: -1_000 },
        { accountId: 'pred', date: '2026-06-30', amountCents: -2_000 },
        { accountId: 'succ', date: '2026-06-01', amountCents: -7_000 }, // mid-span hole → dropped (pinned)
      ],
      balanceSnapshots: [],
      statements: [],
      scheduled: [],
      links: [LINK],
    });
    expect(out.transactions.map((t) => `${t.accountId}:${t.date}`)).toEqual([
      'pred:2026-05-01',
      'pred:2026-06-30',
    ]);
  });

  it('R4: a predecessor statement the successor already covers (older cycleEnd) is dropped; successor + bystander keep identity', () => {
    // st-pred cycleEnd 2026-06-20 <= st-succ's 2026-07-20 → the live successor owns that
    // cycle authoritatively, so the stale predecessor copy is dropped (no streak double).
    const out = apply([LINK]);
    expect(out.statements.map((s) => s.id)).toEqual(['st-succ', 'st-other']);
    // Untouched statement rows are the SAME objects (golden safety by construction).
    expect(out.statements[0]).toBe(STATEMENTS[1]);
    expect(out.statements[1]).toBe(STATEMENTS[2]);
  });

  it('R4 (CLAIM 2): a predecessor statement NEWER than the successor’s is RE-KEYED onto the successor', () => {
    // The live successor has not generated its own statement for the latest cycle yet
    // (a fresh reconnect on the estimate path): the predecessor's current statement must
    // survive AS the successor's, or the owed amount vanishes from the cash-needed headline.
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: ACCOUNTS,
      transactions: [],
      balanceSnapshots: [],
      statements: [
        { id: 'p-current', accountId: 'pred', cycleEnd: '2026-06-20' }, // newer than succ's → re-keyed
        { id: 's-old', accountId: 'succ', cycleEnd: '2026-05-20' }, // successor's own, older
      ],
      scheduled: [],
      links: [LINK],
    });
    expect(out.statements.map((s) => `${s.accountId}:${s.id}`).sort()).toEqual(['succ:p-current', 'succ:s-old']);
  });

  it('R4 (CLAIM 2): with NO successor statement, ALL predecessor statements re-key onto it', () => {
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: ACCOUNTS,
      transactions: [],
      balanceSnapshots: [],
      statements: [
        { id: 'p1', accountId: 'pred', cycleEnd: '2026-05-20' },
        { id: 'p2', accountId: 'pred', cycleEnd: '2026-06-20' },
      ],
      scheduled: [],
      links: [LINK],
    });
    expect(out.statements.map((s) => `${s.accountId}:${s.id}`)).toEqual(['succ:p1', 'succ:p2']);
  });

  it('F6: a predecessor’s scheduled rows are re-keyed to the successor; only accountId changes', () => {
    const out = apply([LINK]);
    // The paycheck moves pred→succ; every other field is preserved verbatim — the
    // forecast/radar/cash-needed filters (pinned to the successor) now find it.
    const paycheck = out.scheduled.find((s) => s.description === 'Paycheck')!;
    expect(paycheck).toEqual({
      accountId: 'succ',
      description: 'Paycheck',
      amountCents: 300_000,
      nextDate: '2026-07-15',
      cadence: 'BIWEEKLY',
    });
    // Successor + bystander rows keep identity (same object — never a re-key copy).
    expect(out.scheduled.find((s) => s.description === 'Rent')).toBe(SCHEDULED[1]);
    expect(out.scheduled.find((s) => s.description === 'Gym')).toBe(SCHEDULED[2]);
    // No row is dropped — re-keying never loses an income/bill.
    expect(out.scheduled).toHaveLength(3);
  });

  it('F6 chain A→B→C: a predecessor’s scheduled rows follow to the TERMINAL successor', () => {
    const A = { id: 'a', type: 'CHECKING', currentBalanceCents: 10_000, feedDroppedAt: null };
    const B = { id: 'b', type: 'CHECKING', currentBalanceCents: 20_000, feedDroppedAt: null };
    const C = { id: 'c', type: 'CHECKING', currentBalanceCents: 30_000, feedDroppedAt: null };
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [A, B, C],
      transactions: [],
      balanceSnapshots: [],
      statements: [
        { id: 'sa', accountId: 'a', cycleEnd: '2026-01-31' }, // older than C's → dropped on re-key
        { id: 'sb', accountId: 'b', cycleEnd: '2026-02-28' }, // older than C's → dropped on re-key
        { id: 'sc', accountId: 'c', cycleEnd: '2026-03-31' }, // terminal's own, newest → kept
      ],
      scheduled: [
        { accountId: 'a', description: 'Paycheck' },
        { accountId: 'b', description: 'Rent' },
        { accountId: 'c', description: 'Gym' },
      ],
      links: [
        { predecessorAccountId: 'a', successorAccountId: 'b', cutoverDate: '2026-03-31' },
        { predecessorAccountId: 'b', successorAccountId: 'c', cutoverDate: '2026-06-30' },
      ],
    });
    // Both A and B are predecessors → every scheduled row lands on C (terminal live side).
    expect(out.scheduled.map((s) => s.accountId)).toEqual(['c', 'c', 'c']);
    // Both A and B statements dropped; only C's survives (the terminal source of truth).
    expect(out.statements.map((s) => s.id)).toEqual(['sc']);
  });
});

describe('applyReconciliationBoundary — inertness (a bad link must change NOTHING)', () => {
  const NO_LINK_EXPECTATION = (out: ReturnType<typeof apply>) => {
    // Exact input references — not copies. Today's behavior, byte-identical.
    expect(out.accounts).toBe(ACCOUNTS);
    expect(out.transactions).toBe(TXNS);
    expect(out.balanceSnapshots).toBe(SNAPSHOTS);
    // R8 extends to the slice-4 families: no effective link → the SAME references,
    // so a demo/golden snapshot with no reconciliations is byte-identical.
    expect(out.statements).toBe(STATEMENTS);
    expect(out.scheduled).toBe(SCHEDULED);
    expect(out.handoverKeys.size).toBe(0);
  };

  it('R8: no links at all → the exact input references (golden fast path)', () => {
    const out = apply([]);
    NO_LINK_EXPECTATION(out);
    expect(out.paymentAccountId).toBeNull();
  });

  it('R7: predecessor side missing (deleted / currency-withheld) → inert', () => {
    NO_LINK_EXPECTATION(apply([{ ...LINK, predecessorAccountId: 'gone' }]));
  });

  it('R7: successor side missing → inert (the predecessor keeps counting fully — never a dropped figure)', () => {
    const out = apply([{ ...LINK, successorAccountId: 'gone' }]);
    NO_LINK_EXPECTATION(out);
    expect(out.accounts.find((a) => a.id === 'pred')!.currentBalanceCents).toBe(240_000);
  });

  it('degenerate self-link → inert', () => {
    NO_LINK_EXPECTATION(apply([{ ...LINK, successorAccountId: 'pred' }]));
  });

  it('cross-type link → inert (would sign-flip the predecessor’s series history)', () => {
    NO_LINK_EXPECTATION(apply([{ predecessorAccountId: 'pred', successorAccountId: 'other', cutoverDate: '2026-06-30' }]));
  });

  it('direction cycle A→B, B→A → BOTH links inert (never zero both sides of a real account)', () => {
    const out = apply([
      LINK,
      { predecessorAccountId: 'succ', successorAccountId: 'pred', cutoverDate: '2026-07-10' },
    ]);
    NO_LINK_EXPECTATION(out);
    // The cardinal-sin check spelled out: neither balance was dropped.
    expect(out.accounts.find((a) => a.id === 'pred')!.currentBalanceCents).toBe(240_000);
    expect(out.accounts.find((a) => a.id === 'succ')!.currentBalanceCents).toBe(250_000);
  });

  it('a cycle does not poison an unrelated valid link', () => {
    const X = { id: 'x', type: 'CREDIT', currentBalanceCents: 40_000, feedDroppedAt: null };
    const Y = { id: 'y', type: 'CREDIT', currentBalanceCents: 41_000, feedDroppedAt: null };
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [...ACCOUNTS, X, Y],
      transactions: TXNS,
      balanceSnapshots: [],
      statements: [],
      scheduled: [],
      links: [
        LINK,
        { predecessorAccountId: 'succ', successorAccountId: 'pred', cutoverDate: '2026-07-10' }, // cycle with LINK
        { predecessorAccountId: 'x', successorAccountId: 'y', cutoverDate: '2026-06-30' }, // independent, valid
      ],
    });
    expect(out.accounts.find((a) => a.id === 'pred')!.currentBalanceCents).toBe(240_000); // cycle inert
    expect(out.accounts.find((a) => a.id === 'x')!.currentBalanceCents).toBe(0); // valid link applied
    expect(out.accounts.find((a) => a.id === 'y')!.currentBalanceCents).toBe(41_000);
  });
});

describe('effectiveReconciliationLinks — the shared effectiveness rule', () => {
  it('keeps a well-formed link and reports it verbatim', () => {
    expect(effectiveReconciliationLinks(ACCOUNTS, [LINK])).toEqual([LINK]);
  });
  it('drops missing-side, self, cross-type, and cycle links', () => {
    expect(
      effectiveReconciliationLinks(ACCOUNTS, [
        { ...LINK, predecessorAccountId: 'gone' },
        { ...LINK, successorAccountId: 'pred' },
        { predecessorAccountId: 'pred', successorAccountId: 'other', cutoverDate: '2026-06-30' },
      ]),
    ).toEqual([]);
    expect(
      effectiveReconciliationLinks(ACCOUNTS, [
        LINK,
        { predecessorAccountId: 'succ', successorAccountId: 'pred', cutoverDate: '2026-07-10' },
      ]),
    ).toEqual([]);
  });
});

// ─── Slice 6 (full-surface hostile critic): chains, siblings, and read guards ─

describe('slice-6 chain composition (critics A-F1/A-F4/A-F6/A-F8, B-F4)', () => {
  // Chain fixture: A (SimpleFIN, dead) → B (reconnect, dead) → C (Plaid, live).
  // Monotone cutovers: cutAB 2026-03-31 <= cutBC 2026-06-30.
  const A = { id: 'a', type: 'CHECKING', currentBalanceCents: 100_000, feedDroppedAt: null };
  const B = { id: 'b', type: 'CHECKING', currentBalanceCents: 110_000, feedDroppedAt: null };
  const C = { id: 'c', type: 'CHECKING', currentBalanceCents: 120_000, feedDroppedAt: null };
  const CHAIN: ReconciliationLinkLike[] = [
    { predecessorAccountId: 'a', successorAccountId: 'b', cutoverDate: '2026-03-31' },
    { predecessorAccountId: 'b', successorAccountId: 'c', cutoverDate: '2026-06-30' },
  ];
  const chainApply = (over: {
    transactions?: { accountId: string; date: string; amountCents: number }[];
    balanceSnapshots?: { accountId: string; date: string; balanceCents: number }[];
    statements?: { id: string; accountId: string; cycleEnd: string; statementBalanceCents: number }[];
  }) =>
    applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [A, B, C],
      transactions: over.transactions ?? [],
      balanceSnapshots: over.balanceSnapshots ?? [],
      statements: over.statements ?? [],
      scheduled: [],
      links: CHAIN,
    });

  it('A-F1: the terminal successor is excluded by the GRAND-predecessor claim, not just the direct one', () => {
    // A claims [2026-01-15, 2026-03-31]. C (deep Plaid backfill) re-imports a purchase
    // dated 2026-02-10 that A already holds — outside B claim, inside A claim.
    const out = chainApply({
      transactions: [
        { accountId: 'a', date: '2026-01-15', amountCents: -1_000 },
        { accountId: 'a', date: '2026-02-10', amountCents: -5_000 },
        { accountId: 'a', date: '2026-03-31', amountCents: -1_000 },
        { accountId: 'b', date: '2026-04-15', amountCents: -1_000 },
        { accountId: 'c', date: '2026-02-10', amountCents: -5_000 }, // A's claim — dropped
        { accountId: 'c', date: '2026-07-01', amountCents: -1_000 },
      ],
    });
    const keys = out.transactions.map((t) => `${t.accountId}:${t.date}:${t.amountCents}`);
    expect(keys).toEqual([
      'a:2026-01-15:-1000',
      'a:2026-02-10:-5000',
      'a:2026-03-31:-1000',
      'b:2026-04-15:-1000',
      'c:2026-07-01:-1000',
    ]);
    // The $50 purchase contributes once (pre-fix: twice, -10 000 cents).
    expect(out.transactions.filter((t) => t.amountCents === -5_000)).toHaveLength(1);
  });

  it('A-F1 control: C backfill BEFORE every claim is still kept (deep history never dropped)', () => {
    const out = chainApply({
      transactions: [
        { accountId: 'a', date: '2026-01-15', amountCents: -1_000 },
        { accountId: 'c', date: '2025-06-01', amountCents: -7_000 }, // pre-A backfill → kept
      ],
    });
    expect(out.transactions.some((t) => t.accountId === 'c' && t.date === '2025-06-01')).toBe(true);
  });

  it('A-F4: a grand-pair same-date snapshot collision keeps exactly one copy (the authoritative side)', () => {
    // B has NO snapshot on the date — the direct-only check saw no collision at all.
    const out = chainApply({
      balanceSnapshots: [
        { accountId: 'a', date: '2026-02-28', balanceCents: 100_000 },
        { accountId: 'c', date: '2026-02-28', balanceCents: 100_000 },
      ],
    });
    // 02-28 <= cutAB → A is authoritative; C's copy drops. One contribution (pre-fix: 200 000 cents).
    expect(out.balanceSnapshots).toEqual([{ accountId: 'a', date: '2026-02-28', balanceCents: 100_000 }]);
  });

  it('A-F4 control: after the elder cutover the DOWNSTREAM side wins the collision', () => {
    const out = chainApply({
      balanceSnapshots: [
        { accountId: 'a', date: '2026-05-15', balanceCents: 90_000 }, // > cutAB, C has the date → drops
        { accountId: 'c', date: '2026-05-15', balanceCents: 91_000 },
      ],
    });
    expect(out.balanceSnapshots).toEqual([{ accountId: 'c', date: '2026-05-15', balanceCents: 91_000 }]);
  });

  it('A-F4 control: a lone observation is never dropped anywhere in the chain', () => {
    const out = chainApply({
      balanceSnapshots: [{ accountId: 'a', date: '2026-05-15', balanceCents: 90_000 }],
    });
    expect(out.balanceSnapshots).toHaveLength(1);
  });

  it('A-F6: two chain generations re-keying the SAME cycle produce ONE statement on the terminal successor', () => {
    // C has no statements of its own; A and B both carry the 2026-02-28 real cycle.
    const out = chainApply({
      statements: [
        { id: 'sa', accountId: 'a', cycleEnd: '2026-02-28', statementBalanceCents: 40_000 },
        { id: 'sb', accountId: 'b', cycleEnd: '2026-02-28', statementBalanceCents: 40_000 },
      ],
    });
    // B's cutover (06-30) is later than A's (03-31) → B's copy (most recent provider) wins.
    expect(out.statements).toEqual([{ id: 'sb', accountId: 'c', cycleEnd: '2026-02-28', statementBalanceCents: 40_000 }]);
  });

  it('A-F6 siblings: two predecessors of ONE successor re-keying the same cycle keep one copy, order-independent', () => {
    const S1 = { id: 'p1', type: 'CREDIT', currentBalanceCents: -50_000, feedDroppedAt: null };
    const S2 = { id: 'p2', type: 'CREDIT', currentBalanceCents: -50_000, feedDroppedAt: null };
    const LIVE = { id: 'live', type: 'CREDIT', currentBalanceCents: -50_000, feedDroppedAt: null };
    const links: ReconciliationLinkLike[] = [
      { predecessorAccountId: 'p1', successorAccountId: 'live', cutoverDate: '2026-06-30' },
      { predecessorAccountId: 'p2', successorAccountId: 'live', cutoverDate: '2026-06-15' },
    ];
    const stmts = [
      { id: 'sp1', accountId: 'p1', cycleEnd: '2026-06-20', statementBalanceCents: 50_000 },
      { id: 'sp2', accountId: 'p2', cycleEnd: '2026-06-20', statementBalanceCents: 50_000 },
    ];
    for (const order of [stmts, [...stmts].reverse()]) {
      const out = applyReconciliationBoundary({
        paymentAccountId: null,
        accounts: [S1, S2, LIVE],
        transactions: [],
        balanceSnapshots: [],
        statements: order,
        scheduled: [],
        links,
      });
      // p1's cutover (06-30) is the latest → its copy wins in BOTH input orders.
      expect(out.statements.map((s) => `${s.accountId}:${s.id}`)).toEqual(['live:sp1']);
    }
  });

  it('A-F8: a cutover BEFORE the predecessor first transaction goes claim-inert — nothing is erased', () => {
    // Unreachable via confirm (bounded >= first txn) but reachable by deleting the
    // predecessor's earliest manual row afterward. Pre-fix: EVERY pred row dropped
    // with no successor copies — silent total erasure. Now: pred keeps everything
    // (visible, advisory-covered double at worst); balance still zeroed.
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [A, B],
      transactions: [
        { accountId: 'a', date: '2026-05-01', amountCents: -1_000 },
        { accountId: 'a', date: '2026-06-01', amountCents: -2_000 },
      ],
      balanceSnapshots: [],
      statements: [],
      scheduled: [],
      links: [{ predecessorAccountId: 'a', successorAccountId: 'b', cutoverDate: '2026-03-31' }],
    });
    expect(out.transactions).toHaveLength(2);
    expect(out.accounts.find((a) => a.id === 'a')!.currentBalanceCents).toBe(0);
  });

  it('B-F4: a non-monotone chain link (racing-commit shape) is INERT at read time — never a double-window', () => {
    // Downstream cutover (03-01) EARLIER than upstream (03-31): refused at confirm, but a
    // Postgres race can commit it. The downstream link must drop; the upstream link stands.
    const bad: ReconciliationLinkLike[] = [
      { predecessorAccountId: 'a', successorAccountId: 'b', cutoverDate: '2026-03-31' },
      { predecessorAccountId: 'b', successorAccountId: 'c', cutoverDate: '2026-03-01' },
    ];
    expect(effectiveReconciliationLinks([A, B, C], bad)).toEqual([bad[0]]);
    // Monotone chain control: both kept.
    expect(effectiveReconciliationLinks([A, B, C], CHAIN)).toEqual(CHAIN);
  });
});

// ─── U.9: SIBLING predecessors of one successor (DECISIONS #453) ─────────────

/**
 * The shape `successorAccountId`'s non-uniqueness exists for: ONE real account
 * connected twice, both stale rows continued onto the live one (#274). Siblings
 * are neither `upstreamsOf` nor `downstreamsOf` each other, so every rule built
 * from those two walks compared each sibling ONLY against the successor and
 * never against its twin — and on a date both cutovers cover, both survived.
 *
 * A link asserts "these two rows are the same real account", so the assertion is
 * transitive: s1 ≡ live and s2 ≡ live means s1 ≡ s2. The whole connected
 * component is one account, and one account contributes ONE balance per date and
 * owns each transaction date exactly once.
 */
describe('U.9 sibling predecessors — one real account connected twice', () => {
  // The reproduction filed in STATUS.md §U.5: a single real $5,000.00 savings
  // account, connected through two dead feeds onto one live row.
  const S1 = { id: 's1', name: 'Savings (SimpleFIN)', type: 'SAVINGS', currentBalanceCents: 500_000, feedDroppedAt: null };
  const S2 = { id: 's2', name: 'Savings (Plaid old)', type: 'SAVINGS', currentBalanceCents: 500_000, feedDroppedAt: null };
  const LIVE = { id: 'live', name: 'Savings', type: 'SAVINGS', currentBalanceCents: 500_000, feedDroppedAt: null };
  // Deliberately DIFFERENT cutovers: the two feeds died on different days, and the
  // rule has to pick a winner per date rather than per pair.
  const CUT_S1 = '2026-04-30';
  const CUT_S2 = '2026-06-30';
  const SIBLINGS: ReconciliationLinkLike[] = [
    { predecessorAccountId: 's1', successorAccountId: 'live', cutoverDate: CUT_S1 },
    { predecessorAccountId: 's2', successorAccountId: 'live', cutoverDate: CUT_S2 },
  ];
  const sibApply = (over: {
    transactions?: { accountId: string; date: string; amountCents: number }[];
    balanceSnapshots?: { accountId: string; date: string; balanceCents: number; accountType?: string }[];
    links?: ReconciliationLinkLike[];
  }) =>
    applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [S1, S2, LIVE],
      transactions: over.transactions ?? [],
      balanceSnapshots: over.balanceSnapshots ?? [],
      statements: [],
      scheduled: [],
      links: over.links ?? SIBLINGS,
    });

  it('U.9: a date BOTH cutovers cover keeps ONE snapshot — $5,000.00 counts once, not twice', () => {
    // 2026-03-31 <= CUT_S1 <= CUT_S2, so both stale rows claim it and the live row
    // is dropped by both. Pre-fix: s1 AND s2 both survived → 1 000 000 cents.
    const out = sibApply({
      balanceSnapshots: [
        { accountId: 's1', date: '2026-03-31', balanceCents: 500_000, accountType: 'SAVINGS' },
        { accountId: 's2', date: '2026-03-31', balanceCents: 500_000, accountType: 'SAVINGS' },
        { accountId: 'live', date: '2026-03-31', balanceCents: 500_000, accountType: 'SAVINGS' },
      ],
    });
    expect(out.balanceSnapshots).toHaveLength(1);
    // Both sides are genuine (feedDroppedAt null). The EARLIEST cutover that
    // still covers the date is the authoritative side — U.12's genuineness
    // step is a no-op here, so this is still the chain's tightest-window rule
    // (A owns [..cutAB], B owns (cutAB..cutBC], C owns the rest).
    expect(out.balanceSnapshots[0]!.accountId).toBe('s1');

    // And the money figure the owner would actually read.
    const series = netWorthSeries({
      snapshots: out.balanceSnapshots.map((b) => ({
        accountId: b.accountId,
        date: b.date,
        balanceCents: b.balanceCents,
        accountType: 'SAVINGS' as string | null,
      })),
      accounts: out.accounts.map((a) => ({ ...a, name: [S1, S2, LIVE].find((x) => x.id === a.id)!.name })),
      today: '2026-07-31',
    });
    const point = series.find((p) => p.date === '2026-03-31')!;
    expect(point.netWorthCents).toBe(500_000); // pre-fix: 1 000 000
    expect(point.constituents).toHaveLength(1);
  });

  it('U.9: between the two cutovers the still-live feed wins — the expired twin does not add a second copy', () => {
    // 2026-05-15 is PAST s1 cutover and inside s2. The successor has no row that
    // date, which is exactly what hid this: s1 was only ever dropped when a
    // DOWNSTREAM copy existed, so with `live` silent both stale rows survived.
    const out = sibApply({
      balanceSnapshots: [
        { accountId: 's1', date: '2026-05-15', balanceCents: 500_000, accountType: 'SAVINGS' },
        { accountId: 's2', date: '2026-05-15', balanceCents: 500_000, accountType: 'SAVINGS' },
      ],
    });
    expect(out.balanceSnapshots).toEqual([
      { accountId: 's2', date: '2026-05-15', balanceCents: 500_000, accountType: 'SAVINGS' },
    ]);
  });

  it('U.9 control: a LONE observation is still never dropped — no fabricated dip', () => {
    // Only the expired twin observed this date. Dropping it would put a hole in the
    // trend where the app genuinely has a reading of the account (F3 doctrine).
    const out = sibApply({
      balanceSnapshots: [{ accountId: 's1', date: '2026-05-15', balanceCents: 500_000, accountType: 'SAVINGS' }],
    });
    expect(out.balanceSnapshots).toHaveLength(1);
    expect(out.balanceSnapshots[0]!.accountId).toBe('s1');
  });

  it('U.9 control: after BOTH cutovers the live row wins', () => {
    const out = sibApply({
      balanceSnapshots: [
        { accountId: 's1', date: '2026-07-31', balanceCents: 500_000, accountType: 'SAVINGS' },
        { accountId: 's2', date: '2026-07-31', balanceCents: 500_000, accountType: 'SAVINGS' },
        { accountId: 'live', date: '2026-07-31', balanceCents: 500_000, accountType: 'SAVINGS' },
      ],
    });
    expect(out.balanceSnapshots).toEqual([
      { accountId: 'live', date: '2026-07-31', balanceCents: 500_000, accountType: 'SAVINGS' },
    ]);
  });

  it('U.9: the winner is order-independent (link order and row order)', () => {
    const rows = [
      { accountId: 's1', date: '2026-03-31', balanceCents: 500_000, accountType: 'SAVINGS' },
      { accountId: 's2', date: '2026-03-31', balanceCents: 500_000, accountType: 'SAVINGS' },
    ];
    for (const links of [SIBLINGS, [...SIBLINGS].reverse()]) {
      for (const balanceSnapshots of [rows, [...rows].reverse()]) {
        const out = sibApply({ balanceSnapshots, links });
        expect(out.balanceSnapshots.map((b) => b.accountId)).toEqual(['s1']);
      }
    }
  });

  it('U.9 critic P0-1: a CHAIN whose two cutovers are equal is decided by chain position, NEVER by account id', () => {
    // Two links of one chain may legitimately share a cutover — the confirm action
    // refuses only a STRICTLY earlier downstream one, and both defaulting to today is
    // the ordinary way to get there. The mid account's window (cut..cut] is EMPTY, so
    // the upstream owns the date. Breaking the tie on id moved this point by $5,000.00
    // depending only on how two opaque cuids sorted — the same data, two answers.
    const CUT = '2026-06-30';
    const DATE = '2026-03-31';
    for (const upId of ['a-up', 'z-up']) {
      const accounts = [upId, 'm-mid', 'm-live'].map((id) => ({ id, type: 'CHECKING', currentBalanceCents: 0, feedDroppedAt: null }));
      const out = applyReconciliationBoundary({
        paymentAccountId: null,
        accounts,
        transactions: [],
        balanceSnapshots: [
          { accountId: upId, date: DATE, balanceCents: 400_000 },
          { accountId: 'm-mid', date: DATE, balanceCents: 900_000 },
        ],
        statements: [],
        scheduled: [],
        links: [
          { predecessorAccountId: upId, successorAccountId: 'm-mid', cutoverDate: CUT },
          { predecessorAccountId: 'm-mid', successorAccountId: 'm-live', cutoverDate: CUT },
        ],
      });
      // The upstream wins in BOTH id orders (pre-fix: 'z-up' lost to 'm-mid', $9,000.00).
      expect(out.balanceSnapshots.map((b) => b.accountId)).toEqual([upId]);
      expect(out.balanceSnapshots[0]!.balanceCents).toBe(400_000);
    }
  });

  it('U.9 critic P0-1: after an equal-cutover pair the DOWNSTREAM side wins instead', () => {
    // The mirror of the rule above: before a cutover the older side owns the date,
    // after it the newer one does. Depth breaks the tie in the opposite direction.
    const CUT = '2026-06-30';
    const DATE = '2026-08-31'; // past both
    const accounts = ['a-up', 'm-mid', 'm-live'].map((id) => ({ id, type: 'CHECKING', currentBalanceCents: 0, feedDroppedAt: null }));
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts,
      transactions: [],
      balanceSnapshots: [
        { accountId: 'a-up', date: DATE, balanceCents: 400_000 },
        { accountId: 'm-mid', date: DATE, balanceCents: 900_000 },
      ],
      statements: [],
      scheduled: [],
      links: [
        { predecessorAccountId: 'a-up', successorAccountId: 'm-mid', cutoverDate: CUT },
        { predecessorAccountId: 'm-mid', successorAccountId: 'm-live', cutoverDate: CUT },
      ],
    });
    expect(out.balanceSnapshots.map((b) => b.accountId)).toEqual(['m-mid']);
  });

  it('U.9 critic finding 3: a predecessor with TWO successors goes inert — never two survivors for one account', () => {
    // Unreachable from the database (`predecessorAccountId @unique`) and guarded here
    // anyway, because the component key's soundness depends on out-degree <= 1: without
    // the guard `chainMaps` keeps only the LAST edge, the other successor keys its own
    // component, and both survive — the U.9 defect through a different door.
    const p = { id: 'p', type: 'CHECKING', currentBalanceCents: 0, feedDroppedAt: null };
    const x = { id: 'x', type: 'CHECKING', currentBalanceCents: 0, feedDroppedAt: null };
    const y = { id: 'y', type: 'CHECKING', currentBalanceCents: 0, feedDroppedAt: null };
    const forked: ReconciliationLinkLike[] = [
      { predecessorAccountId: 'p', successorAccountId: 'x', cutoverDate: '2026-06-30' },
      { predecessorAccountId: 'p', successorAccountId: 'y', cutoverDate: '2026-06-30' },
    ];
    // Both links inert → the boundary changes nothing at all (R8 doctrine: an
    // ambiguous shape falls back to "everything counts fully", never to a wrong winner).
    expect(effectiveReconciliationLinks([p, x, y], forked)).toEqual([]);
    const rows = [
      { accountId: 'p', date: '2026-03-31', balanceCents: 10_000 },
      { accountId: 'x', date: '2026-03-31', balanceCents: 20_000 },
      { accountId: 'y', date: '2026-03-31', balanceCents: 40_000 },
    ];
    const out = applyReconciliationBoundary({
      paymentAccountId: null, accounts: [p, x, y], transactions: [],
      balanceSnapshots: rows, statements: [], scheduled: [], links: forked,
    });
    expect(out.balanceSnapshots).toBe(rows); // exact input reference — the R8 fast path
    // A well-formed sibling shape (two preds, ONE successor) is unaffected by the guard.
    expect(
      effectiveReconciliationLinks([p, x, y], [
        { predecessorAccountId: 'p', successorAccountId: 'y', cutoverDate: '2026-06-30' },
        { predecessorAccountId: 'x', successorAccountId: 'y', cutoverDate: '2026-06-30' },
      ]),
    ).toHaveLength(2);
  });

  it('U.9: equal cutovers tie-break deterministically by account id', () => {
    const sameDay: ReconciliationLinkLike[] = [
      { predecessorAccountId: 's1', successorAccountId: 'live', cutoverDate: CUT_S1 },
      { predecessorAccountId: 's2', successorAccountId: 'live', cutoverDate: CUT_S1 },
    ];
    const rows = [
      { accountId: 's1', date: '2026-03-31', balanceCents: 500_000, accountType: 'SAVINGS' },
      { accountId: 's2', date: '2026-03-31', balanceCents: 500_000, accountType: 'SAVINGS' },
    ];
    for (const balanceSnapshots of [rows, [...rows].reverse()]) {
      const out = sibApply({ balanceSnapshots, links: sameDay });
      expect(out.balanceSnapshots.map((b) => b.accountId)).toEqual(['s1']);
    }
  });

  /**
   * OPEN DEFECT (TASKS U.11), asserted as `it.fails` ON PURPOSE.
   *
   * This states the CORRECT answer — one real $50.00 purchase reported by both dead
   * feeds must contribute $50.00 — and declares that the engine does not yet give it
   * (today it contributes $100.00 to every spending surface). Written this way rather
   * than as a characterization asserting `-10_000`, because a test whose `expect` is
   * the wrong number teaches the next reader that the wrong number is intended, and a
   * slice's own test ratifying the defect it declined to fix is exactly how a bad
   * claim survives (docs/lessons/hiding-a-surface-reassigns-its-claims-by-certainty).
   * When U.11 lands, this test PASSES and vitest fails it as an unexpected pass —
   * forcing whoever fixes it to come here and promote it to a plain `it`.
   *
   * Why U.9 did not fix it too, being the same sibling blind spot: the F3 snapshot
   * rule is fixable with a PROOF, because a snapshot is a STOCK — one account has at
   * most one balance on a date, so a second row for that date is necessarily a
   * duplicate. A transaction is a FLOW: two $50.00 charges on one day are ordinary,
   * so "the twin also has this date" establishes nothing, and de-duplicating by CLAIM
   * SPAN instead would silently delete a row only one feed ever saw — inverting this
   * engine's stated failure direction (a visible, advisory-covered double, never a
   * silent loss). Choosing that direction needs its own evidence and its own critic.
   */
  it.fails('U.11 OPEN DEFECT: sibling feeds must count the same purchase once (currently twice)', () => {
    const out = sibApply({
      transactions: [
        { accountId: 's1', date: '2026-02-10', amountCents: -5_000 },
        { accountId: 's2', date: '2026-02-10', amountCents: -5_000 },
        { accountId: 'live', date: '2026-02-10', amountCents: -5_000 },
      ],
    });
    // The live row IS correctly dropped (both sibling claims cover the date). What
    // survives today is BOTH stale copies: -10 000.
    expect(out.transactions.reduce((s, t) => s + t.amountCents, 0)).toBe(-5_000);
  });

  it('U.9 transactions control: a row only ONE feed ever saw is never dropped', () => {
    const out = sibApply({
      transactions: [
        { accountId: 's1', date: '2026-02-10', amountCents: -5_000 },
        { accountId: 's2', date: '2026-02-11', amountCents: -7_000 },
      ],
    });
    expect(out.transactions.reduce((s, t) => s + t.amountCents, 0)).toBe(-12_000);
  });
});

/**
 * U.12 — a quiet feed's monthly echo must not outrank another record's real
 * reading for the same date. U.4 writes a BalanceSnapshot for every account
 * every month, including one whose feed went quiet; those later rows repeat
 * the last balance the bank actually sent. The U.9 ranker picked by cutover
 * alone, so the earliest still-covering window won even when that window's
 * row was a carried-forward repeat.
 *
 * Fail-old: on this fixture the pre-U.12 ranker returns s1 (earliest cutover)
 * and the trend reads $4,000.00. After: s2, $5,000.00.
 */
describe('U.12 — a genuine reading outranks a carried-forward repeat', () => {
  const S1 = {
    id: 's1',
    name: 'Savings (quiet)',
    type: 'SAVINGS',
    currentBalanceCents: 400_000,
    feedDroppedAt: '2026-01-15',
  };
  const S2 = {
    id: 's2',
    name: 'Savings (live reading)',
    type: 'SAVINGS',
    currentBalanceCents: 500_000,
    feedDroppedAt: null,
  };
  const LIVE = {
    id: 'live',
    name: 'Savings',
    type: 'SAVINGS',
    currentBalanceCents: 500_000,
    feedDroppedAt: null,
  };
  const LINKS: ReconciliationLinkLike[] = [
    { predecessorAccountId: 's1', successorAccountId: 'live', cutoverDate: '2026-02-28' },
    { predecessorAccountId: 's2', successorAccountId: 'live', cutoverDate: '2026-06-30' },
  ];
  const u12Apply = (
    accounts: { id: string; type: string; currentBalanceCents: number; feedDroppedAt: string | null; name: string }[],
    snapshots: { accountId: string; date: string; balanceCents: number; accountType?: string }[],
  ) =>
    applyReconciliationBoundary({
      paymentAccountId: null,
      accounts,
      transactions: [],
      balanceSnapshots: snapshots,
      statements: [],
      scheduled: [],
      links: LINKS,
    });

  it('isCarriedForwardSnapshot: the drop date itself is a reading, the next day is not', () => {
    expect(isCarriedForwardSnapshot('2026-01-15', '2026-01-15')).toBe(false);
    expect(isCarriedForwardSnapshot('2026-01-16', '2026-01-15')).toBe(true);
    expect(isCarriedForwardSnapshot('2026-01-16', null)).toBe(false);
  });

  it('U.12: on a date both windows cover, the genuine reading wins — $5,000.00, not the quiet feed’s $4,000.00 echo', () => {
    // 2026-01-31 is after s1 dropped (2026-01-15) and still inside both cutovers
    // (s1 2026-02-28, s2 2026-06-30). Pre-fix: earliest cutover → s1's repeat.
    const snapshots = [
      { accountId: 's1', date: '2026-01-31', balanceCents: 400_000, accountType: 'SAVINGS' },
      { accountId: 's2', date: '2026-01-31', balanceCents: 500_000, accountType: 'SAVINGS' },
    ];
    const out = u12Apply([S1, S2, LIVE], snapshots);
    expect(out.balanceSnapshots).toHaveLength(1);
    expect(out.balanceSnapshots[0]!.accountId).toBe('s2');
    expect(out.balanceSnapshots[0]!.balanceCents).toBe(500_000);

    const reversed = u12Apply([S1, S2, LIVE], [...snapshots].reverse());
    expect(reversed.balanceSnapshots[0]!.accountId).toBe('s2');

    const series = netWorthSeries({
      snapshots: out.balanceSnapshots.map((b) => ({
        accountId: b.accountId,
        date: b.date,
        balanceCents: b.balanceCents,
        accountType: 'SAVINGS' as string | null,
      })),
      accounts: out.accounts.map((a) => ({ ...a, name: [S1, S2, LIVE].find((x) => x.id === a.id)!.name })),
      today: '2026-07-31',
    });
    const point = series.find((p) => p.date === '2026-01-31')!;
    expect(point.netWorthCents).toBe(500_000);
    expect(point.constituents).toHaveLength(1);
  });

  it('U.12 control: both genuine — earliest covering cutover still wins (U.9 unchanged)', () => {
    const bothLive = [
      { ...S1, feedDroppedAt: null },
      S2,
      LIVE,
    ];
    const out = u12Apply(bothLive, [
      { accountId: 's1', date: '2026-01-31', balanceCents: 400_000, accountType: 'SAVINGS' },
      { accountId: 's2', date: '2026-01-31', balanceCents: 500_000, accountType: 'SAVINGS' },
    ]);
    expect(out.balanceSnapshots).toHaveLength(1);
    expect(out.balanceSnapshots[0]!.accountId).toBe('s1');
    expect(out.balanceSnapshots[0]!.balanceCents).toBe(400_000);
  });

  it('U.12 control: on the drop date itself s1 is still a reading, so earliest cutover wins', () => {
    const out = u12Apply([S1, S2, LIVE], [
      { accountId: 's1', date: '2026-01-15', balanceCents: 400_000, accountType: 'SAVINGS' },
      { accountId: 's2', date: '2026-01-15', balanceCents: 500_000, accountType: 'SAVINGS' },
    ]);
    expect(out.balanceSnapshots).toHaveLength(1);
    expect(out.balanceSnapshots[0]!.accountId).toBe('s1');
  });

  it('U.12 control: a lone carried-forward observation is never dropped', () => {
    const out = u12Apply([S1, S2, LIVE], [
      { accountId: 's1', date: '2026-01-31', balanceCents: 400_000, accountType: 'SAVINGS' },
    ]);
    expect(out.balanceSnapshots).toEqual([
      { accountId: 's1', date: '2026-01-31', balanceCents: 400_000, accountType: 'SAVINGS' },
    ]);
  });

  it('U.12 control: both carried-forward — earliest covering cutover still wins', () => {
    const bothQuiet = [
      S1,
      { ...S2, feedDroppedAt: '2026-01-10' },
      LIVE,
    ];
    const out = u12Apply(bothQuiet, [
      { accountId: 's1', date: '2026-01-31', balanceCents: 400_000, accountType: 'SAVINGS' },
      { accountId: 's2', date: '2026-01-31', balanceCents: 500_000, accountType: 'SAVINGS' },
    ]);
    expect(out.balanceSnapshots).toHaveLength(1);
    expect(out.balanceSnapshots[0]!.accountId).toBe('s1');
  });

  it('U.12: equal cutovers — genuineness outranks the id tiebreak', () => {
    // Same cutover, one quiet. Without genuineness this falls to account id and
    // s1 wins; with it the live reading must win regardless of id order.
    const equal: ReconciliationLinkLike[] = [
      { predecessorAccountId: 's1', successorAccountId: 'live', cutoverDate: '2026-02-28' },
      { predecessorAccountId: 's2', successorAccountId: 'live', cutoverDate: '2026-02-28' },
    ];
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [S1, S2, LIVE],
      transactions: [],
      balanceSnapshots: [
        { accountId: 's1', date: '2026-01-31', balanceCents: 400_000, accountType: 'SAVINGS' },
        { accountId: 's2', date: '2026-01-31', balanceCents: 500_000, accountType: 'SAVINGS' },
      ],
      statements: [],
      scheduled: [],
      links: equal,
    });
    expect(out.balanceSnapshots).toHaveLength(1);
    expect(out.balanceSnapshots[0]!.accountId).toBe('s2');
  });

  it('U.12: a quiet ancestor in a covering chain loses to the genuine mid-chain reading', () => {
    const A = { id: 'a', type: 'CHECKING', currentBalanceCents: 400_000, feedDroppedAt: '2026-01-15' };
    const B = { id: 'b', type: 'CHECKING', currentBalanceCents: 500_000, feedDroppedAt: null };
    const C = { id: 'c', type: 'CHECKING', currentBalanceCents: 600_000, feedDroppedAt: null };
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [A, B, C],
      transactions: [],
      balanceSnapshots: [
        { accountId: 'a', date: '2026-01-31', balanceCents: 400_000, accountType: 'CHECKING' },
        { accountId: 'b', date: '2026-01-31', balanceCents: 500_000, accountType: 'CHECKING' },
      ],
      statements: [],
      scheduled: [],
      links: [
        { predecessorAccountId: 'a', successorAccountId: 'b', cutoverDate: '2026-02-28' },
        { predecessorAccountId: 'b', successorAccountId: 'c', cutoverDate: '2026-06-30' },
      ],
    });
    expect(out.balanceSnapshots).toHaveLength(1);
    expect(out.balanceSnapshots[0]!.accountId).toBe('b');
    expect(out.balanceSnapshots[0]!.balanceCents).toBe(500_000);
  });

  it('U.12: a genuine CREDIT sibling wins and the series subtracts — −$5,000.00, not the echo', () => {
    const c1 = { ...S1, type: 'CREDIT', currentBalanceCents: 400_000 };
    const c2 = { ...S2, type: 'CREDIT', currentBalanceCents: 500_000 };
    const cLive = { ...LIVE, type: 'CREDIT', currentBalanceCents: 500_000 };
    const out = u12Apply([c1, c2, cLive], [
      { accountId: 's1', date: '2026-01-31', balanceCents: 400_000, accountType: 'CREDIT' },
      { accountId: 's2', date: '2026-01-31', balanceCents: 500_000, accountType: 'CREDIT' },
    ]);
    expect(out.balanceSnapshots[0]!.accountId).toBe('s2');
    const series = netWorthSeries({
      snapshots: out.balanceSnapshots.map((b) => ({
        accountId: b.accountId,
        date: b.date,
        balanceCents: b.balanceCents,
        accountType: 'CREDIT' as string | null,
      })),
      accounts: out.accounts.map((a) => ({ ...a, name: a.id })),
      today: '2026-07-31',
    });
    expect(series.find((p) => p.date === '2026-01-31')!.netWorthCents).toBe(-500_000);
  });
});

/**
 * U.37 — genuineness outranks U.9's tier order. U.12 only compared echoes
 * inside the covering tier, so two reachable shapes still preferred a repeat:
 *   (1) the common one-pred/one-succ pair: covering echo beats the live
 *       successor's real reading (terminal is always tier 1);
 *   (2) closed-tier inverse: latest-cutover echo beats an earlier-cutover
 *       genuine reading when the terminal has no row for that historical date.
 *
 * Fail-old: (1) returns pred / $4,000.00; (2) returns s2 / $4,000.00.
 */
describe('U.37 — a genuine reading outranks an echo across tiers', () => {
  it('U.37: a covering predecessor’s echo loses to the live successor’s real reading', () => {
    const pred = {
      id: 'pred',
      name: 'Savings (quiet)',
      type: 'SAVINGS',
      currentBalanceCents: 400_000,
      feedDroppedAt: '2026-01-15',
    };
    const succ = {
      id: 'succ',
      name: 'Savings',
      type: 'SAVINGS',
      currentBalanceCents: 500_000,
      feedDroppedAt: null,
    };
    const snapshots = [
      { accountId: 'pred', date: '2026-01-31', balanceCents: 400_000, accountType: 'SAVINGS' },
      { accountId: 'succ', date: '2026-01-31', balanceCents: 500_000, accountType: 'SAVINGS' },
    ];
    const apply = (rows: typeof snapshots) =>
      applyReconciliationBoundary({
        paymentAccountId: null,
        accounts: [pred, succ],
        transactions: [],
        balanceSnapshots: rows,
        statements: [],
        scheduled: [],
        links: [{ predecessorAccountId: 'pred', successorAccountId: 'succ', cutoverDate: '2026-02-28' }],
      });
    const out = apply(snapshots);
    expect(out.balanceSnapshots).toHaveLength(1);
    expect(out.balanceSnapshots[0]!.accountId).toBe('succ');
    expect(out.balanceSnapshots[0]!.balanceCents).toBe(500_000);
    expect(apply([...snapshots].reverse()).balanceSnapshots[0]!.accountId).toBe('succ');

    const series = netWorthSeries({
      snapshots: out.balanceSnapshots.map((b) => ({
        accountId: b.accountId,
        date: b.date,
        balanceCents: b.balanceCents,
        accountType: 'SAVINGS' as string | null,
      })),
      accounts: out.accounts.map((a) => ({ ...a, name: a.id })),
      today: '2026-07-31',
    });
    expect(series.find((p) => p.date === '2026-01-31')!.netWorthCents).toBe(500_000);
  });

  it('U.37 control: both genuine — the covering predecessor still beats the live successor (U.9 unchanged)', () => {
    const pred = {
      id: 'pred',
      type: 'SAVINGS',
      currentBalanceCents: 400_000,
      feedDroppedAt: null,
    };
    const succ = {
      id: 'succ',
      type: 'SAVINGS',
      currentBalanceCents: 500_000,
      feedDroppedAt: null,
    };
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [pred, succ],
      transactions: [],
      balanceSnapshots: [
        { accountId: 'pred', date: '2026-01-31', balanceCents: 400_000, accountType: 'SAVINGS' },
        { accountId: 'succ', date: '2026-01-31', balanceCents: 500_000, accountType: 'SAVINGS' },
      ],
      statements: [],
      scheduled: [],
      links: [{ predecessorAccountId: 'pred', successorAccountId: 'succ', cutoverDate: '2026-02-28' }],
    });
    expect(out.balanceSnapshots).toHaveLength(1);
    expect(out.balanceSnapshots[0]!.accountId).toBe('pred');
    expect(out.balanceSnapshots[0]!.balanceCents).toBe(400_000);
  });

  it('U.37: a later-cutover echo loses to an earlier-cutover genuine reading when the terminal has no row', () => {
    // 2026-07-31 is past both cutovers. LIVE has no snapshot (backdated combine
    // onto a successor that did not exist that month). Pre-fix: latest cutover
    // → s2's echo. After: s1's real reading.
    const s1 = {
      id: 's1',
      type: 'SAVINGS',
      currentBalanceCents: 500_000,
      feedDroppedAt: null,
    };
    const s2 = {
      id: 's2',
      type: 'SAVINGS',
      currentBalanceCents: 400_000,
      feedDroppedAt: '2026-01-15',
    };
    const live = {
      id: 'live',
      type: 'SAVINGS',
      currentBalanceCents: 600_000,
      feedDroppedAt: null,
    };
    const snapshots = [
      { accountId: 's1', date: '2026-07-31', balanceCents: 500_000, accountType: 'SAVINGS' },
      { accountId: 's2', date: '2026-07-31', balanceCents: 400_000, accountType: 'SAVINGS' },
    ];
    const apply = (rows: typeof snapshots) =>
      applyReconciliationBoundary({
        paymentAccountId: null,
        accounts: [s1, s2, live],
        transactions: [],
        balanceSnapshots: rows,
        statements: [],
        scheduled: [],
        links: [
          { predecessorAccountId: 's1', successorAccountId: 'live', cutoverDate: '2026-02-28' },
          { predecessorAccountId: 's2', successorAccountId: 'live', cutoverDate: '2026-06-30' },
        ],
      });
    const out = apply(snapshots);
    expect(out.balanceSnapshots).toHaveLength(1);
    expect(out.balanceSnapshots[0]!.accountId).toBe('s1');
    expect(out.balanceSnapshots[0]!.balanceCents).toBe(500_000);
    expect(apply([...snapshots].reverse()).balanceSnapshots[0]!.accountId).toBe('s1');
  });

  it('U.37 control: both closed and genuine — latest cutover still wins (U.9 unchanged)', () => {
    const s1 = { id: 's1', type: 'SAVINGS', currentBalanceCents: 500_000, feedDroppedAt: null };
    const s2 = { id: 's2', type: 'SAVINGS', currentBalanceCents: 400_000, feedDroppedAt: null };
    const live = { id: 'live', type: 'SAVINGS', currentBalanceCents: 600_000, feedDroppedAt: null };
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [s1, s2, live],
      transactions: [],
      balanceSnapshots: [
        { accountId: 's1', date: '2026-07-31', balanceCents: 500_000, accountType: 'SAVINGS' },
        { accountId: 's2', date: '2026-07-31', balanceCents: 400_000, accountType: 'SAVINGS' },
      ],
      statements: [],
      scheduled: [],
      links: [
        { predecessorAccountId: 's1', successorAccountId: 'live', cutoverDate: '2026-02-28' },
        { predecessorAccountId: 's2', successorAccountId: 'live', cutoverDate: '2026-06-30' },
      ],
    });
    expect(out.balanceSnapshots).toHaveLength(1);
    expect(out.balanceSnapshots[0]!.accountId).toBe('s2');
    expect(out.balanceSnapshots[0]!.balanceCents).toBe(400_000);
  });

  it('U.37: a covering echo loses to a closed-window genuine reading (no terminal row)', () => {
    const s1 = {
      id: 's1',
      type: 'SAVINGS',
      currentBalanceCents: 400_000,
      feedDroppedAt: '2026-01-15',
    };
    const s2 = {
      id: 's2',
      type: 'SAVINGS',
      currentBalanceCents: 450_000,
      feedDroppedAt: null,
    };
    const live = { id: 'live', type: 'SAVINGS', currentBalanceCents: 600_000, feedDroppedAt: null };
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [s1, s2, live],
      transactions: [],
      balanceSnapshots: [
        { accountId: 's1', date: '2026-03-31', balanceCents: 400_000, accountType: 'SAVINGS' },
        { accountId: 's2', date: '2026-03-31', balanceCents: 450_000, accountType: 'SAVINGS' },
      ],
      statements: [],
      scheduled: [],
      links: [
        { predecessorAccountId: 's1', successorAccountId: 'live', cutoverDate: '2026-06-30' },
        { predecessorAccountId: 's2', successorAccountId: 'live', cutoverDate: '2026-02-28' },
      ],
    });
    expect(out.balanceSnapshots).toHaveLength(1);
    expect(out.balanceSnapshots[0]!.accountId).toBe('s2');
    expect(out.balanceSnapshots[0]!.balanceCents).toBe(450_000);
  });

  it('U.37: a terminal echo loses to a closed-window genuine reading', () => {
    const s1 = {
      id: 's1',
      type: 'SAVINGS',
      currentBalanceCents: 500_000,
      feedDroppedAt: null,
    };
    const live = {
      id: 'live',
      type: 'SAVINGS',
      currentBalanceCents: 400_000,
      feedDroppedAt: '2026-01-15',
    };
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [s1, live],
      transactions: [],
      balanceSnapshots: [
        { accountId: 's1', date: '2026-07-31', balanceCents: 500_000, accountType: 'SAVINGS' },
        { accountId: 'live', date: '2026-07-31', balanceCents: 400_000, accountType: 'SAVINGS' },
      ],
      statements: [],
      scheduled: [],
      links: [{ predecessorAccountId: 's1', successorAccountId: 'live', cutoverDate: '2026-02-28' }],
    });
    expect(out.balanceSnapshots).toHaveLength(1);
    expect(out.balanceSnapshots[0]!.accountId).toBe('s1');
    expect(out.balanceSnapshots[0]!.balanceCents).toBe(500_000);
  });

  it('U.37: after an equal-cutover, a genuine ancestor outranks an echo mid-chain (U.9 depth would have picked the mid)', () => {
    const up = { id: 'a-up', type: 'CHECKING', currentBalanceCents: 500_000, feedDroppedAt: null };
    const mid = {
      id: 'm-mid',
      type: 'CHECKING',
      currentBalanceCents: 400_000,
      feedDroppedAt: '2026-01-15',
    };
    const term = { id: 'm-live', type: 'CHECKING', currentBalanceCents: 600_000, feedDroppedAt: null };
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [up, mid, term],
      transactions: [],
      balanceSnapshots: [
        { accountId: 'a-up', date: '2026-08-31', balanceCents: 500_000, accountType: 'CHECKING' },
        { accountId: 'm-mid', date: '2026-08-31', balanceCents: 400_000, accountType: 'CHECKING' },
      ],
      statements: [],
      scheduled: [],
      links: [
        { predecessorAccountId: 'a-up', successorAccountId: 'm-mid', cutoverDate: '2026-06-30' },
        { predecessorAccountId: 'm-mid', successorAccountId: 'm-live', cutoverDate: '2026-06-30' },
      ],
    });
    expect(out.balanceSnapshots).toHaveLength(1);
    expect(out.balanceSnapshots[0]!.accountId).toBe('a-up');
    expect(out.balanceSnapshots[0]!.balanceCents).toBe(500_000);
  });

  it('U.37: a genuine CREDIT predecessor’s echo loses and the series subtracts — −$5,000.00', () => {
    const pred = {
      id: 'pred',
      type: 'CREDIT',
      currentBalanceCents: 400_000,
      feedDroppedAt: '2026-01-15',
    };
    const succ = {
      id: 'succ',
      type: 'CREDIT',
      currentBalanceCents: 500_000,
      feedDroppedAt: null,
    };
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [pred, succ],
      transactions: [],
      balanceSnapshots: [
        { accountId: 'pred', date: '2026-01-31', balanceCents: 400_000, accountType: 'CREDIT' },
        { accountId: 'succ', date: '2026-01-31', balanceCents: 500_000, accountType: 'CREDIT' },
      ],
      statements: [],
      scheduled: [],
      links: [{ predecessorAccountId: 'pred', successorAccountId: 'succ', cutoverDate: '2026-02-28' }],
    });
    expect(out.balanceSnapshots[0]!.accountId).toBe('succ');
    const series = netWorthSeries({
      snapshots: out.balanceSnapshots.map((b) => ({
        accountId: b.accountId,
        date: b.date,
        balanceCents: b.balanceCents,
        accountType: 'CREDIT' as string | null,
      })),
      accounts: out.accounts.map((a) => ({ ...a, name: a.id })),
      today: '2026-07-31',
    });
    expect(series.find((p) => p.date === '2026-01-31')!.netWorthCents).toBe(-500_000);
  });

  it('U.37 control: a lone covering echo is still never dropped', () => {
    const pred = {
      id: 'pred',
      type: 'SAVINGS',
      currentBalanceCents: 400_000,
      feedDroppedAt: '2026-01-15',
    };
    const succ = {
      id: 'succ',
      type: 'SAVINGS',
      currentBalanceCents: 500_000,
      feedDroppedAt: null,
    };
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [pred, succ],
      transactions: [],
      balanceSnapshots: [{ accountId: 'pred', date: '2026-01-31', balanceCents: 400_000, accountType: 'SAVINGS' }],
      statements: [],
      scheduled: [],
      links: [{ predecessorAccountId: 'pred', successorAccountId: 'succ', cutoverDate: '2026-02-28' }],
    });
    expect(out.balanceSnapshots).toEqual([
      { accountId: 'pred', date: '2026-01-31', balanceCents: 400_000, accountType: 'SAVINGS' },
    ]);
  });
});
