/**
 * Engagement-event vocabulary (TASKS 3.1 / DECISIONS #209). PURE closed sets —
 * only these surfaces/verbs/subject-key shapes may be persisted. Nothing here
 * reads history or derives layout (Wave 3.3); this module only validates writes.
 */

export const ENGAGEMENT_VERBS = ['viewed', 'dismissed', 'expanded', 'acted'] as const;
export type EngagementVerb = (typeof ENGAGEMENT_VERBS)[number];

export const ENGAGEMENT_SURFACES = ['dashboard', 'coach', 'settings', 'ask', 'triage'] as const;
export type EngagementSurface = (typeof ENGAGEMENT_SURFACES)[number];

/** Stable card / affordance ids — kebab-case, no PII. */
export const ENGAGEMENT_SUBJECT_KEYS = [
  'return-moment',
  'cash-needed',
  'radar-assumptions',
  'ask-aimplifi',
  'safe-to-spend',
  'connection-alerts',
  'top-spending',
  'spending-insights',
  'recurring-summary',
  'onboarding-nudge',
  // Nudge "Today" feed proposals (NUDGE_PLAN slice 2). One stable subject per
  // ProposalKind — `nudge:<kind>` — matching engine/nudge/select.ts `subjectKey()`
  // verbatim. Deliberately the KIND only: no money, no merchant (those live in the
  // proposal's own dismissKey/suppression store, never in the behavioral log). Slice 3
  // reads these rows for cadence learning. Keep in lockstep with ProposalKind: a new
  // OpportunityKind needs its `nudge:<kind>` added here or its logging silently no-ops.
  'nudge:payment_due',
  'nudge:cash_flow_dip',
  'nudge:cash_needed_shortfall',
  'nudge:price-increase',
  'nudge:unused-subscription',
  'nudge:insurance-reshop',
  'nudge:negotiable-bill',
] as const;
export type EngagementSubjectKey = (typeof ENGAGEMENT_SUBJECT_KEYS)[number];

export interface EngagementEventInput {
  surface: string;
  verb: string;
  subjectKey: string;
}

const VERB_SET = new Set<string>(ENGAGEMENT_VERBS);
const SURFACE_SET = new Set<string>(ENGAGEMENT_SURFACES);
const SUBJECT_SET = new Set<string>(ENGAGEMENT_SUBJECT_KEYS);

/**
 * True when surface/verb/subjectKey are in the closed sets. Rejects anything
 * else so a buggy client cannot invent analytics dimensions or smuggle PII
 * into subjectKey.
 */
export function isValidEngagementEvent(input: EngagementEventInput): boolean {
  return (
    SURFACE_SET.has(input.surface) &&
    VERB_SET.has(input.verb) &&
    SUBJECT_SET.has(input.subjectKey)
  );
}
