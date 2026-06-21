'use server';

/**
 * Manual card statement actions (extends DECISIONS #45). Let a user attach the
 * current statement (+ APR + autopay) to a manual CREDIT card so the Cash-Needed
 * Engine runs the PRECISE path for it instead of dropping it. Every mutation is
 * ownership-scoped AND guarded to manual CREDIT cards — a LINKED (seed/Plaid)
 * card, or any non-credit account, can never be edited through these. The whole
 * write is atomic; audit-logged; revalidates every page the cash-needed answer
 * feeds (dashboard, cards, calendar, coach) plus accounts.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { parseManualStatement, type ManualStatementInput } from '@/lib/engine/cards/manual-statement';
import { auditLog, requireUserId } from '@/server/authz';

export interface CardStatementResult {
  ok: boolean;
  errors?: string[];
}

/** Every cash-needed-derived surface, revalidated after a billing change. */
function revalidateCashNeeded() {
  revalidatePath('/accounts');
  revalidatePath('/dashboard');
  revalidatePath('/cards');
  revalidatePath('/calendar');
  revalidatePath('/coach');
}

async function ownedManualCard(userId: string, accountId: string) {
  const a = await prisma.account.findFirst({ where: { id: accountId, userId } });
  if (!a) throw new Error('Account not found');
  if (a.provider !== 'manual') throw new Error('Only manually-added cards can be edited here.');
  if (a.type !== 'CREDIT') throw new Error('Statements apply to credit cards only.');
  return a;
}

export async function setManualCardStatement(
  input: { accountId: string } & ManualStatementInput,
): Promise<CardStatementResult> {
  const userId = await requireUserId();
  await ownedManualCard(userId, input.accountId);

  const parsed = parseManualStatement(input);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const s = parsed.statement;
  const accountId = input.accountId;

  // One user-maintained statement per manual card: update the existing row in
  // place (so changing the close date can't violate @@unique([accountId,cycleEnd])
  // — there is only ever one under the documented single-writer model). The read
  // precedes the write batch; a manual card is edited by one user with the button
  // disabled while pending, so the read-then-write window is not a real concurrent
  // path (STATUS #10; row-level locks are deferred to ROADMAP #9).
  const existing = await prisma.statement.findFirst({
    where: { accountId },
    orderBy: { cycleEnd: 'desc' },
  });
  const stmtData = {
    cycleStart: s.cycleStart,
    cycleEnd: s.cycleEnd,
    dueDate: s.dueDate,
    statementBalanceCents: s.statementBalanceCents,
    minimumPaymentCents: s.minimumPaymentCents,
    isEstimated: false,
  };

  // Atomic batch (array form — SQLite-friendly: one transaction, no app round-trips
  // holding the write lock; production Postgres handles it identically).
  await prisma.$transaction([
    existing
      ? prisma.statement.update({ where: { id: existing.id }, data: stmtData })
      : prisma.statement.create({ data: { accountId, ...stmtData } }),
    // Billing fields on the account: APR (null clears it — honest: no interest
    // projection without an APR) + the close/due day-of-month so the card still
    // estimates the NEXT cycle once this statement's due date passes.
    prisma.account.update({
      where: { id: accountId },
      data: {
        aprBps: s.aprBps,
        cycleCloseDayOfMonth: s.cycleCloseDayOfMonth,
        dueDayOfMonth: s.dueDayOfMonth,
      },
    }),
    s.autopay
      ? prisma.autopayConfig.upsert({
          where: { accountId },
          update: { mode: s.autopay.mode, fixedAmountCents: s.autopay.fixedAmountCents },
          create: { accountId, mode: s.autopay.mode, fixedAmountCents: s.autopay.fixedAmountCents },
        })
      : prisma.autopayConfig.deleteMany({ where: { accountId } }),
  ]);

  await auditLog(userId, 'card.statement.set', {
    accountId: input.accountId,
    statementBalanceCents: s.statementBalanceCents,
    minimumPaymentCents: s.minimumPaymentCents,
    dueDate: s.dueDate,
    autopay: s.autopay?.mode ?? null,
  });
  revalidateCashNeeded();
  return { ok: true };
}

export async function clearManualCardStatement(accountId: string): Promise<CardStatementResult> {
  const userId = await requireUserId();
  await ownedManualCard(userId, accountId);

  await prisma.$transaction([
    prisma.statement.deleteMany({ where: { accountId } }),
    prisma.autopayConfig.deleteMany({ where: { accountId } }),
    prisma.account.update({
      where: { id: accountId },
      data: { aprBps: null, cycleCloseDayOfMonth: null, dueDayOfMonth: null },
    }),
  ]);

  await auditLog(userId, 'card.statement.clear', { accountId });
  revalidateCashNeeded();
  return { ok: true };
}
