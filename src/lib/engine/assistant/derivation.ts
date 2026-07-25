/**
 * Glass-Box slice 3 — derivation-chain traces (GLASSBOX_PLAN §Slice 3): the
 * "show the formula + inputs" behind the three derivation figures Ask can
 * honestly explain — net_worth, cash_needed, savings_rate. These are NOT
 * transaction row-sums (offering one would be dishonest); each trace shows the
 * formula's input lines and the step that produces the headline figure.
 *
 * Cardinal design rule (same as engine/glass-box/trace.ts): a trace never
 * recomputes a number from raw inputs with its own logic — it RESHAPES the
 * engine result it is handed, so the lines shown are by construction the exact
 * values the engine already combined into the headline:
 *  - net_worth: one signed line per account, side decided by the canonical
 *    `isLiabilityType` (the SAME predicate `netWorthCents` uses — never sign
 *    inference: an overdrawn checking account is a negative-contribution ASSET);
 *  - cash_needed: the existing glass-box trace's rows, flattened from the
 *    engine's own `perDueDate` partition of the due set (the two-stage
 *    real-statements-else-estimated selection is never re-implemented here);
 *  - savings_rate: the month's income/expenses lines, with the rate recomputed
 *    through the SAME `savingsRateBps` the coach read-path uses.
 *
 * The reconciliation is still CHECKED at runtime — line sum vs the engine's own
 * figure vs the BUILDER's independently-declared figure (`headlineCents` /
 * `headlineBps`) — so genuine drift is reported (reconciled: false → the UI
 * shows an honest fallback), never papered over in either direction.
 *
 * Pure: no I/O, no Date, integer cents only.
 */
import { cents } from '@/lib/money';
import { netWorthCents } from '@/lib/engine/cash-needed/assemble';
import { isLiabilityType } from '@/lib/engine/transactions/query';
import { savingsRateBps } from '@/lib/engine/fi/fi';
import { traceCashNeeded as glassBoxCashNeeded } from '@/lib/engine/glass-box/trace';
import type { CardDuplicatePairInput } from '@/lib/engine/account/card-duplicate-view';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import type { AccountLike } from './answer';

// ─── types ───────────────────────────────────────────────────────────────────

/** One input line of a derivation. Signed: the lines' plain sum IS the
 *  subtotal the formula step explains (net worth / cash required / saved). */
export interface DerivationRow {
  label: string;
  /** Signed contribution to the formula's subtotal. */
  amountCents: number;
  /** Effective due date (cash_needed lines only) — ISO. Rows render it verbatim
   *  (the slice-2 TraceRows precedent); the panel footer, which restates the
   *  headline's own "by DATE" claim, formats it through the SAME `humanDate`
   *  the headline used. */
  date?: string;
  /** cash_needed only: the portion autopay moves automatically — rendered as the
   *  same "(autopay)" marker the dashboard glass-box shows for this row, so Ask
   *  never suggests manual action autopay already covers (critic F5). */
  autopayCents?: number;
  /** net_worth only: which side of "assets − liabilities" this account sits
   *  on, decided by `isLiabilityType` — NEVER inferred from the sign (an
   *  overdrawn asset contributes negative; a paid-off card is a $0 liability). */
  group?: 'asset' | 'liability';
  /** cash_needed only: the amount is estimated from the current balance
   *  because no statement has generated (disclosed in basis too). */
  isEstimated?: boolean;
}

interface DerivationBase {
  kind: 'derivation';
  rows: DerivationRow[];
  /** Plain sum of rows[].amountCents — computed here, displayed verbatim. */
  sumCents: number;
  /** True iff every equality below held; false is the honest fallback, never
   *  a wrong figure under a green check. */
  reconciled: boolean;
  /** What the lines include/exclude, stated inline (assumption transparency). */
  basis: string[];
}

export type DerivationTrace =
  | (DerivationBase & {
      intentKind: 'net_worth';
      /** The engine's own figure (`netWorthCents`) — the tapped number. */
      netCents: number;
    })
  | (DerivationBase & {
      intentKind: 'cash_needed';
      /** The engine's own figure (`headline.requiredCents`) — the tapped number. */
      requiredCents: number;
      /** Last effective due date (`headline.byDate`) — shown next to the total. */
      byDate: string | null;
    })
  | (DerivationBase & {
      intentKind: 'savings_rate';
      incomeCents: number;
      expensesCents: number;
      /** income − expenses; the rows sum to exactly this. */
      savedCents: number;
      /** Recomputed via `savingsRateBps(income, expenses)` — the tapped number. */
      rateBps: number;
      monthLabel: string;
    });

// NOTE (critic F4): there is deliberately NO exported DERIVATION_KINDS set —
// the real gate is the per-kind attach at each `buildAnswer` case (an intent
// only gains a tap when its case wires a trace), and a set nothing reads would
// only invite a "extend the Set, change nothing" edit. Every other
// derivation-chain intent (forecast, safe_to_spend, debt_payoff, …) stays
// non-tappable — never offer an explanation we haven't built honestly.

// ─── net worth ───────────────────────────────────────────────────────────────

// Copy states what the lines actually are (critic F1): manual items (a home, a
// vehicle, "Other debt") are Account rows too — neither linked nor synced — and
// OTHER_LIABILITY sits on the owe side, so neither sentence may claim otherwise.
const NET_WORTH_BASIS = [
  "Current balances across every account you've linked or added.",
  "Credit cards, loans, mortgages, and other debts you've added count as money you owe; everything else counts as money you own.",
];

/**
 * Assets − liabilities, one signed line per account. `expectedCents` is the
 * BUILDER's own headline figure (answerNetWorth.headlineCents), computed
 * independently of this reshape — so the equality is a real drift gate.
 */
export function traceNetWorthDerivation(accounts: readonly AccountLike[], expectedCents: number): DerivationTrace {
  const rows: DerivationRow[] = accounts.map((a) => {
    const liability = isLiabilityType(a.type);
    return {
      label: a.name,
      // `|| 0` normalizes the -0 a negated $0 balance produces — a payload
      // value must round-trip JSON and strict equality cleanly.
      amountCents: liability ? -a.currentBalanceCents || 0 : a.currentBalanceCents,
      group: liability ? 'liability' : 'asset',
    };
  });
  const sum = rows.reduce((s, r) => s + r.amountCents, 0);
  const net = netWorthCents([...accounts]);
  return {
    kind: 'derivation',
    intentKind: 'net_worth',
    rows,
    sumCents: sum,
    netCents: net,
    reconciled: sum === net && net === expectedCents,
    basis: [...NET_WORTH_BASIS],
  };
}

// ─── cash needed ─────────────────────────────────────────────────────────────

const CASH_NEEDED_BASIS =
  'Pay-in-full amounts after any payments already made this cycle. A due date on a weekend or holiday is treated as the prior business day, so the money is there early, never late.';

/**
 * Per-card due lines, lifted verbatim from the existing glass-box trace (whose
 * rows flatten the engine's own `perDueDate` partition — exactly the set
 * `headline.requiredCents` summed). Reconciles the row sum against the
 * engine's figure AND the builder's (`expectedCents`), and pins `byDate` to
 * the last row's date so the "by DATE" in the sentence is covered too.
 */
export function traceCashNeededDerivation(
  result: CashNeededResult,
  expectedCents: number,
  /**
   * Suspected same-card-twice pairs (TASKS L.15 (f), critic P1-1). The FIRST cut of L.15 wired only
   * the dashboard's glass-box and left this one — the panel the Ask reader opens to AUDIT the figure
   * the answer just qualified. It rendered both rows under a green check with a penny-perfect
   * reconciliation and said nothing, which reads as confirmation that both belong. `basis` below
   * already spreads `inner.basis`, so the disclosure flows through with the argument.
   */
  cardDuplicates: readonly CardDuplicatePairInput[] = [],
): DerivationTrace {
  const inner = glassBoxCashNeeded(result, cardDuplicates);
  const rows: DerivationRow[] = inner.rows.map((r) => ({
    label: r.label,
    amountCents: r.amountCents,
    date: r.date,
    ...(r.isEstimated ? { isEstimated: true } : {}),
    ...((r.autopayCents ?? 0) > 0 ? { autopayCents: r.autopayCents } : {}),
  }));
  const byDate = result.headline.byDate;
  const lastRowDate = rows.length > 0 ? rows[rows.length - 1].date ?? null : null;
  return {
    kind: 'derivation',
    intentKind: 'cash_needed',
    rows,
    sumCents: inner.sumCents,
    requiredCents: result.headline.requiredCents,
    byDate,
    reconciled:
      inner.reconciles && inner.sumCents === expectedCents && lastRowDate === byDate,
    basis: [CASH_NEEDED_BASIS, ...inner.basis],
  };
}

// ─── savings rate ────────────────────────────────────────────────────────────

/**
 * Income − expenses = saved; saved ÷ income = the rate. The rate is recomputed
 * through the SAME `savingsRateBps` the coach stores, while `expectedBps` is
 * the coach's STORED value the builder displayed — so this equality is the
 * canary that fires if the coach's definition ever drifts from the formula
 * shown (e.g. a future multi-month average). Income ≤ 0 has no defined rate
 * and can never reconcile.
 */
export function traceSavingsRateDerivation(
  flow: { incomeCents: number; expensesCents: number; monthLabel: string },
  expectedBps: number,
): DerivationTrace {
  const saved = flow.incomeCents - flow.expensesCents;
  const rows: DerivationRow[] = [
    { label: 'Income', amountCents: flow.incomeCents },
    { label: 'Expenses', amountCents: -flow.expensesCents },
  ];
  const sum = rows.reduce((s, r) => s + r.amountCents, 0);
  const recomputed = savingsRateBps(cents(flow.incomeCents), cents(flow.expensesCents));
  return {
    kind: 'derivation',
    intentKind: 'savings_rate',
    rows,
    sumCents: sum,
    incomeCents: flow.incomeCents,
    expensesCents: flow.expensesCents,
    savedCents: saved,
    rateBps: recomputed ?? 0,
    monthLabel: flow.monthLabel,
    reconciled: sum === saved && recomputed !== null && recomputed === expectedBps,
    basis: [
      `Your most recent full month (${flow.monthLabel}). Income and expenses exclude transfers between your own accounts; merchandise refunds count against spending.`,
    ],
  };
}
