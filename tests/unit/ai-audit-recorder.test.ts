/**
 * AI Trust Center recorder (AI plan §3.2, DECISIONS #242): aiAuditSink writes
 * `ai.<touchpoint>.<outcome>` AuditLog rows for a real user, NEVER for the
 * shared demo account, and getAiTrail reads back only well-formed ai.* rows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { aiAuditSink, getAiTrail } from '@/server/ai-audit';

const USER = 'user-ai-audit-test';

beforeAll(async () => {
  await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: USER } });
  await prisma.user.delete({ where: { id: USER } });
});

describe('aiAuditSink', () => {
  it('persists one ai.<touchpoint>.<outcome> row with the given meta', async () => {
    await aiAuditSink(USER, 'categorize')('replied', { categoryId: 'coffee', confidenceBps: 8000 });
    const rows = await prisma.auditLog.findMany({ where: { userId: USER, action: { startsWith: 'ai.' } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('ai.categorize.replied');
    expect(JSON.parse(rows[0].meta)).toEqual({ categoryId: 'coffee', confidenceBps: 8000 });
  });

  it('test_regression__demo_account_never_records_ai_trail: the shared demo user gets NO row', async () => {
    const before = await prisma.auditLog.count({ where: { userId: DEMO_USER_ID, action: { startsWith: 'ai.' } } });
    await aiAuditSink(DEMO_USER_ID, 'intent')('replied', { kind: 'net_worth' });
    const after = await prisma.auditLog.count({ where: { userId: DEMO_USER_ID, action: { startsWith: 'ai.' } } });
    expect(before).toBe(0); // the seed must not plant a fake trail either
    expect(after).toBe(0);
  });
});

describe('getAiTrail', () => {
  it('returns parsed entries most-recent-first, ignoring non-ai and malformed rows', async () => {
    // A user-mutation row and a malformed ai row must both be invisible to the ledger.
    await prisma.auditLog.create({
      data: { userId: USER, action: 'transaction.create.manual', meta: '{}' },
    });
    await prisma.auditLog.create({
      data: { userId: USER, action: 'ai.unknown_thing.replied', meta: '{}' },
    });
    await aiAuditSink(USER, 'review_order')('rejected', {});

    const trail = await getAiTrail(USER);
    expect(trail).toHaveLength(2); // categorize row (test above) + review_order row
    expect(trail[0].touchpoint).toBe('review_order');
    expect(trail[0].outcome).toBe('rejected');
    expect(trail[1].touchpoint).toBe('categorize');
    expect(trail[1].meta).toEqual({ categoryId: 'coffee', confidenceBps: 8000 });
  });

  it('another user’s rows are invisible (ownership-scoped)', async () => {
    expect(await getAiTrail('user-someone-else')).toEqual([]);
  });
});
