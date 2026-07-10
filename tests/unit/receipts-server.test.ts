/**
 * Value-receipts persistence (server/receipts.ts) against the real DB: append-only
 * dedup on [userId, key], summary round-trip, and ownership isolation (user A's
 * catches never appear in user B's tally).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { getValueReceiptsSummary, recordReceipts } from '@/server/receipts';
import type { ReceiptCandidate } from '@/lib/engine/receipts/receipts';
import { cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';

const USER_A = `vr-user-a-${Date.now()}-${process.pid}`;
const USER_B = `vr-user-b-${Date.now()}-${process.pid}`;

const candidate = (over: Partial<ReceiptCandidate> = {}): ReceiptCandidate => ({
  kind: 'reminder-delivered',
  key: `payment_due:card-1:2026-06-15`,
  amountCents: cents(123456),
  label: 'Sapphire',
  occurredOn: isoDate('2026-06-10'),
  ...over,
});

describe('server/receipts — record + summarize round-trip', () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER_A, email: `${USER_A}@test.local` } });
    await prisma.user.create({ data: { id: USER_B, email: `${USER_B}@test.local` } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } });
  });

  it('inserts new candidates and reports the count', async () => {
    const n = await recordReceipts(USER_A, [
      candidate(),
      candidate({ kind: 'radar-catch', key: 'cash_flow_alert:2026-06-14', amountCents: cents(50000), label: '' }),
      candidate({ kind: 'price-increase', key: 'price_increase:Netflix:2026-02-03', amountCents: cents(250), label: 'Netflix', occurredOn: isoDate('2026-02-03') }),
    ]);
    expect(n).toBe(3);
  });

  it('re-recording the same catches is a no-op (idempotent per key)', async () => {
    const n = await recordReceipts(USER_A, [candidate()]);
    expect(n).toBe(0);
    expect(await prisma.valueReceipt.count({ where: { userId: USER_A } })).toBe(3);
  });

  it('a duplicate key WITHIN one batch mints once', async () => {
    const n = await recordReceipts(USER_A, [
      candidate({ key: 'payment_due:card-2:2026-06-20', amountCents: cents(700) }),
      candidate({ key: 'payment_due:card-2:2026-06-20', amountCents: cents(700) }),
    ]);
    expect(n).toBe(1);
  });

  it('recorded rows are append-only facts: the stored amount is the catch-time copy', async () => {
    const row = await prisma.valueReceipt.findUnique({
      where: { userId_key: { userId: USER_A, key: 'payment_due:card-1:2026-06-15' } },
    });
    expect(row?.amountCents).toBe(123456);
    expect(row?.kind).toBe('reminder-delivered');
    expect(row?.label).toBe('Sapphire');
    expect(row?.occurredOn).toBe('2026-06-10');
  });

  it('summary folds the user’s rows with hand-verified totals', async () => {
    const s = await getValueReceiptsSummary(USER_A);
    expect(s.total).toBe(4);
    expect(s.remindersCount).toBe(2);
    expect(s.remindersAmountCents).toBe(123456 + 700);
    expect(s.radarCount).toBe(1);
    expect(s.priceIncreaseCount).toBe(1);
    expect(s.priceIncreaseMonthlyCents).toBe(250);
  });

  it('ownership: user B sees an all-zero tally, and the SAME key is per-user, not global', async () => {
    expect((await getValueReceiptsSummary(USER_B)).total).toBe(0);
    // user B can mint a receipt under a key user A already used
    const n = await recordReceipts(USER_B, [candidate()]);
    expect(n).toBe(1);
    expect((await getValueReceiptsSummary(USER_B)).total).toBe(1);
    expect((await getValueReceiptsSummary(USER_A)).total).toBe(4); // A unchanged
  });

  it('empty candidate list is a no-op', async () => {
    expect(await recordReceipts(USER_A, [])).toBe(0);
  });
});
