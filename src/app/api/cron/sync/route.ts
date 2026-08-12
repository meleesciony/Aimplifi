/**
 * Background sync: Vercel-cron-compatible route, guarded by CRON_SECRET
 * (Authorization: Bearer <secret>). Demo provider: no-op. Plaid provider:
 * runs the real /transactions/sync ingestion (implemented, UNVERIFIED against a
 * live sandbox — see plaid.ts); per-user failures are recorded and do not abort
 * the sweep.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { getProvider } from '@/lib/providers/demo';
import { checkCronBearer } from '@/lib/cron-auth';
import { recordMonthlyBalanceSnapshot } from '@/server/balance-history';
import {
  plaidSyncConfigured,
  sweepPlaidLinkedUsers,
  type PlaidSweepRow,
} from '@/server/plaid-sync';

/**
 * The sweep now makes up to two Plaid round-trips per linked user on top of the
 * primary sync, so it needs the same headroom the vocab cron takes (critic F-14) —
 * a timeout mid-sweep leaves later users unswept with no cursor to resume from.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!checkCronBearer(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const provider = getProvider();
  // Never provider-sync the shared demo account: its data is seeded, and a
  // connection created against it before the connect-fence (#242 follow-up)
  // shipped must not keep ingesting one visitor's real bank into every visitor's
  // row. In demo mode this is a no-op anyway; excluding it also drops a pointless
  // per-run audit row.
  const users = await prisma.user.findMany({
    where: { id: { not: DEMO_USER_ID } },
    select: { id: true },
  });
  const results = [];
  /** U.4 balance-history outcomes, one row per user that wrote or failed to write. */
  const snapshots: { userId: string; written?: number; date?: string | null; error?: string }[] = [];
  for (const user of users) {
    try {
      const result = await provider.syncTransactions(user.id);
      results.push({ userId: user.id, ok: true, ...result });
      await prisma.auditLog.create({
        data: { userId: user.id, action: 'sync.cron', meta: JSON.stringify(result) },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'sync failed';
      results.push({ userId: user.id, ok: false, error: message });
      try {
        await prisma.auditLog.create({
          data: { userId: user.id, action: 'sync.cron.failed', meta: JSON.stringify({ message }) },
        });
      } catch {
        // if the DB itself is down, the failure audit must not abort the sweep
      }
    }
    // U.4: record the month's balance point AFTER the sync above has had its
    // chance to refresh balances — and outside its try, because a sync that
    // failed leaves the balances the app holds no less true (a frozen balance
    // keeps counting everywhere else, so it belongs in the history too).
    // This nightly sweep is the trigger that reaches every user; the sync
    // actions call the same writer so history still accrues if the cron is
    // never configured. Isolated like every other half of this route: a
    // snapshot failure must not cost the remaining users their sync.
    try {
      const snap = await recordMonthlyBalanceSnapshot(user.id);
      if (snap.written > 0) snapshots.push({ userId: user.id, written: snap.written, date: snap.date });
    } catch (e) {
      snapshots.push({ userId: user.id, error: e instanceof Error ? e.message : 'snapshot failed' });
    }
  }
  // Plaid-linked users are swept REGARDLESS of DATA_PROVIDER (src/server/plaid-sync.ts
  // explains why). Without this, card due dates were fetched once at link time and
  // never again, and under a non-plaid DATA_PROVIDER nothing synced at all.
  let plaid: PlaidSweepRow[] = [];
  let plaidError: string | undefined;
  // Wrapped whole: a throw from the dynamic import, the constructor, or the item
  // query must not 500 the route AFTER the primary sweep's writes have committed —
  // that would discard results the caller needs and hide a partial success.
  try {
    if (plaidSyncConfigured()) {
      // Lazy import for the same reason getProvider() does it: the demo path must not
      // pull the Plaid module in at all when no credentials exist.
      const { PlaidProvider } = await import('@/lib/providers/plaid');
      plaid = await sweepPlaidLinkedUsers(new PlaidProvider(), {
        // The primary sweep above already ran transactions for these users when the
        // configured provider IS Plaid; don't run them twice.
        syncTransactions: (process.env.DATA_PROVIDER ?? 'demo') !== 'plaid',
      });
    }
  } catch (e) {
    plaidError = e instanceof Error ? e.message : 'plaid sweep failed';
  }

  return NextResponse.json({
    synced: results.length,
    results,
    snapshots,
    plaid,
    ...(plaidError ? { plaidError } : {}),
  });
}
