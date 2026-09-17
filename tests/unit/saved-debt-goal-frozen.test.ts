/**
 * TASKS L.19 residual (1) — the SAVED debt-free goal on /goals (DECISIONS #746).
 *
 * #742 qualified the planner and both Ask debt answers; its critic (P2-6) named the hop after them:
 * `saveDebtFreeGoal` persists the solver's total as `Goal.targetCents` and the /goals card prints
 * "$X of debt" from that row forever after, with nothing said. `Goal` has no `createdAt`, so the
 * fact must be RECORDED at the save (`Goal.frozenAtSave`) — a re-resolve against today's
 * `feedDroppedAt` would over-claim for a debt that froze after the save.
 *
 * Driven against the REAL writer + the REAL read path (Prisma): the stamp is set from the solver's
 * own input, and a pure-builder test cannot see whether the writer answered.
 *
 * ABSTENTIONS ARE PINNED TO LITERALS — a stamp on a total no frozen account fed is a false hedge, so
 * every "it stamps" case has a "stays null" twin compared against `null`, never against the code's
 * own default (the L.15 rule).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import {
  FROZEN_SAVED_DEBT_GOAL_TESTID,
  frozenSavedDebtGoalNote,
} from '@/lib/engine/account/feed-dropped-view';
import { getProvider } from '@/lib/providers/demo';
import { addMonthsClamped, type ISODate } from '@/lib/dates';
import {
  clearGoalTargetDate,
  renameGoal,
  saveDebtFreeGoal,
  updateGoalMonthly,
  updateGoalTarget,
  updateGoalTargetDate,
} from '@/server/goal-actions';
import { loadDebtAccounts } from '@/server/debt';

const SAVED_ON = '2026-09-17';
const SENTENCE =
  'When this goal was saved on Thu, Sep 17, 2026, the bank behind at least one of the debts in it had stopped sharing that balance, so the debt total here includes the last balance we saw for that debt — not necessarily what you owed on it that day.';

describe('frozenSavedDebtGoalNote — one claim, weakest direction', () => {
  it('a stamped row: the save day, "at least one", "includes the last balance we saw", no direction', () => {
    expect(frozenSavedDebtGoalNote(SAVED_ON)).toBe(SENTENCE);
  });

  it('claims neither direction and names no bank or remedy — the row does not know kind, bank or liveness', () => {
    const note = frozenSavedDebtGoalNote(SAVED_ON) as string;
    expect(note).not.toMatch(/higher or lower|may be lower|may be higher/);
    expect(note).not.toMatch(/Your bank/);
    expect(note).not.toMatch(/Accounts shows|reconnect|fix or remove/);
    // No frozen-since date is stored, so the ONLY date printed is the save day.
    expect(note.match(/\b\d{4}\b/g)).toEqual(['2026']);
  });

  it('null, undefined and the empty string are NOT facts — the note is null (the #745 P2-1 rule)', () => {
    expect(frozenSavedDebtGoalNote(null)).toBeNull();
    expect(frozenSavedDebtGoalNote(undefined)).toBeNull();
    expect(frozenSavedDebtGoalNote('')).toBeNull();
  });

  it('the testid is the one the /goals card renders', () => {
    expect(FROZEN_SAVED_DEBT_GOAL_TESTID).toBe('goal-debt-free-frozen');
  });
});

/** A throwaway user with one live checking account and the given liabilities. */
function fixture(tag: string) {
  const U = `l19-saved-${tag}-${Date.now()}-${process.pid}`;
  const mk = (
    name: string,
    type: string,
    balance: number,
    dropped: string | null,
    extra: { aprBps?: number; minimumPaymentCents?: number } = {},
  ) =>
    prisma.account.create({
      data: {
        userId: U,
        provider: 'plaid',
        providerRef: `${U}-${name}`,
        name,
        type,
        currency: 'USD',
        currentBalanceCents: balance,
        feedDroppedAt: dropped,
        ...extra,
      },
    });
  return {
    U,
    async create(liabilities: Parameters<typeof mk>[]) {
      await prisma.user.deleteMany({ where: { id: U } });
      await prisma.user.create({ data: { id: U, email: `${U}@test.local` } });
      await mk('Everyday Checking', 'CHECKING', 500_000, null);
      for (const l of liabilities) await mk(...l);
    },
    async wipe() {
      await prisma.user.deleteMany({ where: { id: U } });
    },
  };
}

const DROPPED = '2026-05-28';

describe('saveDebtFreeGoal — the writer records the fact the solver was handed', () => {
  const frozen = fixture('frozen');
  const live = fixture('live');
  const zero = fixture('zero');

  beforeAll(async () => {
    await frozen.create([
      ['Chase Sapphire', 'CREDIT', 900_000, DROPPED, { aprBps: 2_399 }],
      ['Auto Loan', 'LOAN', 1_430_000, null, { aprBps: 649, minimumPaymentCents: 38_500 }],
    ]);
    await live.create([
      ['Freedom Card', 'CREDIT', 900_000, null, { aprBps: 2_399 }],
      ['Auto Loan', 'LOAN', 1_430_000, null, { aprBps: 649, minimumPaymentCents: 38_500 }],
    ]);
    // A frozen card that owes nothing is outside the total (Σ max(0,·) and the `> 0` read filter),
    // so it may not stamp a total it never entered — the frozen-debt-plan "no balance" rule.
    await zero.create([
      ['Paid Off Card', 'CREDIT', 0, DROPPED, { aprBps: 1_999 }],
      ['Freedom Card', 'CREDIT', 900_000, null, { aprBps: 2_399 }],
    ]);
  });
  afterAll(async () => {
    await Promise.all([frozen.wipe(), live.wipe(), zero.wipe()]);
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function saveAs(userId: string) {
    vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never);
    const today = getProvider().today(userId) as ISODate;
    await saveDebtFreeGoal(addMonthsClamped(today, 36));
    const rows = await prisma.goal.findMany({ where: { userId, kind: 'debt_free' } });
    expect(rows).toHaveLength(1);
    return { today, goal: rows[0] };
  }

  it('one frozen card in the total → frozenAtSave is the save day, and the money is untouched', async () => {
    const debts = await loadDebtAccounts(frozen.U);
    expect(debts.map((d) => d.frozenSince)).toEqual([DROPPED, null]);
    const { today, goal } = await saveAs(frozen.U);
    expect(goal.frozenAtSave).toBe(today);
    // DISCLOSE, ADJUST NOTHING: the persisted total is the same Σ over the same rows.
    expect(goal.targetCents).toBe(900_000 + 1_430_000);
    expect(frozenSavedDebtGoalNote(goal.frozenAtSave)).toMatch(/^When this goal was saved on /);
  });

  it('nothing frozen → frozenAtSave is null (the literal), never a date', async () => {
    const { goal } = await saveAs(live.U);
    expect(goal.frozenAtSave).toBeNull();
    expect(goal.targetCents).toBe(900_000 + 1_430_000);
    expect(frozenSavedDebtGoalNote(goal.frozenAtSave)).toBeNull();
  });

  it('a frozen card with no balance is outside the total, so it stamps nothing', async () => {
    const debts = await loadDebtAccounts(zero.U);
    expect(debts.map((d) => d.name)).toEqual(['Freedom Card']);
    const { goal } = await saveAs(zero.U);
    expect(goal.frozenAtSave).toBeNull();
    expect(goal.targetCents).toBe(900_000);
  });
});

describe('the stamp follows the total: cleared by a hand-typed target, kept by every other edit', () => {
  const U = `l19-saved-edits-${Date.now()}-${process.pid}`;
  let spy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: U } });
    await prisma.user.create({ data: { id: U, email: `${U}@test.local` } });
    const authz = await import('@/server/authz');
    spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(U);
  });
  afterAll(async () => {
    spy.mockRestore();
    await prisma.user.deleteMany({ where: { id: U } });
  });

  async function stampedRow() {
    return prisma.goal.create({
      data: {
        userId: U,
        name: 'Debt-free by Sep 2029',
        kind: 'debt_free',
        targetCents: 2_330_000,
        savedCents: 0,
        targetDate: '2029-09-30',
        monthlyContributionCents: 50_000,
        frozenAtSave: SAVED_ON,
      },
    });
  }

  it('updateGoalTarget on a debt-free row replaces the total AND clears the stamp', async () => {
    const goal = await stampedRow();
    const fd = new FormData();
    fd.set('target', '20000');
    expect((await updateGoalTarget(goal.id, fd)).ok).toBe(true);
    const row = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
    expect(row.targetCents).toBe(2_000_000);
    expect(row.frozenAtSave).toBeNull();
  });

  it('re-saving the pre-filled, UNCHANGED total keeps the stamp — the fact is as true as it was (critic P2-3)', async () => {
    // GoalTargetControl pre-fills the input with the stored total; tapping Save without editing
    // writes the same Σ back. The stamp describes that total, so it must survive the no-op.
    const goal = await stampedRow();
    const fd = new FormData();
    fd.set('target', '$23,300.00');
    expect((await updateGoalTarget(goal.id, fd)).ok).toBe(true);
    const row = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
    expect(row.targetCents).toBe(2_330_000);
    expect(row.frozenAtSave).toBe(SAVED_ON);
  });

  it('a refused target write (blank) leaves the stamp in place — nothing changed, so nothing is un-said', async () => {
    const goal = await stampedRow();
    const fd = new FormData();
    fd.set('target', '   ');
    expect((await updateGoalTarget(goal.id, fd)).ok).toBe(false);
    const row = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
    expect(row.targetCents).toBe(2_330_000);
    expect(row.frozenAtSave).toBe(SAVED_ON);
  });

  it('date, monthly, name and cleared-date edits leave the total alone and so keep the stamp', async () => {
    const goal = await stampedRow();

    const date = new FormData();
    date.set('targetDate', '2030-03');
    expect((await updateGoalTargetDate(goal.id, date)).ok).toBe(true);

    const monthly = new FormData();
    monthly.set('monthly', '750');
    expect((await updateGoalMonthly(goal.id, monthly)).ok).toBe(true);

    const name = new FormData();
    name.set('name', 'Card-free by spring');
    expect((await renameGoal(goal.id, name)).ok).toBe(true);

    expect((await clearGoalTargetDate(goal.id)).ok).toBe(true);

    const row = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
    expect(row.targetCents).toBe(2_330_000);
    expect(row.monthlyContributionCents).toBe(75_000);
    expect(row.name).toBe('Card-free by spring');
    expect(row.targetDate).toBeNull();
    expect(row.frozenAtSave).toBe(SAVED_ON);
  });
});
