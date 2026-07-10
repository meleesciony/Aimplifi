/**
 * EngagementEvent persistence against the real DB (TASKS 3.1).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { recordEngagementEvent } from '@/server/engagement';

const USER_A = `eg-user-a-${Date.now()}-${process.pid}`;
const USER_B = `eg-user-b-${Date.now()}-${process.pid}`;

describe('server/engagement — recordEngagementEvent', () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER_A, email: `${USER_A}@test.local` } });
    await prisma.user.create({ data: { id: USER_B, email: `${USER_B}@test.local` } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } });
  });

  it('appends a valid event', async () => {
    expect(
      await recordEngagementEvent({
        userId: USER_A,
        surface: 'dashboard',
        verb: 'dismissed',
        subjectKey: 'return-moment',
      }),
    ).toBe(true);
    const rows = await prisma.engagementEvent.findMany({ where: { userId: USER_A } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subjectKey).toBe('return-moment');
    expect(rows[0]!.verb).toBe('dismissed');
  });

  it('rejects inventable subject keys (no PII smuggling)', async () => {
    expect(
      await recordEngagementEvent({
        userId: USER_A,
        surface: 'dashboard',
        verb: 'acted',
        // @ts-expect-error intentional invalid key
        subjectKey: 'user-email@x.com',
      }),
    ).toBe(false);
    expect(await prisma.engagementEvent.count({ where: { userId: USER_A } })).toBe(1);
  });

  it('isolates users', async () => {
    expect(await prisma.engagementEvent.count({ where: { userId: USER_B } })).toBe(0);
  });

  it('appends again — no dedup (each interaction is a signal)', async () => {
    await recordEngagementEvent({
      userId: USER_A,
      surface: 'dashboard',
      verb: 'viewed',
      subjectKey: 'return-moment',
    });
    expect(await prisma.engagementEvent.count({ where: { userId: USER_A } })).toBe(2);
  });
});
