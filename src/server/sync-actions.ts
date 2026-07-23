'use server';

/**
 * One-button sync across EVERY connected provider (owner request, 2026-07-23:
 * *"I want one button sync of all accounts. And individual syncing if required."*).
 *
 * Before this, syncing was per-provider and asymmetric: SimpleFIN had its own
 * "Sync now" plus auto-sync-on-load (#91), while Plaid had no user-reachable sync
 * at all — its only ingest was the one-shot pull at link time, so those accounts
 * could sit a week stale with no button beside them. Individual controls still
 * exist (SimpleFIN's own button, and per-bank sync for each Plaid item); this is
 * the "just refresh everything" path.
 *
 * Composition, not reimplementation: this calls the SAME two actions the
 * individual buttons call, so there is exactly one definition of what syncing a
 * provider means. Each provider is isolated — one failing must never suppress the
 * other's results, because a user with two banks would otherwise lose both when
 * one bank's login expires.
 */
import { prisma } from '@/lib/db';
import { DEMO_CONNECT_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { requireUserId } from '@/server/authz';
import { syncPlaidNow } from '@/server/plaid-actions';
import { syncSimplefinNow } from '@/server/simplefin-actions';

export interface SyncAllResult {
  ok: boolean;
  /** Which providers were actually attempted (a user may have only one). */
  ran: ('simplefin' | 'plaid')[];
  addedTransactions: number;
  statementsWritten: number;
  /** Providers that were attempted and failed — named, never folded into one message. */
  failed: ('simplefin' | 'plaid')[];
  /** Human-readable summary for the flash message. */
  summary: string;
  error?: string;
}

export async function syncAllAccounts(): Promise<SyncAllResult> {
  const empty = { ran: [], addedTransactions: 0, statementsWritten: 0, failed: [] };
  const userId = await requireUserId();
  if (isDemoUser(userId)) {
    return { ok: false, ...empty, summary: '', error: DEMO_CONNECT_BLOCKED };
  }

  const [simplefin, plaidItems] = await Promise.all([
    prisma.simpleFinConnection.findUnique({ where: { userId }, select: { userId: true } }),
    prisma.plaidItem.count({ where: { userId } }),
  ]);

  if (!simplefin && plaidItems === 0) {
    return { ok: false, ...empty, summary: '', error: 'No banks are connected yet.' };
  }

  const ran: ('simplefin' | 'plaid')[] = [];
  const failed: ('simplefin' | 'plaid')[] = [];
  let addedTransactions = 0;
  let statementsWritten = 0;

  if (simplefin) {
    ran.push('simplefin');
    try {
      const r = await syncSimplefinNow();
      if (r.ok) addedTransactions += r.added ?? 0;
      else failed.push('simplefin');
    } catch {
      failed.push('simplefin');
    }
  }

  if (plaidItems > 0) {
    ran.push('plaid');
    try {
      const r = await syncPlaidNow();
      if (r.ok) {
        addedTransactions += r.added ?? 0;
        statementsWritten += r.statementsWritten ?? 0;
      } else {
        failed.push('plaid');
      }
    } catch {
      failed.push('plaid');
    }
  }

  return {
    // Partial success is success: one provider failing shouldn't present as "sync
    // failed" when the other just delivered fresh data. Only an all-fail is a fail.
    // (`ran` is non-empty here — the no-banks case returned above.)
    ok: failed.length < ran.length,
    ran,
    addedTransactions,
    statementsWritten,
    failed,
    summary: summarize({ ran, failed, addedTransactions, statementsWritten }),
  };
}

/**
 * Say what actually happened. "Synced" with no detail can't be told apart from a
 * sync that silently did nothing — which is exactly the failure that let accounts
 * sit a week stale without anyone noticing.
 */
function summarize(r: {
  ran: ('simplefin' | 'plaid')[];
  failed: ('simplefin' | 'plaid')[];
  addedTransactions: number;
  statementsWritten: number;
}): string {
  const label = { simplefin: 'SimpleFIN', plaid: 'Plaid' } as const;
  const parts: string[] = [];

  const succeeded = r.ran.filter((p) => !r.failed.includes(p));
  if (succeeded.length > 0) {
    parts.push(`Synced ${succeeded.map((p) => label[p]).join(' and ')}.`);
  }
  parts.push(
    r.addedTransactions > 0
      ? `${r.addedTransactions} new transaction${r.addedTransactions === 1 ? '' : 's'}.`
      : 'No new transactions.',
  );
  if (r.statementsWritten > 0) {
    parts.push(
      `${r.statementsWritten} card statement${r.statementsWritten === 1 ? '' : 's'} updated.`,
    );
  }
  if (r.failed.length > 0) {
    parts.push(
      `${r.failed.map((p) => label[p]).join(' and ')} couldn’t be reached — try again in a minute.`,
    );
  }
  return parts.join(' ');
}
