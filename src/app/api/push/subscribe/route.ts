/**
 * Store a browser Web-Push subscription for the signed-in user (Gap 2 §2). The
 * client calls this after `pushManager.subscribe(...)` succeeds. Requires a session;
 * returns 503 when the deployment has no VAPID keys (nothing could ever be delivered,
 * so we don't store a dead subscription). Validates the RFC-8291 triple shape.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { savePushSubscription } from '@/server/push-subscriptions';
import { isAllowedPushEndpoint, pushProviderConfigured } from '@/lib/push';

export async function POST(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!pushProviderConfigured()) return NextResponse.json({ error: 'Push not configured' }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = b?.endpoint;
  const p256dh = b?.keys?.p256dh;
  const authKey = b?.keys?.auth;
  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof authKey !== 'string') {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
  }
  // Reject an endpoint that isn't a public https push host (SSRF guard) BEFORE storing.
  if (!isAllowedPushEndpoint(endpoint)) {
    return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
  }

  await savePushSubscription(userId, { endpoint, p256dh, auth: authKey });
  return NextResponse.json({ ok: true });
}
