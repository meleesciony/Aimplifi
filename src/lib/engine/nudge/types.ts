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
import type { PaymentReminder } from '@/lib/engine/reminders/select';
import type { RadarResult } from '@/lib/engine/radar/radar';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import type { Opportunity, OpportunityKind } from '@/lib/engine/fi/insights';

/** Suppression tiers, most urgent first. HANDLED is quiet autopay reassurance. */
export type ProposalTier = 'critical' | 'action' | 'opportunity' | 'handled';

/**
 * Closed union of nudge sources: three fixed kinds plus the four OpportunityKind
 * members. Adding an OpportunityKind breaks the exhaustive switch in select.ts at
 * compile time — an unknown kind is unrepresentable.
 */
export type ProposalKind =
  | 'payment_due'
  | 'cash_flow_dip'
  | 'cash_needed_shortfall'
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
   * NOTE (slice-2 wiring): `nudge:<kind>` is not yet in ENGAGEMENT_SUBJECT_KEYS; slice 2
   * must extend that closed set (or map to a single `nudge-feed` subject) before logging.
   */
  subjectKey: string;
  /**
   * The date that orders this proposal within its tier (verbatim copy of a source
   * date; null = undated, sorts last within the tier).
   */
  sortDate: ISODate | null;
  /** Verbatim day-count passthrough where the source provides one; else null. */
  daysUntil: number | null;
  /** Verbatim money-at-stake, for within-tier ordering and display. Never computed. */
  centsAtStake: Cents;
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
