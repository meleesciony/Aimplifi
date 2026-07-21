/**
 * Smart Notification & Nudge Engine — selector (AI_DIFFERENTIATION_PLAN §2.2, slice 1).
 *
 * Pure and deterministic: tiers each source row by rule, orders within a tier on
 * commensurable fields only (date, then cents at stake), and copies every money and
 * date value verbatim from the source engine — this module does NO money arithmetic
 * (grep-provable: no addCents/sumCents, no arithmetic operator bound to a Cents value).
 *
 * The sharp failure mode is burying what push escalates, so payment_due and
 * cash_flow_dip reuse notify/select's exact push keys and the CRITICAL window is the
 * same NOTIFY_DUE_WINDOW_DAYS constant — shared inputs, not re-derived.
 */
import { type Cents, ZERO } from '@/lib/money';
import { compareDates, type ISODate } from '@/lib/dates';
import type { PaymentReminder } from '@/lib/engine/reminders/select';
import type { RadarResult } from '@/lib/engine/radar/radar';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import type { Opportunity } from '@/lib/engine/fi/insights';
import type { UnusualCharge } from '@/lib/engine/anomaly/detect';
import {
  NOTIFY_DUE_WINDOW_DAYS,
  paymentNotificationKey,
  radarNotificationKey,
} from '@/lib/engine/notify/select';
import type { EngagementSubjectKey } from '@/lib/engine/engagement/event';
import type { NudgeFeed, NudgeInput, Proposal, ProposalKind, ProposalTier } from './types';

const TIER_RANK: Record<ProposalTier, number> = {
  critical: 0,
  action: 1,
  opportunity: 2,
  handled: 3,
};

/**
 * The behavioral-log subject for a proposal — `nudge:<kind>`. The return type is
 * `EngagementSubjectKey` on purpose: it makes the closed-set extension in
 * engagement/event.ts a COMPILE-TIME lockstep. Add a ProposalKind without its
 * `nudge:<kind>` entry there and this annotation fails tsc, rather than the log
 * silently no-op'ing at runtime (isValidEngagementEvent would reject it).
 */
function subjectKey(kind: ProposalKind): EngagementSubjectKey {
  return `nudge:${kind}`;
}

/** CRITICAL dismissals key per-day (auto-clear next build); others key to the fact. */
function dismissKeyFor(tier: ProposalTier, key: string, today: ISODate): string {
  return tier === 'critical' ? `${key}:${today}` : key;
}

// ---- Per-source proposal builders (each row → exactly one Proposal) -------------

function paymentProposal(r: PaymentReminder, today: ISODate, dismissed: ReadonlySet<string>): Proposal {
  // Push floor lockstep: userActionCents > 0 AND daysUntil <= window ⇒ CRITICAL.
  // userActionCents <= 0 means autopay fully covers it ⇒ HANDLED (never pushed).
  let tier: ProposalTier;
  let centsAtStake: Cents;
  if (r.userActionCents <= 0) {
    tier = 'handled';
    centsAtStake = r.autopayCents; // verbatim
  } else if (!(r.daysUntil > NOTIFY_DUE_WINDOW_DAYS)) {
    // Textually mirrors notify/select's push guard (`if (daysUntil > window) continue`)
    // so the two predicates agree on every input, NaN included — the lockstep is by
    // construction, not coincidence.
    tier = 'critical';
    centsAtStake = r.userActionCents; // verbatim
  } else {
    tier = 'action';
    centsAtStake = r.userActionCents; // verbatim
  }
  const key = paymentNotificationKey({ accountId: r.accountId, dueDate: r.dueDate });
  const dismissKey = dismissKeyFor(tier, key, today);
  return {
    kind: 'payment_due',
    tier,
    key,
    dismissKey,
    subjectKey: subjectKey('payment_due'),
    sortDate: r.dueDate, // verbatim
    daysUntil: r.daysUntil, // verbatim
    centsAtStake,
    autopayCents: r.autopayCents, // verbatim — display context for the autopay split
    merchant: null,
    typicalCents: null,
    typicalCount: null,
    isEstimated: r.isEstimated,
    dismissed: dismissed.has(dismissKey),
  };
}

function dipProposal(
  radar: RadarResult | null,
  today: ISODate,
  dismissed: ReadonlySet<string>,
): Proposal | null {
  // pushWorthy already encodes the committed-only within-window test — reuse it,
  // don't re-derive the 7-day math here.
  if (!radar || !radar.pushWorthy || !radar.committed.firstNegativeDate) return null;
  const tier: ProposalTier = 'critical';
  const key = radarNotificationKey(radar.committed.firstNegativeDate);
  const dismissKey = dismissKeyFor(tier, key, today);
  return {
    kind: 'cash_flow_dip',
    tier,
    key,
    dismissKey,
    subjectKey: subjectKey('cash_flow_dip'),
    sortDate: radar.committed.firstNegativeDate, // verbatim
    daysUntil: radar.daysUntilFirstNegative, // verbatim (nullable)
    centsAtStake: radar.coverTransfer?.amountCents ?? ZERO, // verbatim (mirrors notify/select)
    autopayCents: ZERO, // not a payment_due proposal
    merchant: null,
    typicalCents: null,
    typicalCount: null,
    isEstimated: radar.includesEstimatedDues,
    dismissed: dismissed.has(dismissKey),
  };
}

function shortfallProposal(
  cn: CashNeededResult | null,
  today: ISODate,
  dismissed: ReadonlySet<string>,
): Proposal | null {
  if (!cn || cn.headline.shortfallCents <= 0) return null;
  const tier: ProposalTier = 'critical';
  const date = cn.headline.shortfallDate ?? cn.headline.byDate; // verbatim (either source date)
  const key = `cash_needed_shortfall:${date ?? 'undated'}`;
  const dismissKey = dismissKeyFor(tier, key, today);
  // The shortfall is a projection over the cycle's obligations; when any of those
  // obligations is an ESTIMATE (statement not yet generated), the figure rests partly
  // on estimates and must disclose it — mirroring the per-card "(estimated statement)"
  // and dip's `includesEstimatedDues`. A boolean reshape of the engine's own per-card
  // flags (no money arithmetic); the conservative direction (discloses whenever any
  // estimate is in play) never presents an estimate as a settled figure.
  const isEstimated = cn.perDueDate.some((p) => p.cards.some((c) => c.isEstimated));
  return {
    kind: 'cash_needed_shortfall',
    tier,
    key,
    dismissKey,
    subjectKey: subjectKey('cash_needed_shortfall'),
    sortDate: date, // verbatim (nullable)
    daysUntil: null,
    centsAtStake: cn.headline.shortfallCents, // verbatim
    autopayCents: ZERO, // not a payment_due proposal
    merchant: null,
    typicalCents: null,
    typicalCount: null,
    isEstimated,
    dismissed: dismissed.has(dismissKey),
  };
}

/**
 * The opportunity's dismissal identity — keyed to the fact so it returns when the fact
 * changes. The merchant plus a verbatim per-series money discriminant, so two distinct
 * series that share one canonical merchant (e.g. two iCloud tiers) don't collide onto a
 * single dismissal. price-increase already carries its from→to transition, which is a
 * strictly finer discriminant. (No arithmetic — the cents are interpolated, not computed.)
 */
function opportunityKey(o: Opportunity): string {
  switch (o.kind) {
    case 'price-increase':
      // The from→to transition: a NEW price change mints a new key and reappears.
      return `price-increase:${o.merchant}:${o.priceFromCents ?? 'na'}->${o.priceToCents ?? 'na'}`;
    case 'unused-subscription':
    case 'insurance-reshop':
    case 'negotiable-bill':
      return `${o.kind}:${o.merchant}:${o.monthlyCents}`;
    default: {
      const _exhaustive: never = o.kind; // closed union: unknown kinds are unrepresentable
      return _exhaustive;
    }
  }
}

function opportunityProposal(o: Opportunity, today: ISODate, dismissed: ReadonlySet<string>): Proposal {
  const tier: ProposalTier = 'opportunity';
  const key = opportunityKey(o);
  const dismissKey = dismissKeyFor(tier, key, today);
  return {
    kind: o.kind,
    tier,
    key,
    dismissKey,
    subjectKey: subjectKey(o.kind),
    sortDate: null,
    daysUntil: null,
    centsAtStake: o.monthlyCents, // verbatim
    autopayCents: ZERO, // not a payment_due proposal
    merchant: null,
    typicalCents: null,
    typicalCount: null,
    isEstimated: o.isEstimate,
    dismissed: dismissed.has(dismissKey),
  };
}

/**
 * Unusual-charge proposal (#249): the per-merchant median+MAD detector's flag as an
 * ACTION-tier row — it asks for a decision ("was this expected?") with no deadline, so
 * it never competes with CRITICAL warnings and is dismissable. The dismissal fact is
 * the flagged TRANSACTION (`unusual_charge:<txnId>`): dismissing one charge never
 * suppresses a future anomaly, which arrives with a new txn id. Every money value is
 * verbatim from the detector; the typical/median context rides in the display-context
 * fields so the copy can disclose its basis. Deliberately NOT pushed (notify/select is
 * untouched): a statistical "worth a look" is not a payment obligation.
 */
function unusualProposal(u: UnusualCharge, today: ISODate, dismissed: ReadonlySet<string>): Proposal {
  const tier: ProposalTier = 'action';
  const key = `unusual_charge:${u.txnId}`;
  const dismissKey = dismissKeyFor(tier, key, today);
  return {
    kind: 'unusual_charge',
    tier,
    key,
    dismissKey,
    subjectKey: subjectKey('unusual_charge'),
    sortDate: u.date, // verbatim — the charge date orders it within ACTION
    daysUntil: null,
    centsAtStake: u.amountCents, // verbatim — the flagged charge's magnitude
    autopayCents: ZERO, // not a payment_due proposal
    merchant: u.merchantCanonical, // verbatim display context
    typicalCents: u.typicalCents, // verbatim display context
    typicalCount: u.sampleCount, // verbatim display context
    isEstimated: false, // a real posted charge, never an estimate
    dismissed: dismissed.has(dismissKey),
  };
}

// ---- Ordering (commensurable fields only, no arithmetic on money) ---------------

function cmpNum(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Larger money at stake ranks first — comparison only, never subtraction. Params are
 * named `*Cents` so the criterion-1 grep tripwire would catch a future `bCents - aCents`.
 */
function compareCentsDesc(aCents: Cents, bCents: Cents): number {
  if (aCents < bCents) return 1;
  if (aCents > bCents) return -1;
  return 0;
}

/** Dated proposals sort by date ascending; undated ones sort after all dated ones. */
function compareSortDate(a: ISODate | null, b: ISODate | null): number {
  if (a && b) return compareDates(a, b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

/** Locale-free key comparison — the final determinism tiebreak must not depend on ICU. */
function compareKeys(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * A deterministic total order over distinct proposals. The only residual ties are two
 * opportunities identical in (kind, merchant, monthlyCents) — genuinely indistinguishable
 * from the source shape — which the stable sort keeps in input order.
 */
function compareProposals(a: Proposal, b: Proposal): number {
  return (
    cmpNum(TIER_RANK[a.tier], TIER_RANK[b.tier]) ||
    compareSortDate(a.sortDate, b.sortDate) ||
    compareCentsDesc(a.centsAtStake, b.centsAtStake) ||
    compareKeys(a.key, b.key)
  );
}

/**
 * Build the ranked "Today" feed. Deterministic and pure; no I/O, no model calls.
 * CRITICAL proposals are never suppressed by a dismissal — a material warning is
 * never buried. Non-critical dismissals leave the feed until their fact changes.
 */
export function buildNudgeFeed(input: NudgeInput): NudgeFeed {
  const { today, reminders, radar, cashNeeded, opportunities } = input;
  const dismissed = input.dismissedKeys ?? new Set<string>();

  const proposals: Proposal[] = [
    ...reminders.map((r) => paymentProposal(r, today, dismissed)),
    ...opportunities.map((o) => opportunityProposal(o, today, dismissed)),
    ...(input.unusualCharges ?? []).map((u) => unusualProposal(u, today, dismissed)),
  ];
  const dip = dipProposal(radar, today, dismissed);
  if (dip) proposals.push(dip);
  const shortfall = shortfallProposal(cashNeeded, today, dismissed);
  if (shortfall) proposals.push(shortfall);

  // Suppression: a dismissed non-critical proposal leaves the feed until its fact
  // changes; CRITICAL is retained regardless of dismissal state (never buried).
  const visible = proposals.filter((p) => p.tier === 'critical' || !p.dismissed);
  const ordered = visible.slice().sort(compareProposals);

  const headline = ordered.find((p) => p.tier !== 'handled') ?? null;
  const rest = headline ? ordered.filter((p) => p !== headline) : ordered;
  const emptyReason = headline ? null : 'Nothing needs you today.';

  return { headline, rest, ordered, emptyReason };
}
