/**
 * Proactive-notification sweep (Gap 2 §2): Vercel-cron-compatible, CRON_SECRET-guarded
 * like the reminders/sync routes. For each user it unifies imminent payment reminders
 * and a pushWorthy Cash Flow Radar dip through the pure Smart Notification Engine, then
 * delivers the material, not-yet-sent ones as Web Push.
 *
 * DORMANT by default and golden-safe: with no VAPID keys (pushProviderConfigured false)
 * OR no stored subscriptions, nothing is delivered — and, crucially, NO NotificationSent
 * row is written, so a user who subscribes later still receives that alert. A key is
 * recorded ONLY after a real delivery to at least one live device, giving "alert once
 * per subject per USER" without ever burning a key against a phantom send (a transient
 * per-device failure with another device succeeding still records — once-per-subject
 * beats a retry storm). Per-user failures are audited and never abort the sweep. The
 * seeded demo (provider 'demo', zero subscriptions) is a pure no-op that reports what
 * it WOULD send.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { addDays } from '@/lib/dates';
import { businessToday } from '@/lib/business-today';
import { getCashNeeded } from '@/server/finance';
import { getCashFlowRadar } from '@/server/radar';
import { selectPaymentReminders } from '@/lib/engine/reminders/select';
import { paymentNotificationKey, selectNotifications } from '@/lib/engine/notify/select';
import { receiptFromRadarAlert, receiptsFromReminders } from '@/lib/engine/receipts/receipts';
import { recordReceipts } from '@/server/receipts';
import { isAllowedPushEndpoint, pushProviderConfigured, sendPush } from '@/lib/push';
import { deleteGoneEndpoint } from '@/server/push-subscriptions';
import { checkCronBearer } from '@/lib/cron-auth';

/**
 * Fetch lookahead for payment reminders (days). The notification engine tightens
 * delivery to ≤ NOTIFY_DUE_WINDOW_DAYS (3); this wider fetch window just lets the
 * engine make that call rather than pre-filtering it away.
 */
const NOTIFY_WINDOW_DAYS = 5;
/**
 * Radar re-alert cooldown (critic P2-1): the radar dedup key is the projected dip
 * DATE, which can wobble day-to-day as pending charges post. Suppress a new
 * cash_flow_alert if one was delivered to this user within the cooldown, so a single
 * shortfall episode pushes at most ~once, not once per shifted date. Payment keys are
 * stable (accountId+dueDate) and need no cooldown.
 */
const RADAR_REALERT_COOLDOWN_DAYS = 4;
/** Retain the dedup log this long, then prune (bounded growth; expired keys can't re-fire). */
const NOTIFICATION_LOG_RETENTION_DAYS = 120;

export async function GET(request: NextRequest) {
  if (!checkCronBearer(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const configured = pushProviderConfigured();
  const dormant = !configured;

  // Prune the dedup log (P3-3): reminder selection excludes past dates and dates only
  // move forward, so a key older than the retention window can never re-fire. One
  // cheap, indexed delete per sweep keeps the per-user key load bounded.
  await prisma.notificationSent.deleteMany({
    where: { sentAt: { lt: new Date(addDays(businessToday(), -NOTIFICATION_LOG_RETENTION_DAYS)) } },
  });

  const users = await prisma.user.findMany({ select: { id: true } });
  const results: Array<Record<string, unknown>> = [];
  let candidatesTotal = 0;
  let pushesSent = 0;

  for (const user of users) {
    try {
      const accountCount = await prisma.account.count({
        where: { userId: user.id, OR: [{ currency: null }, { currency: 'USD' }] },
      });
      if (accountCount === 0) {
        results.push({ userId: user.id, candidates: 0, sent: 0, reason: 'no-accounts' });
        continue;
      }

      const { today, result, loanObligations } = await getCashNeeded(user.id, 'PAY_IN_FULL');
      const reminders = selectPaymentReminders({
        obligations: result.cards,
        loanObligations,
        today,
        withinDays: NOTIFY_WINDOW_DAYS,
      });
      // Radar is best-effort: a radar failure must not suppress a payment-due push.
      let radar = null;
      try {
        radar = (await getCashFlowRadar(user.id)).radar;
      } catch {
        radar = null;
      }

      // Exclude anything already delivered (dedup at selection).
      const sentRows = await prisma.notificationSent.findMany({
        where: { userId: user.id },
        select: { key: true, sentAt: true },
      });
      const sentKeys = new Set(sentRows.map((r) => r.key));

      // P2-1 cooldown: was a radar alert delivered to this user recently? If so, a
      // dip-date wobble must not re-push the same shortfall episode.
      const cooldownStart = new Date(addDays(today, -RADAR_REALERT_COOLDOWN_DAYS));
      const radarInCooldown = sentRows.some(
        (r) => r.key.startsWith('cash_flow_alert:') && r.sentAt >= cooldownStart,
      );

      const notifications = selectNotifications({
        reminders,
        radar,
        today,
        sentKeys,
        radarAlertOnCooldown: radarInCooldown,
      });
      candidatesTotal += notifications.length;

      // Nothing to deliver against if dormant or the user has no live subscription:
      // report what we WOULD send and record NOTHING (so a later opt-in still fires).
      const subs = configured
        ? await prisma.pushSubscription.findMany({ where: { userId: user.id } })
        : [];

      let userSent = 0;
      if (configured && subs.length > 0) {
        for (const n of notifications) {
          let deliveredToAny = false;
          for (const s of subs) {
            // Defense-in-depth (P3-5): never POST to an endpoint that isn't a public
            // https push host, even for a row that predates the subscribe-time guard.
            if (!isAllowedPushEndpoint(s.endpoint)) {
              await deleteGoneEndpoint(s.endpoint);
              continue;
            }
            const r = await sendPush(
              { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
              { title: n.title, body: n.body, url: n.url, tag: n.key },
            );
            if (r.sent) deliveredToAny = true;
            else if (r.gone) await deleteGoneEndpoint(s.endpoint);
          }
          if (deliveredToAny) {
            // Record the dedup key race-safely: the @@unique makes a concurrent
            // sweep's duplicate insert violate it. Swallow ONLY that (P2002); a real
            // DB fault must surface to the per-user failure audit (P3-2).
            try {
              await prisma.notificationSent.create({ data: { userId: user.id, key: n.key } });
              userSent += 1;
            } catch (e) {
              if ((e as { code?: string })?.code !== 'P2002') throw e;
              // already recorded by a concurrent sweep — fine, it was delivered
            }
            // Value receipt for the delivered catch (TASKS 1.3). Keys are
            // channel-agnostic (payment receipts share the reminder-email key), so
            // whichever channel delivered first minted it and this is a no-op then.
            if (n.kind === 'cash_flow_alert' && radar) {
              const receipt = receiptFromRadarAlert(radar, today);
              if (receipt) await recordReceipts(user.id, [receipt]);
            } else if (n.kind === 'payment_due') {
              const reminder = reminders.find((r) => paymentNotificationKey(r) === n.key);
              if (reminder) await recordReceipts(user.id, receiptsFromReminders([reminder], today));
            }
          }
        }
      }

      pushesSent += userSent;
      results.push({ userId: user.id, candidates: notifications.length, sent: userSent });
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'notify.cron',
          meta: JSON.stringify({ candidates: notifications.length, sent: userSent, dormant }),
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'notify failed';
      results.push({ userId: user.id, ok: false, error: message });
      try {
        await prisma.auditLog.create({
          data: { userId: user.id, action: 'notify.cron.failed', meta: JSON.stringify({ message }) },
        });
      } catch {
        // if the DB itself is down, the failure audit must not abort the sweep
      }
    }
  }

  return NextResponse.json({ usersChecked: users.length, candidatesTotal, pushesSent, dormant, results });
}
