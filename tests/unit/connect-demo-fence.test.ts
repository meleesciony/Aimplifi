/**
 * Demo fence on the bank-CONNECT / INGEST actions (#242 follow-up; the STATUS
 * "owner follow-up" privacy hole). The shared demo account is one row every
 * anonymous visitor logs into, so letting it link a real bank would land ONE
 * visitor's real financial data in the row the NEXT visitor sees — the same
 * shared-account leak class as the household seat (#210) and learned vocab (#226).
 *
 * Load-bearing invariant: the two CONNECT actions (`linkPlaidAccount`,
 * `connectSimplefin`) create the durable connection; if neither can succeed for
 * `user-demo`, then no PlaidItem / SimpleFinConnection row for demo can exist, so
 * the cron sweep, the Plaid webhook, and `syncSimplefinNow` all have nothing to
 * act on by construction. We fence all four ingest entrypoints for defense in
 * depth and prove each here.
 *
 * These tests set the provider keys AS CONFIGURED (the keyed deployment), so the
 * demo message is the ONLY possible refusal — the graceful no-config fallback
 * (`plaid-actions.test.ts`) can't mask a missing fence. `disconnectSimplefin` is
 * intentionally NOT fenced (it removes data, never ingests — the remediation path
 * for any pre-existing breach), so it is not covered here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { auth } = await import('@/auth');
const { createPlaidLinkToken, linkPlaidAccount } = await import('@/server/plaid-actions');
const { connectSimplefin, syncSimplefinNow } = await import('@/server/simplefin-actions');

function actAs(userId: string) {
  vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never);
}

const saved = {
  id: process.env.PLAID_CLIENT_ID,
  secret: process.env.PLAID_SECRET,
  key: process.env.DATA_ENCRYPTION_KEY,
};
function restore(k: 'PLAID_CLIENT_ID' | 'PLAID_SECRET' | 'DATA_ENCRYPTION_KEY', v: string | undefined) {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

beforeEach(() => {
  // A fully KEYED deployment: the fence is the only thing that can refuse demo.
  process.env.PLAID_CLIENT_ID = 'plaid-fake-client-id';
  process.env.PLAID_SECRET = 'plaid-fake-secret';
  process.env.DATA_ENCRYPTION_KEY = 'x'.repeat(64);
});
afterEach(() => {
  restore('PLAID_CLIENT_ID', saved.id);
  restore('PLAID_SECRET', saved.secret);
  restore('DATA_ENCRYPTION_KEY', saved.key);
  vi.restoreAllMocks();
});

describe('test_regression__demo_cannot_connect_a_real_bank (keyed deployment)', () => {
  it('createPlaidLinkToken refuses the demo user before minting a token', async () => {
    actAs(DEMO_USER_ID);
    const r = await createPlaidLinkToken();
    expect(r.ok).toBe(false);
    // The /demo/ message is unique to the fence — a Plaid API error (unfenced,
    // fake keys) or the "not configured" path would read differently.
    expect(r.error).toMatch(/demo/i);
    expect(r.linkToken).toBeUndefined();
  });

  it('linkPlaidAccount refuses the demo user before exchanging the public token', async () => {
    actAs(DEMO_USER_ID);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await linkPlaidAccount('public-sandbox-would-be-real-bank');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/demo/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('connectSimplefin refuses the demo user before claiming the setup token', async () => {
    actAs(DEMO_USER_ID);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await connectSimplefin('https://bridge.simplefin.org/simplefin/claim/demo-would-leak');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/demo/i);
    // No network claim, therefore no SimpleFinConnection row is ever written.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('syncSimplefinNow refuses the demo user before hitting the provider', async () => {
    actAs(DEMO_USER_ID);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await syncSimplefinNow();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/demo/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the fence is demo-specific: a real user passes it and hits the normal path', async () => {
    // A real user with keys CLEARED gets the "not configured" refusal, NOT the
    // demo refusal — proving the fence is not a global off-switch (parallel to
    // ai-demo-fence's "real user still calls through").
    actAs('connect-fence-real-user');
    delete process.env.PLAID_CLIENT_ID;
    delete process.env.PLAID_SECRET;
    delete process.env.DATA_ENCRYPTION_KEY;
    const r = await createPlaidLinkToken();
    expect(r.ok).toBe(false);
    expect(r.error).not.toMatch(/demo/i);
    expect(r.error).toMatch(/configured/i);
  });
});
