/**
 * Pure display copy for the "Today" nudge feed (NUDGE_PLAN slice 2). Extracted from
 * the client card so the money-honesty surface is DIRECTLY unit-testable (a regression
 * to summing or relabeling a figure is caught here, not only by an e2e that happens to
 * seed the right shape). No React, no state — string formatting only.
 *
 * The one rule these functions encode: `centsAtStake` means a DIFFERENT thing per kind
 * (the monthly INCREASE for price-increase; an ESTIMATED monthly saving for
 * insurance-reshop/negotiable-bill; the actual monthly cost for unused-subscription;
 * the user-action amount — the remainder after autopay — for payment_due). Each branch
 * labels its figure with the correct semantic (the #221 false-money-copy class), every
 * estimated figure discloses "(estimated)" INLINE (coaching guardrail — assumptions
 * stated where the number is, not only in the collapsed disclosure), titles are
 * obligation-neutral ("Payment due" covers cards AND loans), and nothing addresses the
 * reader as the payer (a partner's row can flow in at household scope). No money
 * arithmetic: the two verbatim parts of a split are shown, never summed.
 */
import { type ISODate, formatISODate } from '@/lib/dates';
import { type Cents, formatCents } from '@/lib/money';
import type { Proposal } from '@/lib/engine/nudge/types';

/** Days-until phrasing from the verbatim `daysUntil` passthrough (never recomputed). */
export function whenPhrase(daysUntil: number | null): string {
  if (daysUntil === null) return '';
  if (daysUntil <= 0) return ' (today)';
  if (daysUntil === 1) return ' (in 1 day)';
  return ` (in ${daysUntil} days)`;
}

/** The raw, verbatim fields behind a proposal — shown in the "why" disclosure. */
export function whyInputs(p: Proposal): string {
  const parts = [`${formatCents(p.centsAtStake as Cents)} at stake`];
  if (p.sortDate) parts.push(`dated ${formatISODate(p.sortDate as ISODate)}`);
  if (p.daysUntil !== null) parts.push(`${p.daysUntil} day${p.daysUntil === 1 ? '' : 's'} out`);
  if (p.isEstimated) parts.push('based on an estimate');
  return parts.join(' · ');
}

export function proposalCopy(p: Proposal): { title: string; detail: string } {
  const money = formatCents(p.centsAtStake as Cents);
  const date = p.sortDate ? formatISODate(p.sortDate as ISODate) : null;
  // Inline estimate marker for the projection kinds whose figure is estimate-DRIVEN
  // (payment_due carries its own "(estimated statement)" wording; the opportunity kinds
  // that are always estimates say "(estimated)" in their own copy).
  const estMark = p.isEstimated ? ' (estimated)' : '';

  switch (p.kind) {
    case 'payment_due': {
      const est = p.isEstimated ? ' (estimated statement)' : '';
      if (p.tier === 'handled') {
        // Fully covered by autopay: centsAtStake is the autopay amount itself.
        return {
          title: 'Payment scheduled (autopay)',
          detail: `${money}${date ? ` on ${date}` : ''}${est} — autopay moves it automatically; the funds need to be in the account by then.`,
        };
      }
      // centsAtStake here is `userActionCents` — the amount to pay AFTER autopay, not the
      // statement total. When autopay covers part, disclose that split (verbatim
      // autopayCents) so this figure can't be misread as the whole statement and the feed
      // stays in lockstep with the reminders card. The two parts are shown, never summed.
      const autopayNote =
        p.autopayCents > 0 ? ` (autopay covers ${formatCents(p.autopayCents as Cents)})` : '';
      return {
        title: 'Payment due',
        detail: `${money} to pay${date ? ` by ${date}` : ''}${whenPhrase(p.daysUntil)}${autopayNote}${est}.`,
      };
    }
    case 'cash_flow_dip':
      return {
        title: 'Cash flow could dip below $0',
        detail:
          `${date ? `Around ${date}${whenPhrase(p.daysUntil)}. ` : ''}` +
          `${p.centsAtStake > 0 ? `A transfer of about ${money} would cover it${estMark}. ` : ''}` +
          'See Cash Flow Radar below for the exact cover transfer.',
      };
    case 'cash_needed_shortfall':
      return {
        title: 'Short on cash for upcoming bills',
        detail: `About ${money} short${date ? ` by ${date}` : ''}${estMark}. See what’s due above.`,
      };
    case 'price-increase':
      // centsAtStake = the monthly INCREASE (delta), not the new price.
      return {
        title: 'A subscription’s price went up',
        detail: `Up ${money}/mo. Details in Recurring below.`,
      };
    case 'unused-subscription':
      // centsAtStake = the actual monthly cost.
      return {
        title: 'Possibly unused subscription',
        detail: `${money}/mo. Details in Recurring below.`,
      };
    case 'insurance-reshop':
      // centsAtStake = an ESTIMATED monthly saving (~15%), not the premium.
      return {
        title: 'Insurance may be worth re-shopping',
        detail: `Re-shopping could save around ${money}/mo (estimated). Details in Recurring below.`,
      };
    case 'negotiable-bill':
      // centsAtStake = an ESTIMATED monthly saving, not the bill.
      return {
        title: 'This bill may be negotiable',
        detail: `Negotiating could save around ${money}/mo (estimated). Details in Recurring below.`,
      };
    default: {
      const _exhaustive: never = p.kind;
      return _exhaustive;
    }
  }
}
