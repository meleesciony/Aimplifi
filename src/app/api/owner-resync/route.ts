/**
 * TEMPORARY one-time owner SimpleFIN re-sync — REMOVE after use.
 * Nulls lastSyncedAt then re-syncs so: (a) accounts are re-typed with the latest
 * inferAccountType (brokerage institutions → INVESTMENT, so their tickers leave the
 * spending register), (b) transactions are re-categorized with the new taxonomy +
 * generic rules, (c) recurring is rebuilt over spending-only data. Guarded + owner-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { syncFromSimplefin } from '@/lib/providers/simplefin';
import { businessToday } from '@/lib/business-today';
import { normalizeEmail } from '@/lib/auth/validate';

const GUARD = 'OfjWmlS8BjDbugksOlnXzaTAwcYwP2qD';
const OWNERS = new Set(['michael.lee.p@gmail.com', 'lizysuh55@gmail.com']);

export async function POST(req: NextRequest) {
  let body: { token?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  if (body.token !== GUARD) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const email = normalizeEmail(String(body.email ?? ''));
  if (!OWNERS.has(email)) return NextResponse.json({ error: 'not an owner' }, { status: 403 });

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 });
  const conn = await prisma.simpleFinConnection.findUnique({ where: { userId: user.id } });
  if (!conn) return NextResponse.json({ error: 'no SimpleFIN connection' }, { status: 404 });

  try {
    await prisma.simpleFinConnection.update({ where: { userId: user.id }, data: { lastSyncedAt: null } });
    const r = await syncFromSimplefin(user.id, businessToday(user.id));
    const accounts = await prisma.account.findMany({
      where: { userId: user.id, provider: 'simplefin' },
      select: { type: true },
    });
    const byType = accounts.reduce<Record<string, number>>((m, a) => ({ ...m, [a.type]: (m[a.type] ?? 0) + 1 }), {});
    // Transactions now VISIBLE in the spending register (bank + cards only).
    const visibleTxns = await prisma.transaction.count({
      where: { account: { userId: user.id, type: { in: ['CHECKING', 'SAVINGS', 'CREDIT'] } } },
    });
    return NextResponse.json({ ok: true, added: r.added, accountsByType: byType, visibleSpendingTxns: visibleTxns });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'resync failed' }, { status: 500 });
  }
}
