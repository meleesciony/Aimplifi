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
import type {
  FrozenFundingFigure,
  FrozenNothingDueRow,
} from '@/lib/engine/account/feed-dropped-view';

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
  /**
   * The funding account this proposal's figure is walked forward from, when its bank has stopped
   * sharing it (TASKS L.20); null when that balance is live, and on every kind not projected from
   * it. Verbatim display context, the `autopayCents` idiom — no arithmetic, and the label is the
   * one its own source prints (the radar's starting account for a dip, the surface's
   * `paymentAccountName` for a shortfall).
   *
   * This feed prints the two sharpest INSTRUCTIONS in the app — "About $X short by DATE" and "A
   * transfer of about $X would cover it" — and until L.20 it was the last surface stating them
   * with no idea whether the balance underneath had stopped moving. The failure direction is the
   * one L.14 exists for: frozen HIGH understates the shortfall, so the reader moves too little
   * and the autopay bounces.
   */
  fundingFrozen: FrozenFundingFigure | null;
  /** True iff the user has dismissed this proposal's dismissKey (UI collapse hint). */
  dismissed: boolean;
}

export interface NudgeInput {
  today: ISODate;
  reminders: readonly PaymentReminder[];
  radar: RadarResult | null;
  cashNeeded: CashNeededResult | null;
  /**
   * How THIS surface names the account the cash-needed projection walks from (TASKS L.20).
   *
   * REQUIRED, and supplied by the caller rather than read off the result, because
   * `CashNeededResult.fundingFrozen` deliberately carries the drop date and the balance but not
   * the name — "a disclosure must name the row the way the reader sees it named", and only the
   * surface knows that. The dashboard already holds it as `paymentAccountName` and prints it on
   * the cash-needed card a few rows above this feed.
   *
   * Not optional, on this file's standing rule: a defaulted disclosure argument fails silent, and
   * the cost of forgetting it here is a frozen-balance instruction that says nothing.
   */
  paymentAccountName: string;
  /**
   * The frozen rows an all-clear on THIS feed cannot speak for (L.20 critic cycle, finding C-1).
   *
   * L.20 taught this feed to disclose a frozen FUNDING balance and nothing else, so a frozen card,
   * a frozen dated loan, or L.20's own undatable frozen mortgage still produced a bare "Nothing
   * needs you today." at the top of the page — while the reminders card directly below it
   * qualified the very same all-clear. The list is the one `frozenNothingDueRows` already builds
   * for that card; the dashboard hands both surfaces the same rows.
   *
   * REQUIRED, on this file's standing rule: a defaulted disclosure argument fails silent.
   */
  frozenDues: readonly FrozenNothingDueRow[];
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
  /**
   * The all-clear sentence, with every qualifier this feed owes it already composed in — the
   * undated cards carrying a balance, and the frozen rows it cannot speak for.
   *
   * ALWAYS a string (L.20 critic cycle, finding C-2). It used to be null whenever the engine found
   * a headline, which left the client with a bare literal to fall back on when its own
   * session-dismiss filter emptied the feed — and that literal knew none of the qualifiers. The
   * engine composes the sentence; the surface decides whether it is shown.
   */
  emptyReason: string;
  /**
   * The frozen funding balance NO proposal on this feed accounts for (TASKS L.20) — null when the
   * balance is live, and null when a proposal in `ordered` already carries the same fact.
   *
   * Two halves of one disclosure, and this is the half that matters more. A balance frozen HIGH
   * reports a shortfall of $0 and produces no dip, so `shortfallProposal` and `dipProposal` both
   * return null and the feed prints "Nothing needs you today." over a projection that cannot see
   * the account it is projecting — the quiet direction, and the expensive one. This is the same
   * defect the L.19 critic found on /calendar (P1-1), one surface along.
   *
   * Exclusive with `Proposal.fundingFrozen` by construction so the sentence appears exactly once,
   * attached to the claim it qualifies: on the instruction when there is one, on the all-clear
   * when there is not. Safe because both funding-derived kinds are CRITICAL, and the card renders
   * every critical row — dismissed or not — so a proposal carrying the fact is never invisible.
   */
  fundingFrozen: FrozenFundingFigure | null;
}
