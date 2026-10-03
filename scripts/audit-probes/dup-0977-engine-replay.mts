/** READ-ONLY (owner-authorized 2026-10-03): replay the shipped snapshot boundary and the
 * cash-needed / net-worth engines over the 0977 owner's live rows, loaded with plain SELECTs.
 * Mirrors DemoProvider.getFinanceSnapshot + cashNeededFromSnapshot (finance.ts) using the
 * same pure functions, so the question "does 0977 count twice in the money" is answered by
 * the code production runs, not by a reading of it. Never prints the connection string.
 * (Omits the C.25 loan-flow exclusions — they touch loan accounts only, not cards.) */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { holidayTable, isoDate } from '@/lib/dates';
import { applyReconciliationBoundary } from '@/lib/engine/account/reconcile-boundary';
import { assembleCashNeededInput, netWorthCents } from '@/lib/engine/cash-needed/assemble';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { trendHistoryFloor } from '@/lib/engine/networth/snapshot-plan';
import { netWorthSeries } from '@/lib/engine/networth/series';
import { isSupportedCurrency } from '@/lib/providers/currency';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();
// Owner-scoped: abort unless exactly one user owns a 0977 row (critic P2-6) — never print a
// second user's accounts under the owner's authorization.
const owners0977 = (await c.query(`select distinct "userId" from "Account" where mask = '0977'`)).rows;
if (owners0977.length !== 1) { console.error(`expected exactly one 0977 owner, found ${owners0977.length} — aborting`); await c.end(); process.exit(1); }
const ownerId: string = owners0977[0].userId;

const userId = ownerId;
const q = async (sql: string, params: unknown[] = [userId]) => (await c.query(sql, params)).rows;
const user = (await q(`select "paymentAccountId" from "User" where id = $1`))[0];
const accounts = await q(`select * from "Account" where "userId" = $1 order by id asc`);
const own = `"accountId" in (select id from "Account" where "userId" = $1)`;
const autopays = await q(`select * from "AutopayConfig" where ${own}`);
const statements = await q(`select * from "Statement" where ${own} order by "cycleEnd" asc`);
const cardPayments = await q(
  `select * from "CardPayment" where "statementId" in (select id from "Statement" where ${own})`,
);
const transactions = await q(
  `select * from "Transaction" where "accountId" in (select id from "Account" where "userId" = $1 and type = any($2))
    order by date asc, id asc`,
  [userId, [...SPENDING_ACCOUNT_TYPES]],
);
const scheduled = await q(`select * from "ScheduledTransaction" where ${own}`);
const replayToday = isoDate(process.env.REPLAY_TODAY ?? '2026-10-03');
const balanceSnapshots = await q(
  `select "accountId", date, "balanceCents", "accountType" from "BalanceSnapshot"
    where ${own} and date >= $2 order by date asc`,
  [userId, trendHistoryFloor(replayToday)],
);
const links = await q(
  `select "predecessorAccountId", "successorAccountId", "cutoverDate" from "AccountReconciliation"
    where "userId" = $1 and "undoneAt" is null order by "confirmedByUserAt" asc`,
);
await c.end();

const supported = accounts.filter((a) => isSupportedCurrency(a.currency));
const ids = new Set(supported.map((a) => a.id));
const boundary = applyReconciliationBoundary({
  paymentAccountId: user?.paymentAccountId ?? null,
  accounts: supported,
  transactions: transactions.filter((t) => ids.has(t.accountId)),
  balanceSnapshots: balanceSnapshots.filter((b) => ids.has(b.accountId)),
  statements: statements.filter((s) => ids.has(s.accountId)),
  scheduled: scheduled.filter((s) => ids.has(s.accountId)),
  links,
});
const superseded = new Set(boundary.supersededAccountIds);
const short = (s: string) => s.slice(-6);

console.log('active links:', links.length, '| effective predecessors:', superseded.size);
const z = boundary.accounts.filter((a) => a.mask === '0977');
console.log('\n0977 rows after the boundary:');
console.table(z.map((a) => ({ id: short(a.id), plaidItemId: a.plaidItemId?.slice(-6), superseded: superseded.has(a.id), balanceAfterBoundary: a.currentBalanceCents })));
const zTxn = boundary.transactions.filter((t) => z.some((a) => a.id === t.accountId));
console.log('0977 transactions kept per row:', Object.fromEntries(z.map((a) => [short(a.id), zTxn.filter((t) => t.accountId === a.id).length])));

console.log('\nnet worth (cents), all rows raw  :', String(netWorthCents(supported)));
console.log('net worth (cents), after boundary:', String(netWorthCents([...boundary.accounts])));

const obligationAccounts = boundary.accounts.filter((a) => !superseded.has(a.id));
const today = isoDate(process.env.REPLAY_TODAY ?? '2026-10-03');
const year = Number(today.slice(0, 4));
const payment =
  obligationAccounts.find((a) => a.id === boundary.paymentAccountId) ??
  obligationAccounts.find((a) => a.type === 'CHECKING') ??
  obligationAccounts[0];
const input = assembleCashNeededInput({
  today,
  scenario: 'PAY_IN_FULL',
  paymentAccountId: payment.id,
  accounts: obligationAccounts,
  autopays,
  statements: [...boundary.statements],
  cardPayments,
  transactions: [...boundary.transactions],
  scheduled: [...boundary.scheduled],
  holidayTable: holidayTable(year - 1, year + 1),
});
const result = computeCashNeeded(input);
const cardRows = [...result.cards, ...result.unknownDueDateCards] as { cardId: string; cardName?: string }[];
const byId = new Map(accounts.map((a) => [a.id, a]));
console.log('\ncash-needed card rows (PAY_IN_FULL):');
console.table(cardRows.map((r) => ({ id: short(r.cardId), mask: byId.get(r.cardId)?.mask, provider: byId.get(r.cardId)?.provider, name: byId.get(r.cardId)?.name })));
const masks = cardRows.map((r) => byId.get(r.cardId)?.mask).filter(Boolean);
console.log('masks appearing more than once:', [...new Set(masks.filter((m, i) => masks.indexOf(m) !== i))]);

// Net-worth trend: does any date carry a 0977 balance from BOTH rows, or ANY last-4 twice?
// SHIPPED_SHAPE=1 replays the pre-fix call (no superseded list) for a before/after comparison.
const series = netWorthSeries({
  snapshots: [...boundary.balanceSnapshots],
  accounts: [...boundary.accounts],
  supersededAccountIds: process.env.SHIPPED_SHAPE === '1' ? [] : boundary.supersededAccountIds,
  today: replayToday,
});
const zIds = new Set(z.map((a) => a.id));
const doubled0977 = series.filter((p) => p.constituents.filter((k) => zIds.has((k as { accountId: string }).accountId)).length > 1);
console.log('\nnet-worth trend points:', series.length, '| points with BOTH 0977 rows:', doubled0977.length);
const anyMaskTwice = series.flatMap((p) => {
  const ms = p.constituents.map((k) => byId.get((k as { accountId: string }).accountId)?.mask).filter(Boolean);
  const dup = [...new Set(ms.filter((m, i) => ms.indexOf(m) !== i))];
  return dup.length ? [{ date: p.date, masks: dup.join(',') }] : [];
});
console.log('trend points where any last-4 counts twice:', anyMaskTwice.length);
if (anyMaskTwice.length) console.table(anyMaskTwice.slice(-12));
console.log('constituent keys sample:', Object.keys(series.at(-1)?.constituents[0] ?? {}));

// Which 0977 constituents, at what balance, on every point.
const watch = new Set(['0977']);
for (const p of series) {
  const hits = p.constituents.filter((k) => watch.has(byId.get((k as { accountId: string }).accountId)?.mask ?? ''));
  console.log(p.date, 'NW', p.netWorthCents, hits.map((k) => `${short((k as { accountId: string }).accountId)}:${(k as { balanceCents: number }).balanceCents}`).join(' '));
}
const rawToday = balanceSnapshots.filter((b) => b.date >= '2026-09-01' && [...ids].some((i) => i === b.accountId) && watch.has(byId.get(b.accountId)?.mask ?? ''));
console.log('\nraw snapshots since 2026-09-01 for 0977 rows:');
console.table(rawToday.map((b) => ({ id: short(b.accountId), date: b.date, bal: b.balanceCents, superseded: superseded.has(b.accountId) })));

// The net-worth card's change line (netWorthDelta over the last two points), as shipped and with
// combined-away rows in the live point, from whatever engine is on disk.
const { netWorthDelta } = await import('@/lib/engine/networth/panel');
const last = series.at(-1)!;
const prev = series.at(-2)!;
console.log('\nlive point constituents:', last.constituents.length, '| of which combined-away (superseded):', last.constituents.filter((k) => superseded.has(k.accountId)).length);
console.log('live point figure === headline net worth:', last.netWorthCents === Number(netWorthCents([...boundary.accounts])));
console.log('change line:', JSON.stringify(netWorthDelta(prev, last)));
const prevIds = new Set(prev.constituents.map((k) => k.accountId));
console.log('joined since previous point:', last.constituents.filter((k) => !prevIds.has(k.accountId)).map((k) => `${k.name} ${byId.get(k.accountId)?.provider}`));
