/**
 * TEMPORARY one-time owner SimpleFIN re-sync — REMOVE after use. Re-runs the sync
 * (now with XAI_API_KEY set, so the LLM assist categorizes the unknown long tail)
 * over the 90-day window. Guarded + owner-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { syncFromSimplefin } from '@/lib/providers/simplefin';
import { businessToday } from '@/lib/business-today';
import { normalizeEmail } from '@/lib/auth/validate';

const GUARD = 'TCp5bWELu7mkELY-w_XMUAv_IfHs2BYr';
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
    const spendingTxns = await prisma.transaction.findMany({
      where: { account: { userId: user.id, type: { in: ['CHECKING', 'SAVINGS', 'CREDIT'] } } },
      select: { needsReview: true },
    });
    const reviewing = spendingTxns.filter((t) => t.needsReview).length;
    return NextResponse.json({
      ok: true,
      added: r.added,
      spendingTxns: spendingTxns.length,
      stillUncategorized: reviewing,
      autoCategorized: spendingTxns.length - reviewing,
      xaiKeyPresent: Boolean(process.env.XAI_API_KEY),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'resync failed' }, { status: 500 });
  }
}
