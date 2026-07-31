/**
 * READ-ONLY replay of refreshRecurringForUser against the PRODUCTION database.
 *
 * Mirrors src/server/recurring.ts:87-263 statement for statement, importing the
 * REAL helpers, with exactly two omissions — both writes:
 *   - the incomePauseConfirmation.deleteMany (recurring.ts:214)
 *   - the final $transaction full-replace   (recurring.ts:254-261)
 *
 * Fidelity check: the series count it reports must equal the RecurringSeries
 * rows production already holds. If it does, its scheduledRows count is the
 * number the live sync is writing.
 */
import { type ISODate } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { type RecurringTxn, detectRecurring, toScheduledTransactions } from '@/lib/engine/recurring/detect';
import { getRecurringOverrides } from '@/server/recurring-overrides';
import { confirmedPauseState } from '@/lib/engine/income/pause';
import { activeTerminalSuccessorMap, getReconciliationTxnKeep } from '@/server/reconciliation';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { PAYMENT_ACCOUNT_TYPES } from '@/lib/engine/settings/dials';

const OWNER = process.env.REPLAY_USER_ID ?? 'cmqisanqh000004l7wylnhrpd';
const today = (process.env.REPLAY_TODAY ?? '2026-07-27') as ISODate;

async function main() {
  console.log(`replay user=${OWNER} today=${today}`);

  const txns = await prisma.transaction.findMany({
    where: {
      account: { userId: OWNER, type: { in: [...SPENDING_ACCOUNT_TYPES] }, OR: [{ currency: null }, { currency: 'USD' }] },
      status: 'POSTED',
      isSplitParent: false,
    },
    select: { id: true, accountId: true, date: true, amountCents: true, rawDescriptor: true, isTransfer: true },
  });
  console.log(`txns fed to detection (pre-keep): ${txns.length}`);

  const keepsReconciled = await getReconciliationTxnKeep(OWNER);
  const kept = txns.filter((t) => keepsReconciled(t.accountId, t.date));
  console.log(`txns after the reconciliation keep rule: ${kept.length} (dropped ${txns.length - kept.length})`);

  const series = detectRecurring(kept as RecurringTxn[], today, await getRecurringOverrides(OWNER));
  console.log(`detectRecurring -> ${series.length} series`);

  const [user, accounts, terminalOf] = await Promise.all([
    prisma.user.findUnique({ where: { id: OWNER }, select: { paymentAccountId: true } }),
    prisma.account.findMany({ where: { userId: OWNER }, select: { id: true, type: true } }),
    activeTerminalSuccessorMap(OWNER),
  ]);
  const superseded = new Set(terminalOf.keys());
  const cashAccountIds = new Set(
    accounts
      .filter((a) => (PAYMENT_ACCOUNT_TYPES as readonly string[]).includes(a.type) && !superseded.has(a.id))
      .map((a) => a.id),
  );
  const paymentAccountId =
    (user?.paymentAccountId && cashAccountIds.has(user.paymentAccountId) ? user.paymentAccountId : null) ??
    accounts.find((a) => cashAccountIds.has(a.id))?.id ??
    null;

  console.log(`terminalOf (re-key map) size: ${terminalOf.size}`);
  console.log(`superseded ids: ${superseded.size}`);
  console.log(`cashAccountIds: ${cashAccountIds.size} -> ${[...cashAccountIds].join(', ')}`);
  console.log(`paymentAccountId: ${paymentAccountId}`);

  const confirmations = await prisma.incomePauseConfirmation.findMany({
    where: { userId: OWNER },
    select: { merchantCanonical: true },
  });
  let projectable = series;
  if (confirmations.length > 0) {
    const excluded = new Set<string>();
    for (const c of confirmations) {
      const state = confirmedPauseState(series, today, c.merchantCanonical);
      if (state.status === 'paused') excluded.add(c.merchantCanonical);
    }
    if (excluded.size > 0) projectable = series.filter((s) => !(s.isIncome && excluded.has(s.merchantCanonical)));
  }
  console.log(`income-pause confirmations: ${confirmations.length}; projectable series: ${projectable.length}`);

  const onLiveAccounts = terminalOf.size
    ? projectable.map((s) => {
        const to = terminalOf.get(s.accountId);
        return to === undefined || to === s.accountId ? s : { ...s, accountId: to };
      })
    : projectable;

  const rekeyed = onLiveAccounts.filter((s, i) => s.accountId !== projectable[i]!.accountId).length;
  console.log(`series re-keyed onto a live successor (L.26): ${rekeyed}`);

  console.log('\n--- every projectable series, after re-key ---');
  const accType = new Map(accounts.map((a) => [a.id, a.type]));
  for (const s of onLiveAccounts) {
    console.log(
      [
        s.merchantCanonical.padEnd(28).slice(0, 28),
        s.cadence.padEnd(10),
        String(s.typicalAmountCents).padStart(9),
        s.isIncome ? 'INCOME ' : 'expense',
        `lastSeen=${s.lastSeenAt}`,
        `acct=${(accType.get(s.accountId) ?? '??').padEnd(10)}`,
        cashAccountIds.has(s.accountId) ? 'IN-CASH-SCOPE' : 'out-of-scope',
      ].join('  '),
    );
  }

  const scheduledRows = cashAccountIds.size
    ? toScheduledTransactions(onLiveAccounts, { paymentAccountId, cashAccountIds }, today)
    : [];

  console.log(`\n=== RESULT: scheduledRows = ${scheduledRows.length} ===`);
  for (const r of scheduledRows) {
    console.log(`  ${r.nextDate}  ${String(r.amountCents).padStart(9)}  ${r.cadence ?? 'one-off'}  ${r.source}  ${r.description}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
