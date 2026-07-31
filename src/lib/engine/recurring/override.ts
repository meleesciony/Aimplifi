/**
 * The reader's own verdict on whether a merchant is a bill (O.13f / O.15 slice 4).
 *
 * Detection needs THREE sightings at a stable amount with agreeing gaps before it
 * will call anything recurring (see `detectRecurring`), and that bar is deliberate:
 * a false positive prints a dated outflow on /calendar and can raise a radar "move
 * $X by <date>" for a bill that does not exist. But the bar has a cost the app has
 * never let the reader pay off — he can KNOW the rent he has paid once from this
 * account is monthly, and there was no way to say so; and he can see a series the
 * detector invented from three haircuts, and no way to say it is wrong.
 *
 * This module is the leaf: the closed sets, the stored-row parser, and the key the
 * reader's instruction is matched on. The application lives in `detect.ts`, inside
 * `detectRecurring` itself, because five production surfaces detect independently
 * (the /recurring page, the projection writer, the merchant lens, the radar's
 * committed-merchant exclusion and the coach) and an instruction honoured by four
 * of them is worse than one honoured by none — one of them would still be printing
 * the bill he told the app to stop projecting.
 *
 * Pure: no I/O, no dates of its own, no copy.
 */
import type { Cadence } from '@/lib/engine/recurring/detect';

/** What the reader said about a merchant. */
export type RecurringDecision =
  /** "This IS a bill" — projected at the cadence he chose, even where detection
   *  found too little evidence to say so itself. */
  | 'BILL'
  /** "This is NOT a bill" — never detected, never projected, on every surface. */
  | 'NOT_BILL';

/**
 * The cadences a reader may DECLARE. Exactly the six `classifySeriesProjection`
 * will project — IRREGULAR is not a rhythm and cannot be chosen, so a declared
 * series can never carry the one cadence that reaches no money surface (which
 * would be an instruction the app accepts and then silently drops).
 */
export const DECLARABLE_CADENCES: readonly Exclude<Cadence, 'IRREGULAR'>[] = [
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
];

/** A reader instruction, already validated. `cadence` is non-null for BILL and
 *  null for NOT_BILL — the parser is what guarantees it, so consumers do not
 *  each re-check. */
export interface RecurringOverrideInput {
  merchantCanonical: string;
  decision: RecurringDecision;
  cadence: Exclude<Cadence, 'IRREGULAR'> | null;
  /**
   * The DIRECTION of the charge he was standing on. Part of the instruction, and
   * the money critic proved why: without it the engine falls back to whichever
   * sign is in the majority for that payee, so a $49.99 purchase carrying two
   * refunds was declared as recurring INCOME of $25.00 — a sign and an amount the
   * reader never stated, projected onto the payment account as scheduled income,
   * which is the direction that silences warnings. Null only on NOT_BILL and on
   * rows written before the column existed; the engine then falls back as before,
   * and says so at the fallback.
   */
  declaredSign: 'OUT' | 'IN' | null;
}

/**
 * The shape as it comes back from the database: free strings, because the columns
 * are free strings (SQLite portability + additive values, the `taxClass` idiom).
 */
export interface StoredRecurringOverride {
  merchantCanonical: string;
  decision: string;
  cadence: string | null;
  declaredSign?: string | null;
}

/**
 * Refusals the WRITE path returns verbatim. Here rather than beside the action,
 * because a `'use server'` module may export only async functions — and here
 * rather than in the component, because the server owns what it refuses.
 */
/**
 * Why a particular ROW may not be declared recurring. A closed set, in the engine
 * beside the rules, so the menu's disabled reason, the detail page's refusal and
 * the server's `{ok:false}` are one sentence rather than three that can drift —
 * the O.15 slice-2 arrangement, which the first cut of this slice broke: the menu
 * refused a transfer while the detail page three inches away offered the form,
 * saved it, and said it was projected (reader critic P1-2).
 */
export const VERDICT_BLOCKED_TRANSFER =
  'Aimplifi reads this as a move between your own accounts, and those are never tracked as bills.';
export const VERDICT_BLOCKED_SPLIT_PARENT =
  'A split container is left out of every total, so there is no charge here to repeat — mark one of its pieces.';
/**
 * The one the money critic found. `Check`, `Venmo`, `Zelle Payment`, `Cash App`
 * and `PayPal Transfer` are ONE canonical covering many unrelated payees
 * (`isAggregateCanonical`). Detection is safe there only because three sightings
 * at a STABLE amount are needed; a declaration has no such bar, so "my rent is
 * monthly" said on `CHECK #2204` ($1,800) would project whatever the most recent
 * check happened to be — $40 to the gardener — as the rent, on /calendar, in
 * cash-needed and in the plan.
 */
export const VERDICT_BLOCKED_AGGREGATE =
  'This payee name covers everything you pay this way, so Aimplifi cannot tell one of them from another — marking it recurring would follow whichever one came last. Try a rule to give this charge its own payee first.';

export const VERDICT_UNKNOWN_ROW =
  'That transaction is no longer available — nothing was changed.';
export const VERDICT_NO_PAYEE =
  'Aimplifi has no payee name for that transaction yet, so there is nothing to mark as recurring.';

/** No instructions — what the seed, the benchmark and the pure tests pass. */
export const NO_RECURRING_OVERRIDES: readonly RecurringOverrideInput[] = [];

export function isDeclarableCadence(v: unknown): v is Exclude<Cadence, 'IRREGULAR'> {
  return typeof v === 'string' && (DECLARABLE_CADENCES as readonly string[]).includes(v);
}

/**
 * Read one stored row. Anything unrecognized reads back as NO INSTRUCTION
 * (`null`) rather than landing on a guess — the same rule `isTaxClass` follows,
 * and the safe direction here: an unreadable row leaves detection exactly as it
 * was, where a guess would either invent a projected bill or delete a real one.
 *
 * A BILL with no readable cadence is refused for the same reason: the cadence IS
 * the instruction (it decides the dated outflow and the monthly rate), so there
 * is nothing to honour without it.
 */
export function parseRecurringOverride(row: StoredRecurringOverride): RecurringOverrideInput | null {
  if (typeof row.merchantCanonical !== 'string' || row.merchantCanonical.trim() === '') return null;
  if (row.decision === 'NOT_BILL') {
    return { merchantCanonical: row.merchantCanonical, decision: 'NOT_BILL', cadence: null, declaredSign: null };
  }
  if (row.decision === 'BILL' && isDeclarableCadence(row.cadence)) {
    return {
      merchantCanonical: row.merchantCanonical,
      decision: 'BILL',
      cadence: row.cadence,
      // An unrecognized value reads as "he did not say", never as a guessed
      // direction — the fallback is at least the majority of his own charges.
      declaredSign: row.declaredSign === 'OUT' || row.declaredSign === 'IN' ? row.declaredSign : null,
    };
  }
  return null;
}

/**
 * The key an instruction is matched on.
 *
 * Case- and width-insensitive, and NOT the raw canonical, for a measured reason:
 * `Merchant.canonical` can hold two rows differing only in case (`costco` and
 * `Costco` — the recorded O.13c residual, because a portable case-insensitive
 * lookup is not available across SQLite and Postgres in Prisma). Those render
 * identically in the register, so a reader who says "this is not a bill" about
 * one of them means both; matching the stored bytes would honour his instruction
 * on one identity and keep projecting the other, with the page showing the
 * override as applied. NFC first, so a composed and a decomposed accent are one
 * merchant (the #229 Unicode-boundary rule).
 */
export function overrideKey(merchantCanonical: string): string {
  return merchantCanonical.normalize('NFC').trim().toLowerCase();
}

/**
 * What an instruction is ACTUALLY doing right now — the four outcomes, named, so
 * /recurring can say which one applies instead of implying the reader's verdict is
 * always the thing being projected.
 *
 * The middle two are the pair that matters: a BILL declaration whose payee ALSO
 * detects on its own is not the instruction in force (detection wins the details —
 * see `detectRecurring`), and telling the reader "you marked this, every three
 * months" while the app projects it monthly would be a false statement about his
 * own money.
 */
export type VerdictEffect =
  /** NOT_BILL: the payee reaches no list and no projection. */
  | 'suppressed'
  /** BILL: this series exists because he said so. */
  | 'projected-as-declared'
  /** BILL, but the charges earned a series by themselves — the evidence's cadence
   *  is what runs, and his declaration is redundant rather than wrong. */
  | 'detected-anyway'
  /** BILL with no charges under that payee: stored, and doing nothing. */
  | 'no-charges';

export function verdictEffect(
  decision: string,
  merchantCanonical: string,
  series: readonly { merchantCanonical: string; declaredByUser: boolean }[],
): VerdictEffect {
  if (decision === 'NOT_BILL') return 'suppressed';
  const key = overrideKey(merchantCanonical);
  const match = series.find((s) => overrideKey(s.merchantCanonical) === key);
  if (!match) return 'no-charges';
  return match.declaredByUser ? 'projected-as-declared' : 'detected-anyway';
}

/**
 * Index instructions by `overrideKey`. A duplicate key keeps the FIRST row — the
 * table's `@@unique([userId, merchantCanonical])` makes duplicates reachable only
 * through the case collision above, and either row states the same reader intent
 * about the same on-screen payee. Deterministic, so two surfaces reading the same
 * rows in the same order can never resolve one merchant differently.
 */
export function buildOverrideMap(
  overrides: readonly RecurringOverrideInput[],
): Map<string, RecurringOverrideInput> {
  const map = new Map<string, RecurringOverrideInput>();
  for (const o of overrides) {
    const key = overrideKey(o.merchantCanonical);
    if (!map.has(key)) map.set(key, o);
  }
  return map;
}
