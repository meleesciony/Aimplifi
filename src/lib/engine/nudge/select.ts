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
import { type CashNeededResult, undatedCardsWithBalance } from '@/lib/engine/cash-needed/types';
import type { Opportunity } from '@/lib/engine/fi/insights';
import type { UnusualCharge } from '@/lib/engine/anomaly/detect';
import type { IncomePauseState } from '@/lib/engine/income/pause';
import { frozenNothingDueNote } from '@/lib/engine/account/feed-dropped-view';
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
    cadence: null,
    runwayMonths: null,
    isEstimated: r.isEstimated,
    fundingFrozen: null, // not projected from the funding balance
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
    cadence: null,
    runwayMonths: null,
    isEstimated: radar.includesEstimatedDues,
    // The dip IS the radar's verdict re-printed as an instruction, so the fact comes from the
    // radar's own starting account — the account it walked from, labelled as the radar labels it —
    // never from `cashNeeded.fundingFrozen`. The two are the same account on today's dashboard and
    // nothing in either engine guarantees it; a disclosure that names the wrong row is worse than
    // none (TASKS L.20).
    fundingFrozen: radar.startingBalanceFrozen ?? null,
    dismissed: dismissed.has(dismissKey),
  };
}

function shortfallProposal(
  cn: CashNeededResult | null,
  today: ISODate,
  dismissed: ReadonlySet<string>,
  /** How the surface names the funding account (see `NudgeInput.paymentAccountName`). */
  paymentAccountName: string,
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
    cadence: null,
    runwayMonths: null,
    isEstimated,
    // `cn.fundingFrozen` carries the drop date and the balance but deliberately not the name, so
    // the surface's own label completes it (TASKS L.20).
    fundingFrozen: cn.fundingFrozen
      ? {
          label: paymentAccountName,
          frozenSince: cn.fundingFrozen.frozenSince,
          balanceCents: cn.fundingFrozen.balanceCents,
        }
      : null,
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
    cadence: null,
    runwayMonths: null,
    isEstimated: o.isEstimate,
    fundingFrozen: null, // not projected from the funding balance
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
    cadence: null,
    runwayMonths: null,
    isEstimated: false, // a real posted charge, never an estimate
    fundingFrozen: null, // not projected from the funding balance
    dismissed: dismissed.has(dismissKey),
  };
}

/**
 * Income-pause proposal (#251): a lapsed recurring income series. UNCONFIRMED, it is
 * an ACTION-tier row — an acknowledgment ("has this income stopped?") with no payment
 * deadline, so it never competes with CRITICAL warnings and is dismissable. Same
 * precision-first stance as unusual_charge: a late paycheck may be a payroll hiccup,
 * so this is never pushed (notify/select is untouched) and never CRITICAL.
 * CONFIRMED, it becomes a HANDLED-tier row — quiet state disclosure ("projections
 * don't count this while it stays paused") that remains in the feed for as long as
 * the exclusion is in force, carrying the undo affordance: a money mutation may
 * never outlive its own visibility.
 *
 * The unconfirmed dismissal fact is the MISSED OCCURRENCE
 * (`income_pause:<merchant>:<missedSince>`): dismissing one missed date never
 * suppresses a future pause, which arrives with a new missedSince. The CONFIRMED
 * state row keys to its OWN namespace (`income_pause_confirmed:<merchant>`) — a
 * different fact entirely, so a dismissal of the earlier ACTION nudge can never
 * hide the state disclosure carrying the Undo (#251 critic F5; missedSince is
 * deliberately absent — the state is per-merchant and row churn may shift the
 * computed missed date while the same exclusion stays in force). Every money value
 * is verbatim from the detector; centsAtStake is the expected deposit that has not
 * arrived (per-kind semantic, labeled at the copy boundary). `runwayMonths` rides
 * through verbatim from the caller's monthsOfRunway (display context; non-finite
 * or non-positive → null — "∞ months" and "covers about -0.5 months" are
 * unrepresentable downstream, #251 critic F6).
 */
function incomePauseProposal(
  p: IncomePauseState,
  runwayMonths: number | undefined,
  today: ISODate,
  dismissed: ReadonlySet<string>,
): Proposal {
  const tier: ProposalTier = p.confirmed ? 'handled' : 'action';
  const key = p.confirmed
    ? `income_pause_confirmed:${p.merchantCanonical}`
    : `income_pause:${p.merchantCanonical}:${p.missedSince}`;
  const dismissKey = dismissKeyFor(tier, key, today);
  return {
    kind: 'income_pause',
    tier,
    key,
    dismissKey,
    subjectKey: subjectKey('income_pause'),
    sortDate: p.missedSince, // verbatim — the missed expected date orders it within ACTION
    daysUntil: null,
    centsAtStake: p.typicalAmountCents as Cents, // verbatim — the deposit that hasn't arrived
    autopayCents: ZERO, // not a payment_due proposal
    merchant: p.merchantCanonical, // verbatim display context
    typicalCents: null,
    typicalCount: p.occurrences, // verbatim display context — the disclosed basis
    cadence: p.cadence, // verbatim display context
    runwayMonths:
      runwayMonths !== undefined && Number.isFinite(runwayMonths) && runwayMonths > 0
        ? runwayMonths
        : null,
    isEstimated: false, // the missed deposit is a fact; the runway figure discloses its own basis
    fundingFrozen: null, // not projected from the funding balance
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
    ...(input.incomePauses ?? []).map((p) =>
      incomePauseProposal(p, input.runwayMonths, today, dismissed),
    ),
  ];
  const dip = dipProposal(radar, today, dismissed);
  if (dip) proposals.push(dip);
  const shortfall = shortfallProposal(cashNeeded, today, dismissed, input.paymentAccountName);
  if (shortfall) proposals.push(shortfall);

  // Suppression: a dismissed non-critical proposal leaves the feed until its fact
  // changes; CRITICAL is retained regardless of dismissal state (never buried).
  const visible = proposals.filter((p) => p.tier === 'critical' || !p.dismissed);
  const ordered = visible.slice().sort(compareProposals);

  const headline = ordered.find((p) => p.tier !== 'handled') ?? null;
  const rest = headline ? ordered.filter((p) => p !== headline) : ordered;
  // "Nothing needs you today" is a positive all-clear, and a card the cash-needed
  // engine could not date carries a real balance no proposal above can represent —
  // so the unqualified all-clear was false exactly when the owner's issuer sent no
  // statement (#277 P2, the owner-reported class). Name the gap instead. A card
  // with a ZERO balance owes nothing, so it never qualifies the all-clear (the
  // same fence as cash-needed-card's hero branch).
  //
  // Computed UNCONDITIONALLY, not `headline ? null : …` (L.20 critic cycle, finding C-2). The card
  // recomputes `headline` client-side over its own session-dismissed filter, so a reader who
  // dismissed the last row in-session fell through to the component's bare literal fallback and got
  // "Nothing needs you today." over a card the engine had just said it could not date. A sentence
  // whose whole job is to qualify an all-clear may not be gated on the engine's idea of whether the
  // all-clear will be shown; deciding WHETHER to show it is the surface's business, and composing
  // it honestly is this engine's.
  const undatedCount = cashNeeded ? undatedCardsWithBalance(cashNeeded).length : 0;
  // The frozen rows this feed also cannot speak for (finding C-1) — a frozen card, a frozen dated
  // loan, or an undatable frozen loan, none of which the funding-balance disclosure below covers.
  const frozenDueNote = frozenNothingDueNote(input.frozenDues, { nextStep: 'accounts-route' });
  const emptyReason =
    (undatedCount > 0
      ? `Nothing needs you today on what we can date — ${
          undatedCount === 1 ? 'one card has' : `${undatedCount} cards have`
        } no due date yet, so ${undatedCount === 1 ? 'it isn’t' : 'they aren’t'} included.`
      : 'Nothing needs you today.') + (frozenDueNote ? ` ${frozenDueNote}` : '');

  // The frozen funding balance NOBODY above accounts for (TASKS L.20).
  //
  // Resolved against `ordered` — the proposals this feed will actually render — and not against
  // the raw `dip`/`shortfall` locals, because the question is whether the sentence already
  // appears on screen, not whether a proposal was built. (Today the two agree: both funding kinds
  // are CRITICAL and CRITICAL survives every filter above. Resolving against the rendered set is
  // what keeps that an observation rather than an assumption — the L.19 P1 on /calendar was a
  // claim resolved against an engine's input instead of its output.)
  //
  // Deliberately NOT gated on the feed being empty. A frozen balance that produced no shortfall
  // and no dip is silent whether or not an unrelated opportunity happens to sit at the top; the
  // reader takes the same false comfort from a feed with no cash warning in it either way.
  // BOTH sources are consulted, not just cash-needed. A frozen balance suppresses the dip and the
  // shortfall independently — the radar can be walking a frozen account with no cash-needed result
  // beside it at all — and reading only one of them leaves precisely the quiet case silent again,
  // one engine along. Cash-needed first when both are frozen: its sentence names the balance AND
  // the shortfall the dashboard's headline rests on, and on this surface the two engines are
  // handed the same payment account, so the choice is between two labels for one row.
  const stated = ordered.some((p) => p.fundingFrozen !== null);
  const fromCashNeeded = cashNeeded?.fundingFrozen
    ? {
        label: input.paymentAccountName,
        frozenSince: cashNeeded.fundingFrozen.frozenSince,
        balanceCents: cashNeeded.fundingFrozen.balanceCents,
      }
    : null;
  const fundingFrozen = stated ? null : (fromCashNeeded ?? radar?.startingBalanceFrozen ?? null);

  return { headline, rest, ordered, emptyReason, fundingFrozen };
}
