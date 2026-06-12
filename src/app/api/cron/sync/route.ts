/**
 * Background sync (Phase 4): Vercel-cron-compatible route. Guarded by
 * CRON_SECRET (Authorization: Bearer <secret>); queue-safe — syncAllUsers is
 * idempotent (cursor-based in the Plaid provider; no-op in demo).
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers/demo';

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get('authorization');
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const provider = getProvider();
  const users = await prisma.user.findMany({ select: { id: true } });
  const results = [];
  for (const user of users) {
    const result = await provider.syncTransactions(user.id);
    results.push({ userId: user.id, ...result });
    await prisma.auditLog.create({
      data: { userId: user.id, action: 'sync.cron', meta: JSON.stringify(result) },
    });
  }
  return NextResponse.json({ synced: results.length, results });
}
