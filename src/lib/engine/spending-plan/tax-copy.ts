/**
 * The tax rule's sentences (DECISIONS #783) — ONE author for every surface that
 * states it: the Guilt-free page, the /budgets strip, both Ask answers and the
 * glass box. The first two cuts had three authors who named different levers
 * and different scopes (critic cycle 2, P2-4); a rule whose wording drifts per
 * surface is the L.23 defect returning as copy.
 *
 * Copy guardrails: states the rule and the levers, never the reader's situation
 * ("your pay already has tax withheld" is false for a self-employed reader), and
 * every lever named is one that exists and moves the figure.
 */
import { cents, formatCents } from '@/lib/money';
import { categoryName } from '@/lib/engine/categorize/categories';
import type { TaxCategoryNames, TaxChargesLeftOut } from '@/lib/engine/spending-plan/tax-categories';

/** The built-in names — what a reader who renamed nothing sees in the picker. */
export function builtInTaxCategoryNames(): TaxCategoryNames {
  return {
    taxes: categoryName('taxes'),
    estimatedTax: categoryName('estimated-tax'),
    propertyTax: categoryName('property-tax'),
    financial: categoryName('financial'),
  };
}

/** The rule, stated as a rule — true for every reader, with or without a tax
 *  charge (`an-unconditional-sentence-may-only-state-a-rule`). */
export function taxRuleSentence(names: TaxCategoryNames = builtInTaxCategoryNames()): string {
  return `Charges filed as ${names.taxes} or ${names.estimatedTax} are never counted here — income tax paid to the government directly is not a monthly cost in this plan (${names.propertyTax} still counts, as a cost of your home). A monthly target you set for either tax category does count, as your own number.`;
}

/**
 * What was left out, and the levers. `direction` is the SURFACE's figure: a
 * reader who really pays estimated taxes from counted pay has less room to spend
 * than a left-to-spend figure says, and a bigger overage than an over-plan one
 * says. `null` where the surface states no such figure, or where a Fixed
 * override may already include the payments (a claim about the reader's own
 * number this sentence cannot check).
 */
export function taxLeftOutSentence(
  t: TaxChargesLeftOut,
  direction: 'left-to-spend' | 'overage' | null,
): string {
  const n = t.names ?? builtInTaxCategoryNames();
  const months = `${t.months} complete month${t.months === 1 ? '' : 's'}`;
  const charges = `${t.count} charge${t.count === 1 ? '' : 's'}`;
  const parts = [
    `Not counted here: ${formatCents(cents(t.totalCents))} filed as taxes in your last ${months} (${charges}).`,
    'Income tax paid to the government directly isn’t a monthly cost in this plan.',
    // The categorizer and the bank's own category both file some property-tax
    // descriptors as taxes, and rows already filed do not move on their own
    // (critic cycle 2, P1-2) — so the way back is named wherever the total is.
    `If one of these was property tax on your home, file it under ${n.propertyTax} and it counts; a tax-prep fee, under ${n.financial}.`,
  ];
  if (t.targetCents > 0) {
    parts.push(`Your monthly tax target of ${formatCents(cents(t.targetCents))} is counted in their place.`);
  } else {
    const until =
      direction === 'overage'
        ? ' — until you do, your real overage is bigger by those payments'
        : direction === 'left-to-spend'
          ? ' — until you do, your real room to spend is smaller by those payments'
          : '';
    // "quarterly estimates or a monthly payment plan" (critic cycle 3, P2-D): an
    // IRS installment agreement is a detected MONTHLY tax series the rule also
    // leaves out, and a lever addressed only to quarterly payers skipped them.
    parts.push(
      `Paying tax on a schedule from your regular income — quarterly estimates or a monthly payment plan? Set money aside for it under “Money you set aside each month” on the Guilt-free page and it counts${until}.`,
    );
  }
  return parts.join(' ');
}
