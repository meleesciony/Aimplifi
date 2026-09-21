/**
 * Home already answers cash-needed (amount, when, shortfall, transfer) on the
 * stage. Today must not restate those facts — it ranks what ELSE needs a look.
 * Push / email still use the full feed; this is a display filter for Home only.
 */
import type { NudgeFeed, ProposalKind } from './types';

export const HOME_STAGE_ANSWERED_KINDS: ReadonlySet<ProposalKind> = new Set([
  'payment_due',
  'cash_needed_shortfall',
]);

/** Today is empty of *other* work — the stage already answered cash-needed. */
export const HOME_STAGE_ELSE_EMPTY =
  'Cash you need is on the stage — nothing else needs a look today.';

function isHomeStageRestatement(kind: ProposalKind, fundingFrozen: unknown): boolean {
  if (kind === 'payment_due') return true;
  // A frozen shortfall hedge is not on the stage — keep the row (L.20).
  return kind === 'cash_needed_shortfall' && fundingFrozen == null;
}

export function omitHomeStageNudges(feed: NudgeFeed): NudgeFeed {
  const dropped = feed.ordered.filter((p) => isHomeStageRestatement(p.kind, p.fundingFrozen));
  const ordered = feed.ordered.filter((p) => !isHomeStageRestatement(p.kind, p.fundingFrozen));
  const headline = ordered[0] ?? null;
  return {
    ...feed,
    ordered,
    headline,
    rest: headline ? ordered.slice(1) : [],
    emptyReason:
      !headline && dropped.length > 0 ? HOME_STAGE_ELSE_EMPTY : feed.emptyReason,
  };
}
