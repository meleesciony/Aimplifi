/**
 * Weekly self-audit persistence (TASKS 3.2 / DECISIONS #211). Gathers raw counts
 * from existing ledgers, runs the pure Critic, upserts one row per user×week.
 * Golden-safe: money engines never read this table; empty → UI empty state.
 */
import { prisma } from '@/lib/db';
import { addDays, dayOfWeek, type ISODate } from '@/lib/dates';
import {
  computeSelfAuditSnapshot,
  type SelfAuditCounts,
  type SelfAuditView,
} from '@/lib/engine/audit/snapshot';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { getReconciliationTxnKeep } from '@/server/reconciliation';

/** Monday of the ISO week containing `today` (same idiom as the digest cron). */
export function weekStartMonday(today: ISODate): ISODate {
  return addDays(today, -((dayOfWeek(today) + 6) % 7));
}

function windowBounds(weekStart: ISODate): { gte: Date; lt: Date } {
  const weekEnd = addDays(weekStart, 7);
  return {
    gte: new Date(`${weekStart}T00:00:00.000Z`),
    lt: new Date(`${weekEnd}T00:00:00.000Z`),
  };
}

/** Triage-eligible spending-register scope (mirrors getTriageItems account filter). */
function spendingRegisterWhere(userId: string) {
  return {
    isSplitParent: false,
    OR: [{ isTransfer: false }, { reviewPinned: true }],
    account: {
      userId,
      type: { in: [...SPENDING_ACCOUNT_TYPES] },
      OR: [{ currency: null }, { currency: 'USD' }],
    },
  };
}

/** True when a NotificationSent key is a proactive alert (not digest/other). */
export function isAlertNotificationKey(key: string): boolean {
  return key.startsWith('payment_due:') || key.startsWith('cash_flow_alert:');
}

/** Engagement subjectKeys that proxy "user attended to an alert surface". */
const ALERT_ACT_SUBJECTS = ['connection-alerts', 'radar-assumptions'] as const;

/**
 * Gather the week's raw counts for one user. Review rates are a POINT-IN-TIME
 * snapshot of the triage queue (not a flow); unknown/alert counts are windowed.
 */
export async function gatherSelfAuditCounts(
  userId: string,
  weekStart: ISODate,
): Promise<SelfAuditCounts> {
  const win = windowBounds(weekStart);
  const register = spendingRegisterWhere(userId);

  const [reviewRows, keepsReconciled, unknownRows, sentRows, actRows] = await Promise.all([
    // Rows, not counts: the audit describes the register/triage the reader SEES,
    // and both apply the R1 reconciliation keep (H.8 — measured live: a raw count
    // said "75 of 2456 needed sorting" while the boundaried triage queue held 7 of
    // 1332, so the settings card contradicted the queue it audits). A windowed keep
    // cannot be expressed in a Prisma `count` where-clause, so fetch the three
    // fields the filter and the tally need and count in memory.
    prisma.transaction.findMany({
      where: register,
      select: { accountId: true, date: true, needsReview: true },
    }),
    getReconciliationTxnKeep(userId),
    prisma.unknownQuestion.findMany({
      where: { userId, createdAt: win },
      select: { resolvedIntent: true },
    }),
    prisma.notificationSent.findMany({
      where: { userId, sentAt: win },
      select: { key: true },
    }),
    prisma.engagementEvent.count({
      where: {
        userId,
        createdAt: win,
        subjectKey: { in: [...ALERT_ACT_SUBJECTS] },
        verb: { in: ['acted', 'expanded'] },
      },
    }),
  ]);

  const ownedRows = reviewRows.filter((t) => keepsReconciled(t.accountId, t.date));
  const reviewNeeding = ownedRows.filter((t) => t.needsReview).length;
  const reviewTotal = ownedRows.length;
  const unknownAttempts = unknownRows.length;
  const unknownStayed = unknownRows.filter((r) => r.resolvedIntent === 'unknown').length;
  const alertsSent = sentRows.filter((r) => isAlertNotificationKey(r.key)).length;

  return {
    reviewNeeding,
    reviewTotal,
    unknownStayed,
    unknownAttempts,
    alertsSent,
    alertsActed: actRows,
  };
}

export type StoredSelfAudit = SelfAuditView & { id: string };

/** Compute + upsert the snapshot for this user×week. Idempotent. */
export async function recordSelfAuditSnapshot(
  userId: string,
  weekStart: ISODate,
): Promise<StoredSelfAudit> {
  const counts = await gatherSelfAuditCounts(userId, weekStart);
  const snap = computeSelfAuditSnapshot(counts);
  const row = await prisma.selfAuditSnapshot.upsert({
    where: { userId_weekStart: { userId, weekStart } },
    create: {
      userId,
      weekStart,
      reviewNeeding: counts.reviewNeeding,
      reviewTotal: counts.reviewTotal,
      unknownStayed: counts.unknownStayed,
      unknownAttempts: counts.unknownAttempts,
      alertsSent: counts.alertsSent,
      alertsActed: counts.alertsActed,
      reviewRateBps: snap.reviewRateBps,
      unknownRateBps: snap.unknownRateBps,
      alertActRateBps: snap.alertActRateBps,
    },
    update: {
      reviewNeeding: counts.reviewNeeding,
      reviewTotal: counts.reviewTotal,
      unknownStayed: counts.unknownStayed,
      unknownAttempts: counts.unknownAttempts,
      alertsSent: counts.alertsSent,
      alertsActed: counts.alertsActed,
      reviewRateBps: snap.reviewRateBps,
      unknownRateBps: snap.unknownRateBps,
      alertActRateBps: snap.alertActRateBps,
    },
  });
  return {
    id: row.id,
    weekStart: row.weekStart,
    reviewRateBps: snap.reviewRateBps,
    unknownRateBps: snap.unknownRateBps,
    alertActRateBps: snap.alertActRateBps,
    counts: snap.counts,
  };
}

/** Latest weekly snapshot for the AI-trust panel (null until first cron run). */
export async function getLatestSelfAuditSnapshot(userId: string): Promise<SelfAuditView | null> {
  const row = await prisma.selfAuditSnapshot.findFirst({
    where: { userId },
    orderBy: { weekStart: 'desc' },
  });
  if (!row) return null;
  return {
    weekStart: row.weekStart,
    reviewRateBps: row.reviewRateBps,
    unknownRateBps: row.unknownRateBps,
    alertActRateBps: row.alertActRateBps,
    counts: {
      reviewNeeding: row.reviewNeeding,
      reviewTotal: row.reviewTotal,
      unknownStayed: row.unknownStayed,
      unknownAttempts: row.unknownAttempts,
      alertsSent: row.alertsSent,
      alertsActed: row.alertsActed,
    },
  };
}
