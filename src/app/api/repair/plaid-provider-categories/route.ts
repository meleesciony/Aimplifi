/**
 * O.12d — ON-DEMAND repair: backfill `providerCategoryId` / `providerCategoryConfidenceBps`
 * on Plaid rows ingested before L.12 (57e3576, 2026-07-24) added the columns.
 * `/transactions/sync` never re-sends a delivered row, so without this repair those
 * nulls are permanent and the triage inbox's "Plaid's guess" tier stays silent on
 * every pre-L.12 merchant (measured: 97 of the owner's 173 queued rows).
 *
 * Deliberately NOT in vercel.json `crons` — it never fires on a schedule. Invoke it
 * manually with the same bearer the cron routes use:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://www.aimplifi.app/api/repair/plaid-provider-categories
 *
 * On-demand because the defect population is CLOSED: every ingest since L.12 writes
 * the columns, so only rows delivered before that deploy can carry the null. The
 * route stays (idempotent, re-runnable, null-only compare-and-set writes) in case a
 * future gap of the same shape appears. Default sweep is every Plaid-linked user
 * except the shared demo row (which the provider method also fences by construction);
 * `?userId=<id>` scopes the run to one user.
 *
 * COST/SCALE trade-off, stated (critic B P3-3): each user's fetch spans the FULL
 * date range of their null rows — a few 500-row /transactions/get pages per item,
 * serial across all Plaid-linked users in one ≤300s invocation. Fine at current
 * allowlist scale; at real scale, run per-user via `?userId=`. Plaid-side billing
 * for /transactions/get is not verifiable from this repo. A Vercel timeout
 * mid-sweep is safe: writes are per-row compare-and-set, so re-running resumes
 * where it stopped (already-written rows are no longer candidates).
 *
 * PFC availability on /transactions/get is UNVERIFIED against live Plaid (the
 * plaid.ts header's standing label): current Plaid docs return
 * `personal_finance_category` by default, but the account's dashboard API version
 * decides. The first real run's counts are the confirmation — matched rows all
 * landing in `noGuess` means PFC is not coming back on /get; investigate before
 * re-running (the failure direction is a visible no-op, never a wrong write).
 */
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { checkCronBearer } from '@/lib/cron-auth';
import { PlaidProvider } from '@/lib/providers/plaid';
import { plaidSyncConfigured } from '@/server/plaid-sync';

/** Paginated /transactions/get over a multi-year window can take several calls per
 * item — give the repair the same headroom the sync cron takes. */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!checkCronBearer(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!plaidSyncConfigured()) {
    return NextResponse.json(
      { error: 'Plaid is not configured (PLAID_CLIENT_ID / PLAID_SECRET / DATA_ENCRYPTION_KEY)' },
      { status: 503 },
    );
  }

  const userIdParam = request.nextUrl.searchParams.get('userId');
  const linked = await prisma.plaidItem.findMany({
    where: { userId: userIdParam ?? { not: DEMO_USER_ID } },
    select: { userId: true },
    distinct: ['userId'],
  });

  const provider = new PlaidProvider();
  const results: Array<Record<string, unknown>> = [];
  let written = 0;
  for (const { userId } of linked) {
    try {
      const r = await provider.backfillProviderCategories(userId);
      written += r.written;
      results.push({ userId, ok: true, ...r });
    } catch (e) {
      // Per-user isolation: one user's failure (e.g. a dead item token) must not
      // abort the sweep. The provider method audits per-item failures itself.
      results.push({ userId, ok: false, error: e instanceof Error ? e.message : 'backfill failed' });
    }
  }

  if (written > 0) {
    // The columns feed the triage inbox's fallback suggestion tier and the register's
    // provider chip — same surfaces the categorize backfill revalidates.
    revalidatePath('/triage');
    revalidatePath('/transactions');
    revalidatePath('/dashboard');
  }

  return NextResponse.json({ users: results.length, written, results });
}
