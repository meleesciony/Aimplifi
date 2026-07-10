/**
 * UnknownQuestion persistence (server/unknown-questions.ts) against the real DB:
 * scrub-on-write, append-only, ownership isolation, empty scrub → no row.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { recordUnknownQuestion } from '@/server/unknown-questions';

const USER_A = `uq-user-a-${Date.now()}-${process.pid}`;
const USER_B = `uq-user-b-${Date.now()}-${process.pid}`;

describe('server/unknown-questions — recordUnknownQuestion', () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER_A, email: `${USER_A}@test.local` } });
    await prisma.user.create({ data: { id: USER_B, email: `${USER_B}@test.local` } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } });
  });

  it('stores scrubbed text + optional llm guess + resolved intent', async () => {
    const ok = await recordUnknownQuestion({
      userId: USER_A,
      rawQuestion: 'how much did jane@x.com spend $50 in 2026',
      llmGuessKind: 'spend_total',
      resolvedIntent: 'spend_total',
    });
    expect(ok).toBe(true);
    const rows = await prisma.unknownQuestion.findMany({ where: { userId: USER_A } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scrubbedText).toBe('how much did [email] spend [amount] in [num]');
    expect(rows[0]!.llmGuessKind).toBe('spend_total');
    expect(rows[0]!.resolvedIntent).toBe('spend_total');
    expect(rows[0]!.scrubbedText).not.toMatch(/jane|@|\$50|2026/);
  });

  it('appends a second row (no dedup — every qualifying ask is a mining signal)', async () => {
    await recordUnknownQuestion({
      userId: USER_A,
      rawQuestion: 'blorp the flibbert',
      resolvedIntent: 'unknown',
    });
    const n = await prisma.unknownQuestion.count({ where: { userId: USER_A } });
    expect(n).toBe(2);
  });

  it('isolates users — B never sees A rows', async () => {
    const rows = await prisma.unknownQuestion.findMany({ where: { userId: USER_B } });
    expect(rows).toHaveLength(0);
  });

  it('skips blank; digit-only still logs as [num] (mining signal, no raw digits)', async () => {
    const before = await prisma.unknownQuestion.count({ where: { userId: USER_A } });
    expect(await recordUnknownQuestion({ userId: USER_A, rawQuestion: '   ', resolvedIntent: 'unknown' })).toBe(
      false,
    );
    expect(await recordUnknownQuestion({ userId: USER_A, rawQuestion: '12345', resolvedIntent: 'unknown' })).toBe(
      true,
    );
    const row = await prisma.unknownQuestion.findFirst({
      where: { userId: USER_A },
      orderBy: { createdAt: 'desc' },
    });
    expect(row!.scrubbedText).toBe('[num]');
    const after = await prisma.unknownQuestion.count({ where: { userId: USER_A } });
    expect(after).toBe(before + 1);
  });
});
