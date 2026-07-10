/**
 * Weekly self-audit Critic (TASKS 3.2 / DECISIONS #211). PURE — turns raw
 * counts into basis-point rates. Never invents denominators: a zero total
 * yields rate 0 (not NaN). No money fields.
 *
 * Formulas (documented, known-answer tested):
 *   reviewRateBps    = reviewNeeding / reviewTotal × 10000
 *   unknownRateBps   = unknownStayed / unknownAttempts × 10000
 *   alertActRateBps  = alertsActed / alertsSent × 10000
 *
 * Semantics of the counts are owned by the server gatherer (snapshot of the
 * triage queue; UnknownQuestion window; NotificationSent vs engagement proxy).
 */

export interface SelfAuditCounts {
  /** Transactions currently needing review (triage-eligible). */
  reviewNeeding: number;
  /** Triage-eligible spending-register transactions (denominator). */
  reviewTotal: number;
  /** UnknownQuestion rows in the week that stayed `resolvedIntent='unknown'`. */
  unknownStayed: number;
  /** All UnknownQuestion rows in the week (parser-unknown attempts). */
  unknownAttempts: number;
  /** NotificationSent alert keys (payment_due / cash_flow_alert) in the week. */
  alertsSent: number;
  /**
   * Engagement proxy for alert attention in the week (radar Assumptions expand
   * + connection-alerts act). Honest proxy until Wave 3.5 adds key-linked hooks.
   */
  alertsActed: number;
}

export interface SelfAuditSnapshotResult {
  reviewRateBps: number;
  unknownRateBps: number;
  alertActRateBps: number;
  counts: SelfAuditCounts;
}

/** Display shape for the AI-trust panel (engine-owned; no Prisma types). */
export interface SelfAuditView {
  weekStart: string;
  reviewRateBps: number;
  unknownRateBps: number;
  alertActRateBps: number;
  counts: SelfAuditCounts;
}

function rateBps(numer: number, denom: number): number {
  if (denom <= 0 || numer <= 0) return 0;
  return Math.round((Math.min(numer, denom) / denom) * 10000);
}

/** Derive the three Critic rates from raw counts. */
export function computeSelfAuditSnapshot(counts: SelfAuditCounts): SelfAuditSnapshotResult {
  return {
    reviewRateBps: rateBps(counts.reviewNeeding, counts.reviewTotal),
    unknownRateBps: rateBps(counts.unknownStayed, counts.unknownAttempts),
    alertActRateBps: rateBps(counts.alertsActed, counts.alertsSent),
    counts: { ...counts },
  };
}

/** Format bps as a one-decimal percent string for UI (e.g. 210 → "2.1%"). */
export function formatRateBps(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}
