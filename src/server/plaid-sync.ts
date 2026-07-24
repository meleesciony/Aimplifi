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
  ): Promise<{
    itemsAttempted: number;
    itemsFailed: number;
    /** Items whose issuer reports no liability data (depository-only) — expected, not broken. */
    itemsUnsupported: number;
    statementsWritten: number;
  }>;
  /**
   * Register the configured webhook on items linked before PLAID_WEBHOOK_URL was
   * set (idempotent, no-op when the env is unset). Optional so a narrower test port
   * need not provide it; when present, the daily cron backfills webhooks hands-free
   * for a user who never opens the app — the exact "stale for a week" case.
   */
  updateWebhooks?(
    userId: string,
  ): Promise<{ attempted: number; updated: number; failed: number }>;
  /**
   * Backfill the human institution name on items that still lack one (idempotent —
   * only null-name items are looked up). Optional so a narrower test port need not
   * provide it; when present, the daily cron labels a bank ("Chase") hands-free for a
   * user who never opens the app, so the /accounts connection row stops reading
   * "Connected bank".
   */
  syncInstitutions?(
    userId: string,
  ): Promise<{ attempted: number; updated: number; failed: number }>;
  /**
   * Sync each INVESTMENT account's holdings (TASKS 4.3). Optional so a narrower test port
   * need not provide it; when present, the daily cron refreshes a linked brokerage's
   * positions hands-free for a user who never opens the app. No-op (zero billed calls) for
   * a user with no investment account, so a checking/credit-only sweep is unaffected.
   */
  syncHoldings?(
    userId: string,
  ): Promise<{ itemsAttempted: number; itemsFailed: number; upserted: number; removed: number }>;
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
  /** Webhooks registered this run (only set when the port supports the backfill). */
  webhooksUpdated?: number;
  /** Institution names resolved this run (only set when the port supports the backfill). */
  institutionsUpdated?: number;
  /** Investment positions written/updated this run (only set when the port supports holdings sync). */
  holdingsUpserted?: number;
  /** Investment positions pruned this run — sold (only set when the port supports holdings sync). */
  holdingsRemoved?: number;
  /** Investment-bearing items asked for holdings this run (only set when the port supports it). */
  holdingsAttempted?: number;
  /** Investment-holdings items that errored — surfaced so a total holdings failure is visible in
   *  the summary, not just the per-item audit (the liabilities F-6 invariant, holdings parity). */
  holdingsFailed?: number;
  /** Carried through so a PARTIAL failure (2 of 3 items) isn't audited as a clean run. */
  itemsAttempted: number;
  itemsFailed: number;
  /** Depository-only items (issuer reports no liability data) — disclosed apart from failures (#277 P2). */
  itemsUnsupported: number;
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
      itemsUnsupported: 0,
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
      row.itemsUnsupported = liab.itemsUnsupported;
      // Every attempted item that COULD have liability data erroring is a failure
      // even though nothing threw — the provider catches per item. An unsupported
      // item (depository-only) is the issuer's "nothing here", never a failure:
      // before this split a checking-only user was audited 'failed' every night
      // forever (#277 P2). No items at all is neither success nor failure.
      const supportable = liab.itemsAttempted - liab.itemsUnsupported;
      row.liabilities =
        liab.itemsAttempted === 0
          ? 'none'
          : liab.itemsFailed > 0 && liab.itemsFailed >= supportable
            ? 'failed'
            : 'ran';
      if (row.liabilities === 'failed') {
        row.error = row.error ?? `all ${supportable} liabilities-supporting Plaid item(s) failed /liabilities/get`;
      }
    } catch (e) {
      row.liabilities = 'failed';
      row.error = row.error ?? (e instanceof Error ? e.message : 'liability sync failed');
    }

    // Best-effort webhook backfill — hands-free for a user who never taps Sync.
    // Never overwrites a prior step's error, and a failure here does not fail the
    // user's sweep (the data pulls above are what matter).
    if (port.updateWebhooks) {
      try {
        row.webhooksUpdated = (await port.updateWebhooks(userId)).updated;
      } catch (e) {
        row.error = row.error ?? (e instanceof Error ? e.message : 'webhook update failed');
      }
    }

    // Best-effort institution-name backfill — same contract as the webhook backfill:
    // hands-free for a user who never taps Sync, never overwrites a prior step's error,
    // and a failure here does not fail the user's sweep (the data pulls are what matter).
    if (port.syncInstitutions) {
      try {
        row.institutionsUpdated = (await port.syncInstitutions(userId)).updated;
      } catch (e) {
        row.error = row.error ?? (e instanceof Error ? e.message : 'institution sync failed');
      }
    }

    // Best-effort investment-holdings refresh (TASKS 4.3) — same contract: hands-free,
    // never overwrites a prior step's error, and a failure here doesn't fail the sweep
    // (holdings are an additive /investments breakdown; net worth rides the account balance).
    if (port.syncHoldings) {
      try {
        const h = await port.syncHoldings(userId);
        row.holdingsUpserted = h.upserted;
        row.holdingsRemoved = h.removed;
        row.holdingsAttempted = h.itemsAttempted;
        row.holdingsFailed = h.itemsFailed;
        // syncHoldings swallows per-item errors (like syncLiabilities), so a total failure
        // returns normally with upserted:0/removed:0 — byte-identical to a no-change run unless
        // the counts are surfaced. Flag it so the sync.cron.plaid summary shows a broken
        // brokerage-holdings sweep instead of a silent all-clear (#277 F-6, holdings parity).
        if (h.itemsAttempted > 0 && h.itemsFailed >= h.itemsAttempted) {
          row.error = row.error ?? `all ${h.itemsAttempted} investment-holdings item(s) failed /investments/holdings/get`;
        }
      } catch (e) {
        row.error = row.error ?? (e instanceof Error ? e.message : 'holdings sync failed');
      }
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
            itemsUnsupported: row.itemsUnsupported,
            ...(row.webhooksUpdated !== undefined ? { webhooksUpdated: row.webhooksUpdated } : {}),
            ...(row.institutionsUpdated !== undefined
              ? { institutionsUpdated: row.institutionsUpdated }
              : {}),
            ...(row.holdingsUpserted !== undefined
              ? {
                  holdingsUpserted: row.holdingsUpserted,
                  holdingsRemoved: row.holdingsRemoved,
                  holdingsAttempted: row.holdingsAttempted,
                  holdingsFailed: row.holdingsFailed,
                }
              : {}),
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
