/**
 * H.7b — the transfer-flag repair, server half (STATUS §STILL OPEN after H.7,
 * residual 1). The pure planner (engine/categorize/transfer-flag-repair)
 * decides; this reads, discloses, applies and undoes.
 *
 * THE STANCE (#192/#221/#299 — disclose, never silently adjust): clearing a
 * flag rewrites income and spending figures the owner has already looked at,
 * so nothing here runs on a sync or a cron. The preview states exactly what
 * would change; the APPLY is an explicit owner action; the run is recorded and
 * undoable. This is also, deliberately, the app's first and only path that
 * writes `isTransfer: false` (STATUS §after-H.7 residual 4) — scoped to rows
 * the shipped evidence rule declines, never a general un-flagger.
 *
 * READ = the sweep's own read (`loadTransferSweepRows`): the repair judges the
 * same world the sweep writes, identity map and all.
 *
 * WRITE = per-row, premise re-asserted in each WHERE (the backfill cycle-5 /
 * H.7 idiom): a row the user re-files, pins or un-resolves inside the
 * read→write window is SKIPPED, not clobbered. Per-row rather than one
 * updateMany because Undo needs the exact set that actually cleared — an
 * updateMany count cannot say WHICH rows a concurrent edit excluded. The set
 * is bounded by the user's flagged rows (tens, not thousands).
 *
 * RACE DIRECTION, stated: if a sync lands new evidence between plan and write,
 * a just-now-justified flag could clear here — and the very next sweep
 * re-flags it through the overturn gate, because repair and sweep share one
 * rule. The failure heals toward the rule, never away from it.
 */
import { prisma } from '@/lib/db';
import {
  planTransferFlagRepair,
  type TransferFlagRepairPlan,
} from '@/lib/engine/categorize/transfer-flag-repair';
import { NON_COMPETING_CATEGORY_IDS } from '@/lib/engine/categorize/transfers';
import { loadTransferSweepRows } from '@/lib/providers/transfer-refresh';
import { auditLog } from '@/server/authz';
import { getCategoryMeta } from '@/server/category-meta';

export interface TransferFlagRepairPreviewRow {
  id: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
  categoryId: string | null;
  categoryName: string | null;
  accountName: string;
}

export interface TransferFlagRepairRunSummary {
  id: string;
  /** ISO timestamp of the apply. */
  createdAt: string;
  /** Server-rendered display label ("Aug 8, 2026", UTC) — computed here so the
   * client never formats a timestamp and hydration cannot drift. */
  createdAtLabel: string;
  clearedCount: number;
  inflowCents: number;
  outflowCents: number;
  undone: boolean;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function utcDateLabel(d: Date): string {
  return `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export interface TransferFlagRepairPreview {
  clearCount: number;
  inflowCents: number;
  outflowCents: number;
  incomeCategorisedCount: number;
  endorsedCount: number;
  declinedOutOfScopeCount: number;
  flaggedCount: number;
  rows: TransferFlagRepairPreviewRow[];
  /** The most recent run, undone or not — the surface offers Undo on a
   * standing one and names the restore on an undone one. */
  lastRun: TransferFlagRepairRunSummary | null;
}

async function loadPlan(userId: string): Promise<{
  plan: TransferFlagRepairPlan;
  txns: Awaited<ReturnType<typeof loadTransferSweepRows>>;
}> {
  const txns = await loadTransferSweepRows(userId);
  return { plan: planTransferFlagRepair(txns), txns };
}

export async function getTransferFlagRepairPreview(
  userId: string,
): Promise<TransferFlagRepairPreview> {
  const [{ plan }, meta, lastRunRow] = await Promise.all([
    loadPlan(userId),
    getCategoryMeta(userId),
    prisma.transferFlagRepairRun.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // Labels for exactly the rows the preview shows — never the whole corpus.
  const accountIds = [...new Set(plan.clear.map((t) => t.accountId))];
  const accounts = accountIds.length
    ? await prisma.account.findMany({
        where: { id: { in: accountIds }, userId },
        select: { id: true, name: true },
      })
    : [];
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));

  return {
    clearCount: plan.clear.length,
    inflowCents: plan.inflowCents,
    outflowCents: plan.outflowCents,
    incomeCategorisedCount: plan.incomeCategorisedCount,
    endorsedCount: plan.endorsedCount,
    declinedOutOfScopeCount: plan.declinedOutOfScopeCount,
    flaggedCount: plan.flaggedCount,
    rows: plan.clear.map((t) => ({
      id: t.id,
      date: t.date,
      amountCents: t.amountCents,
      rawDescriptor: t.rawDescriptor,
      categoryId: t.categoryId,
      categoryName: t.categoryId === null ? null : (meta.get(t.categoryId)?.name ?? t.categoryId),
      accountName: accountNameById.get(t.accountId) ?? 'Unknown account',
    })),
    lastRun: lastRunRow
      ? {
          id: lastRunRow.id,
          createdAt: lastRunRow.createdAt.toISOString(),
          createdAtLabel: utcDateLabel(lastRunRow.createdAt),
          clearedCount: lastRunRow.clearedCount,
          inflowCents: lastRunRow.inflowCents,
          outflowCents: lastRunRow.outflowCents,
          undone: lastRunRow.undoneAt !== null,
        }
      : null,
  };
}

export interface TransferFlagRepairApplyResult {
  ok: boolean;
  cleared: number;
  /** Rows the plan named that a concurrent edit excluded — skipped, not clobbered. */
  skipped: number;
  inflowCents: number;
  outflowCents: number;
  runId: string | null;
  error?: string;
}

/**
 * Clear the flags today's rule declines. Recomputes the plan from a fresh read
 * — nothing from the client is trusted, and a preview shown minutes ago is not
 * the premise of anything.
 */
export async function applyTransferFlagRepair(
  userId: string,
): Promise<TransferFlagRepairApplyResult> {
  const { plan } = await loadPlan(userId);
  if (plan.clear.length === 0) {
    return { ok: true, cleared: 0, skipped: 0, inflowCents: 0, outflowCents: 0, runId: null };
  }

  const clearedRows: Array<{ id: string; categoryId: string | null }> = [];
  let inflowCents = 0;
  let outflowCents = 0;
  let runId: string | null = null;

  await prisma.$transaction(async (tx) => {
    for (const row of plan.clear) {
      // The write re-asserts its whole premise (H.7): still flagged, still
      // settled, still un-pinned, still the SAME substantive verdict the plan
      // judged — a row re-decided inside the window is skipped.
      const res = await tx.transaction.updateMany({
        where: {
          id: row.id,
          account: { userId },
          isTransfer: true,
          needsReview: false,
          reviewPinned: false,
          categoryId:
            row.categoryId === null
              ? { notIn: [...NON_COMPETING_CATEGORY_IDS] } // unreachable: scope requires a verdict; keeps the premise total
              : row.categoryId,
        },
        data: { isTransfer: false },
      });
      if (res.count === 1) {
        clearedRows.push({ id: row.id, categoryId: row.categoryId });
        if (row.amountCents > 0) inflowCents += row.amountCents;
        else outflowCents += -row.amountCents;
      }
    }
    if (clearedRows.length > 0) {
      const run = await tx.transferFlagRepairRun.create({
        data: {
          userId,
          clearedRows: JSON.stringify(clearedRows),
          clearedCount: clearedRows.length,
          inflowCents,
          outflowCents,
        },
      });
      runId = run.id;
    }
  });

  await auditLog(userId, 'transfers.flag-repair', {
    planned: plan.clear.length,
    cleared: clearedRows.length,
    skipped: plan.clear.length - clearedRows.length,
    inflowCents,
    outflowCents,
    runId,
  });

  return {
    ok: true,
    cleared: clearedRows.length,
    skipped: plan.clear.length - clearedRows.length,
    inflowCents,
    outflowCents,
    runId,
  };
}

export interface TransferFlagRepairUndoResult {
  ok: boolean;
  restored: number;
  /** Rows the reader has re-decided since the repair — their own values win. */
  skipped: number;
  error?: string;
}

/**
 * Restore the flags a run cleared. A row the reader has touched since — new
 * category, un-resolved, pinned, or re-flagged already — is skipped: the
 * survivor's own reader values always win (the H.6b(a) doctrine).
 */
export async function undoTransferFlagRepair(
  userId: string,
  runId: string,
): Promise<TransferFlagRepairUndoResult> {
  // Claim the run atomically: exactly one undo can win.
  const claim = await prisma.transferFlagRepairRun.updateMany({
    where: { id: runId, userId, undoneAt: null },
    data: { undoneAt: new Date() },
  });
  if (claim.count !== 1) {
    return { ok: false, restored: 0, skipped: 0, error: 'This repair was already undone.' };
  }
  const run = await prisma.transferFlagRepairRun.findUniqueOrThrow({ where: { id: runId } });
  const cleared = JSON.parse(run.clearedRows) as Array<{ id: string; categoryId: string | null }>;

  let restored = 0;
  for (const row of cleared) {
    const res = await prisma.transaction.updateMany({
      where: {
        id: row.id,
        account: { userId },
        isTransfer: false,
        needsReview: false,
        reviewPinned: false,
        // Only a row still carrying the verdict it had at clear time restores:
        // a recategorised row is the reader's newer decision, not ours to hide.
        categoryId:
          row.categoryId === null ? { notIn: [...NON_COMPETING_CATEGORY_IDS] } : row.categoryId,
      },
      data: { isTransfer: true },
    });
    restored += res.count;
  }

  await auditLog(userId, 'transfers.flag-repair-undo', {
    runId,
    restored,
    skipped: cleared.length - restored,
  });

  return { ok: true, restored, skipped: cleared.length - restored };
}
