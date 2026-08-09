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
import {
  frozenFundingNote,
  frozenProjectionNote,
} from '@/lib/engine/account/feed-dropped-view';

/**
 * The tier's "why am I seeing this" rule line. Tier-generic, EXCEPT where a kind
 * gives the tier a different meaning: a confirmed income pause sits at HANDLED,
 * but "Autopay covers this — nothing to do" would be a false claim there (#251
 * critic F2 — nothing is on autopay, and there IS something to do: Undo). Exported
 * from the copy module (not the card) so the honesty is directly unit-testable.
 */
export function tierRule(p: Proposal): string {
  if (p.kind === 'income_pause' && p.tier === 'handled') {
    return 'You confirmed this income is paused — kept visible, with Undo, for as long as cash projections exclude it.';
  }
  return TIER_RULE_GENERIC[p.tier];
}

const TIER_RULE_GENERIC: Record<Proposal['tier'], string> = {
  critical: 'It needs attention soon, so it is ranked at the top and never hidden.',
  action: 'It needs a decision, but there is no deadline pressure yet.',
  opportunity: 'A possible saving — no deadline. Dismiss it and it stays gone until the underlying figure changes.',
  handled: 'Autopay covers this — nothing to do. Shown only so you know it is handled.',
};

/** Days-until phrasing from the verbatim `daysUntil` passthrough (never recomputed). */
export function whenPhrase(daysUntil: number | null): string {
  if (daysUntil === null) return '';
  if (daysUntil <= 0) return ' (today)';
  if (daysUntil === 1) return ' (in 1 day)';
  return ` (in ${daysUntil} days)`;
}

/** The raw, verbatim fields behind a proposal — shown in the "why" disclosure. */
export function whyInputs(p: Proposal): string {
  const money = formatCents(p.centsAtStake as Cents);
  // Per-kind money semantics (#249 critic P2-4 / #251): an unusual charge is already
  // SPENT and a paused income's figure is money that DIDN'T arrive — "at stake"
  // would misstate either.
  const parts = [
    p.kind === 'unusual_charge'
      ? `a ${money} charge`
      : p.kind === 'income_pause'
        ? `an expected ${money} deposit`
        : `${money} at stake`,
  ];
  if (p.sortDate) parts.push(`dated ${formatISODate(p.sortDate as ISODate)}`);
  if (p.daysUntil !== null) parts.push(`${p.daysUntil} day${p.daysUntil === 1 ? '' : 's'} out`);
  if (p.isEstimated) parts.push('based on an estimate');
  return parts.join(' · ');
}

/**
 * The frozen-funding qualifier for ONE proposal (TASKS L.20), or null when its figure is not
 * projected from a frozen balance.
 *
 * Two kinds, two sentences, because the two rows make different claims: the shortfall row states an
 * amount the reader is short and is qualified as an INSTRUCTION (`role: 'instruction'` adds the
 * "treat the amount as a floor" guard), while the dip row re-prints the radar's 90-day verdict and
 * takes the projection sentence. `shows` is read from `centsAtStake`, the same value the detail
 * line above uses to decide whether it prints a transfer at all — so the qualifier always describes
 * the sentence actually on screen rather than a status enum's idea of it.
 *
 * `nextStep: 'accounts-route'` on both: this feed renders inside the app, where /accounts is a real
 * route — named as a route, never as a position.
 */
export function proposalFrozenNote(p: Proposal): string | null {
  if (!p.fundingFrozen) return null;
  if (p.kind === 'cash_needed_shortfall') {
    return frozenFundingNote(p.fundingFrozen, { role: 'instruction', nextStep: 'accounts-route' });
  }
  if (p.kind === 'cash_flow_dip') {
    return frozenProjectionNote(p.fundingFrozen, {
      shows: p.centsAtStake > 0 ? 'a-transfer' : 'a-dip',
      nextStep: 'accounts-route',
    });
  }
  // No other kind is projected from the funding balance, so no other kind may borrow a sentence
  // that says it is. `select.ts` sets the field to null on all of them; this is the second lock.
  return null;
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
    case 'unusual_charge': {
      // centsAtStake = the flagged charge's magnitude (verbatim from the detector).
      // The typical figure is the detector's MEDIAN at this merchant — its basis
      // ("median of N charges") is disclosed INLINE next to the number (coaching
      // guardrail), so the comparison can never read as a guess or a judgment.
      // Owner-neutral and no-shame by design: the charge is stated as a fact worth a
      // look, never as overspending — it may be legitimate (a group order, a gift),
      // and dismissing it is offered as the expected outcome.
      const typical =
        p.typicalCents !== null && p.typicalCount !== null
          ? ` — larger than the typical ${formatCents(p.typicalCents as Cents)} there (median of ${p.typicalCount} charges)`
          : '';
      return {
        title: 'Unusual charge worth a look',
        detail: `${money}${p.merchant ? ` at ${p.merchant}` : ''}${date ? ` on ${date}` : ''}${typical}. If it’s expected, dismiss this.`,
      };
    }
    case 'income_pause': {
      // centsAtStake = the paused series' typical deposit (verbatim from the
      // detector) — money that DIDN'T arrive, never "at stake" or "spent". The
      // basis is disclosed inline twice (coaching guardrail): the cadence claim
      // rests on "based on N deposits", and the runway figure names its own
      // formula (cash on hand ÷ the window's average expenses) right next to the
      // number. Copy-subject audit (second-person lesson): income pauses are
      // computed from the VIEWER's own coach data (viewer-only, like
      // unusual_charge — the #249 household asymmetry), so "your cash on hand"
      // always addresses the true owner of both the income and the cash.
      // No-shame and non-advisory: a paused income is stated as a fact worth
      // confirming — it may be planned (a sabbatical, a job change, seasonal
      // work) — and dismissing is offered as an expected outcome.
      const cadenceWord =
        p.cadence === 'WEEKLY' ? 'weekly' : p.cadence === 'BIWEEKLY' ? 'every two weeks' : 'monthly';
      if (p.tier === 'handled') {
        // CONFIRMED state (quiet): the projection exclusion is in force. This row
        // stays for as long as it is — the mutation is always visible, and the UI
        // hangs the Undo on it. Descriptive, not celebratory or alarmed.
        return {
          title: 'Income marked paused',
          detail:
            `${money} from ${p.merchant ?? 'this source'} — you confirmed this income is paused, ` +
            `so cash projections don’t count it. It returns automatically when a new deposit arrives, ` +
            `or use Undo if this was a mistake.`,
        };
      }
      const basis = p.typicalCount !== null ? ` (based on ${p.typicalCount} deposits)` : '';
      // Audit P2: a negative runway is cash below zero — the nudge engine clamps
      // non-positive runway to null (select.ts), so this surface abstains rather
      // than printing "-2.3 months" as a fact; the coach surfaces name what
      // negative is (COACH_COPY.runway / runwayBanded / reviewImprovementRunway).
      const runway =
        p.runwayMonths !== null
          ? ` If it stays paused, your cash on hand covers about ${p.runwayMonths} months of typical spending (cash ÷ your ${p.runwayWindowMonths}-month average expenses).`
          : '';
      return {
        title: 'A regular deposit seems paused',
        detail:
          `${money} from ${p.merchant ?? 'this source'} usually arrives ${cadenceWord}; ` +
          `the deposit expected around ${date ?? 'its usual date'} hasn’t appeared${basis}.` +
          `${runway} If this is a pause you expected, dismiss this.`,
      };
    }
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
