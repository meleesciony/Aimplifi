/**
 * Scenario coherence engine (AI plan §Later #13 slice 1, DECISIONS #255) — the unified
 * scenario-snapshot layer Scenario Studio needs before any what-if UI can exist.
 *
 * THE PROBLEM IT SOLVES: the app's five projection engines read their inputs from TWO
 * independent representations that nothing previously tied together —
 *   - the AGGREGATE figures /coach derives (average monthly income & savings over the
 *     coach's REAL window — its last ≤ 6 full months; annualExpenses = window expenses
 *     × 12 ÷ window months), which feed savings-rate, FI, and retirement; and
 *   - the PER-FLOW scheduled rows (`snap.scheduled`), which feed the cash-flow forecast
 *     and the cash-needed engine's scheduled projection.
 * A "15% pay cut" applied to one representation but not the other ships a silent
 * inconsistency (the plan's blocker (a)). This engine defines ONE canonical state and
 * applies every knob to BOTH representations by documented rules.
 *
 * CARDINAL RULE (both-or-neither): a knob either applies to both representations, or it
 * does not apply at all and says so in `notes`. It never applies to one side only.
 *
 * The ratio-vs-cents hazard is resolved by naming two distinct derived figures:
 *   - `monthlyNetCents`        = income − expenses  → drives the savings RATE.
 *   - `monthlyInvestibleCents` = net − extraDebt    → drives FI + retirement contribution.
 * Reallocating surplus to debt principal genuinely does not change income − expenses,
 * but it does reduce what compounds — the split states that honestly instead of picking
 * one meaning and silently corrupting the other.
 *
 * Base figures arrive VERBATIM from the coach derivation (never re-derived here); the
 * only new identity is monthlyExpenses = monthlyIncome − monthlySavings, exact in
 * integers by construction. `annualExpensesCents` remains the separate verbatim coach
 * figure (window expenses × 12 ÷ window months); its pre-existing rounding divergence
 * from 12 × monthlyExpenses
 * is inherited and documented, not resolved.
 *
 * Adapters preserve each downstream engine's OWN conventions verbatim (fail-loud floors
 * and null-returns included): FI takes the un-floored investible figure and the NOMINAL
 * return; retirement receives un-floored `RetirementBaseInputs` so the one shared
 * `buildRetirementInputs` builder applies its floor and derives the real return; the
 * savings rate keeps its income ≤ 0 → null contract. Forecast and cash-needed both read
 * the SAME adjusted `scheduledRows`. Issued card statements, autopays, loan minimums,
 * and account balances pass through untouched — facts a scenario does not rewrite.
 *
 * The decision-comparison half of #13 ("which option wins by $X") is permanently
 * dropped (plan §4) — this module computes states, never verdicts.
 *
 * Pure & deterministic: integer cents in/out, injected `today`, no I/O, no `new Date()`.
 * Rounding = roundHalfAwayFromZero, once per materialized value. Pinned to the
 * hand-verified table in docs/EDGE_CASES.md §Scenario Coherence.
 */
import { cents, roundHalfAwayFromZero } from '@/lib/money';
import { type ISODate, addMonthsClamped, startOfMonth } from '@/lib/dates';
import type { DebtInput, DebtPlanInput, DebtStrategy } from '@/lib/engine/debt/payoff';
import type { RetirementBaseInputs } from '@/lib/engine/investments/retirement';
import { savingsRateBps } from '@/lib/engine/fi/fi';

/**
 * A scheduled recurring row in the canonical shape BOTH flow consumers accept:
 * structurally a `ScheduledLike` (cash-needed assemble) and mappable 1:1 onto a
 * forecast `ScheduledFlow`. Adjusting rows HERE is what makes the two engines
 * inherit one identical scenario instead of two drifting ones.
 */
export interface ScenarioScheduledRow {
  accountId: string;
  description: string;
  /** Signed: inflow positive, outflow negative (transaction convention). */
  amountCents: number;
  nextDate: string;
  cadence: string | null;
  /** True only on rows this engine synthesized to represent an absolute knob. */
  isSynthetic?: boolean;
}

/** The user dials a scenario carries (hazard: they live OUTSIDE FinanceSnapshot). */
export interface ScenarioDials {
  /** Safe withdrawal rate, bps — validated 100..1000 by the dials engine. */
  swrBps: number;
  /** NOMINAL expected return, bps. Retirement derives its real rate downstream. */
  expectedReturnBps: number;
}

/** The canonical pre-scenario snapshot: both representations, assembled once. */
export interface ScenarioBase {
  today: ISODate;
  /** Verbatim coach figure: average monthly income over the real window (≥ 0). */
  monthlyIncomeCents: number;
  /** Verbatim coach figure: average monthly savings over the real window (may be negative). */
  monthlySavingsCents: number;
  /** Verbatim coach figure: window expenses annualized (× 12 ÷ window months). */
  annualExpensesCents: number;
  /**
   * The number of full months /coach actually averaged over — verbatim
   * `CoachData.fi.monthlySavingsMonths` (the window length, ≤ 6; 0 = no complete
   * months on record). Carried so scenario copy names the SAME window the coach
   * shows; never used in math (the aggregates arrive pre-averaged). Copy that
   * hardcoded "6 months" while the coach read a shorter history was the bug this
   * field kills — every surface must speak the coach's real window.
   */
  averageWindowMonths: number;
  /** Verbatim coach figure: Σ INVESTMENT account balances. */
  portfolioCents: number;
  /**
   * The account synthetic flows land on (the cash-needed payment account).
   * null = none eligible; absolute and extra-debt knobs then no-op with a note
   * (both-or-neither: an aggregate move with no representable flow is forbidden).
   */
  paymentAccountId: string | null;
  scheduledRows: readonly ScenarioScheduledRow[];
  /** The payoff engine's own debt shape, passed through verbatim. */
  debts: readonly DebtInput[];
  dials: ScenarioDials;
}

/** One knob's delta: percent of the BASE figure, then an absolute monthly amount. */
export interface KnobDelta {
  /** Change in bps of the base figure: −1500 = a 15% cut, +1000 = 10% more. */
  percentBps?: number;
  /** Signed absolute monthly change in cents, applied AFTER the percent. */
  monthlyCents?: number;
}

export interface ScenarioKnobs {
  income?: KnobDelta;
  /**
   * Expense knob. Absolute POSITIVE = a new committed monthly outflow (representable
   * as a dated flow). Absolute NEGATIVE is a documented no-op (rule E-CUT): a "cut
   * $250 somewhere" names no bill, so it has no flow representation — use the
   * percent form, which shrinks every known bill proportionally.
   */
  expense?: KnobDelta;
  /** Extra paid monthly toward debts on top of every minimum (≥ 0 after clamp). */
  extraDebtMonthlyCents?: number;
}

/**
 * Clamp bounds — clamp-and-note, never throw (the retirement-whatif reducer
 * precedent). Percent is bounded at ±100%; absolute monthly changes at ±$100k/mo,
 * far beyond any real household but safely inside integer-cents arithmetic.
 */
export const SCENARIO_LIMITS = {
  percentBps: { min: -10000, max: 10000 },
  monthlyCents: { min: -10_000_000, max: 10_000_000 },
  extraDebtMonthlyCents: { min: 0, max: 10_000_000 },
} as const;

/** The post-scenario canonical state every adapter reads. */
export interface ScenarioState {
  today: ISODate;
  /** Post-knob monthly income, floored at 0 (a floor is disclosed in notes). */
  monthlyIncomeCents: number;
  /** Post-knob monthly expenses (base identity: income − savings), floored at 0. */
  monthlyExpensesCents: number;
  /** income − expenses. NOT floored — a deficit is reported honestly. */
  monthlyNetCents: number;
  /** net − extraDebt. NOT floored — downstream conventions decide their own floors. */
  monthlyInvestibleCents: number;
  /** Post-knob annual expenses (verbatim base ± 12 × monthly delta), floored at 0. */
  annualExpensesCents: number;
  /** The coach's real averaging window, carried verbatim from the base (copy only). */
  averageWindowMonths: number;
  portfolioCents: number;
  /** The applied (post-clamp, post-eligibility) extra debt payment. */
  extraDebtMonthlyCents: number;
  /** Adjusted rows: scaled originals + synthetic rows for absolute knobs. */
  scheduledRows: ScenarioScheduledRow[];
  debts: readonly DebtInput[];
  dials: ScenarioDials;
  paymentAccountId: string | null;
  /** Standing modeling assumptions, for the UI to state inline (guardrail). */
  assumptions: string[];
  /** Application notes: clamps applied, knobs that could not apply. */
  notes: string[];
}

/**
 * The averaging window named in copy — the coach's dialect (coach-copy.ts C.9):
 * "your last N full month(s)", singular at 1. `windowMonths` is the coach's real
 * window (≤ 6); 0 means no complete month is on record, and copy must say that
 * instead of inventing a window the reader does not have.
 */
function windowPhrase(windowMonths: number): string {
  if (windowMonths <= 0) return 'your history so far';
  return `the last ${windowMonths} month${windowMonths === 1 ? '' : 's'}`;
}

/** Standing assumptions every scenario carries (stated, not advisory). */
function standingAssumptions(windowMonths: number): string[] {
  return [
    windowMonths <= 0
      ? 'Aggregate figures start at $0 — no complete months of history are on record yet; scheduled flows are your detected recurring items — the same knob moves both.'
      : `Aggregate figures are averages over your last ${windowMonths} full month${windowMonths === 1 ? '' : 's'}; scheduled flows are your detected recurring items — the same knob moves both.`,
    'Issued card statements, loan minimums, and account balances are facts a scenario does not rewrite.',
    'Fixed-dollar scenario adjustments start on the first of next month.',
  ];
}

function clampWithNote(
  value: number,
  limits: { min: number; max: number },
  label: string,
  notes: string[],
): number {
  // Sanitize BEFORE clamping — Math.max/min pass NaN straight through, and a
  // cleared numeric form field arrives as exactly NaN (critic F1). The module's
  // contract is clamp-and-note, never throw, and integer cents out.
  if (!Number.isFinite(value)) {
    notes.push(`The ${label} was not a usable number and was ignored.`);
    return 0;
  }
  let sane = value;
  if (!Number.isInteger(sane)) {
    sane = roundHalfAwayFromZero(sane);
    notes.push(`The ${label} was rounded to a whole number.`);
  }
  const clamped = Math.max(limits.min, Math.min(limits.max, sane));
  if (clamped !== sane) {
    notes.push(`The ${label} was limited to the supported range and applied as its nearest bound.`);
  }
  return clamped;
}

/** Scale one row amount by (10000 + bps)/10000, rounded once. */
function scaleRowAmount(amountCents: number, percentBps: number): number {
  return roundHalfAwayFromZero((amountCents * (10000 + percentBps)) / 10000);
}

/**
 * Apply a knob set to the canonical base. Every rule is pinned in
 * docs/EDGE_CASES.md §Scenario Coherence (S1–S14).
 */
export function applyScenario(base: ScenarioBase, knobs: ScenarioKnobs): ScenarioState {
  const notes: string[] = [];
  const baseExpenses = base.monthlyIncomeCents - base.monthlySavingsCents;
  /** First of next calendar month — the documented anchor for synthetic rows. */
  const anchor = startOfMonth(addMonthsClamped(base.today, 1));

  let rows: ScenarioScheduledRow[] = base.scheduledRows.map((r) => ({ ...r }));
  const synthetic: ScenarioScheduledRow[] = [];

  // ── income ──
  let income = base.monthlyIncomeCents;
  const incomePct = clampWithNote(
    knobs.income?.percentBps ?? 0,
    SCENARIO_LIMITS.percentBps,
    'income percent change',
    notes,
  );
  if (incomePct !== 0) {
    income += roundHalfAwayFromZero((base.monthlyIncomeCents * incomePct) / 10000);
    rows = rows.map((r) =>
      r.amountCents > 0 ? { ...r, amountCents: scaleRowAmount(r.amountCents, incomePct) } : r,
    );
    // S15 (critic F2): the same factor applied to both sides, but a $0 aggregate
    // base makes the asymmetry VISIBLE — disclose it rather than look one-sided.
    if (base.monthlyIncomeCents === 0 && base.scheduledRows.some((r) => r.amountCents > 0)) {
      notes.push(
        `Your average monthly income over ${windowPhrase(base.averageWindowMonths)} is $0, so the percent change shows up only on your scheduled income flows.`,
      );
    }
  }
  const incomeAbs = clampWithNote(
    knobs.income?.monthlyCents ?? 0,
    SCENARIO_LIMITS.monthlyCents,
    'income change',
    notes,
  );
  if (incomeAbs !== 0) {
    if (base.paymentAccountId === null) {
      notes.push(
        'The fixed income change was not applied — there is no payment account to carry it as a flow.',
      );
    } else {
      // The EFFECTIVE delta is what both representations get (floor at $0/mo income).
      const target = Math.max(0, income + incomeAbs);
      const effective = target - income;
      if (effective !== incomeAbs) {
        notes.push('Monthly income cannot go below $0 — the income change was reduced to reach exactly $0.');
      }
      income = target;
      if (effective !== 0) {
        synthetic.push({
          accountId: base.paymentAccountId,
          description: 'Scenario: income adjustment',
          amountCents: effective,
          nextDate: anchor,
          cadence: 'MONTHLY',
          isSynthetic: true,
        });
      }
    }
  }

  // ── expenses ──
  let expenses = baseExpenses;
  let annualExpenses = base.annualExpensesCents;
  const expensePct = clampWithNote(
    knobs.expense?.percentBps ?? 0,
    SCENARIO_LIMITS.percentBps,
    'spending percent change',
    notes,
  );
  if (expensePct !== 0) {
    const delta = roundHalfAwayFromZero((baseExpenses * expensePct) / 10000);
    expenses += delta;
    annualExpenses += 12 * delta;
    rows = rows.map((r) =>
      r.amountCents < 0 ? { ...r, amountCents: scaleRowAmount(r.amountCents, expensePct) } : r,
    );
    // Mirror of S15 for the expense side (critic F2).
    if (baseExpenses === 0 && base.scheduledRows.some((r) => r.amountCents < 0)) {
      notes.push(
        `Your average monthly spending over ${windowPhrase(base.averageWindowMonths)} is $0, so the percent change shows up only on your scheduled bills.`,
      );
    }
  }
  const expenseAbs = clampWithNote(
    knobs.expense?.monthlyCents ?? 0,
    SCENARIO_LIMITS.monthlyCents,
    'spending change',
    notes,
  );
  if (expenseAbs < 0) {
    // Rule E-CUT: a fixed-dollar cut names no bill — no flow representation exists.
    notes.push(
      'A fixed-dollar spending cut was not applied — use the percent knob, which shrinks every known bill proportionally.',
    );
  } else if (expenseAbs > 0) {
    if (base.paymentAccountId === null) {
      notes.push(
        'The added spending was not applied — there is no payment account to carry it as a flow.',
      );
    } else {
      expenses += expenseAbs;
      annualExpenses += 12 * expenseAbs;
      synthetic.push({
        accountId: base.paymentAccountId,
        description: 'Scenario: added spending',
        amountCents: -expenseAbs,
        nextDate: anchor,
        cadence: 'MONTHLY',
        isSynthetic: true,
      });
    }
  }

  // ── extra debt payment ──
  let extraDebt = clampWithNote(
    knobs.extraDebtMonthlyCents ?? 0,
    SCENARIO_LIMITS.extraDebtMonthlyCents,
    'extra debt payment',
    notes,
  );
  if (extraDebt > 0) {
    const hasDebt = base.debts.some((d) => d.balanceCents > 0);
    if (!hasDebt) {
      notes.push('The extra debt payment was not applied — there are no debts to pay.');
      extraDebt = 0;
    } else if (base.paymentAccountId === null) {
      notes.push(
        'The extra debt payment was not applied — there is no payment account to carry it as a flow.',
      );
      extraDebt = 0;
    } else {
      synthetic.push({
        accountId: base.paymentAccountId,
        description: 'Scenario: extra debt payment',
        amountCents: -extraDebt,
        nextDate: anchor,
        cadence: 'MONTHLY',
        isSynthetic: true,
      });
    }
  }

  // Defensive floors on the aggregate figures. The income floor is always disclosed
  // above where a knob caused it; the annualExpenses floor can engage silently only
  // from the cents-scale rounding divergence between the two verbatim coach bases
  // (annualExpenses = expenses6×2 vs monthlyExpenses = income − savings), which is
  // immaterial (critic F4). Net and investible are deliberately NOT floored.
  income = Math.max(0, income);
  expenses = Math.max(0, expenses);
  annualExpenses = Math.max(0, annualExpenses);
  const net = income - expenses;

  // Critic F3: the extra payment has no end date in the flow/aggregate model, even
  // though the payoff engine may clear the debts sooner — a stated assumption, so
  // months-to-FI under an aggressive payoff is read with the right caveat.
  const assumptions = standingAssumptions(base.averageWindowMonths);
  if (extraDebt > 0) {
    assumptions.push(
      'The extra debt payment is modeled as continuing for the whole projection, even after the debts would be paid off.',
    );
  }

  return {
    today: base.today,
    monthlyIncomeCents: income,
    monthlyExpensesCents: expenses,
    monthlyNetCents: net,
    monthlyInvestibleCents: net - extraDebt,
    annualExpensesCents: annualExpenses,
    averageWindowMonths: base.averageWindowMonths,
    portfolioCents: base.portfolioCents,
    extraDebtMonthlyCents: extraDebt,
    scheduledRows: [...rows, ...synthetic],
    debts: base.debts,
    dials: base.dials,
    paymentAccountId: base.paymentAccountId,
    assumptions,
    notes,
  };
}

// ── Adapters: one state, every engine's own input shape & conventions ──

/**
 * Retirement base figures, UN-floored: `buildRetirementInputs` (the one shared
 * builder) applies the ≥0 floors and derives the real (after-inflation) return.
 * This adapter must never re-implement either convention.
 *
 * NOTE (C.17 / audit P2): there is deliberately NO `toFIInputs` adapter. The old
 * one paired the NOMINAL return dial with a present-value FI target — the
 * mixed-base trap its sibling used to warn against — and had no production
 * caller. The sanctioned path to `monthsToFI` is the real return derived by
 * `buildRetirementInputs` (W.2), exactly as the /coach server does.
 */
export function toRetirementBase(s: ScenarioState): RetirementBaseInputs {
  return {
    currentPortfolioCents: s.portfolioCents,
    monthlyContributionCents: s.monthlyInvestibleCents,
    annualRetirementSpendingCents: s.annualExpensesCents,
    nominalReturnBps: s.dials.expectedReturnBps,
    swrBps: s.dials.swrBps,
  };
}

/** Savings rate under the scenario — the engine's income ≤ 0 → null contract holds. */
export function toScenarioSavingsRateBps(s: ScenarioState): number | null {
  return savingsRateBps(cents(s.monthlyIncomeCents), cents(s.monthlyExpensesCents));
}

/** Debt-payoff input with the scenario's extra payment; debts verbatim. */
export function toDebtPlanInput(s: ScenarioState, strategy: DebtStrategy): DebtPlanInput {
  return {
    debts: [...s.debts],
    strategy,
    extraMonthlyCents: s.extraDebtMonthlyCents,
  };
}
