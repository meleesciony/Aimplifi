import { describe, expect, it } from 'vitest';
import {
  ACTIVATION_ENV,
  activationSummary,
  buildActivationChecklist,
  type ActivationInputs,
  type ActivationRow,
} from '@/lib/engine/ops/activation';

const ALL_OFF: ActivationInputs = { cronSecret: false, email: false, push: false, errorTracking: false };
const ALL_ON: ActivationInputs = { cronSecret: true, email: true, push: true, errorTracking: true };

function byKey(rows: ActivationRow[]): Record<string, ActivationRow> {
  return Object.fromEntries(rows.map((r) => [r.key, r]));
}

const KEYS = [
  'error-tracking',
  'email',
  'web-push',
  'scheduled-jobs',
  'payment-reminders',
  'weekly-digest',
  'push-notifications',
];

describe('buildActivationChecklist', () => {
  it('emits the seven systems in a fixed operator-meaningful order', () => {
    expect(buildActivationChecklist(ALL_OFF).map((r) => r.key)).toEqual(KEYS);
  });

  it('all env absent → every system dormant, each missing exactly its required env-var names', () => {
    const rows = byKey(buildActivationChecklist(ALL_OFF));
    expect(rows['error-tracking']).toMatchObject({ status: 'dormant', missing: ['SENTRY_DSN'] });
    expect(rows['email']).toMatchObject({ status: 'dormant', missing: ['RESEND_API_KEY'] });
    expect(rows['web-push']).toMatchObject({
      status: 'dormant',
      missing: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
    });
    expect(rows['scheduled-jobs']).toMatchObject({ status: 'dormant', missing: ['CRON_SECRET'] });
    // Compound rows list the cron secret first, then the provider group.
    expect(rows['payment-reminders']).toMatchObject({
      status: 'dormant',
      missing: ['CRON_SECRET', 'RESEND_API_KEY'],
    });
    expect(rows['weekly-digest']).toMatchObject({
      status: 'dormant',
      missing: ['CRON_SECRET', 'RESEND_API_KEY'],
    });
    expect(rows['push-notifications']).toMatchObject({
      status: 'dormant',
      missing: ['CRON_SECRET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
    });
  });

  it('all env present → every system live with no missing names', () => {
    const rows = buildActivationChecklist(ALL_ON);
    expect(rows.every((r) => r.status === 'live')).toBe(true);
    expect(rows.every((r) => r.missing.length === 0)).toBe(true);
  });

  it('cron secret alone → scheduler live, but email/push deliverers still list only the provider as missing', () => {
    const rows = byKey(buildActivationChecklist({ ...ALL_OFF, cronSecret: true }));
    expect(rows['scheduled-jobs'].status).toBe('live');
    expect(rows['payment-reminders']).toMatchObject({ status: 'dormant', missing: ['RESEND_API_KEY'] });
    expect(rows['weekly-digest']).toMatchObject({ status: 'dormant', missing: ['RESEND_API_KEY'] });
    expect(rows['push-notifications']).toMatchObject({
      status: 'dormant',
      missing: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
    });
  });

  it('email + cron present, push + sentry absent → email deliverers live, push job + tracking dormant', () => {
    const rows = byKey(buildActivationChecklist({ cronSecret: true, email: true, push: false, errorTracking: false }));
    expect(rows['email'].status).toBe('live');
    expect(rows['payment-reminders'].status).toBe('live');
    expect(rows['weekly-digest'].status).toBe('live');
    expect(rows['web-push'].status).toBe('dormant');
    expect(rows['error-tracking'].status).toBe('dormant');
    expect(rows['push-notifications']).toMatchObject({
      status: 'dormant',
      missing: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
    });
  });

  it('never emits a raw value — missing entries are only known env-var NAMES', () => {
    const known = new Set<string>([
      ...ACTIVATION_ENV.cronSecret,
      ...ACTIVATION_ENV.email,
      ...ACTIVATION_ENV.push,
      ...ACTIVATION_ENV.sentry,
    ]);
    for (const row of buildActivationChecklist(ALL_OFF)) {
      for (const name of row.missing) expect(known.has(name)).toBe(true);
    }
  });
});

describe('activationSummary', () => {
  it('counts live systems over total', () => {
    expect(activationSummary(buildActivationChecklist(ALL_OFF))).toEqual({ live: 0, total: 7 });
    expect(activationSummary(buildActivationChecklist(ALL_ON))).toEqual({ live: 7, total: 7 });
    expect(activationSummary(buildActivationChecklist({ ...ALL_OFF, cronSecret: true }))).toEqual({
      live: 1,
      total: 7,
    });
  });
});
