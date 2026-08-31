/**
 * Fence locks for the shared-demo rule (DECISIONS #418 wave): the demo is ONE
 * row every anonymous visitor signs into, so any visitor-personalization write
 * landing there would re-derive the coaching figures the NEXT visitor sees.
 * Each visitor-personalization action that reads `userId` from the session must
 * refuse BEFORE touching the demo row; the UI gates (canWrite) are defense in
 * depth, these locks are the proof at the server-action level.
 *
 * Drive the REAL server actions with `auth` mocked to the demo session — the
 * same harness as custom-category-lifecycle.test.ts (real actions, real DB,
 * `vi.mock('@/auth')`). No-write is asserted as a before/after delta on the
 * demo row so the lock holds regardless of what the seed contains.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/cron-auth', () => ({ checkCronBearer: vi.fn() }));

import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { checkCronBearer } from '@/lib/cron-auth';
import { DEMO_ENTRY_BLOCKED, DEMO_USER_ID } from '@/lib/demo-user';
import { prisma } from '@/lib/db';
import { clearBudget, setBudget } from '@/server/budget-actions';
import { updateMoneyDials } from '@/server/settings-actions';
import { updateRichLife } from '@/server/rich-life-actions';
import { updateEmployerMatch } from '@/server/employer-match-actions';
import { updateTaxAdvantagedRoom } from '@/server/tax-advantaged-room-actions';
import { recordUnknownQuestion } from '@/server/unknown-questions';
import { GET as auditCronGet } from '@/app/api/cron/audit/route';

const DEMO_SESSION = { user: { id: DEMO_USER_ID } } as never;

/** True when the demo user row exists in this DB (the unit DB is seeded with it). */
async function demoUserExists(): Promise<boolean> {
  return (await prisma.user.count({ where: { id: DEMO_USER_ID } })) > 0;
}

describe('shared-demo fences (server actions refuse before any write)', () => {
  it('setBudget as the demo session refuses and never touches a budget row', async () => {
    vi.mocked(auth).mockResolvedValue(DEMO_SESSION);
    const before = await prisma.budget.count({ where: { userId: DEMO_USER_ID } });
    const fd = new FormData();
    fd.set('categoryId', 'groceries');
    fd.set('amount', '400');

    const res = await setBudget(null, fd);

    expect(res).toEqual({ ok: false, amountError: DEMO_ENTRY_BLOCKED });
    expect(await prisma.budget.count({ where: { userId: DEMO_USER_ID } })).toBe(before);
  });

  it('clearBudget as the demo session throws and never touches a budget row', async () => {
    vi.mocked(auth).mockResolvedValue(DEMO_SESSION);
    const before = await prisma.budget.count({ where: { userId: DEMO_USER_ID } });

    await expect(clearBudget('groceries')).rejects.toThrow(DEMO_ENTRY_BLOCKED);

    expect(await prisma.budget.count({ where: { userId: DEMO_USER_ID } })).toBe(before);
  });

  it('updateMoneyDials as the demo session refuses and leaves the demo dials untouched', async () => {
    vi.mocked(auth).mockResolvedValue(DEMO_SESSION);
    const before = await prisma.user.findUnique({ where: { id: DEMO_USER_ID } });
    const fd = new FormData();
    fd.set('paymentAccountId', '');
    fd.set('swr', '4');
    fd.set('expectedReturn', '7');
    fd.set('wage', '38');
    fd.append('moneyDialId', 'travel');
    fd.append('moneyDialId', 'dining');

    const res = await updateMoneyDials(null, fd);

    expect(res).toEqual({ ok: false, error: DEMO_ENTRY_BLOCKED });
    const after = await prisma.user.findUnique({ where: { id: DEMO_USER_ID } });
    expect(after?.swrBps).toBe(before?.swrBps);
    expect(after?.moneyDials).toEqual(before?.moneyDials);
    expect(after?.hourlyWageCents).toBe(before?.hourlyWageCents);
    expect(after?.paymentAccountId).toBe(before?.paymentAccountId);
  });

  it('updateRichLife as the demo session refuses and never touches the vision column', async () => {
    vi.mocked(auth).mockResolvedValue(DEMO_SESSION);
    const before = await prisma.user.findUnique({ where: { id: DEMO_USER_ID } });
    const fd = new FormData();
    fd.set('vision', 'three months of travel every year');

    const res = await updateRichLife(null, fd);

    expect(res).toEqual({ ok: false, error: DEMO_ENTRY_BLOCKED });
    const after = await prisma.user.findUnique({ where: { id: DEMO_USER_ID } });
    expect(after?.richLifeVision).toBe(before?.richLifeVision);
  });

  it('updateEmployerMatch as the demo session refuses and never touches the match column', async () => {
    vi.mocked(auth).mockResolvedValue(DEMO_SESSION);
    const before = await prisma.user.findUnique({ where: { id: DEMO_USER_ID } });
    const fd = new FormData();
    fd.set('employerMatch', 'uncaptured');

    const res = await updateEmployerMatch(null, fd);

    expect(res).toEqual({ ok: false, error: DEMO_ENTRY_BLOCKED });
    const after = await prisma.user.findUnique({ where: { id: DEMO_USER_ID } });
    expect(after?.employerMatch).toBe(before?.employerMatch);
  });

  it('updateTaxAdvantagedRoom as the demo session refuses and never touches the room column', async () => {
    vi.mocked(auth).mockResolvedValue(DEMO_SESSION);
    const before = await prisma.user.findUnique({ where: { id: DEMO_USER_ID } });
    const fd = new FormData();
    fd.set('taxAdvantagedRoom', 'remaining');

    const res = await updateTaxAdvantagedRoom(null, fd);

    expect(res).toEqual({ ok: false, error: DEMO_ENTRY_BLOCKED });
    const after = await prisma.user.findUnique({ where: { id: DEMO_USER_ID } });
    expect(after?.taxAdvantagedRoom).toBe(before?.taxAdvantagedRoom);
  });

  it('recordUnknownQuestion as the demo session returns false and writes no row', async () => {
    const before = await prisma.unknownQuestion.count({ where: { userId: DEMO_USER_ID } });

    const written = await recordUnknownQuestion({
      userId: DEMO_USER_ID,
      rawQuestion: 'Who paid Dr. Nguyen on July 3?',
      resolvedIntent: 'unknown',
    });

    expect(written).toBe(false);
    expect(await prisma.unknownQuestion.count({ where: { userId: DEMO_USER_ID } })).toBe(before);
  });

  it('the audit cron sweep skips the demo row (never snapshots a cross-visitor aggregate)', async () => {
    vi.mocked(checkCronBearer).mockReturnValue(true);
    // Non-vacuous: the seeded demo row must actually be in the sweep's user list.
    expect(await demoUserExists()).toBe(true);
    const before = await prisma.selfAuditSnapshot.count({ where: { userId: DEMO_USER_ID } });

    const res = await auditCronGet(new NextRequest('http://localhost/api/cron/audit'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<Record<string, unknown>> };
    expect(body.results).toContainEqual({
      userId: DEMO_USER_ID,
      written: false,
      reason: 'shared-demo-skipped',
    });
    expect(await prisma.selfAuditSnapshot.count({ where: { userId: DEMO_USER_ID } })).toBe(before);
  });
});
