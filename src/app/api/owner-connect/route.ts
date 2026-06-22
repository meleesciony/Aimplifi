/**
 * TEMPORARY one-time owner SimpleFIN connect — REMOVE after use.
 *
 * Runs the real claim → encrypt → store → sync flow for a household owner so his
 * actual bank data lands in his account without him pasting the (single-use) token
 * into the UI. Guarded by a baked token + owner-emails-only. Returns a summary so
 * any real-bank field quirk (the live path was only demo-verified) is visible to
 * fix. Deleted immediately after it's used.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { encryptToken } from '@/lib/crypto';
import { claimAccessUrl, syncFromSimplefin } from '@/lib/providers/simplefin';
import { businessToday } from '@/lib/business-today';
import { normalizeEmail } from '@/lib/auth/validate';

const GUARD = 'koGUYSND9LJNdTsG4irzZ1aCObKPqIVt';
const OWNERS = new Set(['michael.lee.p@gmail.com', 'lizysuh55@gmail.com']);

export async function POST(req: NextRequest) {
  let body: { token?: string; email?: string; setupToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  if (body.token !== GUARD) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const email = normalizeEmail(String(body.email ?? ''));
  if (!OWNERS.has(email)) return NextResponse.json({ error: 'not an owner' }, { status: 403 });
  const setupToken = String(body.setupToken ?? '').trim();
  if (!setupToken) return NextResponse.json({ error: 'missing setupToken' }, { status: 400 });
  if (!process.env.DATA_ENCRYPTION_KEY) return NextResponse.json({ error: 'DATA_ENCRYPTION_KEY not set' }, { status: 500 });

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 });

  try {
    const accessUrl = await claimAccessUrl(setupToken);
    const ciphertext = encryptToken(accessUrl);
    await prisma.simpleFinConnection.upsert({
      where: { userId: user.id },
      create: { userId: user.id, accessUrl: ciphertext },
      update: { accessUrl: ciphertext, lastSyncedAt: null },
    });
    const r = await syncFromSimplefin(user.id, businessToday(user.id));
    const accounts = await prisma.account.findMany({
      where: { userId: user.id, provider: 'simplefin' },
      select: { name: true, type: true, currentBalanceCents: true },
      orderBy: { name: 'asc' },
    });
    const txnCount = await prisma.transaction.count({ where: { account: { userId: user.id, provider: 'simplefin' } } });
    return NextResponse.json({ ok: true, added: r.added, txnCount, accounts });
  } catch (e) {
    // Temp debug endpoint: surface the real error to diagnose a first real-bank sync.
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'connect failed' }, { status: 500 });
  }
}
