/**
 * TEMPORARY one-time owner SimpleFIN re-sync — REMOVE after use.
 *
 * Nulls the owner's lastSyncedAt then re-syncs, so the deploy's improved account-
 * type classifier is re-applied to existing accounts AND the first-sync 90-day
 * window pulls real transaction history (the initial connect returned balances but
 * almost no transactions). Uses the already-stored access URL — no new token.
 * Guarded + owner-only. Deleted immediately after use.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { syncFromSimplefin } from '@/lib/providers/simplefin';
import { businessToday } from '@/lib/business-today';
import { normalizeEmail } from '@/lib/auth/validate';

const GUARD = '3Bps8OU7k9m0jEu51I4ehiTqKeG2KIyD';
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
    // Treat the next sync as a first sync → 90-day history window + type re-map.
    await prisma.simpleFinConnection.update({ where: { userId: user.id }, data: { lastSyncedAt: null } });
    const r = await syncFromSimplefin(user.id, businessToday(user.id));
    const accounts = await prisma.account.findMany({
      where: { userId: user.id, provider: 'simplefin' },
      select: { name: true, type: true },
      orderBy: { type: 'asc' },
    });
    const byType = accounts.reduce<Record<string, number>>((m, a) => ({ ...m, [a.type]: (m[a.type] ?? 0) + 1 }), {});
    const txnCount = await prisma.transaction.count({ where: { account: { userId: user.id, provider: 'simplefin' } } });
    return NextResponse.json({ ok: true, added: r.added, txnCount, accountsByType: byType });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'resync failed' }, { status: 500 });
  }
}
