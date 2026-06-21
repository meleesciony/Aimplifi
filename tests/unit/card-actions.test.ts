/**
 * Manual card statement actions (extends DECISIONS #45) — integration test driving
 * the REAL actions against a throwaway user. Proves: setting a statement makes a
 * manual CREDIT card produce a precise cash-needed obligation; the manual+CREDIT
 * guard rejects linked cards and non-credit accounts; clearing removes it; and the
 * single-statement invariant holds across repeated sets.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { clearManualCardStatement, setManualCardStatement } from '@/server/card-actions';
import { getCashNeeded } from '@/server/finance';
import { getAccountsView } from '@/server/transactions';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers/demo';
import { addDays } from '@/lib/dates';

describe('manual card statement actions (real, throwaway user — extends #45)', () => {
  const USER = `card-user-${Date.now()}-${process.pid}`;
  let manualCardId = '';
  let manualHomeId = '';
  let linkedCardId = '';

  const today = getProvider().today();
  const cycleEnd = addDays(today, -5); // closed recently
  const dueDate = addDays(today, 20); // due soon — selected as the current statement

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    // A CHECKING account so resolvePaymentAccount has a payment account for getCashNeeded.
    await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Joint Checking', type: 'CHECKING', currentBalanceCents: 340_000 },
    });
    const card = await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Chase Freedom', type: 'CREDIT', currentBalanceCents: 150_000 },
    });
    manualCardId = card.id;
    const home = await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Primary home', type: 'REAL_ESTATE', currentBalanceCents: 50_000_000 },
    });
    manualHomeId = home.id;
    const linked = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'Amex', type: 'CREDIT', currentBalanceCents: 90_000 },
    });
    linkedCardId = linked.id;
  });
  afterAll(wipe);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  it('before any statement, the manual card is absent from the cash-needed answer', async () => {
    const { result } = await getCashNeeded(USER, 'PAY_IN_FULL');
    expect(result.cards.find((c) => c.cardId === manualCardId)).toBeUndefined();
  });

  it('setting a statement makes the manual card a precise (non-estimated) obligation', async () => {
    const res = await setManualCardStatement({
      accountId: manualCardId,
      statementBalance: '1200',
      minimumPayment: '35',
      cycleEnd,
      dueDate,
      apr: '24.99',
      autopayMode: 'STATEMENT_BALANCE',
    });
    expect(res.ok).toBe(true);

    const { result } = await getCashNeeded(USER, 'PAY_IN_FULL');
    const ob = result.cards.find((c) => c.cardId === manualCardId);
    expect(ob).toBeDefined();
    expect(ob!.isEstimated).toBe(false);
    expect(ob!.cashRequiredCents).toBe(120_000);
    expect(ob!.remainingDueCents).toBe(120_000);
    expect(ob!.minimumDueCents).toBe(3_500);
    expect(ob!.dueDate).toBe(dueDate);

    // APR + autopay persisted on the account.
    const acct = await prisma.account.findUnique({ where: { id: manualCardId } });
    expect(acct!.aprBps).toBe(2499);
    const ap = await prisma.autopayConfig.findUnique({ where: { accountId: manualCardId } });
    expect(ap!.mode).toBe('STATEMENT_BALANCE');
  });

  it('rejects invalid input without persisting (and a min over balance)', async () => {
    const r = await setManualCardStatement({
      accountId: manualCardId,
      statementBalance: '100',
      minimumPayment: '500',
      cycleEnd: 'not-a-date',
      dueDate,
    });
    expect(r.ok).toBe(false);
    expect(r.errors!.length).toBeGreaterThanOrEqual(2);
    // The previous good statement is untouched.
    const count = await prisma.statement.count({ where: { accountId: manualCardId } });
    expect(count).toBe(1);
    expect((await prisma.statement.findFirst({ where: { accountId: manualCardId } }))!.statementBalanceCents).toBe(120_000);
  });

  it('re-setting keeps exactly one statement (no duplicate) and reflects the latest', async () => {
    await setManualCardStatement({
      accountId: manualCardId,
      statementBalance: '1500',
      minimumPayment: '50',
      cycleEnd,
      dueDate,
      autopayMode: 'NONE',
    });
    const stmts = await prisma.statement.findMany({ where: { accountId: manualCardId } });
    expect(stmts.length).toBe(1);
    expect(stmts[0].statementBalanceCents).toBe(150_000);
    // Autopay NONE removed the prior config.
    expect(await prisma.autopayConfig.findUnique({ where: { accountId: manualCardId } })).toBeNull();
  });

  it('refuses a LINKED card and a non-credit manual account', async () => {
    await expect(
      setManualCardStatement({ accountId: linkedCardId, statementBalance: '100', minimumPayment: '10', cycleEnd, dueDate }),
    ).rejects.toThrow(/manually-added/i);
    await expect(
      setManualCardStatement({ accountId: manualHomeId, statementBalance: '100', minimumPayment: '10', cycleEnd, dueDate }),
    ).rejects.toThrow(/credit cards only/i);
    await expect(clearManualCardStatement(linkedCardId)).rejects.toThrow(/manually-added/i);
  });

  it('clearing removes the statement and drops the card from the answer again', async () => {
    await clearManualCardStatement(manualCardId);
    expect(await prisma.statement.count({ where: { accountId: manualCardId } })).toBe(0);
    const acct = await prisma.account.findUnique({ where: { id: manualCardId } });
    expect(acct!.aprBps).toBeNull();
    expect(acct!.cycleCloseDayOfMonth).toBeNull();
    const { result } = await getCashNeeded(USER, 'PAY_IN_FULL');
    expect(result.cards.find((c) => c.cardId === manualCardId)).toBeUndefined();
  });

  it('persists + re-hydrates FIXED_AMOUNT autopay, and the engine splits it correctly (F2)', async () => {
    await setManualCardStatement({
      accountId: manualCardId,
      statementBalance: '1000',
      minimumPayment: '40',
      cycleEnd,
      dueDate,
      autopayMode: 'FIXED_AMOUNT',
      autopayFixedAmount: '250',
    });
    const ap = await prisma.autopayConfig.findUnique({ where: { accountId: manualCardId } });
    expect(ap!.mode).toBe('FIXED_AMOUNT');
    expect(ap!.fixedAmountCents).toBe(25_000);

    // The accounts view now carries the fixed amount so the editor can re-hydrate it.
    const view = await getAccountsView(USER);
    expect(view.cardBilling[manualCardId].autopayMode).toBe('FIXED_AMOUNT');
    expect(view.cardBilling[manualCardId].autopayFixedAmountCents).toBe(25_000);

    // Engine: autopay covers min(fixed $250, remaining $1,000) → user must pay the $750 remainder.
    const { result } = await getCashNeeded(USER, 'PAY_IN_FULL');
    const ob = result.cards.find((c) => c.cardId === manualCardId);
    expect(ob!.cashRequiredCents).toBe(100_000);
    expect(ob!.autopayCents).toBe(25_000);
    expect(ob!.userActionCents).toBe(75_000);
  });

  it('re-setting without an APR wipes a previously-saved APR (F4)', async () => {
    await setManualCardStatement({ accountId: manualCardId, statementBalance: '1000', minimumPayment: '40', cycleEnd, dueDate, apr: '19.99' });
    expect((await prisma.account.findUnique({ where: { id: manualCardId } }))!.aprBps).toBe(1999);
    // Re-entry replaces ALL billing fields — omitting APR clears it (documented).
    await setManualCardStatement({ accountId: manualCardId, statementBalance: '1000', minimumPayment: '40', cycleEnd, dueDate });
    expect((await prisma.account.findUnique({ where: { id: manualCardId } }))!.aprBps).toBeNull();
  });

  it('clearing a card that never had a statement is an idempotent no-op (F3)', async () => {
    const fresh = await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Empty Card', type: 'CREDIT', currentBalanceCents: 10_000 },
    });
    const res = await clearManualCardStatement(fresh.id);
    expect(res.ok).toBe(true);
    expect(await prisma.statement.count({ where: { accountId: fresh.id } })).toBe(0);
    expect(await prisma.autopayConfig.findUnique({ where: { accountId: fresh.id } })).toBeNull();
    expect((await prisma.account.findUnique({ where: { id: fresh.id } }))!.aprBps).toBeNull();
  });
});
