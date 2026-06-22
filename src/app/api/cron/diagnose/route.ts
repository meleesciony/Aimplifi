/**
 * TEMPORARY owner-only diagnostic (DECISIONS #73 investigation) — read-only.
 * Re-fetches the connected SimpleFIN accounts and reports how each one is
 * classified vs. how many transactions it carries, so we can see why a
 * checking account's expenses are missing from the register. Guarded by a
 * one-off baked token (NOT a session) and removed once the cause is found.
 *
 * Lives under /api/cron/* so the auth middleware lets it through (that prefix
 * runs its own guard). No secrets are returned.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { decryptToken } from '@/lib/crypto';
import { fetchSimplefinAccounts } from '@/lib/providers/simplefin';
import { inferAccountType, mapSimplefinAccount } from '@/lib/providers/simplefin-map';
import { addDays, isoDate } from '@/lib/dates';
import { getProvider } from '@/lib/providers/demo';

const DIAG_TOKEN = 'diag-a7F3kQ9mZ2pX5rL8wB4nC6tV';

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${DIAG_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const conns = await prisma.simpleFinConnection.findMany({ select: { userId: true, accessUrl: true, lastSyncedAt: true } });
  const out: unknown[] = [];

  for (const conn of conns) {
    const userId = conn.userId;
    const today = getProvider().today(userId);
    const startDate = addDays(isoDate(today), -150);

    // Stored accounts + counts
    const stored = await prisma.account.findMany({
      where: { userId, provider: 'simplefin' },
      select: { id: true, name: true, type: true, _count: { select: { transactions: true } } },
    });

    let live: unknown = null;
    try {
      const accessUrl = decryptToken(conn.accessUrl);
      const data = await fetchSimplefinAccounts(accessUrl, startDate);
      live = (data.accounts ?? []).map((a) => {
        const txns = a.transactions ?? [];
        const zone = txns.filter((t) => `${t.description ?? ''}${t.payee ?? ''}${t.memo ?? ''}`.toLowerCase().includes('zone pest'));
        return {
          rawName: a.name,
          org: a.org?.name ?? null,
          balance: a.balance,
          inferredType: inferAccountType(`${a.name} ${a.org?.name ?? ''}`),
          mappedType: mapSimplefinAccount(a).type,
          txnCount: txns.length,
          sampleDescriptors: txns.slice(0, 6).map((t) => t.description ?? t.payee ?? t.memo ?? ''),
          zonePestHere: zone.length,
        };
      });
    } catch (e) {
      live = { error: e instanceof Error ? e.message : 'fetch failed' };
    }

    out.push({
      userId,
      lastSyncedAt: conn.lastSyncedAt,
      storedAccounts: stored.map((s) => ({ name: s.name, type: s.type, txns: s._count.transactions })),
      liveSimplefinAccounts: live,
    });
  }

  return NextResponse.json({ connections: conns.length, diagnostics: out }, { status: 200 });
}
