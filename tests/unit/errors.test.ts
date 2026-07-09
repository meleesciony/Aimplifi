/**
 * Error-tracking unit tests (Gap 6 §2 / DECISIONS #189). Proves the
 * zero-credential invariant: no DSN → no network; with a DSN → envelope POST;
 * scrubber strips emails and secret-looking keys.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureError,
  errorTrackingConfigured,
  parseSentryDsn,
  scrubExtra,
} from '@/lib/errors';

const VALID_DSN = 'https://abc123public@o123.ingest.sentry.io/456';

describe('parseSentryDsn', () => {
  it('parses a standard cloud DSN into an envelope URL', () => {
    const p = parseSentryDsn(VALID_DSN);
    expect(p).toEqual({
      publicKey: 'abc123public',
      host: 'o123.ingest.sentry.io',
      pathPrefix: '',
      projectId: '456',
      envelopeUrl: 'https://o123.ingest.sentry.io/api/456/envelope/',
    });
  });

  it('rejects junk / missing project id', () => {
    expect(parseSentryDsn('not-a-url')).toBeNull();
    expect(parseSentryDsn('https://nokey@host/')).toBeNull();
    expect(parseSentryDsn('https://key@host/not-numeric')).toBeNull();
  });
});

describe('scrubExtra', () => {
  it('strips emails and secret-looking keys', () => {
    const scrubbed = scrubExtra({
      note: 'user alice@example.com paid',
      authorization: 'Bearer secret',
      cookie: 'session=abc',
      ok: 1,
    });
    expect(scrubbed).toEqual({
      note: 'user [redacted-email] paid',
      ok: 1,
    });
  });
});

describe('captureError (dormant-by-default)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('with NO dsn, does not capture and makes no network call', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await captureError(new Error('boom'), { boundary: 'app' });
    expect(res).toEqual({ captured: false, reason: 'no-provider' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorTrackingConfigured()).toBe(false);
  });

  it('with a DSN, POSTs an envelope and reports success', async () => {
    vi.stubEnv('SENTRY_DSN', VALID_DSN);
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);
    const res = await captureError(new Error('boom'), {
      boundary: 'global',
      extra: { email: 'leak@example.com', authorization: 'nope' },
    });
    expect(res).toEqual({ captured: true });
    expect(errorTrackingConfigured()).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://o123.ingest.sentry.io/api/456/envelope/');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Sentry-Auth']).toContain('sentry_key=abc123public');
    const body = String(init.body);
    expect(body).toContain('"type":"event"');
    expect(body).toContain('boom');
    expect(body).toContain('[redacted-email]');
    expect(body).not.toContain('leak@example.com');
    expect(body).not.toContain('nope');
    expect(body).toContain('"boundary":"global"');
  });

  it('reports a non-OK provider response without throwing', async () => {
    vi.stubEnv('SENTRY_DSN', VALID_DSN);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    expect(await captureError(new Error('x'))).toEqual({
      captured: false,
      reason: 'provider-429',
    });
  });

  it('swallows a network error without throwing', async () => {
    vi.stubEnv('SENTRY_DSN', VALID_DSN);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await captureError(new Error('x'))).toEqual({
      captured: false,
      reason: 'network down',
    });
  });

  it('rejects an invalid DSN without throwing or fetching', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://bad');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await captureError(new Error('x'))).toEqual({
      captured: false,
      reason: 'invalid-dsn',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
