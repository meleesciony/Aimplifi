/**
 * Plaid webhook receiver. On a TRANSACTIONS update for a known item it triggers
 * an incremental sync for that item's owner. In demo mode syncTransactions is a
 * no-op, so this is inert unless DATA_PROVIDER=plaid.
 *
 * SECURITY (ROADMAP #1c): the `Plaid-Verification` JWT is verified (ES256 +
 * request_body_sha256 + freshness) against Plaid's published key BEFORE any DB
 * work, so only Plaid can trigger a sync. The verification logic is unit-tested
 * (tests/unit/plaid-webhook.test.ts); the live key fetch is UNVERIFIED pending
 * real Plaid credentials (docs/PLAID_WALKTHROUGH.md §5). Unknown items are acked.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isDemoUser } from '@/lib/demo-user';
import { getProvider } from '@/lib/providers/demo';
import { verifyPlaidWebhook } from '@/lib/plaid-webhook';

interface PlaidWebhook {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
}

export async function POST(request: NextRequest) {
  // The verification key fetch needs Plaid credentials, which only exist in live
  // Plaid mode — so the demo deploy never exposes this DB-touching, sync-triggering
  // endpoint (it 404s), and in Plaid mode every request must carry a valid signature.
  if ((process.env.DATA_PROVIDER ?? 'demo') !== 'plaid') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Read the RAW body for the signature's body-hash check, then verify the JWT
  // against Plaid's key BEFORE touching the DB. Forged/replayed → clean 401.
  const raw = await request.text();
  const { fetchPlaidWebhookKey } = await import('@/lib/providers/plaid');
  const verified = await verifyPlaidWebhook({
    token: request.headers.get('plaid-verification') ?? '',
    rawBody: raw,
    getKey: fetchPlaidWebhookKey,
  });
  if (!verified.ok) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let body: PlaidWebhook;
  try {
    body = JSON.parse(raw) as PlaidWebhook;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.item_id) {
    return NextResponse.json({ error: 'missing item_id' }, { status: 400 });
  }

  const item = await prisma.plaidItem.findUnique({
    where: { itemId: body.item_id },
    select: { userId: true },
  });
  // Unknown item: acknowledge so Plaid stops retrying, but take no action.
  if (!item) return NextResponse.json({ received: true });
  // A demo-owned item can only exist as a pre-fence (#242 follow-up) breach
  // residual; never sync it, so no more real bank data flows into the shared row.
  if (isDemoUser(item.userId)) return NextResponse.json({ received: true });

  if (body.webhook_type === 'TRANSACTIONS') {
    try {
      await getProvider().syncTransactions(item.userId);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'sync failed';
      try {
        await prisma.auditLog.create({
          data: {
            userId: item.userId,
            action: 'plaid.webhook.sync.failed',
            meta: JSON.stringify({ message }),
          },
        });
      } catch {
        // never let an audit-write failure turn into a webhook 500
      }
    }
  }

  return NextResponse.json({ received: true });
}
