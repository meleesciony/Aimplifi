/**
 * The background Plaid sweep — deliberately INDEPENDENT of `DATA_PROVIDER`.
 *
 * WHY THIS EXISTS (owner-reported 2026-07-23: "no card payments are due this
 * cycle … this isn't true", with real Chase/Capital One cards linked):
 *
 *  1. `syncLiabilities` — the ONLY source of a card's statement, due date and
 *     minimum payment — had exactly one production caller: `linkPlaidAccount`,
 *     inside a try/catch that swallows the error. No cron ever called it. So a
 *     card's due date was fetched once, best-effort, at link time and NEVER
 *     refreshed: an item that wasn't ready yet on Plaid's side (common, and
 *     explicitly anticipated in that catch's comment) failed silently forever,
 *     and even a successful first pull went stale the moment the next statement
 *     generated.
 *  2. The generic sweep resolves its provider through `getProvider()`, which
 *     returns the DemoProvider (a documented no-op sync) unless DATA_PROVIDER is
 *     'plaid'. Linking is deliberately seam-independent — `plaid-actions.ts`
 *     says so — so a user could link successfully and then never sync again,
 *     with nothing in the UI to say so.
 *
 * The rule this module encodes: a user who has a live Plaid item gets swept,
 * whatever the app's configured provider is, exactly as they can LINK whatever
 * the configured provider is. Anything else lets the two halves disagree.
 *
 * Liabilities are swept for every Plaid-linked user; transactions only when the
 * primary sweep is not already Plaid, so the two never double-run.
 */
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';

/** The provider surface this sweep needs — injected so it is testable without HTTP. */
export interface PlaidSyncPort {
  syncTransactions(userId: string): Promise<{ added: number }>;
  /**
   * Returns counts rather than void: the provider swallows per-item errors, so a
   * thrown error is NOT how a failed liability sweep announces itself (critic F-6).
   */
  syncLiabilities(
    userId: string,
  ): Promise<{ itemsAttempted: number; itemsFailed: number; statementsWritten: number }>;
}

export interface PlaidSweepRow {
  userId: string;
  /** 'ran' | 'skipped' (primary sweep owns it) | 'failed' */
  transactions: 'ran' | 'skipped' | 'failed';
  addedTransactions: number;
  /**
   * 'ran' = at least one item answered; 'failed' = every attempted item errored (or
   * the call itself threw); 'none' = the user has no items left to ask about.
   * Distinguishing these is the point: "no due dates" caused by a broken sweep and
   * "no due dates" because the issuer sends none look identical without it.
   */
  liabilities: 'ran' | 'failed' | 'none';
  /** Statements written this run — 0 with itemsAttempted > 0 is the quiet-failure shape. */
  statementsWritten: number;
  /** Carried through so a PARTIAL failure (2 of 3 items) isn't audited as a clean run. */
  itemsAttempted: number;
  itemsFailed: number;
  error?: string;
}

/**
 * Present-and-usable Plaid credentials. Mirrors `plaidConfigured()` in
 * plaid-actions.ts — with no keys the sweep is inert, preserving the
 * zero-credential demo (and keeping the unit suite off the network).
 */
export function plaidSyncConfigured(): boolean {
  return Boolean(
    process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET && process.env.DATA_ENCRYPTION_KEY,
  );
}

/** Every non-demo user with at least one Plaid item, deduped, stable order. */
export async function plaidLinkedUserIds(): Promise<string[]> {
  const items = await prisma.plaidItem.findMany({
    where: { userId: { not: DEMO_USER_ID } },
    select: { userId: true },
    orderBy: { userId: 'asc' },
  });
  return [...new Set(items.map((i) => i.userId))];
}

/**
 * Sweep every Plaid-linked user. Per-user AND per-step failures are isolated:
 * a transaction failure must never cost the user their due dates, which are the
 * more valuable datum (they are what the whole cash-needed answer is built on),
 * so liabilities run even when transactions threw.
 */
export async function sweepPlaidLinkedUsers(
  port: PlaidSyncPort,
  opts: { syncTransactions: boolean },
): Promise<PlaidSweepRow[]> {
  const userIds = await plaidLinkedUserIds();
  const rows: PlaidSweepRow[] = [];

  for (const userId of userIds) {
    const row: PlaidSweepRow = {
      userId,
      transactions: opts.syncTransactions ? 'ran' : 'skipped',
      addedTransactions: 0,
      liabilities: 'ran',
      statementsWritten: 0,
      itemsAttempted: 0,
      itemsFailed: 0,
    };

    if (opts.syncTransactions) {
      try {
        row.addedTransactions = (await port.syncTransactions(userId)).added;
      } catch (e) {
        row.transactions = 'failed';
        row.error = e instanceof Error ? e.message : 'transaction sync failed';
      }
    }

    try {
      const liab = await port.syncLiabilities(userId);
      row.statementsWritten = liab.statementsWritten;
      row.itemsAttempted = liab.itemsAttempted;
      row.itemsFailed = liab.itemsFailed;
      // Every attempted item erroring is a failure even though nothing threw — the
      // provider catches per item. No items at all is neither success nor failure.
      row.liabilities =
        liab.itemsAttempted === 0
          ? 'none'
          : liab.itemsFailed >= liab.itemsAttempted
            ? 'failed'
            : 'ran';
      if (row.liabilities === 'failed') {
        row.error = row.error ?? `all ${liab.itemsAttempted} Plaid item(s) failed /liabilities/get`;
      }
    } catch (e) {
      row.liabilities = 'failed';
      row.error = row.error ?? (e instanceof Error ? e.message : 'liability sync failed');
    }

    await prisma.auditLog
      .create({
        data: {
          userId,
          action: 'sync.cron.plaid',
          meta: JSON.stringify({
            transactions: row.transactions,
            addedTransactions: row.addedTransactions,
            liabilities: row.liabilities,
            statementsWritten: row.statementsWritten,
            itemsAttempted: row.itemsAttempted,
            itemsFailed: row.itemsFailed,
            ...(row.error ? { error: row.error } : {}),
          }),
        },
      })
      .catch(() => {
        // a failed audit write must never abort the sweep (route precedent)
      });

    rows.push(row);
  }

  return rows;
}
