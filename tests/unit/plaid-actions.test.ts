/**
 * Plaid Link actions (DECISIONS #41) — the graceful no-config fallback (the
 * demo-mode invariant): with no Plaid keys, both actions return {ok:false}
 * WITHOUT a network call, so the app still runs credential-free. The happy path
 * (token exchange + sync) is proven end-to-end by `npm run plaid:validate`
 * against Plaid's sandbox (ROADMAP #1a) — the interactive Link iframe is Plaid-
 * hosted and can't be browser-e2e'd, so the validator is its labeled coverage.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'plaid-actions-test-user' } })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { createPlaidLinkToken, linkPlaidAccount } from '@/server/plaid-actions';

describe('plaid-actions — graceful no-config fallback (DECISIONS #41)', () => {
  const saved = {
    id: process.env.PLAID_CLIENT_ID,
    secret: process.env.PLAID_SECRET,
    key: process.env.DATA_ENCRYPTION_KEY,
  };
  function clearPlaidEnv() {
    delete process.env.PLAID_CLIENT_ID;
    delete process.env.PLAID_SECRET;
    delete process.env.DATA_ENCRYPTION_KEY;
  }
  function restore(k: 'PLAID_CLIENT_ID' | 'PLAID_SECRET' | 'DATA_ENCRYPTION_KEY', v: string | undefined) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  afterEach(() => {
    restore('PLAID_CLIENT_ID', saved.id);
    restore('PLAID_SECRET', saved.secret);
    restore('DATA_ENCRYPTION_KEY', saved.key);
  });

  it('createPlaidLinkToken returns not-ok (no network) when Plaid is unconfigured', async () => {
    clearPlaidEnv();
    const r = await createPlaidLinkToken();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/configured/i);
    expect(r.linkToken).toBeUndefined();
  });

  it('linkPlaidAccount returns not-ok when Plaid is unconfigured', async () => {
    clearPlaidEnv();
    const r = await linkPlaidAccount('public-sandbox-xyz');
    expect(r.ok).toBe(false);
  });
});
