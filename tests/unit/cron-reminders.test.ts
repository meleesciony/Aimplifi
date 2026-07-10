/**
 * Payment-reminder cron route (ROADMAP #6) — drives the REAL GET handler against a
 * throwaway user that has a card due within the window. Proves the CRON_SECRET gate
 * and the dormant (no email key) dispatch: reminders are found and audited, but
 * nothing is sent without a provider.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/cron/reminders/route';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers/demo';
import { addDays } from '@/lib/dates';

function req(secret?: string) {
  const headers: Record<string, string> = {};
  if (secret) headers.authorization = `Bearer ${secret}`;
  return new NextRequest('http://localhost/api/cron/reminders', { headers });
}

describe('GET /api/cron/reminders', () => {
  const USER = `rem-user-${Date.now()}-${process.pid}`;
  const today = getProvider().today();

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500_000 },
    });
    const card = await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Imminent Card', type: 'CREDIT', currentBalanceCents: 50_000 },
    });
    // A statement due in 2 days → inside the 5-day imminent window.
    await prisma.statement.create({
      data: {
        accountId: card.id,
        cycleStart: addDays(today, -35),
        cycleEnd: addDays(today, -5),
        dueDate: addDays(today, 2),
        statementBalanceCents: 50_000,
        minimumPaymentCents: 2_500,
      },
    });
  });
  afterAll(wipe);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('rejects a request without the cron secret', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('with the secret + no email key, finds reminders but sends nothing (dormant)', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    vi.stubEnv('RESEND_API_KEY', '');
    const res = await GET(req('test-secret'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.dormant).toBe(true);
    expect(body.emailsSent).toBe(0); // nothing sent without a provider
    expect(body.usersChecked).toBeGreaterThanOrEqual(1);

    const mine = body.results.find((r: { userId: string }) => r.userId === USER);
    expect(mine).toBeDefined();
    expect(mine.reminders).toBeGreaterThanOrEqual(1); // the imminent card
    expect(mine.sent).toBe(false);
    expect(mine.reason).toBe('no-provider');

    // The sweep audited what it would have sent.
    const audit = await prisma.auditLog.findFirst({ where: { userId: USER, action: 'reminders.cron' } });
    expect(audit).not.toBeNull();

    // TASKS 1.3: a dormant run mints NO value receipt — "reminder delivered" means
    // delivered, never "would have been delivered".
    expect(await prisma.valueReceipt.count({ where: { userId: USER } })).toBe(0);
  });

  it('with an email key, actually sends and counts the email (non-dormant)', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await GET(req('test-secret'));
    const body = await res.json();
    expect(body.dormant).toBe(false);
    expect(body.emailsSent).toBeGreaterThanOrEqual(1);
    const mine = body.results.find((r: { userId: string }) => r.userId === USER);
    expect(mine.sent).toBe(true);
    expect(fetchSpy).toHaveBeenCalled();

    // TASKS 1.3: the delivered reminder minted a value receipt with the payment amount
    // copied verbatim (cashRequiredCents = the $500.00 statement), and a second
    // delivery about the same due payment would dedup on the payment key.
    const receipts = await prisma.valueReceipt.findMany({ where: { userId: USER } });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].kind).toBe('reminder-delivered');
    expect(receipts[0].amountCents).toBe(50_000);
    expect(receipts[0].label).toBe('Imminent Card');
    expect(receipts[0].key.startsWith('payment_due:')).toBe(true);

    // Re-run: same reminder re-emails (reminders have no once-per-key send dedup),
    // but the receipt count must not grow — one catch, one receipt.
    await GET(req('test-secret'));
    expect(await prisma.valueReceipt.count({ where: { userId: USER } })).toBe(1);
  });
});
