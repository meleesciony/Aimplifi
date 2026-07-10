/**
 * Operator activation checklist (Wave 0.5, TASKS #0.5).
 *
 * Pure, deterministic presence-map: given env-var PRESENCE booleans (never their
 * values), report which dormant systems are live vs dormant and — for each dormant
 * one — the exact env-var NAMES still needed to activate it. This module reads no
 * `process.env`: the server component supplies the booleans via the existing
 * `*Configured()` helpers (email/errors/push) plus a `CRON_SECRET` presence check.
 * Keeping it value-free means (a) it is trivially unit-testable and (b) no secret can
 * ever cross into the client bundle — only booleans and public env-var names do.
 *
 * "Live vs dormant" is honest about compound gates: a delivery system (reminders,
 * digest, push notifications) is live only when BOTH its cron bearer secret AND its
 * provider are present — exactly the two-part gate the cron routes themselves encode
 * (see src/app/api/cron/{digest,notify,reminders}/route.ts).
 */

export type ActivationInputs = {
  /** CRON_SECRET present — gates every /api/cron/* route (all 401 without it). */
  cronSecret: boolean;
  /** RESEND_API_KEY present — mirrors emailProviderConfigured(). */
  email: boolean;
  /** VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT all present — pushProviderConfigured(). */
  push: boolean;
  /** SENTRY_DSN or NEXT_PUBLIC_SENTRY_DSN present — errorTrackingConfigured(). */
  errorTracking: boolean;
};

export type ActivationStatus = 'live' | 'dormant';

export type ActivationRow = {
  key: string;
  label: string;
  /** Non-secret one-line description of what the system does. */
  detail: string;
  status: ActivationStatus;
  /** Env-var NAMES (never values) still needed to activate; [] when live. */
  missing: string[];
};

/** Canonical env-var name groups. Names only — safe to render. */
export const ACTIVATION_ENV = {
  cronSecret: ['CRON_SECRET'],
  email: ['RESEND_API_KEY'],
  push: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
  // errorTrackingConfigured() also accepts NEXT_PUBLIC_SENTRY_DSN, but SENTRY_DSN is
  // the canonical server var to set, so that is the name we advise.
  sentry: ['SENTRY_DSN'],
} as const;

type Requirement = { present: boolean; names: readonly string[] };

function req(present: boolean, names: readonly string[]): Requirement {
  return { present, names };
}

/** A system is live iff every requirement is present; missing lists absent groups in order. */
function makeRow(key: string, label: string, detail: string, reqs: Requirement[]): ActivationRow {
  const missing = reqs.filter((r) => !r.present).flatMap((r) => [...r.names]);
  return { key, label, detail, status: missing.length === 0 ? 'live' : 'dormant', missing };
}

/**
 * The operator activation checklist, in a fixed operator-meaningful order:
 * base capabilities first (error tracking, email, push, cron), then the composed
 * delivery jobs that depend on them.
 */
export function buildActivationChecklist(inputs: ActivationInputs): ActivationRow[] {
  const cron = req(inputs.cronSecret, ACTIVATION_ENV.cronSecret);
  const email = req(inputs.email, ACTIVATION_ENV.email);
  const push = req(inputs.push, ACTIVATION_ENV.push);
  const sentry = req(inputs.errorTracking, ACTIVATION_ENV.sentry);

  return [
    makeRow(
      'error-tracking',
      'Error tracking (Sentry)',
      'Captures server and client exceptions once a DSN is set.',
      [sentry],
    ),
    makeRow(
      'email',
      'Email delivery (Resend)',
      'Outbound email provider — powers payment reminders and the weekly digest.',
      [email],
    ),
    makeRow(
      'web-push',
      'Web push (VAPID)',
      'Browser push channel — required before any push notification can send.',
      [push],
    ),
    makeRow(
      'scheduled-jobs',
      'Scheduled jobs (cron)',
      'Bearer secret that lets the four Vercel cron routes run; every job 401s without it.',
      [cron],
    ),
    makeRow(
      'payment-reminders',
      'Payment reminders email',
      'Daily cron emails a heads-up before a card payment is due.',
      [cron, email],
    ),
    makeRow(
      'weekly-digest',
      'Weekly digest email',
      'Monday cron emails a week-in-review summary.',
      [cron, email],
    ),
    makeRow(
      'push-notifications',
      'Push notifications',
      'Daily cron pushes due-payment and low-balance heads-ups.',
      [cron, push],
    ),
  ];
}

/** Count of live systems over total — for the panel header ("3 of 7 systems live"). */
export function activationSummary(rows: ActivationRow[]): { live: number; total: number } {
  return { live: rows.filter((r) => r.status === 'live').length, total: rows.length };
}
