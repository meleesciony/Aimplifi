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
  }
  return NextResponse.json({ synced: results.length, results });
}
