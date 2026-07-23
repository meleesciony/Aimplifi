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
  effectiveReconciliationLinks,
  type ReconciliationLinkLike,
} from '@/lib/engine/account/reconcile-boundary';
import { netWorthSeries } from '@/lib/engine/networth/series';

// ─── the EDGE_CASES fixture ─────────────────────────────────────────────────

const PRED = { id: 'pred', type: 'CHECKING', currentBalanceCents: 240_000, availableBalanceCents: 239_000 };
const SUCC = { id: 'succ', type: 'CHECKING', currentBalanceCents: 250_000, availableBalanceCents: 251_000 };
const OTHER = { id: 'other', type: 'SAVINGS', currentBalanceCents: 100_000, availableBalanceCents: null };
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
  { accountId: 'pred', date: '2026-06-30', balanceCents: 240_000 }, // kept
  { accountId: 'pred', date: '2026-07-31', balanceCents: 240_000 }, // dropped
  { accountId: 'succ', date: '2026-06-30', balanceCents: 249_000 }, // dropped
  { accountId: 'succ', date: '2026-07-31', balanceCents: 252_000 }, // kept
  { accountId: 'other', date: '2026-06-30', balanceCents: 100_000 }, // kept
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
  it('R1: half-open split — predecessor owns the cutover date itself, successor owns strictly after', () => {
    const out = apply([LINK]);
    expect(out.transactions).toEqual([
      { accountId: 'pred', date: '2026-06-29', amountCents: -1_000 },
      { accountId: 'pred', date: '2026-06-30', amountCents: -2_000 },
      { accountId: 'succ', date: '2026-07-01', amountCents: -5_000 },
      { accountId: 'other', date: '2026-06-30', amountCents: -6_000 },
    ]);
  });

  it('R1: every pair-date is owned exactly once — no overlap, no gap (union check)', () => {
    const out = apply([LINK]);
    const pairRows = out.transactions.filter((t) => t.accountId !== 'other');
    // Each calendar date the pair has activity on appears exactly once in the output.
    const dates = pairRows.map((t) => t.date).sort();
    expect(dates).toEqual(['2026-06-29', '2026-06-30', '2026-07-01']);
    // Hand-verified pair total (EDGE_CASES): −1000 −2000 −5000 = −8000 —
    // the 6/30 date is counted from the predecessor ONLY and 7/01 from the successor ONLY.
    expect(pairRows.reduce((s, t) => s + t.amountCents, 0)).toBe(-8_000);
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
    expect(out.balanceSnapshots).toEqual([
      { accountId: 'pred', date: '2026-06-30', balanceCents: 240_000 },
      { accountId: 'succ', date: '2026-07-31', balanceCents: 252_000 },
      { accountId: 'other', date: '2026-06-30', balanceCents: 100_000 },
    ]);
  });

  it('remaps a superseded paymentAccountId to its successor; leaves any other id alone', () => {
    expect(apply([LINK], 'pred').paymentAccountId).toBe('succ');
    expect(apply([LINK], 'succ').paymentAccountId).toBe('succ');
    expect(apply([LINK], 'other').paymentAccountId).toBe('other');
    expect(apply([LINK], null).paymentAccountId).toBeNull();
  });

  it('chain A→B→C: B owns exactly the window (cutAB, cutBC]; payment designation follows to the terminal', () => {
    const A = { id: 'a', type: 'CHECKING', currentBalanceCents: 10_000 };
    const B = { id: 'b', type: 'CHECKING', currentBalanceCents: 20_000 };
    const C = { id: 'c', type: 'CHECKING', currentBalanceCents: 30_000 };
    const out = applyReconciliationBoundary({
      paymentAccountId: 'a',
      accounts: [A, B, C],
      transactions: [
        { accountId: 'a', date: '2026-03-31' }, // ≤ cutAB → kept
        { accountId: 'a', date: '2026-04-01' }, // > cutAB → dropped
        { accountId: 'b', date: '2026-03-31' }, // ≤ cutAB → dropped (A owns it)
        { accountId: 'b', date: '2026-04-01' }, // in window → kept
        { accountId: 'b', date: '2026-06-30' }, // ON cutBC → kept
        { accountId: 'b', date: '2026-07-01' }, // > cutBC → dropped
        { accountId: 'c', date: '2026-06-30' }, // ≤ cutBC → dropped (B owns it)
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
    expect(out.transactions.map((t) => `${t.accountId}:${t.date}`)).toEqual([
      'a:2026-03-31',
      'b:2026-04-01',
      'b:2026-06-30',
      'c:2026-07-01',
    ]);
    // Both stale generations contribute 0; only the terminal live side counts.
    expect(out.accounts.map((a) => a.currentBalanceCents)).toEqual([0, 0, 30_000]);
    expect(out.paymentAccountId).toBe('c');
  });

  it('two predecessors → one successor: each predecessor claims only its own covered span', () => {
    const P1 = { id: 'p1', type: 'CHECKING', currentBalanceCents: 1_000 };
    const P2 = { id: 'p2', type: 'CHECKING', currentBalanceCents: 2_000 };
    const S = { id: 's', type: 'CHECKING', currentBalanceCents: 3_000 };
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [P1, P2, S],
      transactions: [
        { accountId: 's', date: '2026-04-01' }, // neither predecessor has data there → KEPT (F2 class)
        { accountId: 's', date: '2026-06-30' }, // inside P2's claim → dropped (P2 owns it)
        { accountId: 's', date: '2026-07-01' }, // beyond both claims → kept
        { accountId: 'p1', date: '2026-03-31' }, // kept
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
    expect(out.transactions.map((t) => `${t.accountId}:${t.date}`)).toEqual([
      's:2026-04-01',
      's:2026-07-01',
      'p1:2026-03-31',
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
    expect(succDates).toEqual(['2026-07-01', '2024-11-05', '2026-03-15']);
    // Total spend is the union counted once: the backfill months are not understated.
    expect(out.transactions.reduce((s, t) => s + (t.amountCents ?? 0), 0)).toBe(
      -1_000 - 2_000 - 5_000 - 6_000 - 120_000 - 80_000,
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
        { accountId: 'succ', date: '2026-07-01', amountCents: -3_000 }, // inside claim → dropped (pred owns it)
        { accountId: 'succ', date: '2026-07-10', amountCents: -9_000 }, // in the empty tail → KEPT
      ],
      balanceSnapshots: [],
      statements: [],
      scheduled: [],
      links: [{ ...LINK, cutoverDate: '2026-07-15' }],
    });
    expect(out.transactions.map((t) => `${t.accountId}:${t.date}`)).toEqual([
      'pred:2026-06-29',
      'pred:2026-07-01',
      'succ:2026-07-10',
    ]);
  });

  it('F3: a snapshot with no same-date counterpart is ALWAYS kept — no fabricated trend dip', () => {
    // Pred's month-end snapshots continue past the cutover (it stayed live until
    // disconnect); succ's first snapshot is a month later. Nothing collides → all kept.
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: ACCOUNTS,
      transactions: [],
      balanceSnapshots: [
        { accountId: 'pred', date: '2026-05-31', balanceCents: 238_000 },
        { accountId: 'pred', date: '2026-06-30', balanceCents: 240_000 }, // AFTER cutover 06-25, no succ copy → kept
        { accountId: 'succ', date: '2026-04-30', balanceCents: 230_000 }, // deep backfill, no pred copy → kept
        { accountId: 'succ', date: '2026-07-31', balanceCents: 252_000 },
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
    const A = { id: 'a', type: 'CHECKING', currentBalanceCents: 10_000 };
    const B = { id: 'b', type: 'CHECKING', currentBalanceCents: 20_000 };
    const C = { id: 'c', type: 'CHECKING', currentBalanceCents: 30_000 };
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
    const X = { id: 'x', type: 'CREDIT', currentBalanceCents: 40_000 };
    const Y = { id: 'y', type: 'CREDIT', currentBalanceCents: 41_000 };
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
  const A = { id: 'a', type: 'CHECKING', currentBalanceCents: 100_000 };
  const B = { id: 'b', type: 'CHECKING', currentBalanceCents: 110_000 };
  const C = { id: 'c', type: 'CHECKING', currentBalanceCents: 120_000 };
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
    const S1 = { id: 'p1', type: 'CREDIT', currentBalanceCents: -50_000 };
    const S2 = { id: 'p2', type: 'CREDIT', currentBalanceCents: -50_000 };
    const LIVE = { id: 'live', type: 'CREDIT', currentBalanceCents: -50_000 };
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
