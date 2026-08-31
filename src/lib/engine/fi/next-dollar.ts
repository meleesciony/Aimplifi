/**
 * W.6(b) — the marginal-dollar question, answered from rates already on file.
 *
 * Given an extra dollar, the canon's agreed order is: high-APR revolving debt,
 * then employer match if known uncaptured, then cash runway to a 3-month floor,
 * then installment debt whose APR beats the return assumption, then remaining
 * tax-advantaged contribution room, then investing.
 * Compared at the NOMINAL return dial (APR is a nominal contracted rate; the
 * FI card's real/after-inflation rate is a different unit).
 *
 * Employer match is collected in Settings as a rung status, not a percentage
 * (#528). Tax-advantaged contribution room is the same shape (#529): a status,
 * not a dollar amount or a vehicle. `remaining` wins only after contracted
 * rates and the runway floor — it names the envelope before taxable investing,
 * and it never outranks a high-APR loan or a thin cushion. CREDIT balances
 * that are not past-due are this-cycle cash-needed, not extra-pay destinations
 * — pay-in-full is the product's standing instruction.
 *
 * Pure: integer cents in, no I/O, no `new Date()`.
 */
import type { Cents } from '@/lib/money';

/** Same 3-month floor the net-worth room-for-error band uses (`runwayMonths < 3`). */
export const RUNWAY_FLOOR_MONTHS = 3;

export type NextDollarDebtKind = 'revolving' | 'installment';

export interface NextDollarDebt {
  id: string;
  name: string;
  kind: NextDollarDebtKind;
  balanceCents: number;
  aprBps: number;
}

/**
 * Match is a rung, not a rate we can compare to APR. `unknown` = not on file
 * (skip the rung). `uncaptured` wins the destination. `captured` and `none`
 * fall through — we know the rung does not apply, so it is not listed as
 * skipped-unknown. Do not invent a percentage.
 */
export type EmployerMatch = 'unknown' | 'uncaptured' | 'captured' | 'none';

/**
 * Contribution room is a rung, not an IRS limit we invent. `unknown` = not on
 * file (skip). `remaining` wins the destination once earlier rungs fall
 * through. `maxed` and `none` fall through — known, so not skipped-unknown.
 * Do not invent a dollar amount or pick Roth vs 401(k) vs HSA.
 */
export type TaxAdvantagedRoom = 'unknown' | 'remaining' | 'maxed' | 'none';

export type NextDollarDestination =
  | 'revolving_debt'
  | 'employer_match'
  | 'emergency_fund'
  | 'installment_debt'
  | 'tax_advantaged'
  | 'invest';

export type SkippedRungId = 'employer_match' | 'tax_advantaged' | 'loan_apr';

export interface NextDollarInput {
  debts: readonly NextDollarDebt[];
  /** Nominal expected-return dial (`User.expectedReturnBps`). */
  expectedReturnBps: number;
  returnIsDefault: boolean;
  runwayMonths: number;
  employerMatch: EmployerMatch;
  taxAdvantagedRoom: TaxAdvantagedRoom;
  /** A LOAN row with a positive balance and no APR — skipped, not ranked as 0%. */
  unknownLoanApr?: boolean;
}

export interface NextDollarPlan {
  destination: NextDollarDestination;
  debt: NextDollarDebt | null;
  expectedReturnBps: number;
  returnIsDefault: boolean;
  runwayMonths: number;
  runwayFloorMonths: typeof RUNWAY_FLOOR_MONTHS;
  employerMatch: EmployerMatch;
  taxAdvantagedRoom: TaxAdvantagedRoom;
  skipped: readonly SkippedRungId[];
  /** Highest-APR installment on file (winner or the comparison that lost). */
  highestInstallment: NextDollarDebt | null;
}

export function classifyDebts(input: {
  loans: readonly {
    id: string;
    name: string;
    balanceCents: number;
    aprBps: number | null;
  }[];
  pastDueCards: readonly {
    id: string;
    name: string;
    remainingDueCents: Cents | number;
    aprBps: number | null;
  }[];
}): NextDollarDebt[] {
  const out: NextDollarDebt[] = [];
  for (const c of input.pastDueCards) {
    const remaining = Number(c.remainingDueCents);
    const apr = c.aprBps ?? 0;
    if (remaining <= 0 || apr <= 0) continue;
    out.push({
      id: c.id,
      name: c.name,
      kind: 'revolving',
      balanceCents: remaining,
      aprBps: apr,
    });
  }
  for (const l of input.loans) {
    if (l.balanceCents <= 0) continue;
    // Null APR is unknown, not 0% — same as cards (critic P1-2). A known 0%
    // promo stays so the copy can name it instead of denying the loan exists.
    if (l.aprBps == null) continue;
    out.push({
      id: l.id,
      name: l.name,
      kind: 'installment',
      balanceCents: l.balanceCents,
      aprBps: l.aprBps,
    });
  }
  return out;
}

function pickHighest(debts: readonly NextDollarDebt[]): NextDollarDebt | null {
  if (debts.length === 0) return null;
  const ranked = [...debts].sort((a, b) => {
    if (b.aprBps !== a.aprBps) return b.aprBps - a.aprBps;
    if (b.balanceCents !== a.balanceCents) return b.balanceCents - a.balanceCents;
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
  });
  return ranked[0] ?? null;
}

function skippedRungs(
  match: EmployerMatch,
  tax: TaxAdvantagedRoom,
  unknownLoanApr: boolean,
): SkippedRungId[] {
  const skipped: SkippedRungId[] = [];
  if (match === 'unknown') skipped.push('employer_match');
  if (tax === 'unknown') skipped.push('tax_advantaged');
  if (unknownLoanApr) skipped.push('loan_apr');
  return skipped;
}

function base(input: NextDollarInput, extra: {
  destination: NextDollarDestination;
  debt: NextDollarDebt | null;
}): NextDollarPlan {
  const installments = input.debts.filter((d) => d.kind === 'installment' && d.balanceCents > 0);
  return {
    destination: extra.destination,
    debt: extra.debt,
    expectedReturnBps: input.expectedReturnBps,
    returnIsDefault: input.returnIsDefault,
    runwayMonths: input.runwayMonths,
    runwayFloorMonths: RUNWAY_FLOOR_MONTHS,
    employerMatch: input.employerMatch,
    taxAdvantagedRoom: input.taxAdvantagedRoom,
    skipped: skippedRungs(
      input.employerMatch,
      input.taxAdvantagedRoom,
      input.unknownLoanApr === true,
    ),
    highestInstallment: pickHighest(installments),
  };
}

/**
 * Rank the next extra dollar. Tie on APR vs return (`aprBps === expectedReturnBps`)
 * falls through — a contracted 7.00% vs an expected 7.00% is a wash, and later
 * rungs (eventually investing) take it. Strict `>` is the documented rule.
 */
export function nextDollar(input: NextDollarInput): NextDollarPlan {
  const revolving = pickHighest(
    input.debts.filter(
      (d) => d.kind === 'revolving' && d.balanceCents > 0 && d.aprBps > input.expectedReturnBps,
    ),
  );
  if (revolving) return base(input, { destination: 'revolving_debt', debt: revolving });

  if (input.employerMatch === 'uncaptured') {
    return base(input, { destination: 'employer_match', debt: null });
  }

  if (
    Number.isFinite(input.runwayMonths) &&
    input.runwayMonths < RUNWAY_FLOOR_MONTHS
  ) {
    return base(input, { destination: 'emergency_fund', debt: null });
  }

  const installment = pickHighest(
    input.debts.filter(
      (d) => d.kind === 'installment' && d.balanceCents > 0 && d.aprBps > input.expectedReturnBps,
    ),
  );
  if (installment) return base(input, { destination: 'installment_debt', debt: installment });

  if (input.taxAdvantagedRoom === 'remaining') {
    return base(input, { destination: 'tax_advantaged', debt: null });
  }

  return base(input, { destination: 'invest', debt: null });
}
