/**
 * Web-Push dispatch (Gap 2 §2) — proves the same zero-credential invariant as
 * email.ts: no VAPID keys → no crypto, no network, {sent:false}. With keys → a real
 * webpush.sendNotification with the RFC-8291 subscription shape and JSON payload; a
 * 404/410 is reported as `gone` (prune) and every failure is swallowed, never thrown.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { setVapidDetails, sendNotification } = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock('web-push', () => ({ default: { setVapidDetails, sendNotification } }));

import { getVapidPublicKey, isAllowedPushEndpoint, pushProviderConfigured, sendPush } from '@/lib/push';

const SUB = { endpoint: 'https://push.example/abc', p256dh: 'p256dh-key', auth: 'auth-secret' };
const PAYLOAD = { title: 'Heads up', body: 'A card is due', url: '/accounts', tag: 'k1' };

function configure() {
  vi.stubEnv('VAPID_PUBLIC_KEY', 'pub-key');
  vi.stubEnv('VAPID_PRIVATE_KEY', 'priv-key');
  vi.stubEnv('VAPID_SUBJECT', 'mailto:ops@aimplifi.app');
}

describe('sendPush (dormant-by-default)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('with NO VAPID keys, does not send and does no crypto/network', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '');
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    vi.stubEnv('VAPID_SUBJECT', '');
    const res = await sendPush(SUB, PAYLOAD);
    expect(res).toEqual({ sent: false, reason: 'no-provider' });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(setVapidDetails).not.toHaveBeenCalled();
    expect(pushProviderConfigured()).toBe(false);
    expect(getVapidPublicKey()).toBeNull();
  });

  it('with a partial config (no subject), stays dormant', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', 'pub-key');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'priv-key');
    vi.stubEnv('VAPID_SUBJECT', '');
    expect(pushProviderConfigured()).toBe(false);
    expect(await sendPush(SUB, PAYLOAD)).toEqual({ sent: false, reason: 'no-provider' });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('with full config, sends with the RFC-8291 shape and JSON payload', async () => {
    configure();
    sendNotification.mockResolvedValueOnce({});
    const res = await sendPush(SUB, PAYLOAD);
    expect(res).toEqual({ sent: true });
    expect(getVapidPublicKey()).toBe('pub-key');
    expect(setVapidDetails).toHaveBeenCalledWith('mailto:ops@aimplifi.app', 'pub-key', 'priv-key');
    const [sub, payload] = sendNotification.mock.calls[0];
    expect(sub).toEqual({ endpoint: SUB.endpoint, keys: { p256dh: SUB.p256dh, auth: SUB.auth } });
    expect(JSON.parse(payload)).toEqual(PAYLOAD);
  });

  it('reports a gone subscription on 410 (prune signal)', async () => {
    configure();
    sendNotification.mockRejectedValueOnce({ statusCode: 410 });
    expect(await sendPush(SUB, PAYLOAD)).toEqual({ sent: false, reason: 'gone-410', gone: true });
  });

  it('reports gone on 404 too', async () => {
    configure();
    sendNotification.mockRejectedValueOnce({ statusCode: 404 });
    expect(await sendPush(SUB, PAYLOAD)).toEqual({ sent: false, reason: 'gone-404', gone: true });
  });

  it('a non-gone status is a plain failure, not a prune', async () => {
    configure();
    sendNotification.mockRejectedValueOnce({ statusCode: 500, message: 'server error' });
    const res = await sendPush(SUB, PAYLOAD);
    expect(res.sent).toBe(false);
    expect(res.gone).toBeUndefined();
  });

  it('swallows a thrown error without throwing', async () => {
    configure();
    sendNotification.mockRejectedValueOnce(new Error('socket hang up'));
    expect(await sendPush(SUB, PAYLOAD)).toEqual({ sent: false, reason: 'socket hang up' });
  });
});

describe('isAllowedPushEndpoint (SSRF guard)', () => {
  it('accepts real browser push-service endpoints (https public host)', () => {
    for (const e of [
      'https://fcm.googleapis.com/fcm/send/abc123',
      'https://web.push.apple.com/xyz',
      'https://sea1.notify.windows.com/w/?token=q',
      'https://updates.push.services.mozilla.com/wpush/v2/g',
    ]) {
      expect(isAllowedPushEndpoint(e)).toBe(true);
    }
  });

  it('rejects non-https, IP literals, localhost, and malformed URLs', () => {
    for (const e of [
      'http://fcm.googleapis.com/x', // not https
      'https://169.254.169.254/latest/meta-data', // cloud metadata (IPv4 literal)
      'https://127.0.0.1/x',
      'https://10.0.0.5/internal',
      'https://[::1]/x', // IPv6 loopback literal
      'https://[fd00::1]/x', // IPv6 ULA literal
      'https://localhost/x',
      'https://api.localhost/x',
      'not-a-url',
      'ftp://example.com/x',
    ]) {
      expect(isAllowedPushEndpoint(e)).toBe(false);
    }
  });
});
