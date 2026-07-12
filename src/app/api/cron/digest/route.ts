/**
 * Weekly digest sweep (Gap 2 §3): Vercel-cron-compatible, CRON_SECRET-guarded like the
 * reminders/notify/sync routes. Intended schedule is weekly (e.g. Monday 13:00). For
 * each user it composes the Money Review (byte-identical to /coach via getCoachData)
 * and the upcoming week's dues into one plain-text email through the SAME dormant email
 * path as reminders (#47): no RESEND_API_KEY → nothing sent, run reports dormant.
 *
 * Once-per-week dedup reuses the #173 NotificationSent table keyed on the week's Monday,
 * so a slipped/duplicate run in the same ISO week sends at most one digest — and, like
 * #173, the key is recorded ONLY after a real send, so a dormant week records nothing
 * and activating email later still delivers. Per-user failures are audited, never abort
 * the sweep; zero-account users are skipped cleanly. The seeded demo is a dormant no-op.
 *
 * JOINT HOUSEHOLD DIGEST (TASKS 4.2 slice 7, DECISIONS #201(2) / #220): a member with a
 * live partner gets ONE household-scope digest instead of a personal one — dues across
 * the household's shared cards (`getCashNeeded(..., 'household')`, the slice-4 merge),
 * plus a symmetric shared-account movement summary and the §4.4 assumptions copy. It is
 * composed PER RECIPIENT, because household scope is viewer-relative by definition
 * ("your accounts + what your partner shared"): a single byte-identical email could only
 * be built by either leaking a partner's private accounts (T1) or dropping each member's
 * own private-card reminders — see DECISIONS #220. The dedup key is UNCHANGED
 * (`weekly_digest:<monday>`), so joining or leaving a household mid-week can never
 * produce a second digest email in the same week.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { addDays, dayOfWeek } from '@/lib/dates';
import { getCashNeeded } from '@/server/finance';
import { getCoachData } from '@/server/coach';
import { partnerIdsOf, resolveViewer } from '@/server/household-authz';
import { getHouseholdDigestContext } from '@/server/household-digest';
import { selectPaymentReminders } from '@/lib/engine/reminders/select';
import { buildWeeklyDigest } from '@/lib/engine/digest/build';
import { receiptsFromOpportunities } from '@/lib/engine/receipts/receipts';
import { getValueReceiptsSummary, recordReceipts } from '@/server/receipts';
import { emailProviderConfigured, sendEmail } from '@/lib/email';
import { checkCronBearer } from '@/lib/cron-auth';

/** Upcoming-dues window for the digest (days). */
const DIGEST_WINDOW_DAYS = 7;

export async function GET(request: NextRequest) {
  if (!checkCronBearer(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dormant = !emailProviderConfigured();
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  const results: Array<Record<string, unknown>> = [];
  let digestsSent = 0;

  for (const user of users) {
    try {
      const accountCount = await prisma.account.count({
        where: { userId: user.id, OR: [{ currency: null }, { currency: 'USD' }] },
      });
      if (accountCount === 0) {
        results.push({ userId: user.id, sent: false, reason: 'no-accounts' });
        continue;
      }

      // A member with a live partner gets the household-scope answer; everyone
      // else (no household, or a household of one) keeps the personal digest,
      // byte-identical to pre-slice-7 — `getCashNeeded` itself downgrades a
      // partnerless 'household' request to 'mine' (T6), but resolving the viewer
      // here keeps the request honest and gives us the shared-account context.
      const viewer = await resolveViewer(user.id);
      const isJoint = partnerIdsOf(viewer).length > 0;

      // The week's Monday is the stable once-per-week dedup key.
      const { today, result, loanObligations } = await getCashNeeded(
        user.id,
        'PAY_IN_FULL',
        isJoint ? 'household' : 'mine',
      );
      const weekStart = addDays(today, -((dayOfWeek(today) + 6) % 7));
      const dedupKey = `weekly_digest:${weekStart}`;
      const already = await prisma.notificationSent.findUnique({
        where: { userId_key: { userId: user.id, key: dedupKey } },
      });
      if (already) {
        results.push({ userId: user.id, sent: false, reason: 'already-sent-this-week' });
        continue;
      }

      const reminders = selectPaymentReminders({
        obligations: result.cards,
        loanObligations,
        today,
        withinDays: DIGEST_WINDOW_DAYS,
      });
      // Personal by design even inside the joint digest (§4.5): the review is
      // computed over the recipient's OWN accounts and reaches only their inbox.
      const { review, opportunities } = await getCoachData(user.id);
      // The tally line reflects everything caught SO FAR (already-persisted rows).
      const receipts = await getValueReceiptsSummary(user.id);
      // Shared-account movement over an inclusive 7-day window ending today.
      const household = isJoint
        ? await getHouseholdDigestContext(viewer, addDays(today, -(DIGEST_WINDOW_DAYS - 1)), today)
        : null;
      const digest = buildWeeklyDigest({ review, reminders, today, receipts, household });

      let sent = false;
      let reason: string | undefined;
      if (!digest) {
        reason = 'nothing-to-send';
      } else if (user.email) {
        const r = await sendEmail({ to: user.email, subject: digest.subject, text: digest.text });
        sent = r.sent;
        reason = r.reason;
        if (sent) {
          digestsSent += 1;
          // Record the week key ONLY after a real send (dormant records nothing, so a
          // later activation still delivers). Race-safe via @@unique([userId,key]).
          try {
            await prisma.notificationSent.create({ data: { userId: user.id, key: dedupKey } });
          } catch (e) {
            if ((e as { code?: string })?.code !== 'P2002') throw e;
          }
          // Value receipts for the price increases this digest actually surfaced
          // (its Money Review creep line names the increase) — minted ONLY after a
          // real send, the same delivery-gated stance as reminders/radar (critic
          // #206 P2-1). They join the tally line from the NEXT digest onward; the
          // /coach visit mints them too, whichever happens first.
          await recordReceipts(user.id, receiptsFromOpportunities(opportunities));
        }
      } else {
        reason = 'no-email';
      }

      results.push({ userId: user.id, sent, reason, joint: isJoint });
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'digest.cron',
          meta: JSON.stringify({ sent, reason, dormant, joint: isJoint }),
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'digest failed';
      results.push({ userId: user.id, ok: false, error: message });
      try {
        await prisma.auditLog.create({
          data: { userId: user.id, action: 'digest.cron.failed', meta: JSON.stringify({ message }) },
        });
      } catch {
        // if the DB itself is down, the failure audit must not abort the sweep
      }
    }
  }

  return NextResponse.json({ usersChecked: users.length, digestsSent, dormant, results });
}
