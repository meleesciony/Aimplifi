/**
 * Weekly self-audit Critic cron (TASKS 3.2 / DECISIONS #211). CRON_SECRET-guarded
 * like digest/notify/reminders. For each user with accounts, upserts one
 * SelfAuditSnapshot for the current ISO week (Monday key). No email/push —
 * dormant-safe by construction (only needs CRON_SECRET). Per-user failures
 * never abort the sweep.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { checkCronBearer } from '@/lib/cron-auth';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { getProvider } from '@/lib/providers/demo';
import { recordSelfAuditSnapshot, weekStartMonday } from '@/server/self-audit';

export async function GET(request: NextRequest) {
  if (!checkCronBearer(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const users = await prisma.user.findMany({ select: { id: true } });
  const results: Array<Record<string, unknown>> = [];
  let snapshotsWritten = 0;
  const provider = getProvider();

  for (const user of users) {
    // The demo is ONE shared row every anonymous visitor signs into: its
    // unknown-question counts mix every visitor's questions, so a snapshot of
    // them would be a cross-visitor aggregate shown to each later visitor (the
    // same shared-account rule that fences the ledger itself). Skip it here.
    if (user.id === DEMO_USER_ID) {
      results.push({ userId: user.id, written: false, reason: 'shared-demo-skipped' });
      continue;
    }
    try {
      const accountCount = await prisma.account.count({
        where: { userId: user.id, OR: [{ currency: null }, { currency: 'USD' }] },
      });
      if (accountCount === 0) {
        results.push({ userId: user.id, written: false, reason: 'no-accounts' });
        continue;
      }

      const today = provider.today(user.id);
      const weekStart = weekStartMonday(today);
      const snap = await recordSelfAuditSnapshot(user.id, weekStart);
      snapshotsWritten += 1;
      results.push({
        userId: user.id,
        written: true,
        weekStart: snap.weekStart,
        reviewRateBps: snap.reviewRateBps,
        unknownRateBps: snap.unknownRateBps,
        alertActRateBps: snap.alertActRateBps,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown';
      try {
        await prisma.auditLog.create({
          data: { userId: user.id, action: 'audit.cron.failed', meta: JSON.stringify({ message }) },
        });
      } catch {
        /* never abort the sweep on audit write failure */
      }
      results.push({ userId: user.id, written: false, reason: 'error', message });
    }
  }

  return NextResponse.json({
    usersChecked: users.length,
    snapshotsWritten,
    results,
  });
}
