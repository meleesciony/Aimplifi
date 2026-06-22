/**
 * TEMPORARY one-time owner password reset — REMOVE after use.
 *
 * The owner forgot the password he set at signup, and there is no self-service
 * reset flow yet (needs an email sender). This endpoint sets a known password for
 * a household owner so he can log in. Guarded by a baked one-time token AND
 * restricted to the two owner emails. Deleted in a follow-up commit immediately
 * after it's used. Not part of the product surface.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { normalizeEmail } from '@/lib/auth/validate';

const GUARD_TOKEN = 'SJ8vI1J0LkT-X1MsQZxxlc_uSAawowTD';
const OWNERS = new Set(['michael.lee.p@gmail.com', 'lizysuh55@gmail.com']);

export async function POST(req: NextRequest) {
  let body: { token?: string; email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  if (body.token !== GUARD_TOKEN) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const email = normalizeEmail(String(body.email ?? ''));
  if (!OWNERS.has(email)) return NextResponse.json({ error: 'not an owner' }, { status: 403 });
  const password = String(body.password ?? '');
  if (password.length < 8) return NextResponse.json({ error: 'password too short' }, { status: 400 });

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash: hashPassword(password) },
    update: { passwordHash: hashPassword(password) },
  });
  return NextResponse.json({ ok: true, email, accountExisted: Boolean(existing) });
}
