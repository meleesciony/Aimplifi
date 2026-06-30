/**
 * Payment-reminder sweep (ROADMAP #6): Vercel-cron-compatible, guarded by
 * CRON_SECRET (Authorization: Bearer <secret>) like the sync route. For each user
 * it computes the cards due within the imminent window and emails a reminder. The
 * email mechanism is dormant by default (no RESEND_API_KEY → nothing sent, the run
 * reports `dormant: true` and audits what it WOULD have sent), so this runs with
 * zero credentials. Per-user failures are recorded and never abort the sweep.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCashNeeded } from '@/server/finance';
import { buildReminderEmail, selectPaymentReminders } from '@/lib/engine/reminders/select';
import { emailProviderConfigured, sendEmail } from '@/lib/email';
import { checkCronBearer } from '@/lib/cron-auth';

/** "Imminent" lookahead for an emailed reminder (days). */
const REMINDER_WINDOW_DAYS = 5;

export async function GET(request: NextRequest) {
  if (!checkCronBearer(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dormant = !emailProviderConfigured();
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  const results: Array<Record<string, unknown>> = [];
  let remindersTotal = 0;
  let emailsSent = 0;

  for (const user of users) {
    try {
      // A brand-new (zero-account) user has nothing to remind about; resolving a
      // payment account would throw, so skip cleanly rather than record a failure.
      const accountCount = await prisma.account.count({ where: { userId: user.id } });
      if (accountCount === 0) {
        results.push({ userId: user.id, reminders: 0, sent: false, reason: 'no-accounts' });
        continue;
      }

      const { today, result, loanObligations } = await getCashNeeded(user.id, 'PAY_IN_FULL');
      // `result.cards` is the complete obligation set (real + estimated); `upcoming`
      // is a subset, so pass only `cards` to avoid double-counting estimated cards.
      // loanObligations adds the next LOAN/MORTGAGE payments within the window (#134).
      const reminders = selectPaymentReminders({
        obligations: result.cards,
        loanObligations,
        today,
        withinDays: REMINDER_WINDOW_DAYS,
      });
      remindersTotal += reminders.length;

      const email = buildReminderEmail(reminders, today);
      let sent = false;
      let reason: string | undefined;
      if (email && user.email) {
        const r = await sendEmail({ to: user.email, subject: email.subject, text: email.text });
        sent = r.sent;
        reason = r.reason;
        if (sent) emailsSent += 1;
      }

      results.push({ userId: user.id, reminders: reminders.length, sent, reason });
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'reminders.cron',
          meta: JSON.stringify({ reminders: reminders.length, sent, reason, dormant }),
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'reminders failed';
      results.push({ userId: user.id, ok: false, error: message });
      try {
        await prisma.auditLog.create({
          data: { userId: user.id, action: 'reminders.cron.failed', meta: JSON.stringify({ message }) },
        });
      } catch {
        // if the DB itself is down, the failure audit must not abort the sweep
      }
    }
  }

  return NextResponse.json({ usersChecked: users.length, remindersTotal, emailsSent, dormant, results });
}
