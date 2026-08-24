/**
 * P.1 remaining half — the radar/cash-dip counterfactual behind "what should
 * I cut?".
 *
 * A cut is a decision with a counterfactual (TASKS.md Wave P, row P.1). The
 * FI half (`src/lib/engine/fi/counterfactual.ts`) re-runs `monthsToFI` on
 * changed scalars. The cash-flow half cannot: the dip date and the cover
 * transfer are properties of a 90-day walk, so the harness filters the cut
 * series' scheduled rows (the same `radarFromSnapshot` input the dashboard
 * radar reads) and re-calls the pure engine. This module is that harness's
 * pure core:
 *
 *  1. `applyCutsToScheduled` — drop or reduce scheduled outflows by the
 *     per-merchant MAX cut (same rule as `cutByMerchant`; `negotiable-bill`
 *     is scaled onto the row cadence so a $20/mo estimate cannot cancel a
 *     weekly series).
 *  2. `cutRadarCounterfactual` — compare the two walks' dip date and cover
 *     amount, and report only IMPROVEMENT. The duplicate-pair radar gate
 *     (server/radar.ts) is the precedent: re-walk, speak only if the dip
 *     date or the cover amount actually moves. A worsening-only result is
 *     the honest null — never a fabricated "your dip disappears".
 *
 * Opportunity carries no series id, so matching is by merchant canonical
 * (`normalizeMerchant` on the scheduled description, which for
 * `toScheduledRow` IS the series' `merchantCanonical`). Card-billed
 * subscriptions that never appear as checking scheduled rows change
 * nothing here; the sentence stays silent rather than inventing a move
 * in card dues this walk does not recompute.
 *
 * Pure: no I/O, integer cents, calendar dates, deterministic.
 */

import { type ISODate, compareDates } from '@/lib/dates';
import { type Cents, cents } from '@/lib/money';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import type { Opportunity, OpportunityKind } from '@/lib/engine/fi/insights';
import type { RadarResult } from '@/lib/engine/radar/radar';

export interface ScheduledCutRow {
  description: string;
  amountCents: number;
  /**
   * The series cadence, when the caller has it (`ScheduledLike.cadence`,
   * `toScheduledRow`). Required to scale a calendar-monthly estimate
   * (`negotiable-bill` is always $20/mo) onto a weekly/biweekly template —
   * applying $20 against one $15 weekly hit would cancel ~13 occurrences.
   * Absent ⇒ treated as monthly (the fail-safe: do not overstate).
   */
  cadence?: string | null;
}

export interface RadarCutSides {
  /** `RadarResult.committed.firstNegativeDate` — null when the committed line never goes negative. */
  firstNegativeDate: ISODate | null;
  /** `RadarResult.coverTransfer.amountCents` — null when there is no cover transfer. */
  coverCents: Cents | null;
}

export interface CutRadarCounterfactual {
  baselineDipDate: ISODate | null;
  cutDipDate: ISODate | null;
  /** Baseline had a dip and the cut walk does not. */
  dipDisappears: boolean;
  /** Both walks have a dip and the cut dip is strictly later. */
  dipLater: boolean;
  baselineCoverCents: Cents | null;
  cutCoverCents: Cents | null;
  /**
   * How much smaller the cover transfer is (baseline − cut, or the whole
   * baseline when the cover goes away). 0 when the cover does not shrink —
   * including when it grows. A rounded-to-$50 cover that does not move is 0.
   */
  coverDropCents: Cents;
  /**
   * Any improvement the copy may speak. False when nothing improved —
   * identical walks, and worsening-only walks, both land here.
   */
  moved: boolean;
}

/**
 * The two fields the dip/cover sentence is allowed to read. One author so a
 * later walk that grows a new figure cannot silently enter the claim.
 */
export function radarCutSides(
  radar: Pick<RadarResult, 'committed' | 'coverTransfer'>,
): RadarCutSides {
  return {
    firstNegativeDate: radar.committed.firstNegativeDate,
    coverCents: radar.coverTransfer?.amountCents ?? null,
  };
}

/**
 * Apply the cut list to a scheduled array: each merchant's largest opportunity
 * is consumed against matching outflows, largest-first-row-wins at the map
 * and then remaining-cut-against-rows in array order.
 *
 * A cut that covers the whole row drops it (cancel the series) ONLY when the
 * winning opportunity is already denominated per occurrence (unused-
 * subscription, price-increase delta, 15% re-shop). `negotiable-bill` is a
 * calendar-monthly $20: it is scaled onto the row's cadence before it is
 * compared to the template, so a weekly $15 internet is reduced by ~$4.62
 * per hit, not cancelled. Promising the whole series gone for a $20/mo
 * estimate would overstate the dip. Income rows (`amountCents >= 0`) are
 * never touched, even if a merchant string collided.
 *
 * Matching is `normalizeMerchant(description).canonical` against
 * `Opportunity.merchant` (already canonical). Unmatched rows pass through
 * unchanged, including extra fields the caller hung on the row.
 */
export function applyCutsToScheduled<T extends ScheduledCutRow>(
  scheduled: readonly T[],
  opportunities: readonly Opportunity[],
): T[] {
  const remaining = new Map<string, number>();
  const kindOf = new Map<string, OpportunityKind>();
  for (const o of opportunities) {
    const prev = remaining.get(o.merchant) ?? 0;
    if (o.monthlyCents > prev) {
      remaining.set(o.merchant, o.monthlyCents);
      kindOf.set(o.merchant, o.kind);
    }
  }
  const out: T[] = [];
  for (const row of scheduled) {
    if (row.amountCents >= 0) {
      out.push(row);
      continue;
    }
    const canonical = normalizeMerchant(row.description).canonical;
    const left = remaining.get(canonical) ?? 0;
    if (left <= 0) {
      out.push(row);
      continue;
    }
    const abs = Math.abs(row.amountCents);
    const kind = kindOf.get(canonical);
    const occurrenceBudget =
      kind === 'negotiable-bill' ? monthlyCutToOccurrenceCents(left, row.cadence) : left;
    const applied = Math.min(occurrenceBudget, abs);
    if (applied <= 0) {
      out.push(row);
      continue;
    }
    // Consume the merchant pool in the same unit it was stored (per-occurrence
    // for unused/delta/15%; calendar-monthly for negotiable-bill).
    if (kind === 'negotiable-bill' && occurrenceBudget > 0) {
      remaining.set(canonical, Math.max(0, left - Math.round((applied * left) / occurrenceBudget)));
    } else {
      remaining.set(canonical, left - applied);
    }
    const nextAbs = abs - applied;
    if (nextAbs === 0) continue; // series cancelled
    out.push({ ...row, amountCents: -nextAbs });
  }
  return out;
}

/**
 * A calendar-monthly cut expressed per scheduled occurrence, so a $20/mo
 * retention offer is ~$4.62 against a weekly template, $20 against monthly,
 * $60 against quarterly. Integer cents, rounded to nearest. Unknown cadence
 * is treated as monthly (the cheap fail-safe — do not invent a weekly
 * conversion that would under-cut a monthly bill).
 */
export function monthlyCutToOccurrenceCents(
  monthlyCents: number,
  cadence: string | null | undefined,
): number {
  switch (cadence) {
    case 'WEEKLY':
      return Math.round((monthlyCents * 12) / 52);
    case 'BIWEEKLY':
      return Math.round((monthlyCents * 12) / 26);
    case 'QUARTERLY':
      return monthlyCents * 3;
    case 'SEMIANNUAL':
      return monthlyCents * 6;
    case 'ANNUAL':
      return monthlyCents * 12;
    default:
      return monthlyCents;
  }
}

/**
 * Compare two radar walks. Speaks only improvement: a disappeared dip, a
 * later first-negative date, or a smaller cover. The `$50` round-up lives
 * inside `computeRadar`; this compares the figures that walk already rounded.
 */
export function cutRadarCounterfactual(
  baseline: RadarCutSides,
  cut: RadarCutSides,
): CutRadarCounterfactual {
  const dipDisappears = baseline.firstNegativeDate !== null && cut.firstNegativeDate === null;
  const dipLater =
    baseline.firstNegativeDate !== null &&
    cut.firstNegativeDate !== null &&
    compareDates(cut.firstNegativeDate, baseline.firstNegativeDate) > 0;

  let coverDrop = 0;
  if (baseline.coverCents !== null && baseline.coverCents > 0) {
    const cutCover = cut.coverCents ?? 0;
    if (cutCover < baseline.coverCents) coverDrop = baseline.coverCents - cutCover;
  }

  return {
    baselineDipDate: baseline.firstNegativeDate,
    cutDipDate: cut.firstNegativeDate,
    dipDisappears,
    dipLater,
    baselineCoverCents: baseline.coverCents,
    cutCoverCents: cut.coverCents,
    coverDropCents: cents(coverDrop),
    moved: dipDisappears || dipLater || coverDrop > 0,
  };
}
