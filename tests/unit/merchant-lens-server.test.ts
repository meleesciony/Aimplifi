/**
 * Merchant Pattern Lens — server composition locks (#250 critic F1/F2).
 *
 * F2: the lens's cadence input must be POSTED-only (the exact getRecurring
 * predicate) — a PENDING charge must never move "typically", manufacture a
 * phantom price change, or make the lens disagree with /recurring.
 * F1: the rendered cadence line shows the MAGNITUDE of the (signed, negative
 * for expenses) typicalAmountCents — never "typically −$10.00".
 *
 * Integration-style over the real getTransactions + test DB, same idiom as
 * household-shared-txns.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { addMonthsClamped, isoDate } from '@/lib/dates';
import { getTransactions } from '@/server/transactions';

const stamp = `${Date.now()}-${process.pid}`;
const userId = `mls-user-${stamp}`;

/**
 * K.8 — the fixture and the engine must read the SAME clock. This file used to date its
 * rows off a raw `new Date()` while `getTransactions` resolves "today" through
 * `businessToday()`, which DEMO_TODAY pins — so whenever the two clocks disagreed (every
 * CI run) the newest posted charge slid outside the engine's window and the facts line
 * read "$50.00 in all" against the expected "$60.00". The pin below is what the fixture
 * dates are derived from, so the two clocks cannot disagree by construction.
 */
const PINNED_TODAY = '2026-06-10';

beforeAll(() => {
  vi.stubEnv('DEMO_TODAY', PINNED_TODAY);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe('merchant lens server composition (#250 F1/F2)', () => {
  it('PENDING rows never reach the cadence line; the line renders a positive magnitude', async () => {
    await prisma.user.create({ data: { id: userId, email: `${userId}@test.local`, name: 'Lens' } });
    const acct = await prisma.account.create({
      data: {
        userId,
        provider: 'manual',
        name: 'Lens Checking',
        type: 'CHECKING',
        currentBalanceCents: 100000,
        currency: 'USD',
      },
    });

    // A monthly Netflix series relative to the ENGINE's today (the pin above):
    // 6 POSTED −$10.00 charges, newest one month ago → ACTIVE, MONTHLY.
    const today = isoDate(PINNED_TODAY);
    const dates = [6, 5, 4, 3, 2, 1].map((m) => addMonthsClamped(today, -m));
    for (const d of dates) {
      await prisma.transaction.create({
        data: {
          accountId: acct.id,
          date: d,
          amountCents: -1000,
          rawDescriptor: 'NETFLIX.COM',
          categoryId: 'entertainment',
          status: 'POSTED',
          isTransfer: false,
          isSplitParent: false,
        },
      });
    }
    // The attack row: a larger PENDING charge dated ON today (addMonthsClamped(today, 0)
    // === today — K.8 critic: this comment used to say "yesterday"). The date matters:
    // the profile's inclusion rule is `date <= today` (merchant/profile.ts), so a row
    // even one day later would be dropped by the DATE filter and this would silently
    // stop testing the STATUS filter at all. On the F2 bug the pending row becomes the
    // series' newest amount → "typically $25.00" + phantom price change; /recurring
    // (POSTED-only) would keep saying $10.00.
    await prisma.transaction.create({
      data: {
        accountId: acct.id,
        date: addMonthsClamped(today, 0),
        amountCents: -2500,
        rawDescriptor: 'NETFLIX.COM',
        categoryId: 'entertainment',
        status: 'PENDING',
        isTransfer: false,
        isSplitParent: false,
      },
    });

    const { lens } = await getTransactions(userId, { merchant: 'Netflix' });
    expect(lens).not.toBeNull();
    expect(lens!.merchant).toBe('Netflix');
    const line = lens!.copy.cadenceLine;
    expect(line).not.toBeNull();
    expect(line).toContain('typically $10.00'); // POSTED-only typical (F2)
    expect(line).not.toContain('$25.00'); // the pending amount never leaks in
    expect(line).not.toContain('-$'); // magnitude, never signed (F1)
    // The pending row is also outside every profile figure (POSTED-only rule):
    // 6 × $10.00, never $85.00.
    expect(lens!.copy.factsLine).toContain('$60.00 in all');
  });
});
