/**
 * RESERVES — the third source of committed money (C.23 / H.4, owner-described
 * twice in his own words).
 *
 * *"other items that aren't explicitly listed as expenditures or fixed are fixed
 * based upon money being reserved every month for home repair, those are fixed.
 * The way I personally categorize yearly membership dues is I divide by 12 and
 * put that cash aside."*
 *
 * The app already models the owner's first two sources of Fixed: a bill that
 * leaves this month, and a longer-rhythm bill SMOOTHED to a monthly rate
 * (`monthlyRateCents` — the engine's ÷12 and his are the same arithmetic). It
 * models nothing for the third: money set aside monthly against a known future
 * expense that no transaction implies. Home repair has no merchant, no series
 * and no history; it is discoverable from nothing, so it must be DECLARED.
 *
 * WHY THIS IS FIXED AND NOT SAVINGS, which looks like a reversal of a rule the
 * owner set one day earlier (`plan.ts:446`, "Settlement / savings — never a Plan
 * Fixed cost class") and is not. It is a DISTINCTION: a reserve pre-funds a
 * known EXPENSE — a bill deferred, not wealth built — and the money leaves for
 * good when the item comes due. Savings and investing build a balance the reader
 * keeps. The 2026-08-01 rule is about that second thing and stands untouched;
 * `investment` is still never Fixed.
 *
 * THE DOUBLE-COUNT HAZARD, closed by construction rather than by arithmetic.
 * `plannedSavingsCents` is `Math.max(goalContributions, savingsTarget)` — "a
 * floor, never a sum" (`plan.ts:393-396`). A reserve carried as a savings goal
 * would sit INSIDE that max and then be added again as Fixed, so the same money
 * would be committed twice and `leftToSpend` would understate by the reserve.
 * The remedy is that a reserve is never a contribution: it stores no
 * `monthlyContributionCents` at all, and the loader that sums contributions
 * excludes `kind = 'reserve'` explicitly rather than relying on that null. Two
 * independent reasons, because one of them is a data convention and data
 * conventions are broken by the next writer.
 *
 * THE READER NEVER DIVIDES. A reserve stores the TRUE COST and its rhythm —
 * $1,200 a year — and this module does the division, because the owner's manual
 * ÷12 is exactly the labour the app exists to remove, and because a stored
 * monthly figure loses the fact that $100 is a twelfth of something (which is
 * the only way the line can explain itself beside the mortgage).
 */
import { monthlyRateCents } from '@/lib/engine/spending-plan/plan';

/** `Goal.kind` for a reserve. The third kind, beside null (savings) and 'debt_free'. */
export const RESERVE_KIND = 'reserve';

/**
 * The rhythms a reserve may be declared on.
 *
 * DELIBERATELY NARROWER than `monthlyRateCents` accepts. That function's
 * `default` branch returns the amount unchanged — a sane fallback for a detected
 * series whose cadence the detector left null, and a catastrophic one here: a
 * stored `'YEARLY'` (a typo, an older writer, a hand-edited row) would enter the
 * plan at TWELVE TIMES its monthly truth, silently, in the direction that eats a
 * reader's whole guilt-free line. So the cadence is validated against this list
 * before any division happens, and anything else is refused and reported.
 */
export const RESERVE_CADENCES = ['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'] as const;
export type ReserveCadence = (typeof RESERVE_CADENCES)[number];

/**
 * How each rhythm is said beside a true cost ("$1,200.00 a year"). One table, so
 * the form's options, the row's subtitle and the list's basis clause cannot
 * drift into describing the same rhythm three ways.
 */
export const RESERVE_CADENCE_WORDS: Record<ReserveCadence, string> = {
  MONTHLY: 'a month',
  QUARTERLY: 'every 3 months',
  SEMIANNUAL: 'twice a year',
  ANNUAL: 'a year',
};

export function isReserveCadence(value: unknown): value is ReserveCadence {
  return typeof value === 'string' && (RESERVE_CADENCES as readonly string[]).includes(value);
}

/*
 * BOUNDARY LIMITS. They live here rather than in `reserve-actions.ts` because a
 * `'use server'` module may export only async functions — a constant there is a
 * build error, not a style point — and because the reason for the cost ceiling
 * is a fact about the stored column, which is this module's subject.
 */
/** Matches the repo's other user-entered name caps (`MAX_RENAME_LEN` = 60). The
 *  name is rendered as a line label directly beside a money figure. */
export const MAX_RESERVE_NAME = 60;

/**
 * Shared name check for create and rename. Trim first: surrounding
 * spaces are not a name, and a 61-char padded string is still too long
 * after trim. Empty and over-cap are the only refusals — the dollars
 * stay on a different field.
 */
export function reserveNameError(raw: string): string | undefined {
  const name = raw.trim();
  if (!name) return 'Give the reserve a name — "Home repair", "Gym dues".';
  if (name.length > MAX_RESERVE_NAME) {
    return `Keep the name under ${MAX_RESERVE_NAME} characters.`;
  }
  return undefined;
}


/**
 * The largest cost this field can hold: `Goal.targetCents` is a Prisma `Int`,
 * i.e. Postgres `integer`, so 2,147,483,647 cents — $21,474,836.47. Named rather
 * than inlined because the reason is the COLUMN, not a product judgement about
 * how big a reserve should be.
 */
export const MAX_RESERVE_COST_CENTS = 2_147_483_647;

/**
 * How many reserves one reader may declare. Every row is read on every plan load
 * and rendered as its own Fixed line, so this is a fan-out bound on a hot loader
 * rather than an abuse control (the `MAX_SUBSCRIPTIONS_PER_USER` precedent).
 */
export const MAX_RESERVES_PER_USER = 50;

/** What the reader declared, as stored. `cadence` is UNVALIDATED on purpose —
 *  it comes off a database row, and validating it is this module's job. */
export interface ReserveDeclaration {
  id: string;
  name: string;
  /** The whole cost, once per `cadence` period. Positive integer cents. */
  trueCostCents: number;
  cadence: string | null;
  /** True when convert paired this reserve to a bill. Cost then stays with the bill. */
  pairedToBill?: boolean;
}

/** A reserve the plan can count. `monthlyCents` is derived, never stored. */
export interface ReserveLine {
  id: string;
  name: string;
  trueCostCents: number;
  cadence: ReserveCadence;
  monthlyCents: number;
  /** True when convert paired this reserve to a bill. Cost then stays with the bill. */
  pairedToBill?: boolean;
}

/** A declaration that could not be counted, and why. */
export interface RefusedReserve {
  id: string;
  name: string;
  reason: 'bad-cadence' | 'bad-amount' | 'rounds-to-zero';
}

export interface ReserveResolution {
  lines: ReserveLine[];
  /** Sum of `lines[].monthlyCents`. Never includes a refused row. */
  monthlyTotalCents: number;
  /**
   * Declarations dropped, with the reason.
   *
   * NOT an empty-array afterthought: a dropped reserve is money the reader told
   * us about and the plan then spent as though it were free, which is the
   * understating direction. `an-empty-set-is-not-a-fact-about-money` — the
   * caller has to be able to say "you declared 3 and we count 2", so the
   * refusals leave this function rather than dying inside it.
   */
  refused: RefusedReserve[];
}

/**
 * Resolve stored declarations into countable monthly lines.
 *
 * Pure and total: every input row leaves as either a line or a refusal, so the
 * two arrays always account for the input exactly.
 */
export function resolveReserves(
  declarations: readonly ReserveDeclaration[],
): ReserveResolution {
  const lines: ReserveLine[] = [];
  const refused: RefusedReserve[] = [];
  for (const d of declarations) {
    if (!isReserveCadence(d.cadence)) {
      refused.push({ id: d.id, name: d.name, reason: 'bad-cadence' });
      continue;
    }
    if (!Number.isSafeInteger(d.trueCostCents) || d.trueCostCents <= 0) {
      // Zero is refused with the rest: a $0.00 reserve line under a total is a
      // claim that a commitment exists at no cost, and the reader who typed it
      // meant to type something else.
      refused.push({ id: d.id, name: d.name, reason: 'bad-amount' });
      continue;
    }
    const monthlyCents = monthlyRateCents(d.trueCostCents, d.cadence);
    if (monthlyCents === 0) {
      // A positive cost whose monthly share rounds to nothing (under 12c a year).
      // Admitted as a line it would print $0.00 under a total, leave the basis at
      // `'none'` while a line exists, and — measured — walk `buildFixedList` into
      // the one state its own ladder has no branch for, returning an EMPTY note
      // where the type promises a sentence in every case (C.23 critic P2-1).
      // A commitment of nothing is not a commitment; it is refused and said.
      refused.push({ id: d.id, name: d.name, reason: 'rounds-to-zero' });
      continue;
    }
    lines.push({
      id: d.id,
      name: d.name,
      trueCostCents: d.trueCostCents,
      cadence: d.cadence,
      monthlyCents,
      pairedToBill: d.pairedToBill === true,
    });
  }
  lines.sort((a, b) => b.monthlyCents - a.monthlyCents || a.name.localeCompare(b.name));
  return {
    lines,
    monthlyTotalCents: lines.reduce((sum, l) => sum + l.monthlyCents, 0),
    refused,
  };
}

/**
 * The one sentence every surface qualifying the Fixed figure adds when reserves
 * are inside it — authored ONCE here and imported, never re-typed per surface.
 *
 * Four authors describe the Fixed term's basis today (`fixedLabel`,
 * `safeToSpendParts`, the composition card, and the Fixed list's own note), and
 * L.30 opened one gap in two places by letting two of them hand-roll the same
 * list. Each of those sentences enumerates where the money came from, so each is
 * INCOMPLETE the moment a source with no transaction behind it enters the figure
 * — and a reader who reconciles the enumeration against the total finds a
 * difference the app never mentions.
 *
 * Returns '' when there are none, so a caller can append unconditionally without
 * inventing a mechanism that did not act (the `longCadencesInTerm` rule).
 */
export function reserveTermClause(reserveCount: number): string {
  if (reserveCount <= 0) return '';
  return reserveCount === 1
    ? 'It also includes the reserve you declared — money set aside monthly for something that has no bill yet.'
    : `It also includes the ${reserveCount} reserves you declared — money set aside monthly for things that have no bill yet.`;
}

/** The same fact as a row-label suffix, for the surfaces that print a label
 *  rather than a sentence. '' when there are none. */
export function reserveLabelSuffix(reserveCount: number): string {
  return reserveCount > 0 ? ' + reserves you declared' : '';
}

/**
 * The basis clause printed beside a reserve line.
 *
 * A MONTHLY reserve gets none, for `billBasisNote`'s reason: a qualifier on a
 * line that needs none trains readers to skip the ones that do. The three
 * divided rhythms always get one, because the figure listed is deliberately not
 * the amount the reader will ever pay at once — which is the entire point of a
 * sinking fund and the entire risk of listing it beside real bills.
 *
 * NO MONEY IN THIS STRING, though the true cost is the obvious thing to name in
 * it. Currency formatting happens only at the UI boundary in this codebase (one
 * `formatCents`), and threading a formatter into the engine to satisfy one
 * clause would put a second formatting authority behind every money sentence the
 * plan prints. The line carries `trueCostCents` instead, and the surface renders
 * it.
 */
export function reserveBasisNote(cadence: ReserveCadence): string | null {
  if (cadence === 'MONTHLY') return null;
  const words: Record<Exclude<ReserveCadence, 'MONTHLY'>, string> = {
    QUARTERLY: 'a third of the quarterly cost',
    SEMIANNUAL: 'a sixth of the half-yearly cost',
    ANNUAL: 'a twelfth of the yearly cost',
  };
  return ` (set aside monthly — ${words[cadence]})`;
}
