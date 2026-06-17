/**
 * Plaid webhook receiver. On a TRANSACTIONS update for a known item it triggers
 * an incremental sync for that item's owner. In demo mode syncTransactions is a
 * no-op, so this is inert unless DATA_PROVIDER=plaid.
 *
 * UNVERIFIED / SECURITY TODO: Plaid-Verification (JWT) signature verification is
 * NOT yet implemented — wire it before production so only Plaid can trigger a
 * sync (docs/PLAID_WALKTHROUGH.md §5). Unknown items are acked and ignored.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers/demo';

interface PlaidWebhook {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
}

export async function POST(request: NextRequest) {
  // Interim mitigation (DECISIONS #44): this endpoint is excluded from auth so
  // Plaid can reach it, but the JWT signature check isn't wired yet (ROADMAP
  // #1c). Until it is, refuse outside live Plaid mode so the demo deploy never
  // exposes an unauthenticated, DB-touching, sync-triggering endpoint.
  if ((process.env.DATA_PROVIDER ?? 'demo') !== 'plaid') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  let body: PlaidWebhook;
  try {
    body = (await request.json()) as PlaidWebhook;
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
