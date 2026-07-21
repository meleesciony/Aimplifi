/**
 * Smart Notification & Nudge Engine — types (AI_DIFFERENTIATION_PLAN §2.2, slice 1).
 *
 * A pure reshape-and-order over existing engine outputs. It does ZERO money
 * arithmetic: every `centsAtStake` and date on a Proposal is copied byte-for-byte
 * from the source engine (the receipts.ts idiom), so the feed can never disagree
 * with the dashboard. Severity is an ORDERING (tier-then-rank), never a scalar
 * score — there is no weighted sum to mis-calibrate.
 */
import type { Cents } from '@/lib/money';
import type { ISODate } from '@/lib/dates';
import type { EngagementSubjectKey } from '@/lib/engine/engagement/event';
import type { PaymentReminder } from '@/lib/engine/reminders/select';
import type { RadarResult } from '@/lib/engine/radar/radar';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import type { Opportunity, OpportunityKind } from '@/lib/engine/fi/insights';
import type { UnusualCharge } from '@/lib/engine/anomaly/detect';
import type { IncomePauseState, PauseCadence } from '@/lib/engine/income/pause';

/** Suppression tiers, most urgent first. HANDLED is quiet autopay reassurance. */
export type ProposalTier = 'critical' | 'action' | 'opportunity' | 'handled';

/**
 * Closed union of nudge sources: four fixed kinds plus the four OpportunityKind
 * members. Adding an OpportunityKind breaks the exhaustive switch in select.ts at
 * compile time — an unknown kind is unrepresentable.
 */
export type ProposalKind =
  | 'payment_due'
  | 'cash_flow_dip'
  | 'cash_needed_shortfall'
  | 'unusual_charge'
  | 'income_pause'
  | OpportunityKind;

export interface Proposal {
  kind: ProposalKind;
  tier: ProposalTier;
  /**
   * Stable identity. For payment_due and cash_flow_dip this is byte-identical to
   * the notify/select push key, so the push-lockstep test can match by key.
   */
  key: string;
  /**
   * What a dismissal writes. CRITICAL keys per-day (reappears while the condition
   * persists); ACTION/OPPORTUNITY key to the underlying fact (reappears when the
   * fact changes — e.g. a new price transition or a new statement due date).
   */
  dismissKey: string;
  /**
   * Behavioral-LOG channel (distinct from suppression): the EngagementEvent subject for
   * slice-3 cadence learning, `nudge:<kind>`. It records the KIND that was viewed/
   * dismissed/acted — deliberately no money, no merchant — so it stays inside
   * EngagementEvent's closed-set, no-money contract. It is NOT the dismissal key.
   *
   * Typed `EngagementSubjectKey` (not string) so a consumer can pass it straight into
   * `logEngagement` with no cast: the closed-set membership is a compile-time fact, and
   * `select.ts`'s `subjectKey()` is the sole producer (its return is checked against the
   * same type). Extending ProposalKind without extending ENGAGEMENT_SUBJECT_KEYS fails
   * the build here, never silently at the runtime validator.
   */
  subjectKey: EngagementSubjectKey;
  /**
   * The date that orders this proposal within its tier (verbatim copy of a source
   * date; null = undated, sorts last within the tier).
   */
  sortDate: ISODate | null;
  /** Verbatim day-count passthrough where the source provides one; else null. */
  daysUntil: number | null;
  /** Verbatim money-at-stake, for within-tier ordering and display. Never computed. */
  centsAtStake: Cents;
  /**
   * Verbatim autopay portion for a payment_due proposal (`PaymentReminder.autopayCents`);
   * ZERO for every other kind. Display context ONLY — it lets the card disclose the
   * autopay split so the feed's "to pay" figure (centsAtStake = userActionCents, the
   * REMAINDER after autopay) can never be misread as the whole statement, keeping the
   * feed in lockstep with the reminders card ("$600 due · autopay covers $100 · $500 to
   * pay"). Never summed here — the two verbatim parts are shown, the total is not
   * recomputed.
   */
  autopayCents: Cents;
  /**
   * Verbatim display context for an unusual_charge proposal; null for every other
   * kind (the autopayCents precedent — context fields, never recomputed). `merchant`
   * is the detector's canonical merchant; `typicalCents` its median charge there;
   * `typicalCount` the baseline size — carried so the copy can disclose the basis
   * ("median of N charges") next to the figure, per the coaching guardrails.
   */
  merchant: string | null;
  typicalCents: Cents | null;
  typicalCount: number | null;
  /**
   * Verbatim display context for an income_pause proposal (#251); null for every
   * other kind. `cadence` is the paused series' cadence (so the copy can say
   * "usually arrives monthly"); `runwayMonths` is the coach's own
   * `monthsOfRunway` figure copied verbatim (liquid ÷ 6-month average expenses,
   * already rounded to 0.1 by its producer) — carried so the copy can quantify
   * "if it stays paused" next to the fact, with the basis disclosed inline. Never
   * recomputed here; null also when the producer's figure is non-finite (no
   * expense history yet).
   */
  cadence: PauseCadence | null;
  runwayMonths: number | null;
  isEstimated: boolean;
  /** True iff the user has dismissed this proposal's dismissKey (UI collapse hint). */
  dismissed: boolean;
}

export interface NudgeInput {
  today: ISODate;
  reminders: readonly PaymentReminder[];
  radar: RadarResult | null;
  cashNeeded: CashNeededResult | null;
  opportunities: readonly Opportunity[];
  /**
   * Per-merchant median+MAD outliers from `detectUnusualCharges` (#249). Optional so
   * pre-existing callers (and tests) that don't surface the radar stay valid; absent
   * means "no unusual charges", identical to [].
   */
  unusualCharges?: readonly UnusualCharge[];
  /**
   * Lapsed recurring income series from `incomePausesForFeed` (#251). Optional so
   * pre-existing callers and tests stay valid; absent means "no paused income",
   * identical to []. An UNCONFIRMED row is news (ACTION); a CONFIRMED row is quiet
   * state (HANDLED) — it stays in the feed for as long as its projection exclusion
   * is in force, so the mutation is always visible and undoable.
   */
  incomePauses?: readonly IncomePauseState[];
  /**
   * The coach's `monthsOfRunway` figure, passed through verbatim for income_pause
   * display context only (see Proposal.runwayMonths). Optional; omitted or a
   * non-finite value renders no runway line.
   */
  runwayMonths?: number;
  /**
   * The set of `dismissKey`s the user has dismissed — the SUPPRESSION store, distinct
   * from the EngagementEvent behavioral log. These are fact-keys (e.g.
   * `price-increase:Netflix:1999->2499`) that embed a merchant and cents, so they cannot
   * live in EngagementEvent (closed-set subjectKey, no money by contract). Slice 2 must
   * back this with a dedicated dismissed-key store, mirroring the reminders engine's own
   * storage-agnostic `dismissedKeys` input (see DECISIONS.md). The engine is
   * storage-agnostic: it only reads the set.
   */
  dismissedKeys?: ReadonlySet<string>;
}

export interface NudgeFeed {
  // Non-critical dismissed proposals are omitted from this feed entirely (CRITICAL is
  // always retained). For the "show everything" control, slice 2 re-invokes the engine
  // with an empty `dismissedKeys` set — there is no hidden-items list on the feed itself.

  /** The single top proposal, or null on an honest empty / all-autopay day. */
  headline: Proposal | null;
  /** Everything below the headline, in canonical order (includes HANDLED items). */
  rest: Proposal[];
  /** headline + rest in one canonical-ordered array. */
  ordered: Proposal[];
  /** Set when there is no headline (nothing needs the user today). */
  emptyReason: string | null;
}
