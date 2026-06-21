/**
 * Background sync: Vercel-cron-compatible route, guarded by CRON_SECRET
 * (Authorization: Bearer <secret>). Demo provider: no-op. Plaid provider:
 * runs the real /transactions/sync ingestion (implemented, UNVERIFIED against a
 * live sandbox — see plaid.ts); per-user failures are recorded and do not abort
 * the sweep.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers/demo';
import { checkCronBearer } from '@/lib/cron-auth';

export async function GET(request: NextRequest) {
  if (!checkCronBearer(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const provider = getProvider();
  const users = await prisma.user.findMany({ select: { id: true } });
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
