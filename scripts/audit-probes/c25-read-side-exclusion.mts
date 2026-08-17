/**
 * READ-ONLY production probe — C.25 (#403): the read-side loan-payment
 * exclusion, replayed against the live rows.
 *
 * Every statement is a SELECT. Nothing is written.
 *
 * Prints, in order:
 *   1. the eligible merchants (edge facts: canonical, loan account, pair
 *      months, obligation amounts) and the row ids the exclusion removes;
 *   2. month-by-month `monthlyFlows` BEFORE (the stored flags, exactly what
 *      /reports prints today) and AFTER (the same rows plus the exclusion
 *      set) — the defect is any month-to-month movement in the BEFORE
 *      column the loan payment causes, and the fix is the AFTER column
 *      staying level.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { selectLoanObligations } from '../../src/lib/engine/loans/obligations';
import { loanPaymentFlowExclusions } from '../../src/lib/engine/categorize/loan-payment-flows';
import { monthlyFlows, type TxnLike } from '../../src/lib/engine/fi/insights';
import { holidayTable, isoDate } from '../../src/lib/dates';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const money = (v: number) =>
  `${v < 0 ? '-' : ''}$${Math.abs(v / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The owner = the account with real linked items (never the shared demo row).
const users = await c.query<{ id: string; email: string }>(
  `select u.id, u.email from "User" u
   where exists (select 1 from "Account" a where a."userId" = u.id and a."plaidItemId" is not null)
   order by u.id asc`,
);
if (users.rows.length === 0) throw new Error('no linked user found');
const user = users.rows[0];
console.log(`user ${user.id} <${user.email}>`);

const accounts = (
  await c.query<{ id: string; name: string; type: string; minimumPaymentCents: number | null; dueDayOfMonth: number | null }>(
    `select id, name, type, "minimumPaymentCents", "dueDayOfMonth" from "Account"
     where "userId" = $1 and (currency is null or currency = 'USD') order by id`,
    [user.id],
  )
).rows;
const typeById = new Map(accounts.map((a) => [a.id, a.type]));
const loanAccounts = accounts.filter((a) => a.type === 'LOAN' || a.type === 'MORTGAGE');
console.log(`\n══ loan/mortgage accounts: ${loanAccounts.map((a) => `${a.name} (${a.type})`).join(', ') || '(none)'} ══`);

const today = isoDate(new Date().toISOString().slice(0, 10));
const year = Number(today.slice(0, 4));
const obligations = selectLoanObligations({
  accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, minimumPaymentCents: a.minimumPaymentCents, dueDayOfMonth: a.dueDayOfMonth })),
  today,
  holidays: holidayTable(year - 1, year + 1),
});
console.log(`dateable obligations: ${obligations.map((o) => `${o.accountName} ${money(o.paymentCents)}`).join(', ') || '(none)'}`);

const spendRows = (
  await c.query<{ id: string; accountId: string; date: string; amountCents: string; rawDescriptor: string; status: string; isSplitParent: boolean; excludeFromTotals: boolean | null; isTransfer: boolean }>(
    `select t.id, t."accountId", t.date, t."amountCents"::text, t."rawDescriptor", t.status, t."isSplitParent", t."excludeFromTotals", t."isTransfer"
     from "Transaction" t join "Account" a on a.id = t."accountId"
     where a."userId" = $1 and a.type in ('CHECKING','SAVINGS','CREDIT') and t."isSplitParent" = false
     order by t.date`,
    [user.id],
  )
).rows.map((r) => ({ ...r, amountCents: Number(r.amountCents) }));
const loanInflows = (
  await c.query<{ id: string; accountId: string; date: string; amountCents: string }>(
    `select t.id, t."accountId", t.date, t."amountCents"::text
     from "Transaction" t join "Account" a on a.id = t."accountId"
     where a."userId" = $1 and a.type in ('LOAN','MORTGAGE') and t."amountCents" > 0 and t.status = 'POSTED'
       and (a.currency is null or a.currency = 'USD')`,
    [user.id],
  )
).rows.map((r) => ({ ...r, amountCents: Number(r.amountCents) }));

const { excludeIds, excluded } = loanPaymentFlowExclusions({
  rows: spendRows,
  loanInflows,
  accountTypeById: typeById,
  obligations: obligations.map((o) => ({ accountId: o.accountId, paymentCents: o.paymentCents })),
});
console.log(`\n══ exclusion: ${excludeIds.size} row(s), ${excluded.length} merchant edge(s) ══`);
for (const e of excluded) {
  const loan = accounts.find((a) => a.id === e.accountId);
  console.log(`  ${e.canonical} -> ${loan?.name ?? e.accountId} @ ${money(e.paymentCents)}/mo`);
}
const byMonth = new Map<string, number>();
for (const r of spendRows) {
  if (!excludeIds.has(r.id)) continue;
  const m = r.date.slice(0, 7);
  byMonth.set(m, (byMonth.get(m) ?? 0) + -r.amountCents);
  const acct = accounts.find((a) => a.id === r.accountId);
  console.log(
    `  row ${r.date} ${money(r.amountCents).padStart(12)} ${r.rawDescriptor.padEnd(28)} on ${acct?.name ?? r.accountId} storedFlag=${r.isTransfer}`,
  );
}
for (const [m, v] of [...byMonth].sort()) console.log(`  month ${m}: ${money(v)} total in the set`);

const toTxn = (r: (typeof spendRows)[number]): TxnLike => ({
  id: r.id,
  date: r.date,
  amountCents: r.amountCents,
  rawDescriptor: r.rawDescriptor,
  accountId: r.accountId,
  isTransfer: r.isTransfer,
  status: r.status,
  isSplitParent: r.isSplitParent,
  excludeFromTotals: r.excludeFromTotals,
});
const txns = spendRows.map(toTxn);
const before = monthlyFlows(txns);
const after = monthlyFlows(txns, excludeIds);
console.log(`\n══ monthly spending: BEFORE (stored flags) vs AFTER (read-side exclusion) ══`);
const afterByMonth = new Map(after.map((f) => [f.month, f]));
for (const b of before) {
  const a = afterByMonth.get(b.month)!;
  const moved = b.expensesCents !== a.expensesCents;
  console.log(
    `  ${b.month}  expenses ${money(b.expensesCents).padStart(12)} -> ${money(a.expensesCents).padStart(12)}${moved ? '   (changed)' : ''}`,
  );
}
// The assertion the defect is named by: does the AFTER column still vary
// month to month by more than ordinary spending? Print its spread.
const exp = after.map((f) => f.expensesCents);
console.log(`\nAFTER spread: min ${money(Math.min(...exp))} / max ${money(Math.max(...exp))}`);

await c.end();
