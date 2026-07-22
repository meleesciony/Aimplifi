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

function apply(links: ReconciliationLinkLike[], paymentAccountId: string | null = null) {
  return applyReconciliationBoundary({
    paymentAccountId,
    accounts: ACCOUNTS,
    transactions: TXNS,
    balanceSnapshots: SNAPSHOTS,
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
      links: [LINK],
    });
    expect(out.transactions.map((t) => `${t.accountId}:${t.date}`)).toEqual([
      'pred:2026-05-01',
      'pred:2026-06-30',
    ]);
  });
});

describe('applyReconciliationBoundary — inertness (a bad link must change NOTHING)', () => {
  const NO_LINK_EXPECTATION = (out: ReturnType<typeof apply>) => {
    // Exact input references — not copies. Today's behavior, byte-identical.
    expect(out.accounts).toBe(ACCOUNTS);
    expect(out.transactions).toBe(TXNS);
    expect(out.balanceSnapshots).toBe(SNAPSHOTS);
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
