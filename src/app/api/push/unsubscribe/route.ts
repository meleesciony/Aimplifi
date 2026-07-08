/**
 * Remove the signed-in user's Web-Push subscription (Gap 2 §2), called when they
 * turn notifications off. Scoped to the user + endpoint; requires a session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { deletePushSubscription } from '@/server/push-subscriptions';

export async function POST(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const endpoint = (body as { endpoint?: unknown })?.endpoint;
  if (typeof endpoint !== 'string') {
    return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
  }

  await deletePushSubscription(userId, endpoint);
  return NextResponse.json({ ok: true });
}
