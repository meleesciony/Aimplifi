/**
 * test_regression__cron_sync_excludes_the_demo_account (#242 follow-up).
 *
 * The background sync sweep must never provider-sync the shared demo row: its
 * data is seeded, and a bank connection created against `user-demo` before the
 * connect-fence shipped must not keep pulling one visitor's real bank data into
 * the row every other visitor sees. The sweep excludes demo at the query, so the
 * demo user never appears in the results and never gets a `sync.cron` audit row.
 */
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { DEMO_USER_ID } from '@/lib/demo-user';
import { prisma } from '@/lib/db';
import { GET } from '@/app/api/cron/sync/route';

function cronReq(secret: string) {
  return new NextRequest('http://localhost/api/cron/sync', {
    method: 'GET',
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe('GET /api/cron/sync — demo exclusion', () => {
  it('never syncs or audits the shared demo account', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret-for-demo-skip-test');

    const before = await prisma.auditLog.count({
      where: { userId: DEMO_USER_ID, action: 'sync.cron' },
    });

    const res = await GET(cronReq('cron-secret-for-demo-skip-test'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ userId: string }> };

    // The demo user is filtered out of the sweep entirely.
    expect(body.results.some((r) => r.userId === DEMO_USER_ID)).toBe(false);

    // …and therefore writes no cron-sync audit row against the demo account.
    const after = await prisma.auditLog.count({
      where: { userId: DEMO_USER_ID, action: 'sync.cron' },
    });
    expect(after).toBe(before);

    vi.unstubAllEnvs();
  });
});
