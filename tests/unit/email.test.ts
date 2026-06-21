/**
 * Email dispatch fallback (ROADMAP #6). Proves the zero-credential invariant: no
 * RESEND_API_KEY → no network call, {sent:false}; with a key → real POST, success
 * and failure both handled without throwing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emailProviderConfigured, sendEmail } from '@/lib/email';

const MSG = { to: 'user@test.local', subject: 'Hi', text: 'body' };

describe('sendEmail (dormant-by-default)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('with NO api key, does not send and makes no network call', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await sendEmail(MSG);
    expect(res).toEqual({ sent: false, reason: 'no-provider' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(emailProviderConfigured()).toBe(false);
  });

  it('with a key, POSTs to the provider and reports success', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);
    const res = await sendEmail(MSG);
    expect(res).toEqual({ sent: true });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(emailProviderConfigured()).toBe(true);
  });

  it('reports a non-OK provider response without throwing', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    expect(await sendEmail(MSG)).toEqual({ sent: false, reason: 'provider-422' });
  });

  it('swallows a network error without throwing', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await sendEmail(MSG)).toEqual({ sent: false, reason: 'network down' });
  });
});
