/**
 * Does the L.26 write actually succeed in production?
 *
 * The four statements refreshRecurringForUser commits (recurring.ts:254-261) are
 * replayed inside an INTERACTIVE transaction that always ends in a thrown
 * DELIBERATE_ROLLBACK, so Postgres rolls every one of them back. Row counts are
 * printed before and after and must be identical.
 *
 * The question it answers: does `scheduledTransaction.createMany` throw on the
 * real database? If it does, that throw is invisible in production — it is
 * swallowed by the bare `catch {}` at plaid.ts:1509.
 */
import { prisma } from '@/lib/db';
import { type ISODate } from '@/lib/dates';
import { type RecurringTxn, detectRecurring, toScheduledTransactions } from '@/lib/engine/recurring/detect';
import { activeTerminalSuccessorMap, getReconciliationTxnKeep } from '@/server/reconciliation';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { PAYMENT_ACCOUNT_TYPES } from '@/lib/engine/settings/dials';

const OWNER = 'cmqisanqh000004l7wylnhrpd';
const today = '2026-07-27' as ISODate;
const DETECTED_SCHEDULED_SOURCES = ['payroll-detected', 'recurring'];

const counts = async (label: string) => {
  const [series, scheduled] = await Promise.all([
    prisma.recurringSeries.count({ where: { userId: OWNER } }),
    prisma.scheduledTransaction.count({ where: { account: { userId: OWNER } } }),
  ])
  console.log(`${label}: RecurringSeries=${series}  ScheduledTransaction=${scheduled}`)
  return { series, scheduled }
}

async function main() {
  const before = await counts('BEFORE')

  const txns = await prisma.transaction.findMany({
    where: {
      account: { userId: OWNER, type: { in: [...SPENDING_ACCOUNT_TYPES] }, OR: [{ currency: null }, { currency: 'USD' }] },
      status: 'POSTED',
      isSplitParent: false,
    },
    select: { id: true, accountId: true, date: true, amountCents: true, rawDescriptor: true, isTransfer: true },
  })
  const keepsReconciled = await getReconciliationTxnKeep(OWNER)
  const series = detectRecurring(txns.filter((t) => keepsReconciled(t.accountId, t.date)) as RecurringTxn[], today)

  const canonicals = [...new Set(series.map((s) => s.merchantCanonical))]
  const merchants = await prisma.merchant.findMany({
    where: { canonical: { in: canonicals } },
    select: { id: true, canonical: true },
  })
  const merchantId = new Map(merchants.map((m) => [m.canonical, m.id]))
  const seriesRows = series
    .filter((s) => merchantId.has(s.merchantCanonical))
    .map((s) => ({
      userId: OWNER,
      merchantId: merchantId.get(s.merchantCanonical)!,
      cadence: s.cadence,
      typicalAmountCents: s.typicalAmountCents,
      lastAmountCents: s.lastAmountCents,
      previousAmountCents: s.previousAmountCents,
      possiblyUnused: s.possiblyUnused,
      priceChangedAt: s.priceChangedAt,
      lastSeenAt: s.lastSeenAt,
      nextExpectedAt: s.nextExpectedAt,
      isSubscription: s.isSubscription,
    }))

  const [user, accounts, terminalOf] = await Promise.all([
    prisma.user.findUnique({ where: { id: OWNER }, select: { paymentAccountId: true } }),
    prisma.account.findMany({ where: { userId: OWNER }, select: { id: true, type: true } }),
    activeTerminalSuccessorMap(OWNER),
  ])
  const superseded = new Set(terminalOf.keys())
  const cashAccountIds = new Set(
    accounts
      .filter((a) => (PAYMENT_ACCOUNT_TYPES as readonly string[]).includes(a.type) && !superseded.has(a.id))
      .map((a) => a.id),
  )
  const paymentAccountId =
    (user?.paymentAccountId && cashAccountIds.has(user.paymentAccountId) ? user.paymentAccountId : null) ??
    accounts.find((a) => cashAccountIds.has(a.id))?.id ??
    null
  const onLiveAccounts = terminalOf.size
    ? series.map((s) => {
        const to = terminalOf.get(s.accountId)
        return to === undefined || to === s.accountId ? s : { ...s, accountId: to }
      })
    : series
  const scheduledRows = cashAccountIds.size
    ? toScheduledTransactions(onLiveAccounts, { paymentAccountId, cashAccountIds }, today)
    : []

  console.log(`computed: seriesRows=${seriesRows.length}  scheduledRows=${scheduledRows.length}`)
  console.log('sample scheduled row:', JSON.stringify(scheduledRows[0]))

  let verdict = 'UNKNOWN'
  try {
    await prisma.$transaction(async (tx) => {
      await tx.recurringSeries.deleteMany({ where: { userId: OWNER } })
      const s = await tx.recurringSeries.createMany({ data: seriesRows })
      await tx.scheduledTransaction.deleteMany({
        where: { account: { userId: OWNER }, source: { in: DETECTED_SCHEDULED_SOURCES } },
      })
      const sch = await tx.scheduledTransaction.createMany({ data: scheduledRows })
      console.log(`INSIDE TX: recurringSeries.createMany -> ${s.count}, scheduledTransaction.createMany -> ${sch.count}`)
      throw new Error('DELIBERATE_ROLLBACK')
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('DELIBERATE_ROLLBACK')) {
      verdict = 'WRITE SUCCEEDS — all four statements ran; rolled back on purpose'
    } else {
      verdict = 'WRITE FAILS — this is the error production swallows:'
      console.error('\n>>> PRODUCTION WRITE ERROR <<<')
      console.error(e)
    }
  }

  console.log(`\nVERDICT: ${verdict}`)
  const after = await counts('AFTER (must equal BEFORE)')
  if (after.series !== before.series || after.scheduled !== before.scheduled) {
    console.error('!!! ROLLBACK DID NOT HOLD — counts changed !!!')
    process.exitCode = 2
  } else {
    console.log('rollback held: production data unchanged.')
  }
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
