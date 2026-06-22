/**
 * Plaid webhook route wiring (ROADMAP #1c): the endpoint 404s outside live Plaid
 * mode (the demo deploy never exposes it) and, in Plaid mode, rejects an unsigned
 * request with 401 BEFORE any DB work. The signature logic itself is covered in
 * tests/unit/plaid-webhook.test.ts; the live key fetch is UNVERIFIED (no creds).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/plaid/webhook/route';

function req(body: string, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/plaid/webhook', { method: 'POST', body, headers });
}

describe('POST /api/plaid/webhook', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('404s outside live Plaid mode', async () => {
    vi.stubEnv('DATA_PROVIDER', 'demo');
    expect((await POST(req('{}'))).status).toBe(404);
  });

  it('401s an UNSIGNED request in Plaid mode (verified before any DB work)', async () => {
    vi.stubEnv('DATA_PROVIDER', 'plaid');
    const res = await POST(req(JSON.stringify({ webhook_type: 'TRANSACTIONS', item_id: 'x' })));
    expect(res.status).toBe(401); // no Plaid-Verification header → missing-token
  });
});
